export type Window = { percent?: number, resetsAt?: number, limited?: boolean }

// Burn-rate history: one sample per poll with all three windows; 6h cap.
export type Sample = { t: number, p: number[] }

// "out" = signed in nowhere, "err" = fetch or payload problem; both look the
// same to the endpoint (200) but mean different things to the user.
export type Mode = "loading" | "ok" | "out" | "err"

// Envelope: { location, data: { go } }, data null when the location is not
// signed in to a Console workspace. Older clients return the payload bare.
export function parse(res: unknown): { windows: Window[] } | "out" | "err" {
  if (res == null) return "err"
  const env = res as { data?: unknown }
  const data = "data" in env ? env.data : res
  if (data == null) return "out"
  const go = (data as { go?: Record<string, unknown> }).go
  if (!go?.rolling) return "err"
  const pick = (w: unknown) => (w ?? {}) as Window
  return { windows: [pick(go.rolling), pick(go.weekly), pick(go.monthly)] }
}

// Humanize milliseconds to a compact duration like 4h or 2d.
export function human(ms: number): string {
  if (ms < 0) return "now"
  const h = ms / 3.6e6
  if (h >= 48) return `${Math.round(h / 24)}d`
  if (h >= 1) return `${Math.round(h)}h`
  return `${Math.max(1, Math.round(ms / 6e4))}m`
}

// "⚠eta/reset" when the window's own burn slope hits 100% before its reset,
// "" otherwise. Resets appear as drops, so analysis starts after the last one.
export function pace(samples: { t: number, p: number }[], resetsAt: number | undefined, now: number): string {
  if (samples.length < 2) return ""
  let start = 0
  for (let i = 1; i < samples.length; i++)
    if (samples[i]!.p < samples[i - 1]!.p) start = i
  const run = samples.slice(start)
  const first = run[0]!
  const last = run[run.length - 1]!
  const mins = (last.t - first.t) / 6e4
  if (mins < 10) return ""
  const perMin = (last.p - first.p) / mins
  if (perMin <= 0) return ""
  const etaMin = (100 - last.p) / perMin
  const remainMin = ((resetsAt ?? 0) - now) / 6e4
  if (etaMin <= 0 || etaMin >= remainMin) return ""
  return ` ⚠${human(etaMin * 6e4)}/${human(remainMin * 6e4)}`
}
