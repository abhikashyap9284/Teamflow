import {randomBytes,randomUUID,scrypt,timingSafeEqual,createHmac} from 'node:crypto';
import {promisify} from 'node:util';
import {z} from 'zod';
import type {Database} from './postgres.ts';
import type {User} from './domain.ts';
const derive=promisify(scrypt),COOKIE='teamflow_session',DAYS=7*24*60*60;
const emailSchema=z.string().trim().toLowerCase().email().max(200),passwordSchema=z.string().min(12,'Use at least 12 characters').max(128);
const response=(data:any,status=200,headers:Record<string,string>={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...headers}});
export function tokenHash(token:string,secret=process.env.SESSION_SECRET){if(!secret||secret.length<32)throw new Error('Configure SESSION_SECRET with at least 32 random characters.');return createHmac('sha256',secret).update(token).digest('hex');}
export async function passwordHash(password:string){const salt=randomBytes(16).toString('hex');const key=await derive(password,salt,32) as Buffer;return 'scrypt$'+salt+'$'+key.toString('hex');}
export async function passwordMatches(password:string,stored:string){const [method,salt,digest]=stored.split('$');if(method!=='scrypt'||!salt||!digest||!/^[a-f0-9]{64}$/.test(digest))return false;const key=await derive(password,salt,32) as Buffer;return timingSafeEqual(key,Buffer.from(digest,'hex'));}
function cookieToken(request:Request){return request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='))?.slice(COOKIE.length+1)||'';}
function cookie(token:string,request:Request,maxAge=DAYS){return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(request.url).protocol==='https:'?'; Secure':''}`;}
export async function getUser(request:Request,db:Database):Promise<User|null>{const token=cookieToken(request);if(!/^[A-Za-z0-9_-]{43}$/.test(token))return null;const user=await db.prepare('SELECT u.id,u.email,u.name,u.email_verified FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.hash=? AND s.expires>? AND s.version=u.auth_version').bind(tokenHash(token),Date.now()).first<any>();return user?{userId:user.id,email:user.email,displayName:user.name,emailVerified:!!user.email_verified}:null;}
async function startSession(request:Request,db:Database,userId:string){const token=randomBytes(32).toString('base64url');await db.batch([db.prepare('DELETE FROM sessions WHERE expires<?').bind(Date.now()),db.prepare('INSERT INTO sessions(hash,user_id,expires,version) SELECT ?,?,?,auth_version FROM users WHERE id=?').bind(tokenHash(token),userId,Date.now()+DAYS*1000,userId)]);return cookie(token,request);}
async function rateLimit(db:Database,key:string,limit:number,windowMs:number){const now=Date.now();const entry=await db.prepare('INSERT INTO rate_limits(id,count,expires) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1 RETURNING count').bind('auth:'+key+':'+Math.floor(now/windowMs),now+windowMs).first<any>();return entry.count<=limit;}
async function emailLink(db:Database,userId:string,email:string,purpose:string){
 if(!process.env.RESEND_API_KEY||!process.env.MAIL_FROM||!process.env.APP_URL)throw new Error('Email delivery is not configured. Set RESEND_API_KEY, MAIL_FROM and APP_URL.');
 const origin=new URL(process.env.APP_URL);if(origin.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(origin.hostname))throw new Error('APP_URL must use HTTPS outside local development.');
 const token=randomBytes(32).toString('base64url'),hash=tokenHash(token);
 await db.batch([db.prepare('DELETE FROM verification_tokens WHERE user_id=? AND purpose=?').bind(userId,purpose),db.prepare('INSERT INTO verification_tokens(hash,user_id,expires,purpose) VALUES(?,?,?,?)').bind(hash,userId,Date.now()+30*60*1000,purpose)]);
 const path=purpose==='reset'?'/login?reset='+token:'/api/auth/verify?token='+token;
 const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.MAIL_FROM,to:[email],subject:purpose==='reset'?'Reset your TeamFlow password':'Verify your TeamFlow email',text:'Open this link within 30 minutes: '+new URL(path,origin).href})});
 if(!r.ok){await db.prepare('DELETE FROM verification_tokens WHERE hash=?').bind(hash).run();throw new Error('Email delivery failed. Check your Resend sender configuration.');}
}
export async function auth(request:Request,path:string,db:Database):Promise<Response>{
 try{
  tokenHash('configuration-check');
  if(request.method==='GET'&&path==='verify'){
   const token=new URL(request.url).searchParams.get('token')||'';if(!/^[A-Za-z0-9_-]{43}$/.test(token))return response({error:'Invalid verification link'},400);
   const hash=tokenHash(token),proof=await db.prepare('SELECT user_id FROM verification_tokens WHERE hash=? AND expires>? AND purpose=?').bind(hash,Date.now(),'verify').first<any>();if(!proof)return response({error:'Verification link expired or already used'},400);
   await db.batch([db.prepare('UPDATE users SET email_verified=1 WHERE id=? AND EXISTS(SELECT 1 FROM verification_tokens WHERE hash=? AND expires>? AND purpose=?)').bind(proof.user_id,hash,Date.now(),'verify'),db.prepare('DELETE FROM verification_tokens WHERE hash=?').bind(hash)]);
   return new Response(null,{status:303,headers:{Location:'/login?verified=1','Cache-Control':'no-store'}});
  }
  if(request.method!=='POST')return response({error:'Method not allowed'},405);
  const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return response({error:'Cross-origin writes are blocked'},403);
  if(!request.headers.get('content-type')?.startsWith('application/json'))return response({error:'Send application/json'},415);
  const text=await request.text();if(text.length>8000)return response({error:'Request is too large'},413);const body=JSON.parse(text);
  if(path==='logout'){const token=cookieToken(request);if(token)await db.prepare('DELETE FROM sessions WHERE hash=?').bind(tokenHash(token)).run();return response({ok:true},200,{'Set-Cookie':cookie('',request,0)});}
  if(path==='send-verification'){
   const user=await getUser(request,db);if(!user)return response({error:'Sign in to continue'},401);if(user.emailVerified)return response({ok:true,message:'Your email is already verified.'});
   if(!await rateLimit(db,'verify:'+user.userId,1,60000))return response({error:'Wait one minute before requesting another email.'},429);
   await emailLink(db,user.userId,user.email,'verify');return response({ok:true,message:'Verification email sent. Check your inbox.'});
  }
  if(path==='reset-password'){
   const password=passwordSchema.parse(body.password),token=String(body.token||'');if(!/^[A-Za-z0-9_-]{43}$/.test(token))return response({error:'Invalid reset link'},400);
   const hash=tokenHash(token),result=await db.prepare('WITH proof AS (DELETE FROM verification_tokens WHERE hash=? AND expires>? AND purpose=? RETURNING user_id) UPDATE users SET password_hash=?,email_verified=1,auth_version=auth_version+1 WHERE id=(SELECT user_id FROM proof) RETURNING id').bind(hash,Date.now(),'reset',await passwordHash(password)).first<any>();
   if(!result)return response({error:'Reset link expired or already used'},400);return response({ok:true,message:'Password reset. Sign in with your new password.'},200,{'Set-Cookie':cookie('',request,0)});
  }
  const email=emailSchema.parse(body.email),ip=request.headers.get('x-forwarded-for')?.split(',')[0].trim()||'local';
  if(!await rateLimit(db,'ip:'+tokenHash(ip).slice(0,24),30,900000)||!await rateLimit(db,'email:'+tokenHash(email).slice(0,24),10,900000))return response({error:'Too many attempts. Try again in 15 minutes.'},429);
  if(path==='forgot-password'){
   if(!process.env.RESEND_API_KEY||!process.env.MAIL_FROM||!process.env.APP_URL)return response({error:'Password-reset email is not configured by the administrator.'},503);
   const user=await db.prepare('SELECT id FROM users WHERE email=?').bind(email).first<any>();if(user)await emailLink(db,user.id,email,'reset');return response({ok:true,message:'If this account exists, a reset link has been sent.'});
  }
  if(!['login','register'].includes(path))return response({error:'Endpoint not found'},404);
  const password=passwordSchema.parse(body.password);let user=await db.prepare('SELECT * FROM users WHERE email=?').bind(email).first<any>();
  if(path==='register'){
   if(user)return response({error:'This email is registered. Sign in or request a password reset.'},409);
   const name=z.string().trim().min(1).max(100).parse(body.name),userId=randomUUID();
   await db.prepare('INSERT INTO users(id,email,name,password_hash,email_verified,created) VALUES(?,?,?,?,0,?)').bind(userId,email,name,await passwordHash(password),Date.now()).run();
   return response({ok:true},201,{'Set-Cookie':await startSession(request,db,userId)});
  }
  const valid=await passwordMatches(password,user?.password_hash||'scrypt$00000000000000000000000000000000$'+'0'.repeat(64));if(!user||!valid)return response({error:'Incorrect email or password'},401);
  return response({ok:true},200,{'Set-Cookie':await startSession(request,db,user.id)});
 }catch(error){
  if(error instanceof z.ZodError)return response({error:error.issues.map(i=>i.message).join('; ')},400);
  if(error instanceof SyntaxError)return response({error:'Invalid JSON'},400);
  if(error instanceof Error&&/configure|configured|delivery|APP_URL/i.test(error.message))return response({error:error.message},503);
  console.error('Authentication request failed', {code:(error as any)?.code||'unknown', message:String((error as any)?.message||'Unknown server failure').replace(/postgres(?:ql)?:\/\/[^\s'\"]+/gi,'[REDACTED_URL]').slice(0,400)});return response({error:'Authentication service error. Check database setup.'},503);
 }
}
