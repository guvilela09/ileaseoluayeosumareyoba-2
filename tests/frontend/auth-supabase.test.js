import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAuth} from '../../src/lib/auth.js';
import {createApi} from '../../src/lib/api.js';

function fakeClient(session=null,{status='SUBSCRIBED',track=async()=>{},initialPresence={'u1':[{userId:'u1'}],'u2':[]},syncTrack=true}={}) {
  const calls=[];
  let stateListener;
  let presenceState=initialPresence;
  const presenceListeners=[];
  let subscribeStatus=status;
  const channel={
    on:(type,options,callback)=>{calls.push(['presence-on',type,options]);if(type==='presence')presenceListeners.push(callback);return channel;},
    subscribe:callback=>{calls.push(['presence-subscribe']);callback(subscribeStatus);return channel;},
    track:async payload=>{calls.push(['presence-track',payload]);const result=await track(payload);if(result==='error'||result==='timed out')return result;if(syncTrack){presenceState={...presenceState,[payload.userId]:[{userId:payload.userId}]};presenceListeners.forEach(callback=>callback());}return result||'ok';},
    presenceState:()=>presenceState,
  };
  const auth={
    getSession:async()=>({data:{session},error:null}),
    getUser:async()=>({data:{user:{id:'u1'}},error:null}),
    onAuthStateChange:callback=>{stateListener=callback;return {data:{subscription:{unsubscribe(){calls.push(['unsubscribe']);}}}};},
    signInWithOAuth:async options=>{calls.push(['oauth',options]);return {data:{url:'https://accounts.google.test',provider:'google'},error:null};},
    signInWithPassword:async credentials=>{calls.push(['password',credentials]);return {data:{user:{id:'u1'},session:{access_token:'jwt'}},error:null};},
    signUp:async options=>{calls.push(['signup',options]);return {data:{user:{id:'u1'},session:null},error:null};},
    resetPasswordForEmail:async(email,options)=>{calls.push(['reset',email,options]);return {error:null};},
    updateUser:async attributes=>{calls.push(['updateUser',attributes]);return {data:{user:{id:'u1'}},error:null};},
    signOut:async()=>{calls.push(['signOut']);return {error:null};},
  };
  return {auth,storage:{from:()=>({upload:async(...args)=>{calls.push(['storage-upload',args[0]]);return {data:{path:args[0]},error:null};}})},channel:topic=>{calls.push(['channel',topic]);return channel;},removeChannel:async value=>calls.push(['removeChannel',value.presenceKey]),calls,emit:(event,nextSession)=>stateListener(event,nextSession),setPresence:value=>{presenceState=value;presenceListeners.forEach(callback=>callback());},setPresenceStatus:value=>{subscribeStatus=value;}};
}

test('creates Supabase auth from only public browser configuration',async()=>{
  const fake=fakeClient();
  const auth=createAuth({supabase:{url:'https://example.supabase.co',publishableKey:'sb_publishable_test'}},()=>fake,{origin:'https://portal.example'});
  assert.equal(await auth.getToken(),null);
  assert.equal(auth.currentUser(),null);
});

test('restores the Supabase session and notifies auth state subscribers',async()=>{
  const fake=fakeClient({user:{id:'u1'},access_token:'restored-jwt'});
  const auth=createAuth({supabase:{url:'https://example.supabase.co',publishableKey:'sb_publishable_test'}},()=>fake);
  let received;
  const unsubscribe=auth.subscribe(user=>{received=user;});
  fake.emit('INITIAL_SESSION',{user:{id:'u1'},access_token:'restored-jwt'});
  assert.equal(await auth.getToken(),'restored-jwt');
  assert.equal(received.id,'u1');
  unsubscribe();
  assert.deepEqual(fake.calls.at(-1),['unsubscribe']);
});

test('forwards PASSWORD_RECOVERY and saves a new password without requiring the old one',async()=>{
  const fake=fakeClient();
  const auth=createAuth({supabase:{url:'https://example.supabase.co',publishableKey:'sb_publishable_test'}},()=>fake);
  let event;
  auth.subscribe((_user,nextEvent)=>{event=nextEvent;});
  fake.emit('PASSWORD_RECOVERY',{user:{id:'u1'},access_token:'recovery-jwt'});
  await auth.setNewPassword('new-password-123');
  assert.equal(event,'PASSWORD_RECOVERY');
  assert.deepEqual(fake.calls.find(call=>call[0]==='updateUser'),['updateUser',{password:'new-password-123'}]);
});

test('Google login initiates OAuth redirect back to current app origin',async()=>{
  const fake=fakeClient();
  const auth=createAuth({supabase:{url:'https://example.supabase.co',publishableKey:'sb_publishable_test'}},()=>fake,{origin:'https://portal.example'});
  await auth.loginGoogle();
  assert.equal(fake.calls[0][0],'oauth');
  assert.equal(fake.calls[0][1].provider,'google');
  assert.equal(fake.calls[0][1].options.redirectTo,'https://portal.example/');
});

test('password login, registration and reset use Supabase Auth APIs',async()=>{
  const fake=fakeClient();
  const auth=createAuth({supabase:{url:'https://example.supabase.co',publishableKey:'sb_publishable_test'}},()=>fake);
  await auth.loginEmail(' person@example.com ','password123');
  await auth.register(' person@example.com ','password123',' Pessoa ');
  await auth.resetPassword('person@example.com');
  assert.deepEqual(fake.calls.filter(call=>['password','signup','reset'].includes(call[0])).map(call=>call[0]),['password','signup','reset']);
  assert.equal(fake.calls.find(call=>call[0]==='signup')[1].options.data.name,'Pessoa');
});

test('uploads DOCX files with a Storage-safe ASCII filename',async()=>{
  const fake=fakeClient();
  const auth=createAuth({supabase:{url:'https://example.supabase.co',publishableKey:'sb_publishable_test'}},()=>fake);
  const file=new File(['PK document'],'Ebó Ejiofùn!.docx',{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});

  const result=await auth.upload(file,'import');
  const path=fake.calls.find(call=>call[0]==='storage-upload')[1];
  assert.match(path,/^uploads\/u1\/[0-9a-f-]+-Eb__Ejiof_n_\.docx$/i);
  assert.doesNotMatch(path,/[\u0080-\uFFFF]/);
  assert.equal(result.filename,'Eb__Ejiof_n_.docx');
});

test('tracks authenticated presence and returns online user states',async()=>{
  const fake=fakeClient();
  const auth=createAuth({supabase:{url:'https://example.supabase.co',publishableKey:'sb_publishable_test'}},()=>fake);
  await auth.startPresence({id:'u1'});
  await auth.getPresence();
  assert.deepEqual(await auth.getPresence(),{u1:true,u2:false});
  assert.equal(fake.calls.find(call=>call[0]==='channel')[1],'portal-presence');
  assert.equal(fake.calls.some(call=>call[0]==='presence-track'&&call[1].userId==='u1'),true);
  await auth.stopPresence();
});

test('does not report a user offline before their presence tracking has completed',async()=>{
  let releaseTrack;
  const fake=fakeClient(null,{initialPresence:{},track:()=>new Promise(resolve=>{releaseTrack=resolve;})});
  const auth=createAuth({supabase:{url:'https://example.supabase.co',publishableKey:'sb_publishable_test'}},()=>fake);
  await auth.startPresence({id:'u1'});
  let settled=false;
  const result=auth.getPresence().then(value=>{settled=true;return value;});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(settled,false);
  releaseTrack();
  assert.equal((await result).u1,true);
});

test('reports the current user online after track succeeds even before the first presence sync',async()=>{
  const fake=fakeClient(null,{initialPresence:{},syncTrack:false});
  const auth=createAuth({supabase:{url:'https://example.supabase.co',publishableKey:'sb_publishable_test'}},()=>fake);
  await auth.startPresence({id:'u1'});
  assert.deepEqual(await auth.getPresence(),{u1:true});
  await auth.stopPresence();
});

test('publishes fresh presence snapshots and treats a Realtime failure as unavailable',async()=>{
  const fake=fakeClient();
  const auth=createAuth({supabase:{url:'https://example.supabase.co',publishableKey:'sb_publishable_test'}},()=>fake);
  await auth.startPresence({id:'u1'});
  await auth.getPresence();
  const snapshots=[];
  const unsubscribe=auth.subscribePresence(value=>snapshots.push(value));
  fake.setPresence({'u1':[],'u2':[{userId:'u2'}],'u3':[]});
  assert.deepEqual(snapshots.at(-1),{u1:true,u2:true,u3:false});
  unsubscribe();
  await auth.stopPresence();
  assert.equal(await auth.getPresence(),null);

  const failed=fakeClient(null,{status:'CHANNEL_ERROR'});
  const unavailable=createAuth({supabase:{url:'https://example.supabase.co',publishableKey:'sb_publishable_test'}},()=>failed);
  await unavailable.startPresence({id:'u1'});
  assert.equal(await unavailable.getPresence(),null);

  const trackingFailed=fakeClient(null,{track:async()=>'error'});
  const trackingUnavailable=createAuth({supabase:{url:'https://example.supabase.co',publishableKey:'sb_publishable_test'}},()=>trackingFailed);
  await trackingUnavailable.startPresence({id:'u1'});
  assert.equal(await trackingUnavailable.getPresence(),null);
});

test('refuses incomplete public configuration without constructing a client',()=>{
  assert.throws(()=>createAuth({supabase:{url:'',publishableKey:''}},()=>assert.fail('client should not be created')),/Supabase ainda não configurado/);
});

test('API sends the current Supabase access token as a bearer credential',async()=>{
  const oldFetch=globalThis.fetch;
  let request;
  globalThis.fetch=async(path,options)=>{request={path,options};return {ok:true,json:async()=>({ok:true})};};
  try{
    const api=createApi(async()=>'supabase-user-jwt',null,'supabase');
    await api('/api/session');
    assert.equal(request.options.headers.Authorization,'Bearer supabase-user-jwt');
  }finally{globalThis.fetch=oldFetch;}
});

test('API uploads files through authenticated storage even if an old preview mode is passed',async()=>{
  const oldFetch=globalThis.fetch;
  const calls=[];
  globalThis.fetch=async(path,options)=>{calls.push([path,options]);return {ok:true,json:async()=>({path:'private/file.png'})};};
  const auth={upload:async(file,kind)=>({path:`private/${file.name}`,kind})};
  try{
    const api=createApi(async()=>'user-jwt',auth,'preview');
    const result=await api.upload(new File(['image'],'file.png',{type:'image/png'}),'image');
    assert.deepEqual(result,{path:'private/file.png'});
    assert.equal(calls[0][0],'/api/uploads/register');
    assert.equal(calls[0][1].headers.Authorization,'Bearer user-jwt');
  }finally{globalThis.fetch=oldFetch;}
});
