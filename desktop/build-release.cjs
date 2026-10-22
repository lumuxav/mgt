// Credentials are consumed only on the protected production branch, never in PR builds.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

function signingPlan(platform, env) {
  if (!['Windows', 'macOS', 'Linux'].includes(platform)) throw Error('Unknown desktop platform')
  const keys = platform === 'Windows'
    ? ['MGT_WINDOWS_CERTIFICATE_BASE64', 'MGT_WINDOWS_CERTIFICATE_PASSWORD']
    : platform === 'macOS'
      ? ['MGT_MAC_CERTIFICATE_BASE64', 'MGT_MAC_CERTIFICATE_PASSWORD', 'MGT_APPLE_API_KEY_BASE64', 'MGT_APPLE_API_KEY_ID', 'MGT_APPLE_API_ISSUER'] : []
  const allowed = env.GITHUB_REF === 'refs/heads/universal-business-platform' && ['push', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME)
  const present = allowed ? keys.filter(key => Boolean(env[key])) : []
  if (present.length && present.length !== keys.length) throw Error('Incomplete signing configuration: ' + keys.filter(key => !env[key]).join(', '))
  const signed = present.length > 0
  return { signed, notarized: signed && platform === 'macOS', status: signed ? (platform === 'macOS' ? 'Developer ID signed and notarized' : 'Authenticode signed') : (platform === 'macOS' ? 'Ad-hoc signature; not notarized' : 'Unsigned') }
}

function run(command, args, env, capture = false) {
  const result = spawnSync(command, args, { env, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' })
  if (result.error || result.status !== 0) throw Error(command + ' failed: ' + (result.error?.message || (capture ? result.stderr : 'see build output')))
  return (result.stdout || '') + (result.stderr || '')
}

function build(platform, arch) {
  if (!['x64', 'arm64'].includes(arch)) throw Error('Unknown desktop architecture')
  const plan = signingPlan(platform, process.env)
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mgt-signing-'))
  const config = JSON.parse(JSON.stringify(require('./package.json').build))
  const env = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' }
  for (const key of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD', 'CSC_NAME', 'CSC_KEYCHAIN', 'APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']) delete env[key]
  const secretFile = (name, value) => {
    const file = path.join(temporary, name)
    fs.writeFileSync(file, Buffer.from(value, 'base64'), { mode: 0o600 })
    return file
  }
  try {
    config.forceCodeSigning = plan.signed
    if (plan.signed && platform === 'Windows') {
      env.WIN_CSC_LINK = secretFile('windows.pfx', env.MGT_WINDOWS_CERTIFICATE_BASE64)
      env.WIN_CSC_KEY_PASSWORD = env.MGT_WINDOWS_CERTIFICATE_PASSWORD
    }
    if (plan.signed && platform === 'macOS') {
      delete config.mac.identity
      config.mac.notarize = true
      config.mac.hardenedRuntime = true
      env.CSC_IDENTITY_AUTO_DISCOVERY = 'true'
      env.CSC_LINK = secretFile('developer-id.p12', env.MGT_MAC_CERTIFICATE_BASE64)
      env.CSC_KEY_PASSWORD = env.MGT_MAC_CERTIFICATE_PASSWORD
      env.APPLE_API_KEY = secretFile('AuthKey.p8', env.MGT_APPLE_API_KEY_BASE64)
      env.APPLE_API_KEY_ID = env.MGT_APPLE_API_KEY_ID
      env.APPLE_API_ISSUER = env.MGT_APPLE_API_ISSUER
    }
    const configPath = path.join(temporary, 'builder.json')
    fs.writeFileSync(configPath, JSON.stringify(config))
    run(process.execPath, [require.resolve('electron-builder/cli.js'), '--config', configPath, '--publish', 'never', platform === 'Windows' ? '--win' : platform === 'macOS' ? '--mac' : '--linux', '--' + arch], env)
    if (plan.signed && platform === 'Windows') {
      for (const file of ['MGT-Business-Suite-Windows-x64.exe', 'win-unpacked/MGT Business Suite.exe']) {
        run('pwsh', ['-NoProfile', '-NonInteractive', '-Command', '$s = Get-AuthenticodeSignature -LiteralPath $env:MGT_SIGNED_FILE; if ($s.Status -ne "Valid") { throw "Installer or app signature is not valid" }'], { ...env, MGT_SIGNED_FILE: path.resolve('dist', file) })
      }
    }
    if (plan.signed && platform === 'macOS') {
      const app = path.resolve('dist', arch === 'arm64' ? 'mac-arm64' : 'mac', 'MGT Business Suite.app')
      run('codesign', ['--verify', '--deep', '--strict', app], env)
      const signature = run('codesign', ['--display', '--verbose=4', app], env, true)
      if (!signature.includes('Authority=Developer ID Application:')) throw Error('Expected a Developer ID Application signature')
      run('xcrun', ['stapler', 'validate', app], env)
      run('spctl', ['--assess', '--type', 'execute', '--verbose=2', app], env)
    }
    const manifest = { platform, arch, ...plan, source: process.env.GITHUB_SHA || null, verified: plan.signed }
    fs.writeFileSync(path.join('dist', `SIGNING-${platform}-${arch}.json`), JSON.stringify(manifest, null, 2) + '\n')
    console.log(`${platform} ${arch}: ${plan.status}`)
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }
}

module.exports = { signingPlan }
if (require.main === module) build(process.argv[2], process.argv[3])
