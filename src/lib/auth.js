import {createClient} from '@supabase/supabase-js';

const MIME={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
const BUCKET='portal-private';

function friendly(error){
  const messages={
    invalid_credentials:'Não foi possível entrar. Confira o e-mail e a senha.',
    email_not_confirmed:'Confirme seu e-mail antes de entrar.',
    user_already_exists:'Já existe uma conta com este e-mail. Entre ou recupere sua senha.',
    weak_password:'Escolha uma senha mais forte, com pelo menos 8 caracteres.',
    over_email_send_rate_limit:'Muitas solicitações de e-mail. Aguarde alguns minutos.',
    request_timeout:'A conexão demorou demais. Tente novamente.',
    popup_blocked:'Permita a janela de acesso Google no navegador.',
  };
  const result=new Error(messages[error?.code]||error?.message||'Não foi possível concluir a operação. Tente novamente.');
  result.code=error?.code;
  return result;
}

export function createAuth(config,makeClient=createClient,location=globalThis.location){
  const publicConfig=config?.supabase;
  if(!publicConfig?.url||!publicConfig?.publishableKey)throw new Error('Supabase ainda não configurado.');
  const client=makeClient(publicConfig.url,publicConfig.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  let currentUser=null;
  let presence=null;
  let presenceReady=Promise.resolve();
  const origin=location?.origin||'';
  const redirectTo=origin?`${origin}/`:undefined;
  async function unwrap(request){const {data,error}=await request;if(error)throw friendly(error);return data;}
  async function stopPresence(){const channel=presence;presence=null;if(channel)await client.removeChannel(channel).catch(()=>{});}
  async function startPresence(user){
    if(!user?.id)return;
    if(presence?.presenceKey===user.id)return;
    void stopPresence();
    const channel=client.channel('portal-presence',{config:{private:true,presence:{key:user.id}}});
    channel.presenceKey=user.id;
    presence=channel;
    channel.on('presence',{event:'sync'},()=>{});
    presenceReady=new Promise(resolve=>{
      let settled=false;
      const finish=()=>{if(settled)return;settled=true;clearTimeout(timeout);resolve();};
      const timeout=setTimeout(finish,5000);
      channel.subscribe(async status=>{
      if(status==='SUBSCRIBED'&&presence===channel){
        try{await channel.track({userId:user.id,onlineAt:new Date().toISOString()});}catch{}
      }
        if(['SUBSCRIBED','CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status))finish();
      });
    });
  }
  return {
    currentUser:()=>currentUser,
    getToken:async()=>{const data=await unwrap(client.auth.getSession());currentUser=data.session?.user||null;return data.session?.access_token||null;},
    subscribe:callback=>{
      const {data:{subscription}}=client.auth.onAuthStateChange((event,session)=>{currentUser=session?.user||null;callback(currentUser,event);});
      // Supabase emits INITIAL_SESSION after restoring the browser session; explicitly return the disposer.
      return ()=>subscription.unsubscribe();
    },
    loginGoogle:async()=>{
      const data=await unwrap(client.auth.signInWithOAuth({provider:'google',options:{...(redirectTo?{redirectTo}:{}),queryParams:{access_type:'offline',prompt:'consent'}}}));
      return data;
    },
    loginEmail:async(email,password)=>{const data=await unwrap(client.auth.signInWithPassword({email:email.trim(),password}));currentUser=data.user;return data.user;},
    register:async(email,password,name)=>{
      if(password.length<8)throw new Error('Escolha uma senha com pelo menos 8 caracteres.');
      const data=await unwrap(client.auth.signUp({email:email.trim(),password,options:{data:{name:name.trim()},...(redirectTo?{emailRedirectTo:redirectTo}:{})}}));
      currentUser=data.user||null;return data.user;
    },
    resetPassword:async email=>unwrap(client.auth.resetPasswordForEmail(email.trim(),redirectTo?{redirectTo}:undefined)),
    changePassword:async(oldPassword,newPassword)=>{
      const data=await unwrap(client.auth.getUser());
      const user=data.user;
      if(!user)throw new Error('Entre novamente para alterar sua senha.');
      const isEmail=user.app_metadata?.provider==='email'||user.identities?.some(identity=>identity.provider==='email');
      if(!isEmail)throw new Error('Sua senha é gerenciada pelo Google. Altere-a nas configurações da conta Google.');
      if(newPassword.length<8)throw new Error('Use pelo menos 8 caracteres na nova senha.');
      await unwrap(client.auth.signInWithPassword({email:user.email,password:oldPassword}));
      return unwrap(client.auth.updateUser({password:newPassword}));
    },
    setNewPassword:async(newPassword)=>{
      if(newPassword.length<8)throw new Error('Use pelo menos 8 caracteres na nova senha.');
      const data=await unwrap(client.auth.updateUser({password:newPassword}));
      currentUser=data.user||currentUser;
      return data.user;
    },
    logout:async()=>{await stopPresence();await unwrap(client.auth.signOut());currentUser=null;},
    upload:async(file,kind='image')=>{
      const data=await unwrap(client.auth.getUser());
      const user=data.user;
      if(!user)throw new Error('Entre novamente para enviar o arquivo.');
      const extension=file.name.split('.').pop().toLowerCase();
      const accepted=kind==='image'?['png','jpg','jpeg','webp']:kind==='import'?['pdf','docx','xlsx']:[];
      if(!accepted.includes(extension))throw new Error('Formato de arquivo não permitido.');
      if(file.type&&file.type!==MIME[extension])throw new Error('Tipo do arquivo incompatível com a extensão.');
      if(!file.size||file.size>(kind==='image'?5:10)*1024*1024)throw new Error(`Limite: ${kind==='image'?5:10} MB.`);
      const filename=file.name.replace(/[^\p{L}\p{N}._-]/gu,'_').slice(-120);
      const path=`uploads/${user.id}/${crypto.randomUUID()}-${filename}`;
      await unwrap(client.storage.from(BUCKET).upload(path,file,{contentType:MIME[extension],upsert:false}));
      return {path,filename};
    },
    startPresence,
    stopPresence,
    getPresence:async()=>{await presenceReady;return Object.fromEntries(Object.entries(presence?.presenceState?.()||{}).map(([userId,connections])=>[userId,Array.isArray(connections)&&connections.length>0]));},
  };
}
