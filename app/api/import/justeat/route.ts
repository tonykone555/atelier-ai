import {NextResponse} from 'next/server';
export const runtime='nodejs';
const ACTOR='lentic_clockss~stealth-web-scraper';
const HOSTS=['just-eat.co.uk','just-eat.ch','just-eat.ie','just-eat.dk','just-eat.no','just-eat.be','just-eat.fr','just-eat.de','just-eat.it','just-eat.es','just-eat.at','just-eat.nl','just-eat.pl'];
function validUrl(raw:unknown){try{const u=new URL(String(raw||'').trim());if(u.protocol!=='https:'||u.username||u.password||!HOSTS.some(h=>u.hostname===h||u.hostname==='www.'+h)||!u.pathname||u.pathname==='/')return null;return u.href}catch{return null}}
function clean(v:unknown,n=300){return typeof v==='string'?v.trim().slice(0,n):''}
function num(v:unknown){if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)&&n>=0?n:null}
function photo(r:Record<string,unknown>){const sources=Array.isArray(r.imageSources)?r.imageSources:[];for(const item of [...sources,r.imageUrl,r.image,r.imageURL,r.pictureUrl]){const s=typeof item==='string'?item:(item&&typeof item==='object'?(item as Record<string,unknown>).path||(item as Record<string,unknown>).url:null);if(typeof s!=='string'||s.includes('{')||s.includes('}'))continue;try{const u=new URL(s);if(u.protocol==='https:')return s}catch{}}return null}
function transform(rows:Record<string,unknown>[],url:string){const swiss=new URL(url).hostname.endsWith('.ch');return rows.slice(0,1000).map((r,i)=>{const vars=Array.isArray(r.variations)?r.variations.slice(0,25).map((v:Record<string,unknown>)=>({name:clean(v.name||v.Name,80),price:num(v.basePrice??v.BasePrice??v.price)})):[];const imageUrl=photo(r);const price=num(r.price??r.basePrice)??vars.map(v=>v.price).find(x=>x!==null)??null;return {id:clean(r.id,100)||String(i+1),name:clean(r.name,160),description:clean(r.description,800),category:clean(r.category||r.menuGroupName,120)||'Menu',price,currency:clean(r.currency,8)||(swiss?'CHF':'GBP'),variations:vars,sourceUrl:url,imageUrl,imageStatus:imageUrl?'available':'missing'}}).filter(r=>r.name)}

function decode(s:string){return s.replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&apos;|&#39;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)))}
function strip(s:string){return decode(s.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ')).trim()}
function piece(s:string,start:string,end:string){const i=s.indexOf(start);if(i<0)return '';const from=i+start.length;const j=s.indexOf(end,from);return j<0?s.slice(from):s.slice(from,j)}
function extractMenu(html:string,url:string){
 const items:ReturnType<typeof transform>=[],seen=new Set<string>();
 const categoryBlocks=html.split(/<section\b[^>]*data-qa="item-category"[^>]*>/i);
 for(const section of categoryBlocks.slice(1)){
  const heading=strip(piece(section,'data-qa="heading">','</h2>'))||'Menu';
  const cards=section.split(/<li\b[^>]*data-item-id="([^"]+)"[^>]*>/i);
  for(let i=1;i<cards.length;i+=2){
   const id=cards[i],card=cards[i+1].split('</li>')[0];
   const name=strip(piece(card,'data-qa="item-name">','</span>'));
   if(!name||seen.has(id))continue;
   seen.add(id);
   const priceText=strip(piece(card,'data-qa="item-price">','</div>'));
   const found=priceText.match(/(\d{1,5}(?:[.,]\d{2})?)\s*(?:CHF|€|£)/i);
   const price=found?Number(found[1].replace(',','.')):null;
   const descStart=card.indexOf('formatted-description-style_description');
   const descPart=descStart<0?'':piece(card.slice(descStart),'aria-hidden="true">','</span>');
   const img=card.match(/<img\b[^>]*\bsrc="(https:[^"]+)"[^>]*>/i);
   const imageUrl=img?decode(img[1]):null;
   items.push({id,name:name.slice(0,160),description:strip(descPart).slice(0,800),category:heading.slice(0,120),price,currency:new URL(url).hostname.endsWith('.ch')?'CHF':'GBP',variations:[],sourceUrl:url,imageUrl,imageStatus:imageUrl?'available':'missing'});
  }
 }
 // Highlights may appear before categories, but usually duplicate main-menu items.
 const popular=piece(html,'data-qa="popular-items"','data-qa="item-category"');
 for(const part of popular.split(/<li\b[^>]*class="[^"]*swiper-slide/).slice(1)){
  const name=strip(piece(part,'popular-item-style_name__','</span>').split('>').slice(1).join('>'));
  if(!name||items.some(x=>x.name===name))continue;
  const priceText=strip(piece(part,'popular-item-style_info__','</div>'));
  const m=priceText.match(/(\d{1,5}(?:[.,]\d{2})?)\s*(?:CHF|€|£)/);
  const img=part.match(/<img\b[^>]*\bsrc="(https:[^"]+)"[^>]*>/i);
  items.push({id:'highlight-'+items.length,name,description:'',category:'Highlights',price:m?Number(m[1].replace(',','.')):null,currency:'CHF',variations:[],sourceUrl:url,imageUrl:img?decode(img[1]):null,imageStatus:img?'available':'missing'});
 }
 return items;
}
function apify(url:string,token:string,method='GET',body?:unknown){return fetch('https://api.apify.com/v2/'+url,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(20000)})}
export async function POST(request:Request){
 try{
  const body=await request.json();if(body?.confirmRights!==true)return NextResponse.json({error:'Confirm permission to reuse this menu.'},{status:403});
  const menuUrl=validUrl(body.menuUrl);if(!menuUrl)return NextResponse.json({error:'Paste a supported Just Eat restaurant URL.'},{status:400});
  const token=process.env.APIFY_TOKEN;if(!token)return NextResponse.json({error:'APIFY_TOKEN is not configured.'},{status:503});
  const r=await apify('acts/'+ACTOR+'/runs?waitForFinish=0',token,'POST',{urls:[menuUrl],outputFormat:'html',waitForSelector:'[data-qa="item-card"]',pageTimeout:120,proxyCountry:new URL(menuUrl).hostname.endsWith('.ch')?'ch':undefined,blockResources:false,maxConcurrency:1});
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
  const first=raw.find((r:Record<string,unknown>)=>typeof r.html==='string') as Record<string,unknown>|undefined;
  if(!first||first.blocked===true||first.ok===false)return NextResponse.json({error:'Scraper did not return accessible rendered HTML. Check the Apify run diagnostics.'},{status:422});
  const html=String(first.html||'');
  const items=extractMenu(html,menuUrl);
  if(!items.length)return NextResponse.json({error:'No dish cards could be parsed from the scraped HTML. HTML length: '+html.length+'; item-name markers: '+(html.match(/data-qa="item-name"/g)||[]).length+'. Please inspect the Actor result.'},{status:422});
  const truncated=first.htmlTruncated===true||Number(first.htmlChars||0)>html.length;
  const restaurantName=strip(piece(html,'data-qa="heading">','</h1>'))||clean(first.title,120).split(' Delivery')[0];
  return NextResponse.json({status:'SUCCEEDED',source:'EasyApi Just Eat menu scraper',restaurantName,sourceUrl:menuUrl,items,imagesFound:items.filter(i=>i.imageUrl).length,imagesMissing:items.filter(i=>!i.imageUrl).length,groups:[...new Set(items.map(i=>i.category))],partial:truncated,renderedHtmlChars:html.length,totalHtmlChars:Number(first.htmlChars||html.length),requiresReview:true,publishable:false,note:truncated?'Partial import: Apify truncated the HTML. Some categories and dishes are missing; verify before publication.':'Review prices, availability and image rights before publication.'});
 }catch{return NextResponse.json({error:'Could not complete the menu import.'},{status:500})}
}