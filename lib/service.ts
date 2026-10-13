import {parseRecord,canWrite,canManage,allowedMonitorUrl,summary} from './domain.ts';
import type {Project,User,Item} from './domain.ts';
import {seed} from './seed.ts';
import type {Database} from './postgres.ts';
type Env={DB:Database;BUCKET?:{put:(key:string,bytes:ArrayBuffer)=>Promise<any>;get:(key:string)=>Promise<{body:Uint8Array}|null>;delete:(key:string)=>Promise<any>};MONITOR_ALLOWED_HOSTS?:string;RESEND_API_KEY?:string;ALERT_EMAIL?:string};
class HttpError extends Error{status:number;constructor(status:number,message:string){super(message);this.status=status;}}
const fail=(n:number,m:string):never=>{throw new HttpError(n,m)};
const id=()=>crypto.randomUUID();
const hash=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(b=>b.toString(16).padStart(2,'0')).join('');
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const decode=(row:any):Item=>({...row,data:JSON.parse(row.data)});
export async function serve(request:Request,path:string[],project:Project,env:Env,user:User|null,fetcher:typeof fetch=fetch):Promise<Response>{
 const db=env.DB;const now=Date.now();const url=new URL(request.url);const method=request.method;
 const rows=async(sql:string,...args:any[])=>((await db.prepare(sql).bind(...args).all()).results as any[]);
 const first=async(sql:string,...args:any[])=>db.prepare(sql).bind(...args).first<any>();
 const run=async(sql:string,...args:any[])=>db.prepare(sql).bind(...args).run();
 const event=(ws:string,message:string)=>db.prepare('INSERT INTO activity(id,workspace,actor,message,created) VALUES(?,?,?,?,?)').bind(id(),ws,user?.displayName||'Monitor runner',message,Date.now());
 try{
  if(!db)fail(503,'Database binding is not configured');
  let tokenWorkspace:string|null=null;
  if(path[0]==='runner'){
   const auth=request.headers.get('authorization');if(!auth?.startsWith('Bearer '))fail(401,'Runner token required');
   tokenWorkspace=(await first('SELECT workspace FROM tokens WHERE hash=?',await hash(auth!.slice(7))))?.workspace||null;if(!tokenWorkspace)fail(401,'Invalid runner token');
  }else if(!user)fail(401,'Sign in to continue');
  if(Number(request.headers.get('content-length')||0)>(path[0]==='attachments'?3*1024*1024:100000))fail(413,'Request is too large');
  if(method!=='GET'&&path[0]!=='runner'){
   const origin=request.headers.get('origin');if(origin&&origin!==url.origin)fail(403,'Cross-origin writes are blocked');
   if(!request.headers.get('content-type')?.startsWith('application/json')&&path[0]!=='attachments')fail(415,'Send application/json');
  }
  const limiter=(user?.userId||tokenWorkspace)+':'+Math.floor(now/60000);
  const limit=await first('INSERT INTO rate_limits(id,count,expires) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1 RETURNING count',limiter,now+120000);if(limit.count>180)fail(429,'Too many requests. Try again in one minute.');
  await run('DELETE FROM rate_limits WHERE expires < ?',now);
  if(path[0]==='bootstrap'){
   if(user!.emailVerified)await run('UPDATE memberships SET user=?,name=? WHERE email=? AND user IS NULL',user!.userId,user!.displayName,user!.email.toLowerCase());
   let spaces=await rows('SELECT w.*,m.role FROM workspaces w JOIN memberships m ON w.id=m.workspace WHERE m.user=? ORDER BY w.created',user!.userId);
   if(!spaces.length){
    const ws='home-'+user!.userId;const board='board-'+user!.userId;const demo=seed(project);
    const statements=[db.prepare('INSERT OR IGNORE INTO workspaces(id,name,owner,created) VALUES(?,?,?,?)').bind(ws,'My workspace',user!.userId,now),db.prepare('INSERT OR IGNORE INTO memberships(id,workspace,email,user,name,role) VALUES(?,?,?,?,?,?)').bind('owner-'+user!.userId,ws,user!.email.toLowerCase(),user!.userId,user!.displayName,'owner')];
    for(let i=0;i<demo.length;i++){const x:any=demo[i];const data={...x.data};if(data.board==='BOARD')data.board=board;const rid=x.id==='BOARD'?board:'sample-'+user!.userId+'-'+i;statements.push(db.prepare('INSERT OR IGNORE INTO records(id,workspace,kind,data,version,updated,author) VALUES(?,?,?,?,1,?,?)').bind(rid,ws,x.kind,JSON.stringify(data),now,user!.userId));}
    await db.batch(statements);spaces=await rows('SELECT w.*,m.role FROM workspaces w JOIN memberships m ON w.id=m.workspace WHERE m.user=? ORDER BY w.created',user!.userId);
   }
   return json({user,workspaces:spaces,project});
  }
  if(path[0]==='workspaces'&&method==='POST'){
   const body=await request.json() as any;const name=String(body.name||'').trim();if(!name||name.length>80)fail(400,'Workspace name must have 1–80 characters');const ws=id();
   await db.batch([db.prepare('INSERT INTO workspaces(id,name,owner,created) VALUES(?,?,?,?)').bind(ws,name,user!.userId,now),db.prepare('INSERT INTO memberships(id,workspace,email,user,name,role) VALUES(?,?,?,?,?,?)').bind(id(),ws,user!.email.toLowerCase(),user!.userId,user!.displayName,'owner')]);return json({id:ws},201);
  }
  const ws=tokenWorkspace||url.searchParams.get('workspace')||'';if(!ws)fail(400,'Workspace required');
  const membership=tokenWorkspace?{role:'owner'}:await first('SELECT * FROM memberships WHERE workspace=? AND user=?',ws,user!.userId);if(!membership)fail(403,'You are not a member of this workspace');const role=membership.role;
  const record=async(rid:string)=>{const r=await first('SELECT * FROM records WHERE id=? AND workspace=?',rid,ws);if(!r)fail(404,'Record not found');return decode(r);};
  const validateRelations=async(kind:string,data:any)=>{
   if(kind==='comment'||kind==='attachment'){const target=await record(data.target);if(target.kind!=='task')fail(400,'A task is required');}
   if(kind==='shape'||kind==='cursor'){const target=await record(data.board);if(target.kind!=='board')fail(400,'A board is required');}
   if(kind==='application'){const opp=await record(data.opportunity);if(opp.kind!=='opportunity')fail(400,'An opportunity is required');}
  };
  if(path[0]==='state'&&method==='GET'){
   const allRecords=(await rows('SELECT * FROM records WHERE workspace=? ORDER BY updated DESC',ws)).map(decode);
   const applicationStats:Record<string,any>={};for(const opp of allRecords.filter(r=>r.kind==='opportunity')){const apps=allRecords.filter(r=>r.kind==='application'&&r.data.opportunity===opp.id);applicationStats[opp.id]={total:apps.length,approved:apps.filter(a=>a.data.status==='approved').length,attended:apps.filter(a=>a.data.attended).length,hours:apps.filter(a=>a.data.attended).length*opp.data.hours};}
   const list=allRecords.filter(r=>r.kind!=='cursor'||r.updated>now-15000).filter(r=>r.kind!=='application'||canManage(role)||r.data.user===user!.userId);
   return json({records:list,applicationStats,members:await rows('SELECT id,name,email,role,user FROM memberships WHERE workspace=?',ws),activity:await rows('SELECT * FROM activity WHERE workspace=? ORDER BY created DESC LIMIT 60',ws),checks:await rows('SELECT * FROM checks WHERE workspace=? ORDER BY created DESC LIMIT 1000',ws),role,revision:now});
  }
  if(path[0]==='invite'&&method==='POST'){
   if(!canManage(role))fail(403,'Only workspace administrators can invite members');const b=await request.json() as any;const email=String(b.email||'').trim().toLowerCase();const inviteRole=String(b.role);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>200||!['admin','editor','viewer'].includes(inviteRole))fail(400,'Valid email and role required');
   if((await first('SELECT role FROM memberships WHERE workspace=? AND email=?',ws,email))?.role==='owner')fail(400,'Owner role cannot be changed');
   await db.batch([db.prepare('INSERT INTO memberships(id,workspace,email,user,name,role) VALUES(?,?,?,NULL,?,?) ON CONFLICT(workspace,email) DO UPDATE SET role=excluded.role').bind(id(),ws,email,email,inviteRole),event(ws,'Invited '+email+' as '+inviteRole)]);return json({ok:true});
  }
  if(path[0]==='members'&&method==='DELETE'){
   if(!canManage(role))fail(403,'Administrator required');const m=await first('SELECT * FROM memberships WHERE id=? AND workspace=?',path[1],ws);if(!m)fail(404,'Member not found');if(m.role==='owner')fail(400,'Cannot remove workspace owner');await db.batch([db.prepare('DELETE FROM memberships WHERE id=? AND workspace=?').bind(path[1],ws),event(ws,'Removed '+m.email)]);return json({ok:true});
  }
  if(path[0]==='records'){
   if(method==='POST'){
    const body=await request.json() as any;const kind=String(body.kind);if(['attachment','incident'].includes(kind))fail(400,'Use the dedicated endpoint');
    if(!canWrite(role)&&!(project==='impacthub'&&['application','profile'].includes(kind))&&kind!=='cursor')fail(403,'Read-only members cannot change this record');
    let data=parseRecord(project,kind,body.data);
    if(kind==='cursor')data.name=user!.displayName;
    if(kind==='monitor')data.url=allowedMonitorUrl(data.url,env.MONITOR_ALLOWED_HOSTS||'example.com,www.cloudflare.com,github.com');
    if(kind==='application'){
     data={...data,user:user!.userId,email:user!.email,status:'pending',attended:false};const opportunity=await record(data.opportunity);if(opportunity.data.status!=='open')fail(400,'Applications are closed');
     if((await rows('SELECT data FROM records WHERE workspace=? AND kind=?',ws,'application')).some(r=>{const a=JSON.parse(r.data);return a.user===user!.userId&&a.opportunity===data.opportunity}))fail(409,'You have already applied');
    }
    if(kind==='monitor'&&(await rows('SELECT id FROM records WHERE workspace=? AND kind=?',ws,'monitor')).length>=20)fail(400,'A workspace supports up to 20 monitors');
    if(kind!=='cursor'&&(await rows('SELECT id FROM records WHERE workspace=?',ws)).length>=2000)fail(400,'This workspace is at its 2,000 record limit');
    if(kind==='profile'&&(await rows('SELECT id FROM records WHERE workspace=? AND kind=? AND author=?',ws,'profile',user!.userId)).length)fail(409,'Profile already exists');
    await validateRelations(kind,data);const rid=kind==='cursor'?'cursor-'+ws+'-'+user!.userId:kind==='application'?'application-'+data.opportunity+'-'+user!.userId:kind==='profile'?'profile-'+ws+'-'+user!.userId:id();
    const clause=kind==='cursor'?' ON CONFLICT(id) DO UPDATE SET data=excluded.data,version=version+1,updated=excluded.updated':'';
    const stmt=db.prepare('INSERT INTO records(id,workspace,kind,data,version,updated,author) VALUES(?,?,?,?,1,?,?)'+clause).bind(rid,ws,kind,JSON.stringify(data),now,user!.userId);
    await db.batch(kind==='cursor'?[stmt]:[stmt,event(ws,'Created '+kind+': '+(data.title||data.name||data.text?.slice(0,50)||kind))]);return json(await record(rid),201);
   }
   const item=await record(path[1]);
   if(method==='PATCH'){
    if(!canWrite(role)&&!(item.kind==='profile'&&item.author===user!.userId))fail(403,'Editor permission required');
    if(item.kind==='application'&&!canManage(role))fail(403,'Only administrators can review applications');
    if(item.kind==='attachment'||item.kind==='cursor')fail(400,'Use the dedicated endpoint');
    const body=await request.json() as any;let data=parseRecord(project,item.kind,body.data);if(!Number.isInteger(body.version))fail(400,'Record version required');
    if(item.kind==='profile'&&item.author!==user!.userId)fail(403,'You may only edit your own profile');
    if(item.kind==='monitor')data.url=allowedMonitorUrl(data.url,env.MONITOR_ALLOWED_HOSTS||'example.com,www.cloudflare.com,github.com');
    if(item.kind==='application'){
     if(data.user!==item.data.user||data.opportunity!==item.data.opportunity||data.email!==item.data.email)fail(400,'Application identity cannot change');
     if(data.attended&&data.status!=='approved')fail(400,'Approve the application before recording attendance');
     if(data.status==='approved'&&item.data.status!=='approved'){const opp=await record(data.opportunity);const approved=(await rows('SELECT data FROM records WHERE workspace=? AND kind=?',ws,'application')).filter(r=>{const x=JSON.parse(r.data);return x.opportunity===opp.id&&x.status==='approved'}).length;if(approved>=opp.data.capacity)fail(409,'Opportunity is at capacity');}
    }
    await validateRelations(item.kind,data);
    let capacityClause='';let capacityArgs:any[]=[];
    if(item.kind==='application'&&data.status==='approved'&&item.data.status!=='approved'){const opp=await record(data.opportunity);capacityClause=" AND (SELECT COUNT(*) FROM records WHERE workspace=? AND kind='application' AND json_extract(data,'$.opportunity')=? AND json_extract(data,'$.status')='approved') < ?";capacityArgs=[ws,opp.id,opp.data.capacity];}
    if(item.kind==='opportunity'){const approved=(await rows("SELECT id FROM records WHERE workspace=? AND kind='application' AND json_extract(data,'$.opportunity')=? AND json_extract(data,'$.status')='approved'",ws,item.id)).length;if(data.capacity<approved)fail(400,'Capacity cannot be lower than approved applications');}
    const result=await run('UPDATE records SET data=?,version=version+1,updated=? WHERE id=? AND workspace=? AND version=?'+capacityClause,JSON.stringify(data),now,item.id,ws,body.version,...capacityArgs);
    if(!result.meta.changes)fail(409,'This record changed in another session. Refresh and try again.');
    await event(ws,'Updated '+item.kind+': '+(data.title||data.name||item.id)).run();return json(await record(item.id));
   }
   if(method==='DELETE'){
    if(!canWrite(role)&&!(item.kind==='application'&&item.data.user===user!.userId))fail(403,'Editor permission required');
    if(item.kind==='profile'&&item.author!==user!.userId)fail(403,'You may only delete your own profile');
    const version=Number(url.searchParams.get('version'));if(version!==item.version)fail(409,'This record changed. Refresh before deleting.');
    if(item.kind==='application'&&item.data.attended&&!canManage(role))fail(400,'Recorded attendance cannot be withdrawn');
    if(item.kind==='attachment'&&env.BUCKET)await env.BUCKET.delete(item.data.key);
    const dependent=(await rows('SELECT * FROM records WHERE workspace=?',ws)).map(decode).filter(r=>r.data.board===item.id||r.data.target===item.id||r.data.opportunity===item.id||r.data.monitor===item.id);
    if(dependent.some(r=>r.kind==='attachment'))for(const r of dependent.filter(r=>r.kind==='attachment'))await env.BUCKET?.delete(r.data.key);
    await db.batch([db.prepare('DELETE FROM records WHERE id=? AND workspace=? AND version=?').bind(item.id,ws,version),...dependent.map(r=>db.prepare('DELETE FROM records WHERE id=? AND workspace=?').bind(r.id,ws)),event(ws,'Deleted '+item.kind)]);return json({ok:true});
   }
  }
  if(path[0]==='attachments'&&project==='teamflow'){
   if(!env.BUCKET)fail(503,'File storage is not configured');
   if(method==='GET'){const item=await record(path[1]);if(item.kind!=='attachment')fail(404,'Attachment not found');const obj=await env.BUCKET!.get(item.data.key);if(!obj)fail(404,'File missing');return new Response(new Uint8Array(obj!.body).buffer,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="${item.data.name.replace(/[^a-zA-Z0-9._-]/g,'_')}"`,'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store'}});}
   if(method==='POST'){
    if(!canWrite(role))fail(403,'Editor permission required');const task=await record(path[1]);if(task.kind!=='task')fail(400,'Task required');const bytes=await request.arrayBuffer();if(bytes.byteLength>3*1024*1024)fail(413,'File must be under 3 MB');if(!bytes.byteLength)fail(400,'File is empty');const rid=id();const name=(request.headers.get('x-filename')||'attachment').replace(/[^a-zA-Z0-9._ -]/g,'_').slice(0,180);const key=ws+'/'+rid;
    await env.BUCKET!.put(key,bytes);const data={target:task.id,name,key,size:bytes.byteLength,type:request.headers.get('content-type')||'application/octet-stream'};
    try{await db.batch([db.prepare('INSERT INTO records(id,workspace,kind,data,version,updated,author) VALUES(?,?,?,?,1,?,?)').bind(rid,ws,'attachment',JSON.stringify(data),now,user!.userId),event(ws,'Uploaded '+name)]);}catch(e){await env.BUCKET!.delete(key);throw e;}return json(await record(rid),201);
   }
  }
  if(path[0]==='token'&&project==='pulseops'&&method==='POST'){
   if(!canManage(role))fail(403,'Administrator required');const token='po_'+id()+id();await db.batch([db.prepare('DELETE FROM tokens WHERE workspace=?').bind(ws),db.prepare('INSERT INTO tokens(hash,workspace,created) VALUES(?,?,?)').bind(await hash(token),ws,now)]);return json({token});
  }
  if(path[0]==='token'&&method==='DELETE'){if(!canManage(role))fail(403,'Administrator required');await run('DELETE FROM tokens WHERE workspace=?',ws);return json({ok:true});}
  if((path[0]==='check'||path[0]==='runner')&&project==='pulseops'&&method==='POST'){
   if(!canWrite(role))fail(403,'Editor permission required');
   const monitors=path[0]==='check'?[await record(path[1])]:(await rows('SELECT * FROM records WHERE workspace=? AND kind=?',ws,'monitor')).map(decode);
   const checked=[];
   for(const monitor of monitors){
    if(monitor.kind!=='monitor')fail(400,'Monitor required');if(monitor.data.paused||now-monitor.data.lastChecked<30000)continue;
    const target=allowedMonitorUrl(monitor.data.url,env.MONITOR_ALLOWED_HOSTS||'example.com,www.cloudflare.com,github.com');
    const locked=await run('UPDATE records SET data=?,version=version+1,updated=? WHERE id=? AND version=?',JSON.stringify({...monitor.data,lastChecked:now}),now,monitor.id,monitor.version);if(!locked.meta.changes)continue;
    const start=Date.now();let status=0,error:string|null=null;try{const response=await fetcher(target,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(10000),headers:{'User-Agent':'PulseOps/1.0'}});status=response.status;await response.body?.cancel();}catch(e){error=e instanceof Error?e.message:'Request failed';}
    const ok=status===monitor.data.expected;const latency=Date.now()-start;const cid=id();const prior=await first('SELECT * FROM records WHERE workspace=? AND kind=? AND id=?',ws,'incident','incident-'+monitor.id);const incident=prior?decode(prior):null;
    const statements=[db.prepare('INSERT INTO checks(id,workspace,monitor,status,latency,ok,error,created) VALUES(?,?,?,?,?,?,?,?)').bind(cid,ws,monitor.id,status,latency,ok?1:0,error,now)];
    let transition=false;
    if(!ok&&(!incident||incident.data.status==='resolved')){transition=true;const data={monitor:monitor.id,title:monitor.data.name+' is unavailable',status:'open',started:now,resolved:null,note:error||'HTTP '+status};statements.push(db.prepare('INSERT INTO records(id,workspace,kind,data,version,updated,author) VALUES(?,?,?,?,1,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,version=version+1,updated=excluded.updated').bind('incident-'+monitor.id,ws,'incident',JSON.stringify(data),now,'runner'),event(ws,'Incident opened: '+monitor.data.name));}
    if(ok&&incident?.data.status==='open'){transition=true;statements.push(db.prepare('UPDATE records SET data=?,version=version+1,updated=? WHERE id=?').bind(JSON.stringify({...incident.data,status:'resolved',resolved:now}),now,incident.id),event(ws,'Recovered: '+monitor.data.name));}
    await db.batch(statements);
    if(transition&&env.RESEND_API_KEY&&env.ALERT_EMAIL){try{await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:'PulseOps <onboarding@resend.dev>',to:[env.ALERT_EMAIL],subject:(ok?'Recovered: ':'Incident: ')+monitor.data.name,text:target+' returned '+status+(error?' '+error:'')})});}catch{/* Incident remains durable even if email delivery fails. */}}
    checked.push({monitor:monitor.id,status,latency,ok,error});
   }
   await run('DELETE FROM checks WHERE workspace=? AND id NOT IN (SELECT id FROM checks WHERE workspace=? ORDER BY created DESC LIMIT 1000)',ws,ws);
   return json({checked,summary:summary(checked)});
  }
  return fail(404,'Endpoint not found');
 }catch(e){if(e instanceof HttpError)return json({error:e.message},e.status);if(e instanceof Error&&('issues' in e||e.message.startsWith('Use HTTPS')||e.message==='Unsupported record type'))return json({error:e.message},400);console.error('API failure',e instanceof Error?e.message:'unknown');if(e instanceof Error&&/no such table|does not exist/i.test(e.message))return json({error:'Database setup is incomplete. Run npm run db:migrate with your configured DATABASE_URL.'},503);return json({error:'Unexpected server error. Check the server logs.'},500);}
}
