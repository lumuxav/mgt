'use client'

export function Sparkline({points=[],height=160,label='Trend'}){
  const values=points.map(x=>Number(x.value||0))
  const max=Math.max(...values,1)
  const min=Math.min(...values,0)
  const span=Math.max(max-min,1)
  const width=720
  const pad=18
  const coords=values.map((value,index)=>{
    const x=values.length<=1?width/2:pad+(index*(width-pad*2)/(values.length-1))
    const y=height-pad-((value-min)/span)*(height-pad*2)
    return [x,y]
  })
  const path=coords.map(([x,y],i)=>`${i?'L':'M'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  return <div className="w-full">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="h-auto w-full overflow-visible text-accent">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
      {coords.map(([x,y],i)=><circle key={i} cx={x} cy={y} r="3" fill="currentColor"/>)}
    </svg>
    <div className="mt-2 flex justify-between text-[10px] text-muted">
      <span>{points[0]?.label||''}</span><span>{points.at(-1)?.label||''}</span>
    </div>
  </div>
}

export function Bars({rows=[],valueKey='value',labelKey='label',format=(v)=>v,maxRows=8}){
  const visible=rows.slice(0,maxRows)
  const max=Math.max(...visible.map(row=>Math.abs(Number(row[valueKey]||0))),1)
  return <div className="space-y-3">
    {visible.map((row,index)=>{
      const value=Number(row[valueKey]||0)
      const width=Math.max(2,Math.min(100,Math.abs(value)/max*100))
      return <div key={row.id||row[labelKey]||index}>
        <div className="mb-1 flex items-center justify-between gap-3 text-xs"><span className="truncate font-bold">{row[labelKey]}</span><strong>{format(value)}</strong></div>
        <div className="h-2 overflow-hidden rounded-full bg-[var(--panel-2)]"><div className="h-full rounded-full bg-current text-accent" style={{width:`${width}%`}}/></div>
      </div>
    })}
    {!visible.length&&<p className="text-sm text-muted">No data available for this period.</p>}
  </div>
}

export function ProgressBar({value=0,label,valueLabel}){
  const safe=Math.max(0,Math.min(100,Number(value||0)))
  return <div>
    <div className="mb-1 flex items-center justify-between gap-3 text-xs"><span className="text-muted">{label}</span><strong>{valueLabel||safe.toLocaleString(undefined,{maximumFractionDigits:1})+'%'}</strong></div>
    <div className="h-2 overflow-hidden rounded-full bg-[var(--panel-2)]"><div className="h-full rounded-full bg-current text-accent" style={{width:`${safe}%`}}/></div>
  </div>
}
