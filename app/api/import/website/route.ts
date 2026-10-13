import {NextResponse} from 'next/server';
export const runtime='nodejs';
const ROUTES=[
 {name:'Accueil',path:'/'},
 {name:'Notre Restaurant',path:'/presentation'},
 {name:'La Carte',path:'/menu'},
 {name:'Nos Plats',path:'/histoire'},
 {name:'Événements',path:'/evenements'},
 {name:'Réserver',path:'/reservation'},
 {name:'Contact',path:'/contact'}
];
export async function POST(request:Request){
 try{
  const data=await request.json();
  if(data?.confirmRights!==true)return NextResponse.json({error:'Confirm that you are authorized to reuse this website before importing.'},{status:403});
  const url=new URL(String(data.url||''));
  if(url.protocol!=='https:'||url.hostname!=='yahabibi.ch'||url.username||url.password||url.port)return NextResponse.json({error:'This first full-site import is configured for https://yahabibi.ch/ only.'},{status:400});
  const pages=await Promise.all(ROUTES.map(async route=>{
   const target=new URL(route.path,'https://yahabibi.ch');
   try{
    const response=await fetch(target,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(12000),headers:{'Accept':'text/html','User-Agent':'AtelierWebsiteImporter/1.0'}});
    const mime=response.headers.get('content-type')||'';
    if(!response.ok||!mime.includes('text/html'))return {...route,url:target.href,status:'unavailable'};
    const html=(await response.text()).slice(0,1500000);
    const titleMatch=html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title=titleMatch?.[1]?.replace(/&amp;/g,'&').trim().slice(0,150)||route.name;
    return {...route,url:target.href,title,status:'verified'};
   }catch{return {...route,url:target.href,status:'unavailable'}}
  }));
  return NextResponse.json({name:'Ya Habibi!',sourceWebsite:'https://yahabibi.ch',mode:'original-reference',pages,verified:pages.filter(p=>p.status==='verified').length,total:pages.length,note:'The original pages are linked for reference. Remote iframe previews depend on the source website allowing embedding. This import does not copy or make the original source HTML editable.'});
 }catch{return NextResponse.json({error:'Could not inspect website URL.'},{status:400})}
}
