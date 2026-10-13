import {NextResponse} from 'next/server';
export const runtime='nodejs';
const ACTOR='easyapi~just-eat-restaurant-menu-scraper';
const HOSTS=['just-eat.co.uk','just-eat.ch','just-eat.ie','just-eat.dk','just-eat.no','just-eat.be','just-eat.fr','just-eat.de','just-eat.it','just-eat.es','just-eat.at','just-eat.nl','just-eat.pl'];
function validUrl(raw:unknown){try{const u=new URL(String(raw||'').trim());if(u.protocol!=='https:'||u.username||u.password||!HOSTS.some(h=>u.hostname===h||u.hostname==='www.'+h)||!u.pathname||u.pathname==='/')return null;return u.href}catch{return null}}
function clean(v:unknown,n=300){return typeof v==='string'?v.trim().slice(0,n):''}
function num(v:unknown){if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)&&n>=0?n:null}
function photo(r:Record<string,unknown>){const sources=Array.isArray(r.imageSources)?r.imageSources:[];for(const item of [...sources,r.imageUrl,r.image,r.imageURL,r.pictureUrl]){const s=typeof item==='string'?item:(item&&typeof item==='object'?(item as Record<string,unknown>).path||(item as Record<string,unknown>).url:null);if(typeof s!=='string'||s.includes('{')||s.includes('}'))continue;try{const u=new URL(s);if(u.protocol==='https:')return s}catch{}}return null}
function transform(rows:Record<string,unknown>[],url:string){const swiss=new URL(url).hostname.endsWith('.ch');return rows.slice(0,1000).map((r,i)=>{const vars=Array.isArray(r.variations)?r.variations.slice(0,25).map((v:Record<string,unknown>)=>({name:clean(v.name||v.Name,80),price:num(v.basePrice??v.BasePrice??v.price)})):[];const imageUrl=photo(r);const price=num(r.price??r.basePrice)??vars.map(v=>v.price).find(x=>x!==null)??null;return {id:clean(r.id,100)||String(i+1),name:clean(r.name,160),description:clean(r.description,800),category:clean(r.category||r.menuGroupName,120)||'Menu',price,currency:clean(r.currency,8)||(swiss?'CHF':'GBP'),variations:vars,sourceUrl:url,imageUrl,imageStatus:imageUrl?'available':'missing'}}).filter(r=>r.name)}
function apify(url:string,token:string,method='GET',body?:unknown){return fetch('https://api.apify.com/v2/'+url,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(20000)})}
export async function POST(request:Request){
 try{
  const body=await request.json();if(body?.confirmRights!==true)return NextResponse.json({error:'Confirm permission to reuse this menu.'},{status:403});
  const menuUrl=validUrl(body.menuUrl);if(!menuUrl)return NextResponse.json({error:'Paste a supported Just Eat restaurant URL.'},{status:400});
  const token=process.env.APIFY_TOKEN;if(!token)return NextResponse.json({error:'APIFY_TOKEN is not configured.'},{status:503});
  const r=await apify('acts/'+ACTOR+'/runs?waitForFinish=0',token,'POST',{restaurantUrl:menuUrl,maxItems:1000});
  if(!r.ok)return NextResponse.json({error:'Could not start the Just Eat scraper (HTTP '+r.status+').'},{status:502});
  const j=await r.json();if(!j.data?.id)return NextResponse.json({error:'No scraper run ID returned.'},{status:502});
  return NextResponse.json({runId:j.data.id,menuUrl,status:j.data.status||'RUNNING'});
 }catch{return NextResponse.json({error:'Could not start the menu import.'},{status:500})}
}
export async function GET(request:Request){
 try{
  const q=new URL(request.url).searchParams;const runId=q.get('runId')||'',menuUrl=validUrl(q.get('menuUrl'));if(!/^[a-zA-Z0-9]{10,30}$/.test(runId)||!menuUrl)return NextResponse.json({error:'Invalid import request.'},{status:400});
  const token=process.env.APIFY_TOKEN;if(!token)return NextResponse.json({error:'Apify is not configured.'},{status:503});
  const r=await apify('actor-runs/'+runId,token);if(!r.ok)return NextResponse.json({error:'Could not check scraper status.'},{status:502});
  const j=await r.json();const run=j.data;if(!run)return NextResponse.json({error:'Scraper run not found.'},{status:404});
  if(!['SUCCEEDED','FAILED','ABORTED','TIMED-OUT'].includes(run.status))return NextResponse.json({status:run.status||'RUNNING'});
  if(run.status!=='SUCCEEDED')return NextResponse.json({error:'Just Eat scraper run '+run.status.toLowerCase()+'. This Actor may not support this country or restaurant URL.',status:run.status},{status:422});
  if(!run.defaultDatasetId)return NextResponse.json({error:'No menu dataset returned.'},{status:422});
  const data=await apify('datasets/'+run.defaultDatasetId+'/items?clean=true&limit=1000',token);
  if(!data.ok)return NextResponse.json({error:'Could not read the menu results.'},{status:502});
  const raw=await data.json();if(!Array.isArray(raw))return NextResponse.json({error:'Invalid menu data.'},{status:422});
  const rows=raw.flatMap((r:Record<string,unknown>)=>Array.isArray(r.items)?r.items: Array.isArray(r.menuItems)?r.menuItems:[r]) as Record<string,unknown>[];
  const items=transform(rows,menuUrl);if(!items.length)return NextResponse.json({error:'The scraper completed but returned no usable dishes. Swiss compatibility is not confirmed.'},{status:422});
  return NextResponse.json({status:'SUCCEEDED',source:'EasyApi Just Eat menu scraper',restaurantName:clean(raw[0]?.restaurantName,150),sourceUrl:menuUrl,items,imagesFound:items.filter(i=>i.imageUrl).length,imagesMissing:items.filter(i=>!i.imageUrl).length,groups:[...new Set(items.map(i=>i.category))],requiresReview:true,publishable:false,note:'Review prices and image rights before use. Missing or placeholder image URLs are excluded.'});
 }catch{return NextResponse.json({error:'Could not complete the menu import.'},{status:500})}
}