
const TIKTOK_AUTH = "https://www.tiktok.com/v2/auth/authorize/";
const TIKTOK_TOKEN = "https://open.tiktokapis.com/v2/oauth/token/";
const TIKTOK_USER = "https://open.tiktokapis.com/v2/user/info/";
const TIKTOK_VIDEO = "https://open.tiktokapis.com/v2/video/list/";
const SCOPES = "user.info.basic,user.info.profile,user.info.stats,video.list";
const HEADER = { "content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff" };
function json(obj,status=200){return new Response(JSON.stringify(obj),{status,headers:HEADER});}
function redirect(url){return new Response(null,{status:302,headers:{"location":url,"cache-control":"no-store"}});}
function secureCookie(name,value,maxAge){return name+"="+value+"; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age="+maxAge;}
function b64(bytes){return btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");}
function nonce(){const a=new Uint8Array(32);crypto.getRandomValues(a);return b64(a);}
function equal(a,b){if(typeof a!=="string"||typeof b!=="string")return false;let diff=a.length^b.length;const len=Math.max(a.length,b.length);for(let i=0;i<len;i++)diff|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return diff===0;}
async function signature(secret,message){const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return b64(new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(message))));}
function getCookie(req,name){const match=(req.headers.get("cookie")||"").split("; ").find(x=>x.startsWith(name+"="));return match?match.slice(name.length+1):"";}
async function isOwner(req,env){if(!env.DASHBOARD_PASSWORD||env.DASHBOARD_PASSWORD.length<12)return false;const parts=getCookie(req,"iky_owner").split(".");if(parts.length!==3)return false;const [expiry,randomPart,mac]=parts;if(!expiry||!randomPart||!mac||!Number.isFinite(Number(expiry))||Number(expiry)<Date.now())return false;return equal(mac,await signature(env.DASHBOARD_PASSWORD,expiry+"."+randomPart));}
function originAllowed(req){const o=req.headers.get("origin");return !o||o===new URL(req.url).origin;}
function store(env){return env.TIKTOK_STORE.get(env.TIKTOK_STORE.idFromName("personal-iky"));}
function proxy(env,path,init){return store(env).fetch("https://internal"+path,init);}
function errURL(req,message){const base=new URL("/",req.url);base.searchParams.set("tiktok_status",message);return base.toString();}
async function readBody(req){try{return await req.json();}catch{return {};}}
async function tokengrant(env,details){
  const form=new URLSearchParams({client_key:(env.TIKTOK_CLIENT_KEY||"").trim(),client_secret:(env.TIKTOK_CLIENT_SECRET||"").trim(),...details});
  const r=await fetch(TIKTOK_TOKEN,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded","cache-control":"no-store"},body:form});
  let j;
  try{j=await r.json();}catch{j={error:"invalid_response"};}
  if(!r.ok||!j?.access_token){
    const allowed=new Set(["invalid_client","invalid_grant","invalid_request","invalid_scope","unauthorized_client","unsupported_grant_type","server_error","temporarily_unavailable"]);
    const code=allowed.has(j?.error)?j.error:"unknown_error";
    const logId=typeof j?.log_id==="string"?j.log_id.replace(/[^A-Za-z0-9_-]/g,"").slice(0,100):"";
    // Do not log secrets, access tokens, authorization codes, or arbitrary error descriptions.
    console.error("TikTok token exchange error",code,"HTTP",r.status,"log_id",logId);
    const err=new Error("TikTok token exchange failed");
    err.oauthCategory=code;
    err.oauthLogId=logId;
    throw err;
  }
  return j;
}
async function getUser(token){const fields="open_id,display_name,avatar_url,username,follower_count,following_count,likes_count,video_count";const r=await fetch(TIKTOK_USER+"?fields="+fields,{headers:{authorization:"Bearer "+token,"cache-control":"no-store"}});const j=await r.json();if(!r.ok||j.error?.code!=="ok"||!j.data?.user)throw Error("TikTok user info: "+(j.error?.code||r.status));return j.data.user;}
async function recentVideos(token){const fields="id,title,create_time,cover_image_url,share_url,view_count,like_count,comment_count,share_count";const r=await fetch(TIKTOK_VIDEO+"?fields="+fields,{method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+token},body:JSON.stringify({max_count:20})});const j=await r.json();if(!r.ok||j.error?.code!=="ok")throw Error("TikTok video list: "+(j.error?.code||r.status));return (j.data?.videos||[]).map(v=>({id:v.id,title:v.title||"",view_count:v.view_count??null,like_count:v.like_count??null,comment_count:v.comment_count??null,share_count:v.share_count??null,create_time:v.create_time??null,share_url:v.share_url||""}));}

const WORKSPACE_FIELDS={
 ideas:["id","title","hook","pillar","platform","stage","notes","date","updated_at"],
 assets:["id","title","url","kind","updated_at"],
 brands:["id","name","contact","value","deadline","status","deliverables","notes","updated_at"]
};
function blankWorkspace(){return {profile:{handle:"@ikyhdyat",updated_at:0},ideas:[],assets:[],brands:[],deleted:{ideas:{},assets:{},brands:{}}};}
function normalizedWorkspace(input){
 const src=input&&typeof input==="object"&&!Array.isArray(input)?input:{},out=blankWorkspace();
 if(src.profile&&typeof src.profile==="object"&&!Array.isArray(src.profile)){
   const keys=["handle","followers","views","likes","videos","updated_at"];
   for(const k of keys){const v=src.profile[k];if((typeof v==="string"||typeof v==="number")&&String(v).length<250)out.profile[k]=v;}
 }
 for(const group of ["ideas","assets","brands"]){
   const entries=Array.isArray(src[group])?src[group].slice(0,3000):[];
   const seen=new Set();
   for(const ent of entries){
     if(!ent||typeof ent!=="object"||typeof ent.id!=="string"||!ent.id||ent.id.length>96||seen.has(ent.id))continue;
     seen.add(ent.id);
     const row={id:ent.id};
     for(const field of WORKSPACE_FIELDS[group]){
       if(field==="id")continue;
       const val=ent[field];
       if(field==="updated_at"){row.updated_at=Number.isFinite(Number(val))?Math.max(0,Number(val)):0;continue;}
       if(typeof val==="string")row[field]=val.slice(0,field==="notes"||field==="deliverables"?12000:1000);
       if(typeof val==="number"&&Number.isFinite(val))row[field]=val;
     }
     out[group].push(row);
   }
   if(src.deleted&&typeof src.deleted[group]==="object"&&src.deleted[group]){
     for(const [id,at] of Object.entries(src.deleted[group]).slice(0,5000)){
       if(id.length<=96&&Number.isFinite(Number(at)))out.deleted[group][id]=Math.max(0,Number(at));
     }
   }
 }
 return out;
}
function mergeWorkspace(base,incoming){
 const a=normalizedWorkspace(base),b=normalizedWorkspace(incoming),merged=blankWorkspace();
 merged.profile=(Number(b.profile.updated_at)||0)>=(Number(a.profile.updated_at)||0)?b.profile:a.profile;
 for(const group of ["ideas","assets","brands"]){
   const deletions={...a.deleted[group]};
   for(const [id,at] of Object.entries(b.deleted[group]))deletions[id]=Math.max(Number(deletions[id])||0,Number(at)||0);
   const rows=new Map();
   for(const row of a[group])rows.set(row.id,row);
   for(const row of b[group]){
     const prev=rows.get(row.id);
     if(!prev||(Number(row.updated_at)||0)>(Number(prev.updated_at)||0))rows.set(row.id,row);
   }
   merged[group]=[...rows.values()].filter(r=>(Number(r.updated_at)||0)>(Number(deletions[r.id])||0)).slice(0,3000);
   merged.deleted[group]=deletions;
 }
 return merged;
}

export class TikTokStore {
  constructor(ctx,env){this.ctx=ctx;this.env=env;this.syncing=null;}
  async fetch(req){
    const url=new URL(req.url),path=url.pathname,s=this.ctx.storage;
    try{
      if(path==="/internal/create-state"&&req.method==="POST"){const state=nonce();await s.put("oauth-state",{state,created:Date.now()});return json({state});}
      if(path==="/internal/consume-state"&&req.method==="POST"){const body=await readBody(req);const current=await s.get("oauth-state");await s.delete("oauth-state");return json({ok:!!(current&&current.created>Date.now()-10*60*1000&&equal(current.state,body.state))});}
      if(path==="/internal/link"&&req.method==="POST"){
        const body=await readBody(req);if(!body.access_token||!body.refresh_token||!body.open_id)return json({error:"missing_token"},400);
        const expected=(this.env.TIKTOK_EXPECTED_USERNAME||"ikyhdyat").replace(/^@/,"").toLowerCase();
        const user=await getUser(body.access_token);
        if(!user.username||user.username.replace(/^@/,"").toLowerCase()!==expected)return json({error:"wrong_account",message:"Akun TikTok yang diotorisasi tidak cocok dengan @"+expected},400);
        const existing=await s.get("account");
        if(existing&&existing.open_id!==body.open_id)return json({error:"different_account"},409);
        await s.put("account",{access_token:body.access_token,refresh_token:body.refresh_token,open_id:body.open_id,scope:body.scope||"",expires_at:Date.now()+(body.expires_in||7200)*1000,refresh_expires_at:Date.now()+(body.refresh_expires_in||15552000)*1000});
        try{await this.performSync();}catch(e){await s.put("last-error",{message:String(e.message||e).slice(0,130),at:new Date().toISOString()});}
        return json({ok:true});
      }
      if(path==="/internal/sync"&&req.method==="POST"){
        if(this.syncing)return await this.syncing;
        this.syncing=this.performSync().then(res=>json(res)).catch(async e=>{await s.put("last-error",{message:String(e.message||e).slice(0,140),at:new Date().toISOString()});return json({ok:false,error:String(e.message||e).slice(0,140)},502);}).finally(()=>{this.syncing=null;});
        return await this.syncing;
      }
      if(path==="/internal/credentials-check"&&req.method==="GET"){
        const prior=await s.get("credentials-check");
        if(prior&&Date.now()-prior.checked_ms<20*60*1000)return json(prior.safe);
        if(!this.env.TIKTOK_CLIENT_KEY||!this.env.TIKTOK_CLIENT_SECRET)return json({result:"not_configured"});
        // Client credentials can be unsupported for Login Kit; this probe is diagnostic only.
        const form=new URLSearchParams({client_key:this.env.TIKTOK_CLIENT_KEY.trim(),client_secret:this.env.TIKTOK_CLIENT_SECRET.trim(),grant_type:"client_credentials"});
        let safe={result:"inconclusive"};
        try{
          const response=await fetch(TIKTOK_TOKEN,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:form});
          const obj=await response.json();
          if(response.ok&&obj?.access_token)safe={result:"credentials_accepted"};
          else if(obj?.error==="invalid_client")safe={result:"invalid_client"};
          else if(obj?.error==="unauthorized_client")safe={result:"credentials_recognized_grant_unavailable"};
          else safe={result:"inconclusive",error:["invalid_request","temporarily_unavailable","server_error"].includes(obj?.error)?obj.error:"unknown"};
        }catch(e){safe={result:"inconclusive",error:"network_error"};}
        await s.put("credentials-check",{checked_ms:Date.now(),safe});
        return json(safe);
      }
      if(path==="/internal/last-oauth-error"&&req.method==="GET"){
        return json(await s.get("last-oauth-error")||{result:"no_recorded_failure"});
      }
      if(path==="/internal/record-oauth-error"&&req.method==="POST"){
        const body=await readBody(req);
        const allowed=["invalid_client","invalid_grant","invalid_request","invalid_scope","unauthorized_client","unsupported_grant_type","server_error","temporarily_unavailable","unknown_error","internal_error"];
        const category=allowed.includes(body.category)?body.category:"internal_error";
        await s.put("last-oauth-error",{category,at:new Date().toISOString()});
        return json({ok:true});
      }
      if(path==="/internal/sync-diagnostics"&&req.method==="GET"){
        const acct=await s.get("account"),latest=await s.get("latest"),lastError=await s.get("last-error");
        const scopes=new Set((acct?.scope||"").split(",").map(x=>x.trim()).filter(Boolean));
        const videoCode=String(latest?.video_error||"").match(/^TikTok video list: ([a-z0-9_]+)/i);
        return json({
          connected:!!acct,
          stats_scope_granted:scopes.has("user.info.stats"),
          video_scope_granted:scopes.has("video.list"),
          snapshot_available:!!latest,
          all_metrics_zero:!!latest&&latest.followers===0&&latest.likes===0&&latest.video_count===0,
          video_api_status:latest?.video_error?(videoCode?videoCode[1]:"failed"):latest?(latest.recent_video_count===0?"no_videos":"ok"):"not_checked",
          sync_error_present:!!lastError
        });
      }
      if(path==="/internal/workspace"&&req.method==="GET"){
        const stored=await s.get("workspace");
        return json({ok:true,workspace:normalizedWorkspace(stored),saved_at:await s.get("workspace-saved-at")||null});
      }
      if(path==="/internal/workspace"&&req.method==="PUT"){
        const len=Number(req.headers.get("content-length")||0);
        if(len>900000)return json({error:"workspace_too_large"},413);
        const raw=await req.text();
        if(raw.length>900000)return json({error:"workspace_too_large"},413);
        let parsed;
        try{parsed=JSON.parse(raw);}catch{return json({error:"invalid_json"},400);}
        const merged=mergeWorkspace(await s.get("workspace"),parsed?.workspace);
        const serialized=JSON.stringify(merged);
        if(serialized.length>900000)return json({error:"workspace_too_large"},413);
        const savedAt=new Date().toISOString();
        await s.put("workspace",merged);
        await s.put("workspace-saved-at",savedAt);
        return json({ok:true,workspace:merged,saved_at:savedAt});
      }
      if(path==="/internal/status"){
        const acct=await s.get("account"),latest=await s.get("latest"),history=await s.get("history")||[],lastError=await s.get("last-error");
        return json({connected:!!acct,scope:acct?.scope||"",latest:latest||null,history,lastError:lastError||null,account:"@"+(this.env.TIKTOK_EXPECTED_USERNAME||"ikyhdyat").replace(/^@/,"")});
      }
      if(path==="/internal/disconnect"&&req.method==="POST"){await s.delete("account");await s.delete("latest");await s.delete("history");await s.delete("last-error");return json({ok:true});}
      return json({error:"not_found"},404);
    }catch(e){return json({error:String(e.message||e).slice(0,150)},500);}
  }
  async performSync(){
    const s=this.ctx.storage;let account=await s.get("account");if(!account)throw Error("TikTok belum dihubungkan melalui OAuth");
    if(Date.now()>account.expires_at-20*60*1000){
      if(Date.now()>account.refresh_expires_at)throw Error("Refresh token kedaluwarsa; otorisasi ulang diperlukan");
      const fresh=await tokengrant(this.env,{grant_type:"refresh_token",refresh_token:account.refresh_token});
      account={...account,access_token:fresh.access_token,refresh_token:fresh.refresh_token||account.refresh_token,expires_at:Date.now()+(fresh.expires_in||7200)*1000,refresh_expires_at:Date.now()+(fresh.refresh_expires_in||15552000)*1000,scope:fresh.scope||account.scope};
      await s.put("account",account);
    }
    const user=await getUser(account.access_token);
    const expected=(this.env.TIKTOK_EXPECTED_USERNAME||"ikyhdyat").replace(/^@/,"").toLowerCase();
    if(!user.username||user.username.toLowerCase()!==expected)throw Error("Username TikTok tidak cocok");
    let videos=[],videoError=null;
    try{videos=await recentVideos(account.access_token);}catch(e){videoError=String(e.message||e).slice(0,110);}
    const snapshot={synced_at:new Date().toISOString(),username:user.username,display_name:user.display_name||"",avatar_url:user.avatar_url||"",followers:user.follower_count??null,following:user.following_count??null,likes:user.likes_count??null,video_count:user.video_count??null,recent_views:videos.reduce((sum,v)=>sum+(Number(v.view_count)||0),0),recent_video_count:videos.length,videos,video_error:videoError,source:"tiktok_official_api"};
    if(snapshot.followers===null)throw Error("TikTok tidak memberi akses user.info.stats; periksa persetujuan scope");
    await s.put("latest",snapshot);
    const hist=await s.get("history")||[];
    hist.push({at:snapshot.synced_at,followers:snapshot.followers,likes:snapshot.likes,video_count:snapshot.video_count,recent_views:videos.length?snapshot.recent_views:null});
    const cutoff=Date.now()-180*24*3600*1000;await s.put("history",hist.filter(x=>new Date(x.at).getTime()>cutoff).slice(-740));
    await s.delete("last-error");
    return {ok:true,synced_at:snapshot.synced_at};
  }
}
export default {
  async fetch(req,env){
    const url=new URL(req.url),path=url.pathname;
    if(!path.startsWith("/api/"))return env.ASSETS.fetch(req);
    if(req.method==="OPTIONS")return new Response(null,{status:405});
    if(path==="/api/tiktok/callback"&&req.method==="GET"){
      const state=url.searchParams.get("state"),code=url.searchParams.get("code");
      if(!state||!equal(state,getCookie(req,"iky_oauth")))return redirect(errURL(req,"invalid_oauth_session"));
      const v=await proxy(env,"/internal/consume-state",{method:"POST",body:JSON.stringify({state})});
      const ver=await v.json();if(!ver.ok)return redirect(errURL(req,"state_expired"));
      if(url.searchParams.get("error"))return redirect(errURL(req,"authorization_denied"));
      if(!code)return redirect(errURL(req,"no_code"));
      if(!env.TIKTOK_CLIENT_KEY||!env.TIKTOK_CLIENT_SECRET)return redirect(errURL(req,"missing_tiktok_keys"));
      try{
        const callback=(env.TIKTOK_REDIRECT_URI||new URL("/api/tiktok/callback",url.origin).href);
        const token=await tokengrant(env,{grant_type:"authorization_code",code,redirect_uri:callback});
        const v=await proxy(env,"/internal/link",{method:"POST",body:JSON.stringify(token)});
        const result=await v.json();
        if(!v.ok||!result.ok)return redirect(errURL(req,result.error||"link_failed"));
        // Only an authorized TikTok account with the exact expected username can reach this point.
        const expiry=String(Date.now()+7*24*60*60*1000),sessionNonce=nonce();
        const mac=await signature(env.DASHBOARD_PASSWORD,expiry+"."+sessionNonce);
        const res=redirect(errURL(req,"connected"));
        res.headers.append("set-cookie",secureCookie("iky_owner",expiry+"."+sessionNonce+"."+mac,7*24*60*60));
        res.headers.append("set-cookie",secureCookie("iky_oauth","",0));
        res.headers.append("set-cookie",secureCookie("iky_retry","",0));
        return res;
      }catch(e){
        console.error("TikTok OAuth callback failed",e?.oauthCategory||"internal_error",e?.oauthLogId||"");
        try{await proxy(env,"/internal/record-oauth-error",{method:"POST",body:JSON.stringify({category:e?.oauthCategory||"internal_error"})});}catch(_){}
        // Authorization codes are one-use and may expire. Retry only once with a fresh code.
        if(e?.oauthCategory==="invalid_grant"&&getCookie(req,"iky_retry")!=="1"){
          try{
            const retryStateResponse=await proxy(env,"/internal/create-state",{method:"POST"});
            const retryState=await retryStateResponse.json();
            if(retryState.state){
              const redirectUri=env.TIKTOK_REDIRECT_URI||new URL("/api/tiktok/callback",url.origin).href;
              const authorization=new URL(TIKTOK_AUTH);
              for(const [k,v] of Object.entries({client_key:env.TIKTOK_CLIENT_KEY.trim(),scope:SCOPES,response_type:"code",redirect_uri:redirectUri,state:retryState.state}))authorization.searchParams.set(k,v);
              const retry=redirect(authorization.href);
              retry.headers.append("set-cookie",secureCookie("iky_oauth",retryState.state,600));
              retry.headers.append("set-cookie",secureCookie("iky_retry","1",600));
              return retry;
            }
          }catch(retryError){console.error("TikTok fresh authorization attempt failed");}
        }
        const target=new URL(errURL(req,"token_exchange_failed"));
        if(e?.oauthCategory)target.searchParams.set("oauth_error",e.oauthCategory);
        if(e?.oauthLogId)target.searchParams.set("oauth_log_id",e.oauthLogId);
        return redirect(target.href);
      }
    }
    if(!originAllowed(req))return json({error:"invalid_origin"},403);
    if(path==="/api/tiktok/config"&&req.method==="GET"){
      return json({oauth_diagnostics:"workspace-cloud-v8",mode:env.TIKTOK_MODE==="production"?"production":"sandbox",app_configured:!!(env.TIKTOK_CLIENT_KEY&&env.TIKTOK_CLIENT_SECRET),session_configured:!!(env.DASHBOARD_PASSWORD&&env.DASHBOARD_PASSWORD.length>=12),redirect_uri:env.TIKTOK_REDIRECT_URI||new URL("/api/tiktok/callback",url.origin).href,expected_account:"@"+(env.TIKTOK_EXPECTED_USERNAME||"ikyhdyat").replace(/^@/,"")});
    }
    if(path==="/api/tiktok/health"&&req.method==="GET"){
      const [a,b,c]=await Promise.all([
        proxy(env,"/internal/credentials-check"),
        proxy(env,"/internal/last-oauth-error"),
        proxy(env,"/internal/sync-diagnostics")
      ]);
      const credentials=await a.json();
      const last_oauth_error=await b.json();
      const sync_diagnostics=await c.json();
      return json({credentials,last_oauth_error,sync_diagnostics,mode:env.TIKTOK_MODE==="production"?"production":"sandbox"});
    }
    // TikTok OAuth itself authenticates the owner. No separate password prompt.
    if(path==="/api/tiktok/connect"&&req.method==="POST"){
      if(!env.TIKTOK_CLIENT_KEY||!env.TIKTOK_CLIENT_SECRET)return json({error:"tiktok_app_not_configured"},503);
      if(!env.DASHBOARD_PASSWORD||env.DASHBOARD_PASSWORD.length<12)return json({error:"session_secret_not_configured"},503);
      const r=await proxy(env,"/internal/create-state",{method:"POST"});const j=await r.json();
      if(!j.state)return json({error:"state_failed"},502);
      const callback=env.TIKTOK_REDIRECT_URI||new URL("/api/tiktok/callback",url.origin).href;
      const target=new URL(TIKTOK_AUTH);
      for(const [k,v] of Object.entries({client_key:env.TIKTOK_CLIENT_KEY.trim(),scope:SCOPES,response_type:"code",redirect_uri:callback,state:j.state}))target.searchParams.set(k,v);
      const response=json({authorize_url:target.href});
      response.headers.append("set-cookie",secureCookie("iky_oauth",j.state,600));
      response.headers.append("set-cookie",secureCookie("iky_retry","",0));
      return response;
    }
    // Read-only TikTok profile snapshots are shared across the owner's devices.
    // Never expose the account's access/refresh tokens, raw video list or internal errors.
    if(path==="/api/tiktok/status"&&req.method==="GET"){
      const r=await proxy(env,"/internal/status");
      if(!r.ok)return json({error:"status_unavailable"},502);
      const data=await r.json();
      const owner=await isOwner(req,env);
      if(owner)return json({...data,owner_session:true,read_only:false});
      const raw=data.latest;
      const publicLatest=raw?{
        synced_at:raw.synced_at||null,
        username:raw.username||"",
        display_name:raw.display_name||"",
        avatar_url:raw.avatar_url||"",
        followers:raw.followers??null,
        likes:raw.likes??null,
        video_count:raw.video_count??null,
        recent_views:raw.recent_views??null,
        recent_video_count:raw.recent_video_count??0
      }:null;
      const history=Array.isArray(data.history)?data.history.slice(-180).map(h=>({
        at:h.at,followers:h.followers??null,likes:h.likes??null,
        video_count:h.video_count??null,recent_views:h.recent_views??null
      })):[];
      return json({
        connected:!!data.connected,
        owner_session:false,
        read_only:true,
        account:data.account||"",
        scope:"",
        latest:publicLatest,
        history
      });
    }
    if(path==="/api/workspace"&&["GET","PUT"].includes(req.method)){
      if(!await isOwner(req,env))return json({error:"owner_authorization_required"},401);
      const r=await proxy(env,"/internal/workspace",{
        method:req.method,
        headers:{"content-type":"application/json"},
        ...(req.method==="PUT"?{body:await req.text()}:{})
      });
      return new Response(r.body,{status:r.status,headers:HEADER});
    }
    if(!await isOwner(req,env))return json({error:"owner_authorization_required"},401);
    if(path==="/api/tiktok/sync"&&req.method==="POST"){const r=await proxy(env,"/internal/sync",{method:"POST"});return new Response(r.body,{status:r.status,headers:HEADER});}
    if(path==="/api/tiktok/disconnect"&&req.method==="POST"){const r=await proxy(env,"/internal/disconnect",{method:"POST"});return new Response(r.body,{status:r.status,headers:HEADER});}
    return json({error:"not_found"},404);
  },
  async scheduled(event,env,ctx){
    if(!env.TIKTOK_CLIENT_KEY||!env.TIKTOK_CLIENT_SECRET)return;
    ctx.waitUntil(proxy(env,"/internal/sync",{method:"POST"}).catch(e=>console.error("scheduled_sync_failed",String(e))));
  }
};