// Collects the licences of every package that ends up inside the shipped app (the
// libraries bundled into the interface, the Phantom connect page and the main process)
// and writes build/THIRD-PARTY-NOTICES.txt, which the installer ships.
// Run: node scripts/licenses.mjs
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const nm = join(root, 'node_modules')

// Packages whose code or assets are bundled into what users install.
const ROOTS = ['react', 'react-dom', 'zustand', 'motion', 'qrcode', 'lucide-react', '@fontsource-variable/inter', '@fontsource-variable/space-grotesk', '@solana/web3.js', '@solana/wallet-adapter-base', '@solana/wallet-adapter-phantom', 'buffer', 'tweetnacl', 'electron']

const seen = new Map()
function visit(name, from) {
  // Resolve like Node does: nearest node_modules first, then the top level.
  const candidates = [from && join(from, 'node_modules', name), join(nm, name)].filter(Boolean)
  const dir = candidates.find((d) => existsSync(join(d, 'package.json')))
  if (!dir) return
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const key = `${pkg.name}@${pkg.version}`
  if (seen.has(key)) return
  const file = readdirSync(dir).find((f) => /^(licen[sc]e|copying|ofl)(\.|$)/i.test(f))
  const license = typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? (pkg.licenses ?? []).map((l) => l.type).join(' OR ') ?? '')
  seen.set(key, { name: pkg.name, version: pkg.version, license: license || 'UNKNOWN', text: file ? readFileSync(join(dir, file), 'utf8').trim() : '', homepage: pkg.homepage ?? pkg.repository?.url ?? '' })
  if (name === 'electron') return // its own dependencies are install-time tooling, not shipped
  for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) visit(dep, dir)
  // Peer dependencies that are actually installed are bundled too (for example react for react-dom).
  for (const dep of Object.keys(pkg.peerDependencies ?? {})) visit(dep, dir)
}
for (const r of ROOTS) visit(r, null)

const list = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
const byLicense = {}
for (const p of list) (byLicense[p.license] ??= []).push(p.name)

const head = [
  'THIRD-PARTY NOTICES',
  '',
  'Bagscope includes the open-source software and fonts listed below. Each is used under',
  'its own licence, reproduced here as its authors require. Bagscope also runs on Electron',
  'and Chromium; their notices are in the LICENSE and LICENSES.chromium.html files in the',
  'installation folder.',
  '',
  `Packages: ${list.length}`,
  ...Object.entries(byLicense).sort().map(([l, n]) => `  ${l}: ${n.length}`),
  '',
  '='.repeat(78),
  ''
]
const body = list.flatMap((p) => [`${p.name} ${p.version}`, `Licence: ${p.license}`, p.homepage ? `Source: ${p.homepage}` : '', '', p.text || '(No licence file in the package; see the licence identifier above.)', '', '-'.repeat(78), ''])
writeFileSync(join(root, 'build', 'THIRD-PARTY-NOTICES.txt'), [...head, ...body].join('\r\n'))

console.log(`packages: ${list.length}`)
for (const [l, n] of Object.entries(byLicense).sort()) console.log(`  ${l.padEnd(28)} ${n.length}`)
const risky = list.filter((p) => /GPL|AGPL|LGPL|CC-BY-NC|SSPL|UNKNOWN|UNLICENSED|BUSL/i.test(p.license))
console.log(risky.length ? `needs a look: ${risky.map((p) => `${p.name} (${p.license})`).join(', ')}` : 'no copyleft, non-commercial or unknown licences found')
console.log(`without a licence file: ${list.filter((p) => !p.text).map((p) => p.name).join(', ') || 'none'}`)
