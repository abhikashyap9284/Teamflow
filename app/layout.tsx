import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'TeamFlow — Abhi',description:'TeamFlow: a complete Task planning, Kanban workflows, role-checked team collaboration, task discussions, file uploads, analytics. built with React and TypeScript.'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>};
