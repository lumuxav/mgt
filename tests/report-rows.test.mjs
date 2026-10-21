import test from 'node:test'
import assert from 'node:assert/strict'
import { reportRows } from '../lib/reportRows.js'

test('report fetch includes rows beyond the API page cap',async()=>{
 const source=Array.from({length:2307},(_,id)=>({id}))
 const pages=[]
 const query={order(){return this},async range(start,end){pages.push([start,end]);return {data:source.slice(start,end+1),error:null}}}
 const result=await reportRows(query)
 assert.equal(result.data.length,2307)
 assert.deepEqual(pages,[[0,999],[1000,1999],[2000,2999]])
})
test('later page error never returns partial totals as success',async()=>{
 const query={order(){return this},async range(start){return start?{error:new Error('Network failed')}:{data:Array(1000).fill({id:1})}}}
 const result=await reportRows(query)
 assert.equal(result.data,null)
 assert.match(result.error.message,/Network failed/)
})
test('bounded reports fail explicitly instead of dropping older records',async()=>{
 const query={order(){return this},async range(){return {data:Array(1000).fill({id:1})}}}
 const result=await reportRows(query,['id'],1000)
 assert.equal(result.data,null)
 assert.match(result.error.message,/exceeds/)
})
