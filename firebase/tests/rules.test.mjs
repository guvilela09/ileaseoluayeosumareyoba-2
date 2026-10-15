// Run with emulators: cd firebase; firebase emulators:exec --project demo-ilease --only firestore,database,storage "node --test tests/rules.test.mjs"
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { ref as databaseRef, get, set } from 'firebase/database';
import { ref as storageRef, uploadBytes } from 'firebase/storage';

let env;
const projectId = 'demo-ilease';
const accessRevision = '2026-10-14T00:00:00+00:00';
before(async () => {
  env = await initializeTestEnvironment({ projectId,
    firestore: { rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') },
    database: { rules: await readFile(new URL('../database.rules.json', import.meta.url), 'utf8') },
    storage: { rules: await readFile(new URL('../storage.rules', import.meta.url), 'utf8') },
  });
  await env.withSecurityRulesDisabled(async context => {
    const store = context.firestore();
    for (const [uid, status, role] of [['member','approved','member'],['admin','approved','admin'],['pending','pending','member'],['blocked','blocked','admin']]) {
      await setDoc(doc(store, 'users', uid), {status,role});
      await set(databaseRef(context.database(), `serverMirror/approvedUsers/${uid}`), { approved:status==='approved', admin:status==='approved' && role==='admin', updatedAt:accessRevision });
    }
    await setDoc(doc(store,'announcements','published'), {title:'Aviso',published:true,archived:false});
    await setDoc(doc(store,'announcements','draft'), {title:'Rascunho',published:false,archived:false});
    await setDoc(doc(store,'progress','member','lists','personal'), {checked:['a']});
    await setDoc(doc(store,'mailCampaigns','private'), {recipientUids:['member']});
  });
});
after(async () => { await env?.cleanup(); });
const session = uid => env.authenticatedContext(uid, {email_verified:true,accessRevision});

test('pending, blocked and unverified cannot read approved content', async () => {
  for (const uid of ['pending','blocked']) await assertFails(getDoc(doc(session(uid).firestore(),'announcements','published')));
  await assertFails(getDoc(doc(env.authenticatedContext('member',{email_verified:false}).firestore(),'announcements','published')));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),'announcements','published')));
});
test('members read published announcements only; admin can read draft', async () => {
  await assertSucceeds(getDoc(doc(session('member').firestore(),'announcements','published')));
  await assertFails(getDoc(doc(session('member').firestore(),'announcements','draft')));
  await assertSucceeds(getDoc(doc(session('admin').firestore(),'announcements','draft')));
  await assertFails(getDocs(collection(session('member').firestore(),'announcements')));
  await assertSucceeds(getDocs(query(collection(session('member').firestore(),'announcements'),where('published','==',true),where('archived','==',false))));
});
test('all direct writes and cross-user progress are denied', async () => {
  await assertFails(setDoc(doc(session('admin').firestore(),'users','member'),{role:'admin'}));
  await assertFails(setDoc(doc(session('member').firestore(),'progress','member','lists','personal'),{checked:['all']}));
  await assertSucceeds(getDoc(doc(session('member').firestore(),'progress','member','lists','personal')));
  await assertFails(getDoc(doc(session('admin').firestore(),'progress','member','lists','personal')));
  await assertFails(getDoc(doc(session('admin').firestore(),'mailCampaigns','private')));
});
test('presence is per connection, mirror is privileged and global read is admin only', async () => {
  await assertSucceeds(set(databaseRef(session('member').database(),'presence/member/connections/tab1'),{revision:accessRevision}));
  await assertFails(set(databaseRef(session('member').database(),'presence/admin/connections/tab1'),{revision:accessRevision}));
  await assertFails(set(databaseRef(session('member').database(),'serverMirror/approvedUsers/member'),{approved:true,admin:true}));
  await assertFails(get(databaseRef(session('member').database(),'presence')));
  await assertSucceeds(get(databaseRef(session('admin').database(),'presence')));
  await env.withSecurityRulesDisabled(context => set(databaseRef(context.database(),'serverMirror/approvedUsers/member'),{approved:false,admin:false,updatedAt:'2026-10-14T00:01:00+00:00'}));
  await assertFails(set(databaseRef(session('member').database(),'presence/member/connections/tab2'),{revision:accessRevision}));
  // restore test fixture
  await env.withSecurityRulesDisabled(context => set(databaseRef(context.database(),'serverMirror/approvedUsers/member'),{approved:true,admin:false}));
});
test('uploads require approval, owner, safe MIME/size and admin for imports', async () => {
  const image = {contentType:'image/png',customMetadata:{ownerUid:'member',kind:'image'}};
  await assertSucceeds(uploadBytes(storageRef(session('member').storage(),'uploads/member/photo.png'),new Uint8Array([1]),image));
  await assertFails(uploadBytes(storageRef(session('member').storage(),'uploads/admin/other.png'),new Uint8Array([1]),image));
  await assertFails(uploadBytes(storageRef(session('pending').storage(),'uploads/pending/photo.png'),new Uint8Array([1]),{...image,customMetadata:{ownerUid:'pending',kind:'image'}}));
  await assertFails(uploadBytes(storageRef(session('member').storage(),'uploads/member/large.png'),new Uint8Array(5*1024*1024+1),image));
  await assertFails(uploadBytes(storageRef(session('member').storage(),'uploads/member/file.pdf'),new Uint8Array([1]),{contentType:'application/pdf',customMetadata:{ownerUid:'member',kind:'import'}}));
  await assertSucceeds(uploadBytes(storageRef(session('admin').storage(),'uploads/admin/file.pdf'),new Uint8Array([1]),{contentType:'application/pdf',customMetadata:{ownerUid:'admin',kind:'import'}}));
  await assertFails(uploadBytes(storageRef(session('member').storage(),'uploads/member/html.png'),new Uint8Array([1]),{...image,contentType:'text/html'}));
});
