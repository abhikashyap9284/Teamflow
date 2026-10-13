import { neon } from '@neondatabase/serverless';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
if(!process.env.DATABASE_URL)throw new Error('Set DATABASE_URL in .env.local before running this command.');
const sql=neon(process.env.DATABASE_URL);
try{
 await sql.query('CREATE TABLE IF NOT EXISTS app_migrations(name TEXT PRIMARY KEY,checksum TEXT NOT NULL)');
 for(const file of (await readdir('db')).filter(n=>n.endsWith('.sql')).sort()){
  const source=await readFile('db/'+file,'utf8');const checksum=createHash('sha256').update(source).digest('hex');
  const applied=await sql.query('SELECT checksum FROM app_migrations WHERE name=$1',[file]);
  if(applied.length){if(applied[0].checksum!==checksum)throw new Error('An applied migration was modified; restore it and add a new migration.');continue;}
  const statements=source.split('-- statement-break').map(s=>s.trim()).filter(Boolean);
  await sql.transaction([...statements.map(s=>sql.query(s)),sql.query('INSERT INTO app_migrations(name,checksum) VALUES($1,$2)',[file,checksum])]);
  console.log('Applied',file);
 }
 console.log('PostgreSQL database is ready.');
}catch(error){console.error('Database migration failed. Check DATABASE_URL, database access, and migration history. Error code:',error.code||error.name);process.exit(1);}
