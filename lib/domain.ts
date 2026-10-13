import { z } from 'zod';
export type Project = 'teamflow'|'pulseops'|'collabcanvas'|'impacthub';
export type User = {userId:string;email:string;displayName:string;emailVerified?:boolean};
export type Item = {id:string;workspace:string;kind:string;data:Record<string,any>;version:number;updated:number;author:string};
const str = z.string().trim().min(1).max(200);
const date = z.string().refine(v=>!v || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Use YYYY-MM-DD');
export const roles = ['owner','admin','editor','viewer'] as const;
export const schemas: Record<string,z.ZodTypeAny> = {
 task:z.object({title:str,description:z.string().max(10000).default(''),status:z.enum(['backlog','progress','review','done']),priority:z.enum(['low','medium','high']),assignee:z.string().max(200).default(''),due:date.default(''),labels:z.array(z.string().max(30)).max(8).default([])}).strict(),
 comment:z.object({target:str,text:z.string().trim().min(1).max(4000)}).strict(),
 monitor:z.object({name:str,url:z.string().url().max(2048),expected:z.number().int().min(100).max(599).default(200),paused:z.boolean().default(false),lastChecked:z.number().default(0)}).strict(),
 incident:z.object({monitor:str,title:str,status:z.enum(['open','resolved']),started:z.number(),resolved:z.number().nullable(),note:z.string().max(4000).default('')}).strict(),
 board:z.object({title:str,description:z.string().max(1000).default('')}).strict(),
 shape:z.object({board:str,type:z.enum(['sticky','rect','ellipse','text','path']),x:z.number().min(-100000).max(100000),y:z.number().min(-100000).max(100000),w:z.number().min(10).max(10000),h:z.number().min(10).max(10000),color:z.enum(['yellow','purple','blue','green','pink','white']),text:z.string().max(10000).default(''),points:z.array(z.tuple([z.number().min(-100000).max(100000),z.number().min(-100000).max(100000)])).max(2000).default([])}).strict(),
 cursor:z.object({board:str,x:z.number().min(-100000).max(100000),y:z.number().min(-100000).max(100000),name:str}).strict(),
 opportunity:z.object({title:str,description:z.string().max(10000),category:z.enum(['Environment','Education','Community','Health']),location:str,date:date,hours:z.number().min(0.5).max(24),capacity:z.number().int().min(1).max(10000),status:z.enum(['open','closed'])}).strict(),
 application:z.object({opportunity:str,name:str,email:z.string().email().max(200),motivation:z.string().max(4000),status:z.enum(['pending','approved','rejected']),attended:z.boolean().default(false),user:str}).strict(),
 profile:z.object({name:str,bio:z.string().max(2000),skills:z.string().max(1000)}).strict(),
 attachment:z.object({target:str,name:str,key:str,size:z.number().int().max(5*1024*1024),type:str}).strict()
};
const kinds:Record<Project,string[]>={teamflow:['task','comment','attachment'],pulseops:['monitor','incident'],collabcanvas:['board','shape','cursor'],impacthub:['opportunity','application','profile']};
export function parseRecord(project:Project,kind:string,data:unknown){if(!kinds[project].includes(kind)) throw new Error('Unsupported record type');return schemas[kind].parse(data);}
export function canWrite(role:string){return ['owner','admin','editor'].includes(role);}
export function canManage(role:string){return ['owner','admin'].includes(role);}
export function allowedMonitorUrl(input:string,allowlist:string){const u=new URL(input);const hosts=allowlist.split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443')||!hosts.includes(u.hostname.toLowerCase()))throw new Error('Use HTTPS and a host listed in MONITOR_ALLOWED_HOSTS. Default: example.com, www.cloudflare.com, github.com');return u.href;}
export function summary(checks:any[]){const n=checks.length;return {uptime:n?checks.filter(c=>c.ok).length/n*100:null,latency:n?Math.round(checks.reduce((a,c)=>a+c.latency,0)/n):null,total:n};}
