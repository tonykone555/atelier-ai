import {NextResponse} from 'next/server';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';

export const runtime='nodejs';
export const maxDuration=60;

type Page={name:string;path:string;url:string;status:'verified'|'unavailable';title?:string};
const MAX_PAGES=30;
const MAX_HTML=1200000;
const FETCH_TIMEOUT=8500;
function publicIp(ip:string){
 const value=ip.toLowerCase();
 if(value.includes(':')){
  if(value==='::1'||value==='::'||value.startsWith('fe80:')||value.startsWith('fc')||value.startsWith('fd')||value.startsWith('ff'))return false;
  if(value.startsWith('::ffff:'))return publicIp(value.slice(7));
  return true;
 }
 const p=value.split('.').map(Number);
 return p.length===4&&p.every(n=>Number.isInteger(n)&&n>=0&&n<=255)&&
 p[0]!==0&&p[0]!==10&&p[0]!==127&&p[0]<224&&
 !(p[0]===169&&p[1]===254)&&!(p[0]===172&&p[1]>=16&&p[1]<=31)&&
 !(p[0]===192&&p[1]===168)&&!(p[0]===100&&p[1]>=64&&p[1]<=127)&&
 !(p[0]===192&&p[1]===0)&&!(p[0]===198&&p[1]===18)&&!(p[0]===198&&p[1]===19);
}
async function checkedOrigin(raw:string){
 const url=new URL(raw);
 const hostname=url.hostname.toLowerCase();
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||
 !hostname.includes('.')||hostname.endsWith('.local')||hostname.endsWith('.internal')||
 hostname.endsWith('.localhost')||hostname==='localhost'||isIP(hostname))throw Error('Use a public HTTPS website domain.');
 const records=await lookup(hostname,{all:true,verbatim:true});
 if(!records.length||records.some(r=>!publicIp(r.address)))throw Error('The website must resolve to a public internet address.');
 return url;
}
function decodeHtml(value:string){return value.replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)))}
function strip(value:string){return decodeHtml(value.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim())}
function normalized(url:URL,origin:URL){
 if(url.origin!==origin.origin||url.protocol!=='https:'||url.username||url.password||url.port)return null;
 if(/\.(?:pdf|jpg|jpeg|png|webp|gif|svg|ico|zip|mp4|mov|mp3|css|js|xml|json|woff2?|ttf|otf)(?:$)/i.test(url.pathname))return null;
 url.hash='';url.search='';
 const path=url.pathname.replace(/\/+$/,'')||'/';
 return path;
}
function discover(html:string,base:URL,origin:URL){
 const found:{path:string;label:string}[]=[];
 const anchors=html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi);
 for(const match of anchors){
  const tag=match[0];
  const href=tag.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i)?.[1]||tag.match(/\bhref\s*=\s*'([^']*)'/i)?.[1];
  if(!href||href.startsWith('#')||href.startsWith('javascript:')||href.startsWith('mailto:')||href.startsWith('tel:'))continue;
  try{
   const target=new URL(decodeHtml(href),base);
   const path=normalized(target,origin);
   if(!path)continue;
   let label=strip(tag.slice(tag.indexOf('>')+1,tag.lastIndexOf('</a>'))).slice(0,90);
   if(!label)label=path==='/'?'Home':path.split('/').filter(Boolean).pop()!.replace(/[-_]/g,' ');
   found.push({path,label});
  }catch{}
 }
 return found;
}
async function readPage(origin:URL,path:string){
 const target=new URL(path,origin);
 const response=await fetch(target,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(FETCH_TIMEOUT),headers:{'Accept':'text/html','User-Agent':'AtelierWebsiteImporter/1.0'}});
 const mime=response.headers.get('content-type')||'';
 if(!response.ok||!mime.toLowerCase().includes('text/html'))throw Error('Page does not return HTML.');
 const size=Number(response.headers.get('content-length')||0);
 if(size>MAX_HTML*2)throw Error('Page is too large.');
 const html=(await response.text()).slice(0,MAX_HTML);
 const title=strip(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'').slice(0,120);
 return {html,title};
}
async function getSitemapPaths(origin:URL){
 const paths:string[]=[];
 try{
  const r=await fetch(new URL('/sitemap.xml',origin),{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(5000),headers:{Accept:'application/xml,text/xml'}});
  if(!r.ok||Number(r.headers.get('content-length')||0)>500000)return paths;
  const xml=(await r.text()).slice(0,500000);
  for(const m of xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)){
   try{const p=normalized(new URL(decodeHtml(m[1].trim()),origin),origin);if(p&&!paths.includes(p))paths.push(p)}catch{}
   if(paths.length>=MAX_PAGES)break;
  }
 }catch{}
 return paths;
}
export async function POST(request:Request){
 try{
  const data=await request.json();
  if(data?.confirmRights!==true)return NextResponse.json({error:'Confirm permission to reuse this website design and content before importing.'},{status:403});
  const origin=await checkedOrigin(String(data.url||''));
  const startPath=normalized(new URL(origin.href),origin)||'/';
  const queue:{path:string;label:string}[]=[{path:startPath,label:'Home'}];
  if(startPath!=='/')queue.push({path:'/',label:'Home'});
  const visited=new Set<string>();
  const pages:Page[]=[];
  // Read linked pages (including navigation pages); sitemap supplies routes not exposed in the homepage navigation.
  const sitemap=await getSitemapPaths(origin);
  let index=0;
  while(index<queue.length&&pages.length<MAX_PAGES){
   const batch=queue.slice(index,index+5);
   index+=batch.length;
   const outcome=await Promise.all(batch.map(async entry=>{
    if(visited.has(entry.path))return null;
    visited.add(entry.path);
    const page:Page={path:entry.path,name:entry.label,url:new URL(entry.path,origin).href,status:'unavailable'};
    try{
     const result=await readPage(origin,entry.path);
     page.status='verified';page.title=result.title;
     if(result.title&&(entry.label==='Home'||entry.label.length>60))page.name=result.title.slice(0,55);
     return {page,links:discover(result.html,new URL(entry.path,origin),origin)};
    }catch{return {page,links:[] as {path:string;label:string}[]}}
   }));
   for(const item of outcome){
    if(!item)continue;
    pages.push(item.page);
    for(const link of item.links){
     if(queue.length>=MAX_PAGES*4)break;
     if(!visited.has(link.path)&&!queue.some(q=>q.path===link.path))queue.push(link);
    }
   }
   if(index>=queue.length&&sitemap.length){
    for(const path of sitemap){
     if(queue.length>=MAX_PAGES*4)break;
     if(!visited.has(path)&&!queue.some(q=>q.path===path))queue.push({path,label:path.split('/').filter(Boolean).pop()?.replace(/[-_]/g,' ')||'Home'});
    }
   }
  }
  if(!pages.some(p=>p.status==='verified'))return NextResponse.json({error:'No accessible HTML pages found. This website may block automated requests or require JavaScript rendering.'},{status:422});
  const label=pages[0].title||origin.hostname.replace(/^www\./,'');
  return NextResponse.json({name:label,sourceWebsite:origin.origin,mode:'original-reference',pages,verified:pages.filter(p=>p.status==='verified').length,total:pages.length,partial:queue.length>MAX_PAGES,note:'Discovers up to 30 same-origin public HTML pages. Source pages remain external references and may block iframe embedding. This does not copy HTML/CSS or make the source editable.'});
 }catch(error){
  return NextResponse.json({error:error instanceof Error?error.message:'Unable to inspect website.'},{status:400});
 }
}
