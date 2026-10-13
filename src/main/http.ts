export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public body = ''
  ) {
    super(message)
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

interface Opts {
  method?: string
  headers?: Record<string, string>
  body?: unknown
  form?: Record<string, string>
  timeoutMs?: number
  retries?: number
}

/** JSON fetch with timeout and backoff on 429/5xx. Throws HttpError; never returns partial data. */
export async function fetchJson<T>(url: string, opts: Opts = {}): Promise<T> {
  const { method = 'GET', timeoutMs = 20000, retries = 2 } = opts
  const host = new URL(url).host
  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const headers: Record<string, string> = { accept: 'application/json', ...opts.headers }
      let body: string | undefined
      if (opts.form) {
        headers['content-type'] = 'application/x-www-form-urlencoded'
        body = new URLSearchParams(opts.form).toString()
      } else if (opts.body !== undefined) {
        headers['content-type'] = 'application/json'
        body = JSON.stringify(opts.body)
      }
      const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) })
      if (res.ok) return (await res.json()) as T
      const text = await res.text().catch(() => '')
      const err = new HttpError(`${host} responded ${res.status}`, res.status, text.slice(0, 600))
      if (res.status !== 429 && res.status < 500) throw err
      lastErr = err
      const retryAfter = Number(res.headers.get('retry-after'))
      await sleep(Math.min(retryAfter > 0 ? retryAfter * 1000 : 900 * 2 ** attempt, 8000))
    } catch (e) {
      if (e instanceof HttpError && e.status !== 429 && e.status < 500) throw e
      lastErr = e instanceof HttpError ? e : new Error(`${host}: ${describe(e)}`)
      if (attempt < retries) await sleep(600 * 2 ** attempt)
    }
  }
  throw lastErr
}

function describe(e: unknown): string {
  const err = e as Error & { cause?: { code?: string } }
  if (err?.name === 'TimeoutError') return 'request timed out'
  if (err?.cause?.code) return `network error (${err.cause.code})`
  return err?.message ?? 'network error'
}

/** Serialises calls with a minimum gap, to stay under a provider's rate limit. */
export function limiter(minGapMs: number): <T>(fn: () => Promise<T>, urgent?: boolean) => Promise<T> {
  const queue: (() => Promise<void>)[] = []
  let busy = false
  let last = 0
  const pump = async (): Promise<void> => {
    if (busy) return
    busy = true
    while (queue.length) {
      const job = queue.shift()!
      const wait = last + minGapMs - Date.now()
      if (wait > 0) await sleep(wait)
      last = Date.now()
      await job()
    }
    busy = false
  }
  // Urgent calls (something the user is looking at) jump ahead of background work.
  return <T>(fn: () => Promise<T>, urgent = false): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const job = (): Promise<void> => fn().then(resolve, reject)
      if (urgent) queue.unshift(job)
      else queue.push(job)
      void pump()
    })
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))
