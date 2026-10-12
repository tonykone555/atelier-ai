import {NextResponse} from 'next/server';

export const runtime = 'nodejs';
type Item={id:string;name:string;description:string;category:string;price:number|null;currency:string;variations:{name:string;price:number|null}[];sourceUrl:string};
function validUrl(value:unknown):string|null {
  try{const url=new URL(String(value));const h=url.hostname.toLowerCase();
    if(url.protocol!=='https:'||!(h==='just-eat.co.uk'||h==='www.just-eat.co.uk')||!url.pathname.endsWith('/menu'))return null;
    return url.toString();
  }catch{return null}
}
function number(v:unknown):number|null{const n=Number(v);return Number.isFinite(n)&&n>=0?n:null}
function clean(v:unknown,max=400){return typeof v==='string'?v.trim().slice(0,max):''}
export async function POST(request:Request){
  try{
    const body=await request.json();
    if(body?.confirmRights!==true)return NextResponse.json({error:'Confirm you are authorized to import and reuse this restaurant menu.'},{status:403});
    const menuUrl=validUrl(body?.menuUrl);
    if(!menuUrl)return NextResponse.json({error:'Enter a valid UK Just Eat restaurant /menu URL.'},{status:400});
    const token=process.env.APIFY_TOKEN;
    if(!token)return NextResponse.json({error:'Set APIFY_TOKEN in the server environment.'},{status:503});
    const actor='bakos_bence~justeat-menus';
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),50000);
    let response:Response;
    try{
      response=await fetch('https://api.apify.com/v2/acts/'+actor+'/run-sync-get-dataset-items?clean=true&limit=250',
        {method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},signal:controller.signal,
        body:JSON.stringify({mode:'menuUrl',startUrls:[menuUrl],country:'uk',maxItems:250})});
    }finally{clearTimeout(timeout)}
    if(!response.ok)return NextResponse.json({error:'Apify menu import failed',status:response.status},{status:502});
    const rows=await response.json();
    if(!Array.isArray(rows))return NextResponse.json({error:'Unexpected scraper output'},{status:502});
    const items:Item[]=rows.slice(0,250).map((r:Record<string,unknown>,index:number)=>{
      const variations=Array.isArray(r.variations)?r.variations.slice(0,30).map((v:Record<string,unknown>)=>({name:clean(v.Name??v.name,80),price:number(v.BasePrice??v.price)})):[];
      return {id:clean(r.id,100)||String(index+1),name:clean(r.name,160),description:clean(r.description,800),
        category:clean(r.category,120)||'Menu',price:number(r.price),currency:clean(r.currency,8)||'GBP',variations,sourceUrl:menuUrl};
    }).filter((r:Item)=>r.name);
    return NextResponse.json({source:'Just Eat via Apify',sourceUrl:menuUrl,restaurantName:clean(rows[0]?.restaurantName,150),
      items,groups:[...new Set(items.map(i=>i.category))],requiresReview:true,publishable:false,
      note:'Imported data is a draft only. Verify item details, prices and reuse rights before publication.'});
  }catch(e){return NextResponse.json({error:e instanceof Error&&e.name==='AbortError'?'Import timed out':'Could not import the menu'},{status:500})}
}
