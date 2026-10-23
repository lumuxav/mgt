// Read every page; never label a silently truncated response as a complete report.
export async function reportRows(query,orderColumns=['id'],maximum=100000) {
  const pageSize=1000
  let ordered=query
  for(const column of orderColumns)ordered=ordered.order(column,{ascending:true})
  const rows=[]
  for(let offset=0;offset<maximum;offset+=pageSize){
    const result=await ordered.range(offset,offset+pageSize-1)
    if(result.error)return {...result,data:null}
    const page=result.data||[]
    rows.push(...page)
    if(page.length<pageSize)return {...result,data:rows}
  }
  return {data:null,error:new Error('This report exceeds 100,000 records. Export the ledger or narrow its source period before generating it.')}
}
