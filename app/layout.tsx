import './style.css';import type {Metadata} from 'next';
export const metadata:Metadata={title:'Atelier — AI Website Studio',description:'Generate premium business websites and online storefronts'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}