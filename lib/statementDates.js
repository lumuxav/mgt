export function statementDates(timeZone='UTC',now=new Date()) {
  const parts=new Intl.DateTimeFormat('en',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now)
  const value=Object.fromEntries(parts.map(part=>[part.type,part.value]))
  const endDate=`${value.year}-${value.month}-${value.day}`
  const start=new Date(endDate+'T12:00:00Z')
  start.setUTCDate(start.getUTCDate()-89)
  return {startDate:start.toISOString().slice(0,10),endDate}
}
