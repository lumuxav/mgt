import { NextResponse } from 'next/server'
import { verifyOrganizationPermission } from '../../../../lib/serverAccess'

export async function PATCH(req){
  const check=await verifyOrganizationPermission(req,'roles.manage')
  if(check.error)return NextResponse.json({error:check.error},{status:check.status})
  try{
    const body=await req.json()
    if(typeof body.user_id!=='string'||!Array.isArray(body.additional_roles)
      ||body.additional_roles.some(role=>typeof role!=='string')
      ||typeof body.scope!=='string'){
      return NextResponse.json({error:'Invalid work-access configuration.'},{status:400})
    }
    if(body.additional_roles.length>10)return NextResponse.json({error:'Too many additional roles.'},{status:400})
    const {error}=await check.adminClient.rpc('server_set_staff_work_access',{
      p_organization_id:check.organizationId,
      p_actor_id:check.caller.id,
      p_user_id:body.user_id,
      p_roles:body.additional_roles,
      p_scope:body.scope,
      p_location_id:body.scope==='location'?(body.location_id||null):null,
    })
    if(error) return NextResponse.json({error:error.message},{status:400})
    return NextResponse.json({ok:true})
  }catch(e){return NextResponse.json({error:e?.message||'Could not update staff access.'},{status:500})}
}
