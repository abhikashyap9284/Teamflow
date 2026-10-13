import {neon} from '@neondatabase/serverless';
import {randomUUID} from 'node:crypto';

// Checks read-only metadata and runs a temporary rate-limit insert/upsert/delete.
// Prints no database URL, username, password, or session secret.
let failed=false;
function ok(label){console.log('PASS:',label)}
function fail(label,reason=''){console.error('FAIL:',label,reason);failed=true}
function safeReason(e){
 const code=String(e?.code||e?.name||'UNKNOWN');
 const msg=String(e?.message||'Unknown database error')
   .replace(/postgres(?:ql)?:\/\/[^\s'\"]+/gi,'[DATABASE_URL_REDACTED]')
   .replace(/password\s*[:=]\s*\S+/gi,'password=[REDACTED]')
   .slice(0,500);
 return `code=${code}; message=${msg}`;
}
const url=process.env.DATABASE_URL||'';
const secret=process.env.SESSION_SECRET||'';
console.log('TeamFlow authentication diagnostics');
console.log('Node:',process.version);
if(!url){fail('DATABASE_URL is missing from this process')}else {
 try{
  const u=new URL(url);
  if(!['postgresql:','postgres:'].includes(u.protocol)||!u.hostname||!u.password||!u.username)throw Error('URL is incomplete or has wrong scheme');
  if(u.hostname.includes('YOUR-NEON-HOST')||u.username==='USER')throw Error('DATABASE_URL still contains example placeholders');
  ok('DATABASE_URL syntax is usable (credentials not shown)');
 }catch(e){fail('DATABASE_URL format',safeReason(e))}
}
if(secret.length>=32)ok('SESSION_SECRET exists and meets length requirement');
else fail('SESSION_SECRET missing or too short (minimum 32 characters)');
if(url){
 try{
  const sql=neon(url);
  await sql.query('SELECT 1 AS ok');ok('Neon database connection');
  const expected=['users','sessions','verification_tokens','rate_limits','workspaces','memberships','records','activity'];
  const result=await sql.query('SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ANY($1::text[])',[expected]);
  const actual=new Set(result.map(x=>x.table_name));
  const missing=expected.filter(t=>!actual.has(t));
  if(missing.length)fail('Required database tables missing:',missing.join(', '));else ok('Required authentication and app tables exist');
  if(!missing.includes('rate_limits')){
   const id='diagnostics:'+randomUUID();
   try{
    const rows=await sql.query('INSERT INTO rate_limits(id,count,expires) VALUES($1,1,$2) ON CONFLICT(id) DO UPDATE SET count=rate_limits.count+1 RETURNING count',[id,Date.now()+60000]);
    if(Number(rows[0]?.count)===1)ok('Auth rate-limit INSERT and RETURNING');else fail('Auth rate-limit result unexpected');
    const again=await sql.query('INSERT INTO rate_limits(id,count,expires) VALUES($1,1,$2) ON CONFLICT(id) DO UPDATE SET count=rate_limits.count+1 RETURNING count',[id,Date.now()+60000]);
    if(Number(again[0]?.count)===2)ok('Auth rate-limit UPSERT');else fail('Auth rate-limit upsert result unexpected');
   }catch(e){fail('Auth rate-limit SQL',safeReason(e))}
   finally{try{await sql.query('DELETE FROM rate_limits WHERE id=$1',[id])}catch{}}
  }
 }catch(e){fail('Neon database connection or schema',safeReason(e))}
}
console.log(failed?'DIAGNOSIS: FAIL (read the FAIL messages above)':'DIAGNOSIS: PASS (reproduce login and inspect server logs if error persists)');
if(failed)process.exitCode=1;
