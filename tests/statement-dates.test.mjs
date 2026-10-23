import { test } from 'node:test'
import assert from 'node:assert/strict'
import { statementDates } from '../lib/statementDates.js'
test('statement includes the current business day across the UTC midnight boundary',()=>{
  const now=new Date('2026-10-21T22:30:00Z')
  assert.deepEqual(statementDates('Africa/Kampala',now),{startDate:'2026-07-25',endDate:'2026-10-22'})
  assert.equal(statementDates('America/New_York',now).endDate,'2026-10-21')
})
