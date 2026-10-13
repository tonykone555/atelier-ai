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
function cardPhoto(card:string){
 const tags=card.match(/<img\b[^>]*>/gi)||[];
 const read=(tag:string,attr:string)=>{const m=tag.match(new RegExp('(?:^|\\s)'+attr+'\\s*=\\s*(?:"([^"]+)"|\'([^\']+)\'|([^\\s>]+))','i'));return m?(m[1]||m[2]||m[3]):''};
 const candidates:string[]=[];
 for(const tag of tags){
  for(const attr of ['data-srcset','srcset','data-original','data-lazy-src','data-src','src','data-image-url']){
   const value=decode(read(tag,attr));
   if(!value)continue;
   if(attr.includes('srcset'))for(const part of value.split(','))candidates.push(part.trim().split(/\s+/)[0]);
   else candidates.push(value);
  }
 }
 for(const value of candidates){
  if(!/^https:\/\//i.test(value)||/(placeholder|blank\.|data:image|spacer|pixel)/i.test(value))continue;
  return value.replace(/&amp;/g,'&');
 }
 return null;
}
function parsePrice(raw:string){
 const text=strip(raw).replace(/[’']/g,'').replace(/\u00a0/g,' ');
 const match=text.match(/(?:CHF|SFr\.?|Fr\.?|EUR|GBP|€|£)\s*(\d{1,5}(?:[.,]\d{1,2})?)|(\d{1,5}(?:[.,]\d{1,2})?)\s*(?:CHF|SFr\.?|Fr\.?|EUR|GBP|€|£)/i);
 const amount=match?.[1]||match?.[2];
 return amount?Number(amount.replace(',','.')):null;
}
function cardPrice(card:string){
 const marker=card.search(/data-qa=["']item-price["']/i);
 if(marker>=0){const snippet=card.slice(marker,marker+800);const value=parsePrice(snippet);if(value!==null)return value}
 for(const term of ['item-price','price-style','itemPrice','basePrice','"price"','"amount"']){
  const i=card.indexOf(term);if(i>=0){const value=parsePrice(card.slice(i,i+600));if(value!==null)return value}
 }
 return null;
}
function extractMenu(html:string,url:string){
 const items:ReturnType<typeof transform>=[],seen=new Set<string>();
 const categoryBlocks=html.split(/<section\b[^>]*data-qa="item-category"[^>]*>/i);
 for(const section of categoryBlocks.slice(1)){
  const headingHtml=piece(section,'data-qa="heading">','</h2>');const heading=strip(piece(headingHtml,'aria-hidden="true">','</span>'))||strip(headingHtml)||'Menu';
  const cards=section.split(/<li\b[^>]*data-item-id="([^"]+)"[^>]*>/i);
  for(let i=1;i<cards.length;i+=2){
   const id=cards[i],card=cards[i+1].split('</li>')[0];
   const name=strip(piece(card,'data-qa="item-name">','</span>'));
   if(!name||seen.has(id))continue;
   seen.add(id);
   const priceText=piece(card,'data-qa="item-price">','</div>');
   const price=parsePrice(priceText)??cardPrice(card);
   const descStart=card.indexOf('formatted-description-style_description');
   const descPart=descStart<0?'':piece(card.slice(descStart),'aria-hidden="true">','</span>');
   const imageUrl=cardPhoto(card);
   items.push({id,name:name.slice(0,160),description:strip(descPart).slice(0,800),category:heading.slice(0,120),price,currency:new URL(url).hostname.endsWith('.ch')?'CHF':'GBP',variations:[],sourceUrl:url,imageUrl,imageStatus:imageUrl?'available':'missing'});
  }
 }
 // Highlights may appear before categories, but usually duplicate main-menu items.
 const popular=piece(html,'data-qa="popular-items"','data-qa="item-category"');
 for(const part of popular.split(/<li\b[^>]*class="[^"]*swiper-slide/).slice(1)){
  const name=strip(piece(part,'popular-item-style_name__','</span>').split('>').slice(1).join('>'));
  if(!name||items.some(x=>x.name===name))continue;
  const priceText=strip(piece(part,'popular-item-style_info__','</div>'));
  const price=parsePrice(priceText)??cardPrice(part);
  const imageUrl=cardPhoto(part);
  items.push({id:'highlight-'+items.length,name,description:'',category:'Highlights',price,currency:'CHF',variations:[],sourceUrl:url,imageUrl,imageStatus:imageUrl?'available':'missing'});
 }
 // A dish can appear in both Highlights and its category. Reuse its verified image,
 // but never assign a photo from a different product.
 const byName=new Map<string,string>();for(const item of items){if(item.imageUrl)byName.set(item.name.trim().toLowerCase(),item.imageUrl)}for(const item of items){if(!item.imageUrl){const found=byName.get(item.name.trim().toLowerCase());if(found){item.imageUrl=found;item.imageStatus='available'}}}
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

  // Actors vary in their dataset output. Prefer actual menu records when present;
  // otherwise parse any successful HTML page, not just the first result.
  const objects=raw.filter((r:unknown):r is Record<string,unknown>=>r!==null&&typeof r==='object'&&!Array.isArray(r));
  const isDish=(r:Record<string,unknown>)=>typeof r.name==='string'&&r.name.trim().length>1&&
    (r.price!==undefined||r.basePrice!==undefined||r.variations!==undefined||r.menuGroupName!==undefined||r.category!==undefined);
  const rows:Record<string,unknown>[]=[];
  for(const item of objects){
   if(isDish(item))rows.push(item);
   for(const key of ['items','menuItems','products','dishes']){
    const nested=item[key];if(Array.isArray(nested))for(const v of nested){
     if(v&&typeof v==='object'&&!Array.isArray(v)&&isDish(v as Record<string,unknown>))rows.push(v as Record<string,unknown>);
    }
   }
  }
  const byIdentity=new Map<string,ReturnType<typeof transform>[number]>();
  const add=(items:ReturnType<typeof transform>)=>{for(const item of items){
   const key=(item.category+'|'+item.name).trim().toLowerCase();
   const current=byIdentity.get(key);
   if(!current)byIdentity.set(key,item);
   else byIdentity.set(key,{...current,price:current.price??item.price,imageUrl:current.imageUrl||item.imageUrl,
     imageStatus:current.imageUrl||item.imageUrl?'available':'missing',description:current.description||item.description});
  }};
  if(rows.length)add(transform(rows,menuUrl));
  let html='',first:Record<string,unknown>|undefined;
  for(const row of objects){
   const candidate=typeof row.html==='string'?row.html:typeof row.content==='string'&&row.content.trimStart().startsWith('<')?row.content:'';
   if(!candidate||row.blocked===true||row.ok===false)continue;
   const extracted=extractMenu(candidate,menuUrl);
   if(extracted.length){
    add(extracted);
    if(candidate.length>html.length){html=candidate;first=row}
   }
  }
  const items=[...byIdentity.values()];
  if(!items.length){
   const blocked=objects.some(r=>r.blocked===true||r.ok===false||[401,403,429,503].includes(Number(r.statusCode||r.status||0)));
   const lengths=objects.map(r=>typeof r.html==='string'?r.html.length:0);
   const errors=objects.map(r=>clean(r.error||r.message||r.statusText,160)).filter(Boolean).slice(0,2);
   return NextResponse.json({
    error:blocked?'Just Eat blocked or challenged the scraper. No verified menu was returned. Try again later or supply a menu file.':
     'The scraper completed, but returned no recognizable menu data. The restaurant page may use a different layout or require browser rendering.',
    diagnostic:{runId,records:raw.length,htmlLengths:lengths.slice(0,4),structuredRows:rows.length,actorErrors:errors},
    status:'NO_MENU'
   },{status:422});
  }
  const truncated=first?.htmlTruncated===true||Number(first?.htmlChars||0)>html.length;
  const restaurantName=html?strip(piece(html,'data-qa="heading">','</h1>'))||clean(first?.title,120).split(' Delivery')[0]:'';
  return NextResponse.json({status:'SUCCEEDED',source:rows.length?'structured-or-html-menu':'rendered-html-menu',restaurantName,sourceUrl:menuUrl,items,
   imagesFound:items.filter(i=>i.imageUrl).length,imagesMissing:items.filter(i=>!i.imageUrl).length,
   groups:[...new Set(items.map(i=>i.category))],partial:truncated,renderedHtmlChars:html.length,
   totalHtmlChars:Number(first?.htmlChars||html.length),requiresReview:true,publishable:false,
   note:truncated?'Partial HTML import. Verify the full menu against the restaurant.':'Verify all imported dishes, photos, prices and reuse rights before publishing.'});

 }catch{return NextResponse.json({error:'Could not complete the menu import.'},{status:500})}
}