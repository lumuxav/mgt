import { supabase } from './supabase'

export const DEFAULT_NOTIFICATION_CATEGORIES = {
  approvals: true,
  finance: true,
  inventory: true,
  operations: true,
  hr: true,
  projects: true,
  fleet: true,
  documents: true,
  system: true,
}

export const NOTIFICATION_CATEGORY_LABELS = {
  approvals: 'Approvals',
  finance: 'Finance & credit',
  inventory: 'Inventory',
  operations: 'Operations & service',
  hr: 'HR & payroll',
  projects: 'Projects',
  fleet: 'Fleet & delivery',
  documents: 'Documents',
  system: 'System',
}

export function notificationState(row){
  return Array.isArray(row?.notification_states) ? row.notification_states[0] || null : null
}

export function notificationCategoryEnabled(preferences,category){
  const categories={...DEFAULT_NOTIFICATION_CATEGORIES,...(preferences?.categories||{})}
  return categories[category]!==false
}

export async function syncNotificationSystem(){
  const {error}=await supabase.rpc('sync_my_notifications')
  if(error)throw error
}

export async function loadNotificationPreferences(userId,organizationId){
  if(!userId||!organizationId)return {browser_enabled:false,email_enabled:false,categories:{...DEFAULT_NOTIFICATION_CATEGORIES}}
  const {data,error}=await supabase.from('notification_preferences')
    .select('browser_enabled,email_enabled,categories')
    .eq('organization_id',organizationId)
    .eq('user_id',userId)
    .maybeSingle()
  if(error)throw error
  return {
    browser_enabled:Boolean(data?.browser_enabled),
    email_enabled:Boolean(data?.email_enabled),
    categories:{...DEFAULT_NOTIFICATION_CATEGORIES,...(data?.categories||{})},
  }
}

export async function loadNotificationInbox({userId,organizationId}={}){
  const now=new Date().toISOString()
  const [all,preferences]=await Promise.all([
    (async()=>{
      const rows=[]
      const pageSize=1000
      const activeNotifications=()=>supabase.from('notifications')
        .select('id,organization_id,recipient_user_id,audience_permission,dedupe_key,category,severity,title,body,href,action_label,entity_type,entity_id,source,metadata,created_at,updated_at,resolved_at,expires_at,notification_states(read_at,dismissed_at)')
        .is('resolved_at',null)
        .or(`expires_at.is.null,expires_at.gt.${now}`)
      for(let offset=0;offset<100000;offset+=pageSize){
        const {data,error}=await activeNotifications()
          .order('created_at',{ascending:false})
          .order('id',{ascending:false})
          .range(offset,offset+pageSize-1)
        if(error)throw error
        rows.push(...(data||[]))
        if((data||[]).length<pageSize)return rows
      }
      const {data,error}=await activeNotifications().range(100000,100000)
      if(error)throw error
      if(data?.length)throw new Error('Notification inbox exceeds the 100,000 row safety limit.')
      return rows
    })(),
    loadNotificationPreferences(userId,organizationId),
  ])
  const mapped=all.map((row)=>({...row,state:notificationState(row)}))
  const items=mapped.filter((row)=>!row.state?.dismissed_at&&notificationCategoryEnabled(preferences,row.category))
  return {
    items,
    all:mapped,
    preferences,
    unread:items.filter((row)=>!row.state?.read_at).length,
  }
}

export async function markNotificationRead(notificationId,read=true){
  const {error}=await supabase.rpc('mark_notification_read',{p_notification_id:notificationId,p_read:read})
  if(error)throw error
}

export async function dismissNotification(notificationId){
  const {error}=await supabase.rpc('dismiss_notification',{p_notification_id:notificationId})
  if(error)throw error
}

export async function markAllNotificationsRead(){
  const {data,error}=await supabase.rpc('mark_all_notifications_read')
  if(error)throw error
  return Number(data||0)
}

export async function saveNotificationPreferences({browserEnabled,emailEnabled,categories}){
  const {error}=await supabase.rpc('save_notification_preferences',{
    p_browser_enabled:Boolean(browserEnabled),
    p_categories:{...DEFAULT_NOTIFICATION_CATEGORIES,...(categories||{})},
    p_email_enabled:Boolean(emailEnabled),
  })
  if(error)throw error
}
