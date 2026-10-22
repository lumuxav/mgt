const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { pipeline } = require('node:stream/promises')
const { createHash } = require('node:crypto')

const project = 'mehuiivevjqmwvaapbgz'
function backupConnection(value) {
  let url
  try { url = new URL(value) } catch { throw Error('Configure MGT_BACKUP_DATABASE_URL with the MGT PostgreSQL connection string') }
  const user = decodeURIComponent(url.username)
  const direct = url.hostname === `db.${project}.supabase.co` && user === 'postgres'
  const sessionPool = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) && user === `postgres.${project}`
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !(direct || sessionPool) || (url.port && url.port !== '5432') || url.pathname !== '/postgres') throw Error('Backup target must be the MGT database or its session pooler on port 5432')
  if (!url.password) throw Error('MGT backup database password is missing')
  return { PGHOST: url.hostname, PGPORT: '5432', PGUSER: user, PGPASSWORD: decodeURIComponent(url.password), PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '30' }
}

async function backup() {
  if (process.env.GITHUB_REF !== 'refs/heads/universal-business-platform' || process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch') throw Error('Production backups require the manual MGT production-branch workflow')
  const connection = backupConnection(process.env.MGT_BACKUP_DATABASE_URL)
  const recipient = process.env.MGT_BACKUP_AGE_RECIPIENT || ''
  if (!/^age1[a-z0-9]{50,70}$/.test(recipient)) throw Error('Configure an age public recipient; keep the private recovery key outside GitHub')
  const directory = path.resolve('backup-artifact')
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const destination = path.join(directory, 'mgt-database.dump.age')
  let dump, encrypt
  const complete = child => new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', code => code === 0 ? resolve() : reject(Error('Backup command failed; no backup is published')))
  })
  try {
    // One pg_dump transaction provides a consistent snapshot across all schemas.
    // The dump is encrypted as it streams; plaintext is never written to disk.
    dump = spawn('docker', ['run', '--rm', ...Object.keys(connection).flatMap(key => ['-e', key]), 'postgres:17.11', 'pg_dump', '--dbname=postgres', '--format=custom', '--no-owner', '--no-acl'], { env: { ...process.env, ...connection }, stdio: ['ignore', 'pipe', 'inherit'] })
    encrypt = spawn('age', ['--recipient', recipient], { stdio: ['pipe', 'pipe', 'inherit'] })
    await Promise.all([complete(dump), complete(encrypt), pipeline(dump.stdout, encrypt.stdin), pipeline(encrypt.stdout, fs.createWriteStream(destination, { mode: 0o600 }))])
    if (fs.statSync(destination).size < 100) throw Error('Encrypted backup is unexpectedly empty')
    const hash = createHash('sha256')
    for await (const chunk of fs.createReadStream(destination)) hash.update(chunk)
    fs.writeFileSync(path.join(directory, 'MANIFEST.json'), JSON.stringify({ project, source: process.env.GITHUB_SHA, created_at: new Date().toISOString(), file: path.basename(destination), sha256: hash.digest('hex'), format: 'PostgreSQL custom archive encrypted with age', excludes: ['Storage object bytes', 'cluster roles', 'hosting secrets', 'provider credentials held outside the database'], restore_verified: false }, null, 2) + '\n')
    console.log('Encrypted MGT database snapshot created. A restoration in an isolated target is still required.')
  } catch (error) {
    dump?.kill(); encrypt?.kill()
    fs.rmSync(directory, { recursive: true, force: true })
    throw error
  }
}

module.exports = { backupConnection }
if (require.main === module) backup().catch(error => { console.error(error.message); process.exitCode = 1 })
