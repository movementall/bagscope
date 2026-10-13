// Development test: plays the role of the Phantom mobile app against Bagscope's phone
// connect flow, following Phantom's documented deep-link protocol.
// Usage: node scripts/sim-phantom.mjs "<connect deeplink from the QR>"
import nacl from 'tweetnacl'

const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
function enc(buf) {
  const d = [0]
  for (const byte of buf) {
    let c = byte
    for (let i = 0; i < d.length; i++) { c += d[i] << 8; d[i] = c % 58; c = (c / 58) | 0 }
    while (c > 0) { d.push(c % 58); c = (c / 58) | 0 }
  }
  let out = ''
  for (const byte of buf) { if (byte !== 0) break; out += '1' }
  for (let i = d.length - 1; i >= 0; i--) out += A[d[i]]
  return out
}
function dec(s) {
  const b = [0]
  for (const ch of s) {
    let c = A.indexOf(ch)
    for (let i = 0; i < b.length; i++) { c += b[i] * 58; b[i] = c & 0xff; c >>= 8 }
    while (c > 0) { b.push(c & 0xff); c >>= 8 }
  }
  for (const ch of s) { if (ch !== '1') break; b.push(0) }
  return Uint8Array.from(b.reverse())
}
const title = (html) => /<h1[^>]*>(.*?)<\/h1>/.exec(html)?.[1] ?? '(no title)'
const unescape = (s) => s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))

const link = new URL(process.argv[2])
const dappPub = dec(link.searchParams.get('dapp_encryption_public_key'))
const redirect = link.searchParams.get('redirect_link')
console.log('connect link ok:', link.pathname, '| redirect', redirect.replace(/\/[0-9a-f]{20,}/, '/<token>'))

const phantom = nacl.box.keyPair()
const wallet = nacl.sign.keyPair()
const address = enc(wallet.publicKey)
const shared = nacl.box.before(dappPub, phantom.secretKey)
const seal = (obj) => {
  const nonce = nacl.randomBytes(24)
  return { nonce: enc(nonce), data: enc(nacl.box.after(Buffer.from(JSON.stringify(obj)), nonce, shared)) }
}

// 1. user approves the connection
const c = seal({ public_key: address, session: 'test-session' })
let html = await (await fetch(`${redirect}?${new URLSearchParams({ phantom_encryption_public_key: enc(phantom.publicKey), ...c })}`)).text()
console.log('1 connect  ->', title(html))

// 2. user taps "Verify ownership" and approves the message
const signHref = unescape(/href="([^"]*signMessage[^"]*)"/.exec(html)[1])
const sign = new URL(signHref)
const opened = nacl.box.open.after(dec(sign.searchParams.get('payload')), dec(sign.searchParams.get('nonce')), shared)
const req = JSON.parse(Buffer.from(opened).toString())
const message = dec(req.message)
console.log('  message shown to user:', JSON.stringify(Buffer.from(message).toString().split('\n')[0]), '| session echoed:', req.session === 'test-session')

// 2a. a forged signature must be refused
const forged = seal({ signature: enc(nacl.sign.detached(message, nacl.sign.keyPair().secretKey)) })
html = await (await fetch(`${sign.searchParams.get('redirect_link')}?${new URLSearchParams(forged)}`)).text()
console.log('2a forged signature ->', title(html), '|', /<p[^>]*>(.*?)<\/p>/.exec(html)?.[1])

// 2b. the real signature is accepted
const good = seal({ signature: enc(nacl.sign.detached(message, wallet.secretKey)) })
html = await (await fetch(`${sign.searchParams.get('redirect_link')}?${new URLSearchParams(good)}`)).text()
console.log('2b real signature   ->', title(html))

// 3. user rejects in Phantom
html = await (await fetch(`${redirect}?errorCode=4001&errorMessage=User+rejected+the+request.`)).text()
console.log('3 rejected ->', title(html))
console.log('ADDRESS', address)
