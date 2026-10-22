import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2"

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}})
const esc=(value:string)=>String(value||"").replace(/[&<>"']/g,(ch)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]||ch))
const sha256=async(value:string)=>{
  const bytes=new TextEncoder().encode(value)
  const digest=await crypto.subtle.digest("SHA-256",bytes)
  return Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,"0")).join("")
}
const retryAt=(attempt:number)=>new Date(Date.now()+Math.min(60,2**Math.min(attempt,6))*60000).toISOString()

Deno.serve(async(req)=>{
  if(req.method!=="POST")return json({error:"Method not allowed"},405)

  const url=Deno.env.get("SUPABASE_URL")
  const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if(!url||!service)return json({error:"Supabase service configuration missing"},500)

  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}})
  const token=req.headers.get("x-mgt-dispatch-token")||""
  if(!token)return json({error:"Unauthorized"},401)
  const tokenHash=await sha256(token)
  const {data:authRow,error:authError}=await admin.from("notification_dispatch_auth").select("token_hash").eq("id","email-dispatch").maybeSingle()
  if(authError||!authRow||authRow.token_hash!==tokenHash)return json({error:"Unauthorized"},401)

  const resendKey=Deno.env.get("RESEND_API_KEY")
  const fromEmail=Deno.env.get("MGT_NOTIFICATION_FROM_EMAIL")
  const appUrl=(Deno.env.get("MGT_APP_URL")||"https://mgt-lake.vercel.app").replace(/\/$/,"")
  if(!resendKey||!fromEmail)return json({ok:true,configured:false,processed:0,delivered:0,failed:0,abandoned:0,message:"Email provider credentials are not configured yet."})

  const now=new Date().toISOString()
  const {data:queue,error:queueError}=await admin.from("notification_deliveries")
    .select("id,organization_id,notification_id,user_id,recipient,status,attempt_count,next_attempt_at")
    .eq("channel","email")
    .in("status",["queued","failed"])
    .lte("next_attempt_at",now)
    .order("created_at",{ascending:true})
    .limit(25)
  if(queueError)return json({error:queueError.message},500)

  let delivered=0,failed=0,abandoned=0
  for(const item of queue||[]){
    const attempt=Number(item.attempt_count||0)+1
    const stamp=new Date().toISOString()
    const {data:claimed,error:claimError}=await admin.from("notification_deliveries")
      .update({status:"processing",last_attempt_at:stamp,attempt_count:attempt,updated_at:stamp})
      .eq("id",item.id).in("status",["queued","failed"]).eq("attempt_count",item.attempt_count)
      .select("id,status").maybeSingle()
    if(claimError)return json({error:"Could not claim notification delivery"},500)
    // The database also rejects recipients who lost permission or work scope.
    if(claimed?.status!=="processing")continue

    const [notificationRes,settingsRes,orgRes]=await Promise.all([
      admin.from("notifications").select("id,title,body,href,action_label,severity,category,resolved_at,expires_at").eq("id",item.notification_id).maybeSingle(),
      admin.from("notification_delivery_settings").select("email_enabled,sender_name,reply_to_email").eq("organization_id",item.organization_id).maybeSingle(),
      admin.from("organizations").select("name,legal_name").eq("id",item.organization_id).maybeSingle(),
    ])

    const notification=notificationRes.data
    const settings=settingsRes.data
    const org=orgRes.data
    if(!notification||notification.resolved_at||(notification.expires_at&&new Date(notification.expires_at)<=new Date())||!settings?.email_enabled){
      await admin.from("notification_deliveries").update({status:"skipped",error_message:"Notification is no longer eligible for email delivery.",updated_at:new Date().toISOString()}).eq("id",item.id)
      continue
    }

    const senderName=(settings.sender_name||org?.legal_name||org?.name||"MGT Business Suite").trim()
    const actionUrl=notification.href?appUrl+(notification.href.startsWith("/")?notification.href:"/"+notification.href):appUrl+"/notifications"
    const subject=notification.title
    const text=[notification.title,notification.body||"",notification.action_label?notification.action_label+": "+actionUrl:actionUrl].filter(Boolean).join("\n\n")
    const html=`<!doctype html><html><body style="margin:0;background:#f5f6f7;font-family:Arial,sans-serif;color:#17211b"><div style="max-width:640px;margin:0 auto;padding:32px 18px"><div style="background:#fff;border:1px solid #e5e7eb;border-radius:18px;padding:28px"><div style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#6b7280">${esc(org?.name||"MGT Business Suite")} · ${esc(notification.category)}</div><h1 style="font-size:24px;line-height:1.25;margin:12px 0">${esc(notification.title)}</h1>${notification.body?`<p style="font-size:15px;line-height:1.7;color:#4b5563">${esc(notification.body)}</p>`:""}<a href="${esc(actionUrl)}" style="display:inline-block;margin-top:18px;background:#17211b;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700">${esc(notification.action_label||"Open MGT")}</a><p style="margin-top:24px;font-size:12px;line-height:1.6;color:#9ca3af">This message was generated from your MGT Business Suite notification settings. You can change email notification preferences inside MGT Settings.</p></div></div></body></html>`

    try{
      const response=await fetch("https://api.resend.com/emails",{
        method:"POST",
        headers:{"authorization":"Bearer "+resendKey,"content-type":"application/json"},
        body:JSON.stringify({
          from:`${senderName} <${fromEmail}>`,
          to:[item.recipient],
          subject,
          html,
          text,
          ...(settings.reply_to_email?{reply_to:settings.reply_to_email}:{}),
        }),
      })
      const responseText=(await response.text()).slice(0,1000)
      let providerId:string|null=null
      try{providerId=JSON.parse(responseText)?.id||null}catch{}
      if(response.ok){
        delivered++
        await admin.from("notification_deliveries").update({
          status:"delivered",provider:"resend",provider_message_id:providerId,response_code:response.status,
          response_excerpt:responseText,error_message:null,delivered_at:new Date().toISOString(),updated_at:new Date().toISOString()
        }).eq("id",item.id)
      }else{
        const terminal=attempt>=8||(response.status>=400&&response.status<500&&response.status!==429)
        if(terminal)abandoned++;else failed++
        await admin.from("notification_deliveries").update({
          status:terminal?"abandoned":"failed",provider:"resend",response_code:response.status,response_excerpt:responseText,
          error_message:`Resend HTTP ${response.status}`,next_attempt_at:terminal?null:retryAt(attempt),updated_at:new Date().toISOString()
        }).eq("id",item.id)
      }
    }catch(error){
      const terminal=attempt>=8
      if(terminal)abandoned++;else failed++
      await admin.from("notification_deliveries").update({
        status:terminal?"abandoned":"failed",provider:"resend",error_message:String(error?.message||"Email delivery failed").slice(0,500),
        next_attempt_at:terminal?null:retryAt(attempt),updated_at:new Date().toISOString()
      }).eq("id",item.id)
    }
  }

  return json({ok:true,configured:true,processed:(queue||[]).length,delivered,failed,abandoned})
})
