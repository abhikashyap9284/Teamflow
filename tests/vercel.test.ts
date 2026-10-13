import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {PgDatabase,PostgresFiles,postgresSql} from '../lib/postgres.ts';
import {auth,getUser,passwordHash,passwordMatches,tokenHash} from '../lib/auth.ts';
import {serve} from '../lib/service.ts';
import type {User} from '../lib/domain.ts';

process.env.SESSION_SECRET='test-only-session-secret-never-use-in-production-0123456789';
async function setup(){
 const pg=new PGlite();await pg.exec(readFileSync('db/001_initial.sql','utf8'));
 const db=new PgDatabase({execute:async q=>{const r=await pg.query(q.sql,q.params);return {rows:r.rows as any[],rowCount:r.affectedRows||r.rows.length}},transaction:async queries=>pg.transaction(async tx=>{const results=[];for(const q of queries){const r=await tx.query(q.sql,q.params);results.push({rows:r.rows as any[],rowCount:r.affectedRows||r.rows.length});}return results;})});
 const request=(path:string,data:any={},cookie='',origin='https://team.test')=>new Request('https://team.test/api/auth/'+path,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,Origin:origin},body:JSON.stringify(data)});
 return {pg,db,request};
}
const own:User={userId:'owner',email:'owner@example.org',displayName:'Owner',emailVerified:true};
const viewer:User={userId:'viewer',email:'viewer@example.org',displayName:'Viewer',emailVerified:true};
async function call(db:PgDatabase,path:string,method='GET',body:any=undefined,user:User|null=own,workspace='home-owner'){
 const request=new Request('https://team.test/api/'+path+(path.includes('?')?'&':'?')+'workspace='+workspace,{method,headers:body!==undefined?{'Content-Type':'application/json'}:{},body:body!==undefined?JSON.stringify(body):undefined});const response=await serve(request,path.split('?')[0].split('/'),'teamflow',{DB:db,BUCKET:new PostgresFiles(db)},user);return {status:response.status,data:await response.json() as any};
}
test('passwords are salted and session tokens are keyed hashes',async()=>{
 const one=await passwordHash('A-strong-passphrase-123'),two=await passwordHash('A-strong-passphrase-123');assert.notEqual(one,two);assert.ok(await passwordMatches('A-strong-passphrase-123',one));assert.ok(!await passwordMatches('Incorrect-passphrase',one));assert.throws(()=>tokenHash('token','short'));assert.notEqual(tokenHash('token','a'.repeat(32)),tokenHash('token','b'.repeat(32)));
});
test('PostgreSQL adapter preserves literals and quotes reserved membership identifiers',()=>{
 assert.equal(postgresSql("SELECT '?' AS marker,user FROM memberships WHERE m.user=?"),'SELECT \'?\' AS marker,"user" FROM memberships WHERE m."user"=$1');assert.match(postgresSql('INSERT OR IGNORE INTO records(id) VALUES(?)'),/ON CONFLICT DO NOTHING$/);
});
test('register, login, session expiry, CSRF blocking and logout against PostgreSQL',async()=>{
 const{pg,db,request}=await setup();try{
  const registration=await auth(request('register',{email:'abhi@example.org',name:'Abhi',password:'A-strong-passphrase-123'}),'register',db);assert.equal(registration.status,201);const cookie=registration.headers.get('set-cookie')!;assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.match(cookie,/SameSite=Lax/);
  const account=await getUser(request('x',{},cookie),db);assert.equal(account?.displayName,'Abhi');assert.equal(account?.emailVerified,false);
  const stored=(await db.prepare('SELECT * FROM users').first<any>())!;assert.notEqual(stored.password_hash,'A-strong-passphrase-123');const token=cookie.split(';')[0].split('=')[1];assert.notEqual((await db.prepare('SELECT hash FROM sessions').first<any>())!.hash,token);
  assert.equal((await auth(request('login',{email:'abhi@example.org',password:'Wrong-password-1234'}),'login',db)).status,401);
  assert.equal((await auth(request('login',{email:'abhi@example.org',password:'A-strong-passphrase-123'}),'login',db)).status,200);
  assert.equal((await auth(request('logout',{},cookie,'https://attacker.test'),'logout',db)).status,403);
  await auth(request('logout',{},cookie),'logout',db);assert.equal(await getUser(request('x',{},cookie),db),null);
  const forged=new Request('https://team.test',{headers:{'oai-authenticated-user-id':'admin','oai-authenticated-user-email':'admin@example.org'}});assert.equal(await getUser(forged,db),null);
  await db.prepare('UPDATE sessions SET expires=0').run();const login=await auth(request('login',{email:'abhi@example.org',password:'A-strong-passphrase-123'}),'login',db);const liveCookie=login.headers.get('set-cookie')!;await db.prepare('UPDATE sessions SET expires=0').run();assert.equal(await getUser(request('x',{},liveCookie),db),null);
 }finally{await pg.close()}
});
test('unverified email cannot claim workspace invitations',async()=>{
 const{pg,db}=await setup();try{
  assert.equal((await call(db,'bootstrap')).status,200);assert.equal((await call(db,'invite','POST',{email:viewer.email,role:'viewer'})).status,200);
  const unverified=await call(db,'bootstrap','GET',undefined,{...viewer,emailVerified:false});assert.ok(!unverified.data.workspaces.some((w:any)=>w.id==='home-owner'));
  const verified=await call(db,'bootstrap','GET',undefined,viewer);assert.ok(verified.data.workspaces.some((w:any)=>w.id==='home-owner'&&w.role==='viewer'));
  assert.equal((await call(db,'records','POST',{kind:'task',data:{title:'No',status:'backlog',priority:'low'}},viewer)).status,403);
 }finally{await pg.close()}
});
test('tasks persist, stale changes conflict, and batch writes roll back on PostgreSQL',async()=>{
 const{pg,db}=await setup();try{
  await call(db,'bootstrap');const task=(await call(db,'records','POST',{kind:'task',data:{title:'Vercel task',status:'backlog',priority:'high'}})).data;
  const updated=await call(db,'records/'+task.id,'PATCH',{data:{...task.data,status:'done'},version:1});assert.equal(updated.status,200);assert.equal(updated.data.version,2);
  assert.equal((await call(db,'records/'+task.id,'PATCH',{data:task.data,version:1})).status,409);assert.equal((await call(db,'state')).data.records.find((r:any)=>r.id===task.id).data.status,'done');
  await assert.rejects(db.batch([db.prepare('INSERT INTO workspaces(id,name,owner,created) VALUES(?,?,?,?)').bind('transaction-test','Test','owner',1),db.prepare('INSERT INTO workspaces(id,name,owner,created) VALUES(?,?,?,?)').bind('home-owner','Duplicate','owner',1)]));assert.equal(await db.prepare('SELECT id FROM workspaces WHERE id=?').bind('transaction-test').first(),null);
 }finally{await pg.close()}
});
test('file bytes persist independently of the Vercel filesystem',async()=>{
 const{pg,db}=await setup();try{const files=new PostgresFiles(db);await files.put('file-key',new Uint8Array([2,4,6]).buffer);assert.deepEqual([...(await new PostgresFiles(db).get('file-key'))!.body],[2,4,6]);await files.delete('file-key');assert.equal(await files.get('file-key'),null)}finally{await pg.close()}
});
test('password reset consumes one-time proof and revokes previous sessions',async()=>{
 const{pg,db,request}=await setup();try{
  const registration=await auth(request('register',{name:'Reset user',email:'reset@example.org',password:'Original-passphrase-123'}),'register',db),cookie=registration.headers.get('set-cookie')!;
  const user=await getUser(request('x',{},cookie),db),token='r'.repeat(43);
  await db.prepare('INSERT INTO verification_tokens(hash,user_id,expires,purpose) VALUES(?,?,?,?)').bind(tokenHash(token),user!.userId,Date.now()+60000,'reset').run();
  assert.equal((await auth(request('reset-password',{token,password:'Updated-passphrase-456'}),'reset-password',db)).status,200);
  assert.equal(await getUser(request('x',{},cookie),db),null);
  assert.equal((await auth(request('reset-password',{token,password:'Another-passphrase-789'}),'reset-password',db)).status,400);
  assert.equal((await auth(request('login',{email:'reset@example.org',password:'Updated-passphrase-456'}),'login',db)).status,200);
 }finally{await pg.close()}
});
