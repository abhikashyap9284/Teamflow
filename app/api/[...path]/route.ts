import { getDatabase,PostgresFiles } from '../../../lib/postgres';
import { auth,getUser } from '../../../lib/auth';
import { serve } from '../../../lib/service';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
async function handler(request:Request){
 try{
  const path=new URL(request.url).pathname.replace(/^\/api\//,'').split('/'),db=getDatabase();
  if(path[0]==='auth')return auth(request,path[1],db);
  return await serve(request,path,'teamflow',{DB:db,BUCKET:new PostgresFiles(db)},await getUser(request,db));
 }catch(error){
  console.error('API configuration or connection error',(error as any)?.code||'configuration');
  const message=error instanceof Error&&/Configure DATABASE_URL|Configure SESSION_SECRET/.test(error.message)?error.message:'Database connection failed. Check DATABASE_URL and run npm run db:migrate.';
  return Response.json({error:message},{status:503});
 }
}
export {handler as GET,handler as POST,handler as PATCH,handler as DELETE};
