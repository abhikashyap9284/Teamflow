import { neon } from '@neondatabase/serverless';

export type Query = { sql: string; params: any[] };
export type Result = { rows: Record<string,any>[]; rowCount: number };
export type Transport = { execute: (query: Query) => Promise<Result>; transaction: (queries: Query[]) => Promise<Result[]> };
export interface Statement {
  bind(...values: any[]): Statement;
  first<T=any>(): Promise<T|null>;
  all(): Promise<{results: any[]}>;
  run(): Promise<{meta:{changes:number}}>;
}
export interface Database { prepare(sql:string):Statement; batch(statements:Statement[]):Promise<any[]> }

// This is a bounded adapter for SQL emitted by lib/service.ts, not a general
// SQLite compatibility layer. Values always travel as separate parameters.
export function postgresSql(input: string) {
  let sql = input.replace(/INSERT OR IGNORE INTO /gi, 'INSERT INTO ');
  if (/INSERT OR IGNORE INTO /i.test(input)) sql += ' ON CONFLICT DO NOTHING';
  sql = sql.replace(/json_extract\(data,'\$\.(\w+)'\)/g, "(data::jsonb ->> '$1')");
  if (/ON CONFLICT/i.test(sql)) {
    const table = sql.match(/^INSERT INTO (\w+)/i)?.[1];
    if (table) sql = sql.replace(/\b(count|version)=\1\+1/g, (_, col) => `${col}=${table}.${col}+1`);
  }
  let index = 0, quote = '', output = '';
  for (let i=0; i<sql.length; i++) {
    const char = sql[i];
    if (quote) {
      output += char;
      if (char === quote) { if (sql[i+1] === quote) output += sql[++i]; else quote = ''; }
    } else if (char === "'" || char === '"') { quote=char; output+=char; }
    else if (sql.slice(i,i+4).toLowerCase()==='user' && !/[\w]/.test(sql[i-1]||'') && !/[\w]/.test(sql[i+4]||'')) { output+='"user"';i+=3; }
    else output += char === '?' ? '$'+(++index) : char;
  }
  return output;
}
const numeric = new Set(['created','updated','expires','version','status','latency','ok','count','size','email_verified']);
function normalize(row:Record<string,any>) {
  return Object.fromEntries(Object.entries(row).map(([key,value]) => [key,numeric.has(key)&&value!==null?Number(value):value]));
}
class Prepared implements Statement {
  db:PgDatabase; query:Query;
  constructor(db:PgDatabase,sql:string,params:any[]=[]) { this.db=db;this.query={sql:postgresSql(sql),params}; }
  bind(...params:any[]) { const next=new Prepared(this.db,'');next.query={sql:this.query.sql,params};return next; }
  async first<T=any>() { const result=await this.db.transport.execute(this.query);return result.rows.length?normalize(result.rows[0]) as T:null; }
  async all() { return {results:(await this.db.transport.execute(this.query)).rows.map(normalize)}; }
  async run() { return {meta:{changes:(await this.db.transport.execute(this.query)).rowCount}}; }
}
export class PgDatabase implements Database {
  transport:Transport;
  constructor(transport:Transport){this.transport=transport;}
  prepare(sql:string){return new Prepared(this,sql);}
  async batch(statements:Statement[]){
    const queries=statements.map(s=>{if(!(s instanceof Prepared)||s.db!==this)throw new Error('Invalid transaction statement');return s.query;});
    return (await this.transport.transaction(queries)).map(result=>({meta:{changes:result.rowCount}}));
  }
}
export function getDatabase() {
  const url=process.env.DATABASE_URL;
  if(!url)throw new Error('Configure DATABASE_URL with a Neon PostgreSQL connection string, then run npm run db:migrate.');
  const client=neon(url);
  const execute=async(query:Query)=>await client.query(query.sql,query.params,{fullResults:true}) as unknown as Result;
  const transaction=async(queries:Query[])=>await client.transaction(queries.map(q=>client.query(q.sql,q.params)),{fullResults:true}) as unknown as Result[];
  return new PgDatabase({execute,transaction});
}
export class PostgresFiles {
  db:Database;
  constructor(db:Database){this.db=db;}
  async put(key:string,bytes:ArrayBuffer) {
    await this.db.prepare('INSERT INTO attachment_data(key,payload,size,updated) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,size=excluded.size,updated=excluded.updated')
      .bind(key,Buffer.from(bytes).toString('base64'),bytes.byteLength,Date.now()).run();
  }
  async get(key:string) {
    const item=await this.db.prepare('SELECT payload FROM attachment_data WHERE key=?').bind(key).first<any>();
    return item?{body:new Uint8Array(Buffer.from(item.payload,'base64'))}:null;
  }
  async delete(key:string){await this.db.prepare('DELETE FROM attachment_data WHERE key=?').bind(key).run();}
}
