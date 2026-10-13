'use client';
import React,{useCallback,useEffect,useRef,useState} from 'react';
import {Layers,Activity,PenTool,Leaf,LayoutDashboard,Columns3,ListTodo,Users,Settings,Bell,Search,ChevronRight,HelpCircle,Menu,Plus,LogOut,LoaderCircle,Folder,Heart,Calendar,Shield,ArrowUpRight} from 'lucide-react';
import Feature from './features';
import {AppContext,Modal,Editor,Scene,Empty,fmtDate,admin,type State,type Context} from './ui';
import type {Project,User,Item} from '../lib/domain';
const configs={
teamflow:{name:'TeamFlow',tagline:'Good work starts with a clear plan.',subtitle:'Bring your team, tasks, and ideas into one thoughtful workspace. Less friction. More forward.',icon:Layers,nav:[['overview','Overview',LayoutDashboard],['board','Task board',Columns3],['list','All tasks',ListTodo],['analytics','Insights',Activity]],label:'PROJECT WORKSPACE'},
pulseops:{name:'PulseOps',tagline:'Know before your users do.',subtitle:'Monitor your services, investigate incidents, and keep reliability in focus. Every check is a real HTTP request.',icon:Activity,nav:[['overview','Overview',LayoutDashboard],['monitors','Monitors',Activity],['incidents','Incidents',Shield],['checks','Check history',ListTodo]],label:'RELIABILITY WORKSPACE'},
collabcanvas:{name:'CollabCanvas',tagline:'Big ideas need a little space.',subtitle:'A shared canvas for thinking out loud. Sketch, connect, and shape what comes next together.',icon:PenTool,nav:[['overview','Your boards',Folder],['canvas','Whiteboard',PenTool]],label:'CREATIVE WORKSPACE'},
impacthub:{name:'ImpactHub',tagline:'Small actions. Lasting impact.',subtitle:'Find a purpose, bring people together, and make your community a little better. One opportunity at a time.',icon:Leaf,nav:[['overview','Overview',LayoutDashboard],['opportunities','Opportunities',Heart],['applications','Applications',ListTodo],['profile','My profile',Users],['analytics','Impact report',Activity]],label:'COMMUNITY WORKSPACE'}
} as const;
export default function Product({project}:{project:Project}){
const cfg=configs[project];const Icon=cfg.icon;const[user,setUser]=useState<User|null>(null);const[spaces,setSpaces]=useState<any[]>([]);const[workspace,setWorkspace]=useState('');const[state,setState]=useState<State>({records:[],members:[],activity:[],checks:[],role:'viewer'});const[view,setView]=useState('overview');const[search,setSearch]=useState('');const[loading,setLoading]=useState(true);const[error,setError]=useState('');const[syncError,setSyncError]=useState('');const[notice,setNotice]=useState('');const[busy,setBusy]=useState(false);const[modal,setModal]=useState('');const[menu,setMenu]=useState(false);const[online,setOnline]=useState(true);const searchRef=useRef<HTMLInputElement>(null);const currentWs=useRef('');const mounted=useRef(true);
const toast=useCallback((message:string)=>setNotice(message),[]);
useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),6000);return()=>clearTimeout(timer)},[notice]);
const api=useCallback(async(path:string,method='GET',body?:any):Promise<any>=>{const join=path.includes('?')?'&':'?';const r=await fetch('/api/'+path+(currentWs.current?join+'workspace='+encodeURIComponent(currentWs.current):''),{method,headers:body!==undefined?{'Content-Type':'application/json'}:undefined,body:body!==undefined?JSON.stringify(body):undefined});const data:any=await r.json();if(!r.ok){if(r.status===401)throw new Error('Sign in to continue');let message=data.error||'Request failed';try{const issues=JSON.parse(message);if(Array.isArray(issues))message=issues.map((x:any)=>x.path.join('.')+': '+x.message).join('; ')}catch{}throw new Error(message)}return data},[]);
const refresh=useCallback(async()=>{const ws=currentWs.current;if(!ws)return;const data=await api('state');if(currentWs.current===ws&&mounted.current){setState(data);setSyncError('')}},[api]);
useEffect(()=>{mounted.current=true;let live=true;api('bootstrap').then(data=>{if(!live)return;setUser(data.user);setSpaces(data.workspaces);let pref='';try{pref=localStorage.getItem(project+'-workspace')||''}catch{}const ws=data.workspaces.find((s:any)=>s.id===pref)?.id||data.workspaces[0]?.id||'';currentWs.current=ws;setWorkspace(ws);return refresh()}).catch(e=>{if(live)setError(e.message)}).finally(()=>{if(live)setLoading(false)});return()=>{live=false;mounted.current=false}},[api,project,refresh]);
useEffect(()=>{if(!user)return;let inFlight=false;const tick=async()=>{if(document.visibilityState!=='visible'||inFlight)return;inFlight=true;try{await refresh();setOnline(true)}catch(e){setOnline(false);setSyncError(e instanceof Error?e.message:'Sync paused')}finally{inFlight=false}};const timer=setInterval(tick,2500);return()=>clearInterval(timer)},[user,refresh]);
useEffect(()=>{const key=(e:KeyboardEvent)=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();searchRef.current?.focus()}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[]);
const mutate=async<T,>(fn:()=>Promise<T>)=>{setBusy(true);try{const result=await fn();await refresh();return result}catch(e){toast(e instanceof Error?e.message:'Could not save');throw e}finally{setBusy(false)}};
const create=(kind:string,data:any)=>mutate<Item>(()=>api('records','POST',{kind,data}));
const update=(item:Item,data:any)=>mutate<Item>(()=>api('records/'+item.id,'PATCH',{data,version:item.version}));
const remove=async(item:Item)=>{await mutate(()=>api('records/'+item.id+'?version='+item.version,'DELETE',{}))};
const switchWorkspace=async(ws:string)=>{currentWs.current=ws;setWorkspace(ws);setState({records:[],members:[],activity:[],checks:[],role:'viewer'});setView('overview');setSearch('');try{localStorage.setItem(project+'-workspace',ws)}catch{}await refresh()};
const context:Context={state,user:user!,workspace,view,search,busy,api,create,update,remove,refresh,toast,setView};
if(loading)return <div className={'app '+project}>
<div className="loading">
<LoaderCircle className="spin" size={22}/> Preparing your workspace…</div>
</div>;
if(!user)return <div className={'app '+project}>
<main className="login">
<div className="login-copy">
<div className="brand">
<span className="brand-mark">
<Icon size={22}/>
</span>{cfg.name}</div>
<span className="eyebrow">Built for your next chapter</span>
<h1>{cfg.tagline}</h1>
<p>{cfg.subtitle}</p>
<a className="btn primary" href="/login">Sign in <ArrowUpRight size={17}/>
</a>
<small>Your own persistent workspace. Create an account and invite teammates by verified email.<br/>Sample content is labeled; replace it with your real work.</small>{error&&error!=='Sign in to continue'&&<p className="form-error">{error}<br/>
<button className="btn" onClick={()=>location.reload()}>Retry</button>
</p>}</div>
<div className="login-art">
<Scene variant={project}/>
<div className="login-caption">A workspace that works as thoughtfully as you do.<br/>Built by Abhi · Next.js · TypeScript · PostgreSQL</div>
</div>
</main>
</div>;
return <AppContext.Provider value={context}>
<div className={'app '+project}>
<aside className={'sidebar '+(menu?'open':'')}>
<a className="brand" href="/" aria-label={cfg.name+' home'}>
<span className="brand-mark">
<Icon size={21}/>
</span>{cfg.name}</a>
<select className="workspace-picker" aria-label="Switch workspace" value={workspace} onChange={e=>switchWorkspace(e.target.value).catch(err=>toast(err.message))}>{spaces.map(s=>
<option key={s.id} value={s.id}>{s.name}</option>)}</select>
<div className="nav-caption">{cfg.label}</div>
<nav className="nav">{cfg.nav.map(([key,label,NavIcon])=>
<button key={key} className={view===key?'active':''} onClick={()=>{setView(key);setMenu(false);setSearch('')}}>
<NavIcon size={17}/>{label}</button>)}<button className={view==='team'?'active':''} onClick={()=>{setView('team');setMenu(false)}}>
<Users size={17}/> Team <span className="count">{state.members.length}</span>
</button>
<button className={view==='activity'?'active':''} onClick={()=>{setView('activity');setMenu(false)}}>
<Bell size={17}/> Activity</button>
<button className={view==='settings'?'active':''} onClick={()=>{setView('settings');setMenu(false)}}>
<Settings size={17}/> Settings</button>
</nav>
<div className="sidebar-bottom">
<div className="upgrade">
<strong>Your next milestone starts here.</strong>
<p>Create another workspace for a fresh project, team, or community.</p>
<button className="btn" onClick={()=>setModal('workspace')}>
<Plus size={13}/> New workspace</button>
</div>
<div className="user-card">
<span className="avatar">{user.displayName.slice(0,2).toUpperCase()}</span>
<div>
<strong>{user.displayName}</strong>
<small>{state.role} · Signed in</small>
</div>
<button className="icon-btn" aria-label="Sign out" onClick={async()=>{try{const r=await fetch("/api/auth/logout",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});if(!r.ok)throw new Error("Sign out failed");location.href="/login"}catch(e){toast((e as Error).message)}}}>
<LogOut size={15}/>
</button>
</div>
</div>
</aside>
<div className="main">
<header className="topbar">
<button className="icon-btn mobile-toggle" onClick={()=>setMenu(!menu)} aria-label="Toggle menu">
<Menu size={20}/>
</button>
<div className="breadcrumb">Workspace <ChevronRight size={13}/>
<strong>{spaces.find(s=>s.id===workspace)?.name}</strong>
</div>
<label className="searchbox">
<Search size={16}/>
<input ref={searchRef} value={search} onChange={e=>setSearch(e.target.value)} aria-label="Search workspace" placeholder="Search your workspace…"/>
<kbd>⌘ K</kbd>
</label>
<div className="top-actions">
<button className="icon-btn" aria-label="Keyboard shortcuts" onClick={()=>setModal('help')}>
<HelpCircle size={18}/>
</button>
<button className="icon-btn" aria-label="Open activity" onClick={()=>setView('activity')}>
<Bell size={18}/>
</button>
<span className="avatar">{user.displayName.slice(0,2).toUpperCase()}</span>
</div>
</header>{syncError&&<div className="sync-error" role="status">Sync paused: {syncError}. Unsaved forms stay open. Reconnecting automatically.</div>}<main className="content">{view==='team'?<>
<h1 className="page-title">Great work is a team effort.</h1>
<p className="page-subtitle">Invite people with the verified email used for their TeamFlow account. They will see this workspace after signing in and verifying their email.</p>
<div className="section-head">
<h2>Workspace members</h2>{admin(state.role)&&<button className="btn primary" onClick={()=>setModal('invite')}>
<Plus size={15}/> Invite member</button>}</div>
<div className="panel table-scroll">
<table className="data-table">
<thead>
<tr>
<th>Name</th>
<th>Email</th>
<th>Role</th>
<th>Access</th>
</tr>
</thead>
<tbody>{state.members.map(m=>
<tr key={m.id}>
<td>{m.name}</td>
<td>{m.email}</td>
<td>
<span className="badge">{m.role}</span>
</td>
<td>
<div className="member-action">
<span>{m.user?'Joined':'Awaiting sign-in'}</span>{admin(state.role)&&m.role!=='owner'&&<button className="btn small danger" onClick={async()=>{if(confirm('Remove '+m.email+' from this workspace?'))try{await api('members/'+m.id,'DELETE',{});await refresh()}catch(e){toast((e as Error).message)}}}>Remove</button>}</div>
</td>
</tr>)}</tbody>
</table>
</div>
</>:view==='activity'?<>
<h1 className="page-title">Activity, in context.</h1>
<p className="page-subtitle">The latest 60 changes in this workspace. Updates refresh while this page is open.</p>
<div className="panel panel-body">{state.activity.length?<div className="activity-list">{state.activity.map(a=>
<div className="activity-item" key={a.id}>
<span className="avatar">{a.actor.slice(0,2).toUpperCase()}</span>
<div>
<p>{a.message}</p>
<small>{a.actor} · {fmtDate(a.created)}</small>
</div>
</div>)}</div>:<Empty title="A fresh start" description="Your workspace activity will appear as your team makes changes."/>}</div>
</>:view==='settings'?<>
<h1 className="page-title">Workspace settings</h1>
<p className="page-subtitle">A few things to know about your workspace.</p>
<div className="panel panel-body help">
<p>
<strong>{cfg.name}</strong> · Built by Abhi. Your role is <strong>{state.role}</strong>.</p><p>Email: {user.email} · {user.emailVerified?'Verified':'Not verified'}</p>{!user.emailVerified&&<button className="btn" onClick={async()=>{try{const r=await api('auth/send-verification','POST',{});toast(r.message)}catch(e){toast((e as Error).message)}}}>Send verification email</button>}
<p>Data is stored on the server. Each workspace has its own membership boundary. Owner/admin can invite people; editor can edit; viewer can read. ImpactHub viewers can also apply and manage their own profile.</p>
<p>Collaboration uses automatic updates every 2.5 seconds while open. Concurrent edits use record versions; a stale update shows a conflict instead of replacing someone else’s work.</p>
<p>Sample records are starter content, not real clients, production uptime, or verified community impact.</p>
<button className="btn" onClick={()=>setModal('workspace')}>
<Plus size={15}/> Create workspace</button>{project==='pulseops'&&<>
<p>Continuous monitoring requires the background runner included in your source. Generate a token, then run <code>npm run monitor:worker</code> with the documented environment variables. Email alerts require your Resend configuration.</p>
<button disabled={!admin(state.role)} className="btn primary" onClick={async()=>{try{const {token}=await api('token','POST',{});setNotice('Token generated. It is shown once.');setModal('token:'+token)}catch(e){toast((e as Error).message)}}}>Generate runner token</button>
<button disabled={!admin(state.role)} className="btn danger" onClick={async()=>{try{await api('token','DELETE',{});toast('Runner token revoked')}catch(e){toast((e as Error).message)}}}>Revoke runner token</button>
</>}</div>
</>:<Feature key={workspace} />}
<footer className="footer">
<span>{cfg.name} · Thoughtfully built by Abhi</span>
<span className="status-live">
<i/>{online?'Server sync active · 2.5s':'Reconnecting'}</span>
</footer>
</main>
</div>{notice&&<div className="toast" role="status">{notice}</div>}
{modal==='help'&&<Modal title="A little help" onClose={()=>setModal('')}>
<div className="help">
<p>
<kbd>Ctrl / ⌘ K</kbd> Focus search.</p>
<p>
<kbd>Esc</kbd> Close the active dialog.</p>{project==='collabcanvas'&&<>
<p>
<kbd>Delete</kbd> Delete the selected shape. <kbd>Ctrl / ⌘ Z</kbd> Undo your last shape change.</p>
<p>Drag empty space with the hand tool. Use the mouse wheel to zoom. Add notes, shapes, or freehand paths from the toolbar. Select a shape to edit its text or color.</p>
</>}<p>Task cards support drag and drop on desktop. The status dropdown works on keyboard and touch devices.</p>
<p>Records save only after the server accepts the change. If another person edits the same record, refresh it before trying again.</p>
</div>
</Modal>}
{modal==='workspace'&&<Modal title="A new workspace" onClose={()=>setModal('')}>
<Editor fields={[{key:'name',label:'Workspace name',required:true}]} initial={{name:''}} label="Create workspace" onSave={async data=>{const r=await api('workspaces','POST',data);const boot=await api('bootstrap');setSpaces(boot.workspaces);await switchWorkspace(r.id);setModal('')}}/>
</Modal>}
{modal==='invite'&&<Modal title="Invite a teammate" onClose={()=>setModal('')}>
<div className="callout">An invitation grants membership to a verified email. It does not send an invitation email. Share the website link with your teammate.</div>
<Editor fields={[{key:'email',label:'verified account email',type:'email',required:true},{key:'role',label:'Role',options:['editor','viewer','admin']}]} initial={{email:'',role:'editor'}} label="Grant workspace access" onSave={async data=>{await api('invite','POST',data);await refresh();setModal('');toast('Workspace invitation saved')}}/>
</Modal>}
{modal.startsWith('token:')&&<Modal title="Your runner token" onClose={()=>setModal('')}>
<p className="callout">Copy this secret now. It is stored as a hash and will not be shown again. A new token revokes the previous one.</p>
<div className="token-output">{modal.slice(6)}</div>
<button className="btn" style={{marginTop:15}} onClick={()=>navigator.clipboard.writeText(modal.slice(6)).then(()=>toast('Copied')).catch(()=>toast('Select the token and copy it manually'))}>Copy token</button>
</Modal>}
</div>
</AppContext.Provider>}
