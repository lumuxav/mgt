import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const { backupConnection } = createRequire(import.meta.url)('../scripts/backup-mgt.cjs')
test('backup target accepts only the pinned MGT direct database or session pooler', () => {
  const direct = backupConnection('postgresql://postgres:encoded%40password@db.mehuiivevjqmwvaapbgz.supabase.co:5432/postgres')
  assert.equal(direct.PGPASSWORD, 'encoded@password')
  assert.equal(direct.PGSSLMODE, 'require')
  assert.equal(backupConnection('postgres://postgres.mehuiivevjqmwvaapbgz:example@aws-1-eu-west-1.pooler.supabase.com:5432/postgres').PGPORT, '5432')
  for (const value of ['postgres://postgres:example@db.unrelated.supabase.co/postgres', 'postgres://postgres.other:example@aws-1-eu-west-1.pooler.supabase.com/postgres', 'postgres://postgres.mehuiivevjqmwvaapbgz:example@aws-1-eu-west-1.pooler.supabase.com:6543/postgres', 'postgres://postgres:example@localhost/postgres']) assert.throws(() => backupConnection(value), /MGT database/)
})
