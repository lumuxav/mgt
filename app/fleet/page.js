'use client'

import { useEffect,useMemo,useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { getPlatformContext } from '../../lib/platformDb'
import { getBusinessConfig } from '../../lib/platformConfig'

const money=(value,currency)=>`${Number(value||0).toLocaleString()} ${currency||''}`.trim()

export default function FleetPage(){
  const business=getBusinessConfig()
  const [context,setContext]=useState(null)
  const [permissions,setPermissions]=useState([])
  const [vehicles,setVehicles]=useState([])
  const [fuelLogs,setFuelLogs]=useState([])
  const [deliveries,setDeliveries]=useState([])
  const [users,setUsers]=useState([])
  const [locations,setLocations]=useState([])
  const [customers,setCustomers]=useState([])
  const [sales,setSales]=useState([])
  const [jobs,setJobs]=useState([])
  const [bankAccounts,setBankAccounts]=useState([])
  const [tab,setTab]=useState('fleet')
  const [message,setMessage]=useState(null)
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)
  const [selectedDelivery,setSelectedDelivery]=useState(null)

  const [vehicleForm,setVehicleForm]=useState({location_id:'',registration_number:'',make:'',model:'',model_year:'',vin:'',fuel_type:'petrol',odometer:'',service_due_odometer:'',capacity:'',driver_user_id:'',insurance_expiry:'',license_expiry:'',purchase_date:'',purchase_cost:'',notes:''})
  const [fuelForm,setFuelForm]=useState({vehicle_id:'',odometer:'',quantity:'',unit_cost:'',supplier:'',reference:'',notes:'',payment_method:'',bank_account_id:''})
  const [deliveryForm,setDeliveryForm]=useState({source_location_id:'',destination:'',customer_id:'',sale_id:'',work_order_id:'',vehicle_id:'',driver_user_id:'',contact_name:'',contact_phone:'',package_description:'',scheduled_at:'',notes:''})
  const [deliveryUpdate,setDeliveryUpdate]=useState({recipient_name:'',notes:'',failure_reason:''})

  const currency=context?.organization?.currency||business.currency||'UGX'
  const canFleetManage=permissions.includes('fleet.manage')
  const canDispatch=permissions.includes('fleet.dispatch')

  const load=async()=>{
    setLoading(true)
    try{
      const ctx=await getPlatformContext()
      setContext(ctx)
      if(!ctx.organization?.id)throw new Error('Complete business setup first.')
      const org=ctx.organization.id
      const [permRes,vehicleRes,fuelRes,deliveryRes,userRes,locRes,customerRes,saleRes,jobRes,bankRes]=await Promise.all([
        supabase.rpc('current_permissions'),
        supabase.from('vehicles').select('*').eq('organization_id',org).order('created_at',{ascending:false}).limit(1000),
        supabase.from('fuel_logs').select('*').eq('organization_id',org).order('log_date',{ascending:false}).limit(2500),
        supabase.from('deliveries').select('*').eq('organization_id',org).order('created_at',{ascending:false}).limit(2500),
        supabase.from('users').select('id,full_name,role,default_location_id').eq('organization_id',org).eq('active',true).order('full_name'),
        supabase.from('locations').select('id,name,type').eq('organization_id',org).eq('active',true).order('name'),
        supabase.from('customers').select('id,name,phone,address').eq('organization_id',org).eq('active',true).order('name'),
        supabase.from('sales').select('id,sale_number,customer_id,total_amount,created_at').eq('organization_id',org).order('created_at',{ascending:false}).limit(300),
        supabase.from('work_orders').select('id,job_number,title,customer_id,final_amount,created_at').eq('organization_id',org).order('created_at',{ascending:false}).limit(300),
        supabase.from('bank_accounts').select('id,name,provider,account_type').eq('organization_id',org).eq('active',true).order('name'),
      ])
      for(const r of [permRes,vehicleRes,fuelRes,deliveryRes,userRes,locRes,customerRes,saleRes,jobRes,bankRes])if(r.error)throw r.error
      setPermissions((permRes.data||[]).map((x)=>x.permission))
      setVehicles(vehicleRes.data||[])
      setFuelLogs(fuelRes.data||[])
      setDeliveries(deliveryRes.data||[])
      setUsers(userRes.data||[])
      setLocations(locRes.data||[])
      setCustomers(customerRes.data||[])
      setSales(saleRes.data||[])
      setJobs(jobRes.data||[])
      setBankAccounts(bankRes.data||[])
      const defaultLocation=ctx.location?.id||locRes.data?.[0]?.id||''
      const firstVehicle=vehicleRes.data?.find((v)=>v.active)?.id||''
      setVehicleForm((v)=>({...v,location_id:v.location_id||defaultLocation}))
      setFuelForm((v)=>({...v,vehicle_id:v.vehicle_id||firstVehicle,bank_account_id:v.bank_account_id||bankRes.data?.[0]?.id||''}))
      setDeliveryForm((v)=>({...v,source_location_id:v.source_location_id||defaultLocation,vehicle_id:v.vehicle_id||firstVehicle}))
      if(selectedDelivery){
        const fresh=(deliveryRes.data||[]).find((d)=>d.id===selectedDelivery.id)
        if(fresh)setSelectedDelivery(fresh)
      }
    }catch(error){setMessage({type:'error',text:error.message||'Could not load fleet.'})}
    finally{setLoading(false)}
  }

  useEffect(()=>{load()},[])

  const userName=(id)=>users.find((u)=>u.id===id)?.full_name||'Unassigned'
  const vehicleName=(id)=>{const v=vehicles.find((x)=>x.id===id);return v?`${v.registration_number} · ${v.make||''} ${v.model||''}`.trim():'No vehicle'}
  const locationName=(id)=>locations.find((l)=>l.id===id)?.name||'Location'
  const customerName=(id)=>customers.find((c)=>c.id===id)?.name||'No customer'

  const createVehicle=async(event)=>{
    event.preventDefault();setBusy(true);setMessage(null)
    const f=vehicleForm
    const {data,error}=await supabase.rpc('create_vehicle',{
      p_location_id:f.location_id,p_registration_number:f.registration_number,p_make:f.make||null,p_model:f.model||null,
      p_model_year:f.model_year?Number(f.model_year):null,p_vin:f.vin||null,p_fuel_type:f.fuel_type,p_odometer:Number(f.odometer||0),
      p_service_due_odometer:f.service_due_odometer?Number(f.service_due_odometer):null,p_capacity:f.capacity||null,
      p_driver_user_id:f.driver_user_id||null,p_insurance_expiry:f.insurance_expiry||null,p_license_expiry:f.license_expiry||null,
      p_purchase_date:f.purchase_date||null,p_purchase_cost:Number(f.purchase_cost||0),p_notes:f.notes||null
    })
    if(error)setMessage({type:'error',text:error.message})
    else{
      setVehicleForm((v)=>({location_id:v.location_id,registration_number:'',make:'',model:'',model_year:'',vin:'',fuel_type:'petrol',odometer:'',service_due_odometer:'',capacity:'',driver_user_id:'',insurance_expiry:'',license_expiry:'',purchase_date:'',purchase_cost:'',notes:''}))
      setMessage({type:'success',text:`Vehicle registered as asset ${data?.asset_number||''}.`});await load()
    }
    setBusy(false)
  }

  const recordFuel=async(event)=>{
    event.preventDefault();setBusy(true);setMessage(null)
    const f=fuelForm
    const {data,error}=await supabase.rpc('record_fuel_log',{
      p_vehicle_id:f.vehicle_id,p_odometer:Number(f.odometer),p_quantity:Number(f.quantity),p_unit_cost:Number(f.unit_cost||0),
      p_supplier:f.supplier||null,p_reference:f.reference||null,p_notes:f.notes||null,p_payment_method:f.payment_method||null,
      p_bank_account_id:f.payment_method&&f.payment_method!=='cash'?(f.bank_account_id||null):null
    })
    if(error)setMessage({type:'error',text:error.message})
    else{
      setFuelForm((v)=>({...v,odometer:'',quantity:'',unit_cost:'',supplier:'',reference:'',notes:'',payment_method:''}))
      setMessage({type:'success',text:`Fuel log saved · ${money(data?.total_cost,currency)}.`});await load()
    }
    setBusy(false)
  }

  const createDelivery=async(event)=>{
    event.preventDefault();setBusy(true);setMessage(null)
    const f=deliveryForm
    const {data,error}=await supabase.rpc('create_delivery',{
      p_source_location_id:f.source_location_id||null,p_destination:f.destination,p_customer_id:f.customer_id||null,
      p_sale_id:f.sale_id||null,p_work_order_id:f.work_order_id||null,p_vehicle_id:f.vehicle_id||null,
      p_driver_user_id:f.driver_user_id||null,p_contact_name:f.contact_name||null,p_contact_phone:f.contact_phone||null,
      p_package_description:f.package_description||null,p_scheduled_at:f.scheduled_at?new Date(f.scheduled_at).toISOString():null,p_notes:f.notes||null
    })
    if(error)setMessage({type:'error',text:error.message})
    else{
      setDeliveryForm((v)=>({source_location_id:v.source_location_id,destination:'',customer_id:'',sale_id:'',work_order_id:'',vehicle_id:v.vehicle_id,driver_user_id:'',contact_name:'',contact_phone:'',package_description:'',scheduled_at:'',notes:''}))
      setMessage({type:'success',text:`${data?.delivery_number||'Delivery'} created.`});await load()
    }
    setBusy(false)
  }

  const updateDelivery=async(status)=>{
    if(!selectedDelivery)return
    setBusy(true);setMessage(null)
    const {error}=await supabase.rpc('update_delivery_status',{
      p_delivery_id:selectedDelivery.id,p_status:status,p_recipient_name:deliveryUpdate.recipient_name||null,
      p_notes:deliveryUpdate.notes||null,p_failure_reason:deliveryUpdate.failure_reason||null
    })
    if(error)setMessage({type:'error',text:error.message})
    else{
      setMessage({type:'success',text:`${selectedDelivery.delivery_number} moved to ${status.replaceAll('_',' ')}.`})
      setDeliveryUpdate({recipient_name:'',notes:'',failure_reason:''});await load()
    }
    setBusy(false)
  }

  const updateVehicleAssignment=async(vehicle,driverId)=>{
    setBusy(true);setMessage(null)
    const {error}=await supabase.from('vehicles').update({assigned_driver_id:driverId||null,status:driverId&&vehicle.status==='available'?'assigned':(!driverId&&vehicle.status==='assigned'?'available':vehicle.status),updated_at:new Date().toISOString()}).eq('id',vehicle.id)
    if(error)setMessage({type:'error',text:error.message});else await load()
    setBusy(false)
  }

  const now=new Date()
  const days30=new Date(Date.now()+30*86400000)
  const docExpiring=vehicles.filter((v)=>v.active&&(
    (v.insurance_expiry&&new Date(v.insurance_expiry+'T23:59:59')<=days30)||
    (v.license_expiry&&new Date(v.license_expiry+'T23:59:59')<=days30)
  ))
  const serviceDue=vehicles.filter((v)=>v.active&&v.service_due_odometer!=null&&Number(v.odometer)>=Number(v.service_due_odometer))
  const activeDeliveries=deliveries.filter((d)=>!['delivered','cancelled','failed'].includes(d.status))
  const fuelSpend=fuelLogs.reduce((sum,f)=>sum+Number(f.total_cost||0),0)

  const fuelByVehicle=useMemo(()=>vehicles.map((v)=>{
    const logs=fuelLogs.filter((f)=>f.vehicle_id===v.id)
    const cost=logs.reduce((sum,f)=>sum+Number(f.total_cost||0),0)
    const qty=logs.reduce((sum,f)=>sum+Number(f.quantity||0),0)
    return {vehicle:v,cost,qty,logs}
  }),[vehicles,fuelLogs])

  if(loading)return <main className="page-wrap text-muted">Loading fleet...</main>

  return <main className="page-wrap">
    <div className="page-header-row">
      <div><p className="page-eyebrow">Fleet</p><h1 className="page-title">Fleet & Delivery</h1><p className="page-subtitle">Vehicles, drivers, fuel, service mileage, dispatch and delivery completion in one operational workspace.</p></div>
      <Link href="/assets" className="btn-secondary rounded-xl px-4 py-2 text-sm font-bold">Assets & Maintenance</Link>
    </div>

    {message&&<div className={`mb-5 rounded-xl border px-4 py-3 text-sm ${message.type==='error'?'border-red-500/30 bg-red-500/10 text-red-500':'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'}`}>{message.text}</div>}

    <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className="page-card p-4"><p className="text-xs text-muted">Active vehicles</p><strong className="mt-2 block text-2xl">{vehicles.filter((v)=>v.active).length}</strong></div>
      <div className="page-card p-4"><p className="text-xs text-muted">Active deliveries</p><strong className="mt-2 block text-2xl">{activeDeliveries.length}</strong></div>
      <div className="page-card p-4"><p className="text-xs text-muted">Service mileage reached</p><strong className="mt-2 block text-2xl text-amber-600">{serviceDue.length}</strong></div>
      <div className="page-card p-4"><p className="text-xs text-muted">Recorded fuel spend</p><strong className="mt-2 block text-xl">{money(fuelSpend,currency)}</strong></div>
    </section>

    <div className="mb-5 flex gap-2 overflow-x-auto rounded-2xl bg-[var(--panel-2)] p-1">
      {[['fleet','Vehicles'],['new','New vehicle'],['fuel','Fuel'],['deliveries','Deliveries'],['dispatch','New delivery']].map(([key,label])=><button key={key} type="button" onClick={()=>setTab(key)} className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-black ${tab===key?'bg-[var(--panel)] text-accent shadow-sm':'text-muted'}`}>{label}</button>)}
    </div>

    {tab==='fleet'&&<section className="space-y-3">
      {docExpiring.length>0&&<div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-700"><strong>{docExpiring.length} vehicle document warning(s).</strong> Insurance or licence expiry is within 30 days or already overdue.</div>}
      {!vehicles.length&&<div className="page-card p-7 text-center text-sm text-muted">No vehicles registered.</div>}
      {vehicles.map((v)=><article key={v.id} className="page-card p-5"><div className="grid gap-4 lg:grid-cols-[1fr_auto_auto] lg:items-start"><div><div className="flex flex-wrap items-center gap-2"><strong>{v.registration_number}</strong><span className="rounded-full bg-[var(--panel-2)] px-2 py-1 text-[10px] font-black uppercase text-muted">{v.status.replaceAll('_',' ')}</span>{v.service_due_odometer!=null&&Number(v.odometer)>=Number(v.service_due_odometer)&&<span className="rounded-full bg-amber-500/10 px-2 py-1 text-[10px] font-black uppercase text-amber-600">service due</span>}</div><p className="mt-1 text-sm text-muted">{v.make||''} {v.model||''}{v.model_year?` · ${v.model_year}`:''} · {locationName(v.location_id)}</p><p className="mt-1 text-xs text-muted">{v.fuel_type} · {Number(v.odometer||0).toLocaleString()} km{v.capacity?` · capacity ${v.capacity}`:''}</p></div><div className="text-left lg:text-right"><span className="text-xs text-muted">Driver</span><strong className="block">{v.assigned_driver_id?userName(v.assigned_driver_id):'Unassigned'}</strong>{canFleetManage&&<select disabled={busy||['maintenance','in_transit','retired'].includes(v.status)} className="input-base mt-2 !py-2 text-xs" value={v.assigned_driver_id||''} onChange={(e)=>updateVehicleAssignment(v,e.target.value)}><option value="">No driver</option>{users.map((u)=><option key={u.id} value={u.id}>{u.full_name}</option>)}</select>}</div><div className="text-left lg:text-right"><span className="text-xs text-muted">Documents</span><p className="text-xs">Insurance {v.insurance_expiry||'—'}</p><p className="text-xs">Licence {v.license_expiry||'—'}</p></div></div></article>)}
    </section>}

    {tab==='new'&&canFleetManage&&<form onSubmit={createVehicle} className="page-card mx-auto max-w-4xl p-5"><h2 className="font-black">Register vehicle</h2><p className="mt-1 text-sm text-muted">A vehicle is automatically registered in the Asset Register as well.</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><input required className="input-base" placeholder="Registration number" value={vehicleForm.registration_number} onChange={(e)=>setVehicleForm({...vehicleForm,registration_number:e.target.value})}/><select className="input-base" value={vehicleForm.location_id} onChange={(e)=>setVehicleForm({...vehicleForm,location_id:e.target.value})}>{locations.map((l)=><option key={l.id} value={l.id}>{l.name}</option>)}</select><input className="input-base" placeholder="Make" value={vehicleForm.make} onChange={(e)=>setVehicleForm({...vehicleForm,make:e.target.value})}/><input className="input-base" placeholder="Model" value={vehicleForm.model} onChange={(e)=>setVehicleForm({...vehicleForm,model:e.target.value})}/><input className="input-base" type="number" min="1900" max="2100" placeholder="Model year" value={vehicleForm.model_year} onChange={(e)=>setVehicleForm({...vehicleForm,model_year:e.target.value})}/><input className="input-base" placeholder="VIN / chassis number" value={vehicleForm.vin} onChange={(e)=>setVehicleForm({...vehicleForm,vin:e.target.value})}/><select className="input-base" value={vehicleForm.fuel_type} onChange={(e)=>setVehicleForm({...vehicleForm,fuel_type:e.target.value})}><option value="petrol">Petrol</option><option value="diesel">Diesel</option><option value="electric">Electric</option><option value="hybrid">Hybrid</option><option value="gas">Gas</option><option value="other">Other</option></select><input className="input-base" placeholder="Capacity e.g. 3.5 tonnes / 14 seats" value={vehicleForm.capacity} onChange={(e)=>setVehicleForm({...vehicleForm,capacity:e.target.value})}/><input className="input-base" type="number" min="0" step="0.1" placeholder="Current odometer km" value={vehicleForm.odometer} onChange={(e)=>setVehicleForm({...vehicleForm,odometer:e.target.value})}/><input className="input-base" type="number" min="0" step="0.1" placeholder="Next service at km" value={vehicleForm.service_due_odometer} onChange={(e)=>setVehicleForm({...vehicleForm,service_due_odometer:e.target.value})}/><select className="input-base" value={vehicleForm.driver_user_id} onChange={(e)=>setVehicleForm({...vehicleForm,driver_user_id:e.target.value})}><option value="">No assigned driver</option>{users.map((u)=><option key={u.id} value={u.id}>{u.full_name}</option>)}</select><label><span className="mb-1 block text-xs font-bold text-muted">Insurance expiry</span><input className="input-base" type="date" value={vehicleForm.insurance_expiry} onChange={(e)=>setVehicleForm({...vehicleForm,insurance_expiry:e.target.value})}/></label><label><span className="mb-1 block text-xs font-bold text-muted">Licence expiry</span><input className="input-base" type="date" value={vehicleForm.license_expiry} onChange={(e)=>setVehicleForm({...vehicleForm,license_expiry:e.target.value})}/></label><label><span className="mb-1 block text-xs font-bold text-muted">Purchase date</span><input className="input-base" type="date" value={vehicleForm.purchase_date} onChange={(e)=>setVehicleForm({...vehicleForm,purchase_date:e.target.value})}/></label><input className="input-base" type="number" min="0" step="0.01" placeholder="Purchase cost" value={vehicleForm.purchase_cost} onChange={(e)=>setVehicleForm({...vehicleForm,purchase_cost:e.target.value})}/><textarea className="input-base min-h-20 sm:col-span-2" placeholder="Vehicle notes" value={vehicleForm.notes} onChange={(e)=>setVehicleForm({...vehicleForm,notes:e.target.value})}/></div><button disabled={busy} className="btn-primary mt-4 w-full rounded-xl px-4 py-3 font-black">Register vehicle</button></form>}

    {tab==='fuel'&&<section className="grid gap-5 xl:grid-cols-[400px_1fr]">
      {canFleetManage&&<form onSubmit={recordFuel} className="page-card h-fit p-5"><h2 className="font-black">Record fuel</h2><select className="input-base mt-3" value={fuelForm.vehicle_id} onChange={(e)=>{const v=vehicles.find((x)=>x.id===e.target.value);setFuelForm({...fuelForm,vehicle_id:e.target.value,odometer:v?String(v.odometer):fuelForm.odometer})}}>{vehicles.filter((v)=>v.active).map((v)=><option key={v.id} value={v.id}>{v.registration_number} · {v.make||''} {v.model||''}</option>)}</select><input required className="input-base mt-3" type="number" min="0" step="0.1" placeholder="Odometer km" value={fuelForm.odometer} onChange={(e)=>setFuelForm({...fuelForm,odometer:e.target.value})}/><div className="mt-3 grid grid-cols-2 gap-3"><input required className="input-base" type="number" min="0.001" step="0.001" placeholder="Litres / units" value={fuelForm.quantity} onChange={(e)=>setFuelForm({...fuelForm,quantity:e.target.value})}/><input className="input-base" type="number" min="0" step="0.01" placeholder="Cost per litre/unit" value={fuelForm.unit_cost} onChange={(e)=>setFuelForm({...fuelForm,unit_cost:e.target.value})}/></div><div className="mt-3 rounded-xl bg-[var(--panel-2)] p-3 text-sm"><span className="text-muted">Total:</span> <strong>{money(Number(fuelForm.quantity||0)*Number(fuelForm.unit_cost||0),currency)}</strong></div><input className="input-base mt-3" placeholder="Fuel station / supplier" value={fuelForm.supplier} onChange={(e)=>setFuelForm({...fuelForm,supplier:e.target.value})}/><select className="input-base mt-3" value={fuelForm.payment_method} onChange={(e)=>setFuelForm({...fuelForm,payment_method:e.target.value})}><option value="">Track cost only / not paid now</option><option value="cash">Cash</option><option value="bank">Bank</option><option value="mobile_money">Mobile Money</option><option value="card">Card</option></select>{fuelForm.payment_method&&fuelForm.payment_method!=='cash'&&<select className="input-base mt-3" value={fuelForm.bank_account_id} onChange={(e)=>setFuelForm({...fuelForm,bank_account_id:e.target.value})}>{bankAccounts.map((a)=><option key={a.id} value={a.id}>{a.name}</option>)}</select>}<input className="input-base mt-3" placeholder="Receipt / payment reference" value={fuelForm.reference} onChange={(e)=>setFuelForm({...fuelForm,reference:e.target.value})}/><textarea className="input-base mt-3 min-h-16" placeholder="Notes" value={fuelForm.notes} onChange={(e)=>setFuelForm({...fuelForm,notes:e.target.value})}/><button disabled={busy||!fuelForm.vehicle_id} className="btn-primary mt-3 w-full rounded-xl px-4 py-3 font-black">Save fuel log</button></form>}
      <div className="page-card overflow-hidden"><div className="border-b border-[var(--line)] p-4"><strong>Fuel history</strong></div><div className="max-h-[800px] divide-y divide-[var(--line)] overflow-y-auto">{fuelLogs.map((f)=><div key={f.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto]"><div><strong>{vehicleName(f.vehicle_id)}</strong><p className="mt-1 text-xs text-muted">{new Date(f.log_date+'T00:00:00').toLocaleDateString()} · {Number(f.quantity).toLocaleString()} units · odometer {Number(f.odometer).toLocaleString()} km{f.supplier?` · ${f.supplier}`:''}</p></div><strong>{money(f.total_cost,currency)}</strong></div>)}</div></div>
    </section>}

    {tab==='deliveries'&&<section className="space-y-3">
      {!deliveries.length&&<div className="page-card p-7 text-center text-sm text-muted">No deliveries yet.</div>}
      {deliveries.map((d)=><button key={d.id} type="button" onClick={()=>setSelectedDelivery(d)} className="page-card w-full p-4 text-left sm:p-5"><div className="grid gap-3 lg:grid-cols-[1fr_auto_auto] lg:items-center"><div><div className="flex flex-wrap items-center gap-2"><strong>{d.delivery_number}</strong><span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${d.status==='delivered'?'bg-emerald-500/10 text-emerald-600':d.status==='failed'?'bg-red-500/10 text-red-500':d.status==='in_transit'?'bg-blue-500/10 text-blue-600':'bg-[var(--panel-2)] text-muted'}`}>{d.status.replaceAll('_',' ')}</span></div><p className="mt-1 text-sm">{d.destination}</p><p className="mt-1 text-xs text-muted">{d.customer_id?customerName(d.customer_id):'No customer'} · {d.vehicle_id?vehicleName(d.vehicle_id):'No vehicle'} · {d.driver_user_id?userName(d.driver_user_id):'No driver'}</p></div><div className="text-left lg:text-right"><span className="text-xs text-muted">Scheduled</span><strong className="block text-sm">{d.scheduled_at?new Date(d.scheduled_at).toLocaleString():'Unscheduled'}</strong></div><div className="text-left lg:text-right"><span className="text-xs text-muted">Source</span><strong className="block text-sm">{locationName(d.source_location_id)}</strong></div></div></button>)}
    </section>}

    {tab==='dispatch'&&canDispatch&&<form onSubmit={createDelivery} className="page-card mx-auto max-w-4xl p-5"><h2 className="font-black">Create delivery / dispatch</h2><div className="mt-4 grid gap-3 sm:grid-cols-2"><select className="input-base" value={deliveryForm.source_location_id} onChange={(e)=>setDeliveryForm({...deliveryForm,source_location_id:e.target.value})}>{locations.map((l)=><option key={l.id} value={l.id}>{l.name}</option>)}</select><input required className="input-base" placeholder="Destination / delivery address" value={deliveryForm.destination} onChange={(e)=>setDeliveryForm({...deliveryForm,destination:e.target.value})}/><select className="input-base" value={deliveryForm.customer_id} onChange={(e)=>setDeliveryForm({...deliveryForm,customer_id:e.target.value})}><option value="">No linked customer</option>{customers.map((c)=><option key={c.id} value={c.id}>{c.name}</option>)}</select><select className="input-base" value={deliveryForm.vehicle_id} onChange={(e)=>{const v=vehicles.find((x)=>x.id===e.target.value);setDeliveryForm({...deliveryForm,vehicle_id:e.target.value,driver_user_id:v?.assigned_driver_id||deliveryForm.driver_user_id})}}><option value="">No vehicle assigned yet</option>{vehicles.filter((v)=>v.active&&!['maintenance','out_of_service','retired'].includes(v.status)).map((v)=><option key={v.id} value={v.id}>{v.registration_number} · {v.make||''} {v.model||''}</option>)}</select><select className="input-base" value={deliveryForm.driver_user_id} onChange={(e)=>setDeliveryForm({...deliveryForm,driver_user_id:e.target.value})}><option value="">No driver assigned yet</option>{users.map((u)=><option key={u.id} value={u.id}>{u.full_name}</option>)}</select><input className="input-base" type="datetime-local" value={deliveryForm.scheduled_at} onChange={(e)=>setDeliveryForm({...deliveryForm,scheduled_at:e.target.value})}/><select className="input-base" value={deliveryForm.sale_id} onChange={(e)=>setDeliveryForm({...deliveryForm,sale_id:e.target.value,work_order_id:''})}><option value="">No linked sale</option>{sales.map((s)=><option key={s.id} value={s.id}>{s.sale_number||s.id.slice(0,8)} · {money(s.total_amount,currency)}</option>)}</select><select className="input-base" value={deliveryForm.work_order_id} onChange={(e)=>setDeliveryForm({...deliveryForm,work_order_id:e.target.value,sale_id:''})}><option value="">No linked service job</option>{jobs.map((j)=><option key={j.id} value={j.id}>{j.job_number||'Job'} · {j.title}</option>)}</select><input className="input-base" placeholder="Contact / recipient name" value={deliveryForm.contact_name} onChange={(e)=>setDeliveryForm({...deliveryForm,contact_name:e.target.value})}/><input className="input-base" placeholder="Contact phone" value={deliveryForm.contact_phone} onChange={(e)=>setDeliveryForm({...deliveryForm,contact_phone:e.target.value})}/><textarea className="input-base min-h-20 sm:col-span-2" placeholder="Package / load description" value={deliveryForm.package_description} onChange={(e)=>setDeliveryForm({...deliveryForm,package_description:e.target.value})}/><textarea className="input-base min-h-20 sm:col-span-2" placeholder="Dispatch notes" value={deliveryForm.notes} onChange={(e)=>setDeliveryForm({...deliveryForm,notes:e.target.value})}/></div><button disabled={busy} className="btn-primary mt-4 w-full rounded-xl px-4 py-3 font-black">Create delivery</button></form>}

    {selectedDelivery&&<div className="fixed inset-0 z-[100] overflow-y-auto bg-black/60 p-4 sm:p-8"><div className="mx-auto max-w-2xl rounded-3xl bg-[var(--panel)] p-5 shadow-2xl sm:p-6"><div className="flex items-start justify-between gap-4"><div><p className="page-eyebrow">{selectedDelivery.delivery_number}</p><h2 className="text-xl font-black">{selectedDelivery.destination}</h2><p className="mt-1 text-sm text-muted">{selectedDelivery.customer_id?customerName(selectedDelivery.customer_id):'No customer'} · {selectedDelivery.vehicle_id?vehicleName(selectedDelivery.vehicle_id):'No vehicle'}</p></div><button type="button" onClick={()=>setSelectedDelivery(null)} className="rounded-xl border border-[var(--line)] px-3 py-2 font-black">×</button></div><div className="mt-4"><Link href={`/deliveries/${selectedDelivery.id}/note`} className="btn-secondary inline-block rounded-xl px-3 py-2 text-xs font-black">Delivery note</Link></div><div className="mt-5 grid gap-3 sm:grid-cols-2"><div className="rounded-xl bg-[var(--panel-2)] p-3"><span className="text-xs text-muted">Status</span><strong className="block capitalize">{selectedDelivery.status.replaceAll('_',' ')}</strong></div><div className="rounded-xl bg-[var(--panel-2)] p-3"><span className="text-xs text-muted">Driver</span><strong className="block">{selectedDelivery.driver_user_id?userName(selectedDelivery.driver_user_id):'Unassigned'}</strong></div></div>{selectedDelivery.package_description&&<div className="mt-4 rounded-xl border border-[var(--line)] p-4 text-sm"><strong>Load / package</strong><p className="mt-1 text-muted">{selectedDelivery.package_description}</p></div>}{selectedDelivery.contact_name&&<p className="mt-3 text-sm text-muted">Contact: {selectedDelivery.contact_name}{selectedDelivery.contact_phone?` · ${selectedDelivery.contact_phone}`:''}</p>}{canDispatch&&!['delivered','cancelled'].includes(selectedDelivery.status)&&<div className="mt-5"><textarea className="input-base min-h-16" placeholder="Status / delivery note" value={deliveryUpdate.notes} onChange={(e)=>setDeliveryUpdate({...deliveryUpdate,notes:e.target.value})}/><input className="input-base mt-3" placeholder="Recipient name (for delivered)" value={deliveryUpdate.recipient_name} onChange={(e)=>setDeliveryUpdate({...deliveryUpdate,recipient_name:e.target.value})}/><input className="input-base mt-3" placeholder="Failure reason (for failed)" value={deliveryUpdate.failure_reason} onChange={(e)=>setDeliveryUpdate({...deliveryUpdate,failure_reason:e.target.value})}/><div className="mt-3 grid grid-cols-2 gap-2"><button disabled={busy} onClick={()=>updateDelivery('dispatched')} className="btn-secondary rounded-xl px-3 py-2 text-xs font-black">Dispatched</button><button disabled={busy} onClick={()=>updateDelivery('in_transit')} className="btn-secondary rounded-xl px-3 py-2 text-xs font-black">In transit</button><button disabled={busy} onClick={()=>updateDelivery('failed')} className="rounded-xl bg-red-500 px-3 py-2 text-xs font-black text-white">Failed</button><button disabled={busy} onClick={()=>updateDelivery('delivered')} className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white">Delivered</button></div></div>}{selectedDelivery.delivered_at&&<div className="mt-4 rounded-xl bg-emerald-500/10 p-4 text-sm text-emerald-700"><strong>Delivered {new Date(selectedDelivery.delivered_at).toLocaleString()}</strong><p className="mt-1">Received by {selectedDelivery.recipient_name||'recipient not recorded'}</p></div>}</div></div>}
  </main>
}
