const fs = require('node:fs')
const path = require('node:path')

const directory = process.argv[2] || 'release-assets'
const expected = [['Windows', 'x64'], ['Linux', 'x64'], ['macOS', 'arm64'], ['macOS', 'x64']]
const lines = ['Desktop signing verified during this build:', '', '| Package | Signing status |', '| --- | --- |']
for (const [platform, arch] of expected) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, `SIGNING-${platform}-${arch}.json`), 'utf8'))
  if (manifest.platform !== platform || manifest.arch !== arch || manifest.source !== process.env.GITHUB_SHA) throw Error('Signing manifest does not match this release')
  if (manifest.signed && (!manifest.verified || (platform === 'macOS' && !manifest.notarized))) throw Error('Signed package did not pass signature verification')
  lines.push(`| ${platform} ${arch} | ${manifest.status} |`)
}
fs.writeFileSync(path.join(directory, 'SIGNING.md'), lines.join('\n') + '\n')
