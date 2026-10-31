import { Plugin } from "@opencode/plugin/tui"
import { jsx } from "@opentui/solid/jsx-runtime"
import { appendFileSync } from "node:fs"

// debug sink, written when the toggle flag is on
const DEBUG_LOG = `${process.env.HOME}/.cache/opencode/go-usage-debug.log`

type Window = { percent?: number, resetsAt?: number, limited?: boolean }

// Burn-rate history: one sample per poll with all three windows; 6h cap.
type Sample = { t: number, p: number[] }

// Humanize milliseconds to a compact duration like 4h or 2d.
function human(ms: number): string {
  if (ms < 0) return "now"
  const h = ms / 3.6e6
  if (h >= 48) return `${Math.round(h / 24)}d`
  if (h >= 1) return `${Math.round(h)}h`
  return `${Math.max(1, Math.round(ms / 6e4))}m`
}

// "⚠eta/reset" when the window's own burn slope hits 100% before its reset,
// "" otherwise. Resets appear as drops, so analysis starts after the last one.
function pace(samples: { t: number, p: number }[], resetsAt: number | undefined, now: number): string {
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

export default Plugin.define({
  id: "go-usage",
  setup(context) {
    // windows: go rolling/weekly/monthly; ok=false -> "GO ?"
    const [state, update] = context.storage.memory("go-usage", {
      initial: { windows: [] as Window[], ok: true, samples: [] as Sample[], dbg: false },
    })
    const dbg = (msg: string) => {
      if (!state.dbg) return
      try { appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${msg}\n`) } catch {}
    }

    // feature-detect: client.experimental.usage.limits, older client.usage.limits
    const anyClient = context.client as any
    const call = anyClient?.experimental?.usage?.limits ?? anyClient?.usage?.limits

    const refresh = async () => {
      if (!call) { update((d) => { d.ok = false }); dbg("client method missing"); return }
      try {
        const res = await call()
        dbg(`raw: ${JSON.stringify(res)?.slice(0, 300) ?? String(res)}`)
        const data = res?.data ?? res
        const go = data?.go
        if (!go) throw new Error("no go data")
        const pick = (w: unknown) => (w ?? {}) as Window
        update((d) => {
          d.ok = true
          d.windows = [pick(go.rolling), pick(go.weekly), pick(go.monthly)]
          // memory store predating samples (hot reload) and fetch errors both land here
          d.samples = (d.samples ?? []).concat({ t: Date.now(), p: d.windows.map((w: Window) => Math.round(w.percent ?? 0)) })
          const cutoff = Date.now() - 6 * 3.6e6
          d.samples = d.samples.filter((s: Sample) => s.t > cutoff).slice(-400)
        })
      }
      catch (e) {
        dbg(`error: ${e instanceof Error ? e.stack : String(e)}`)
        update((d) => {
          d.ok = false
        })
      }
    }
    refresh()
    // a fetch that hangs must not blank the status bar forever
    const failTimer = setTimeout(() => {
      if (state.windows.length === 0) update((d) => { d.ok = false })
    }, 10_000)
    const timer = setInterval(refresh, 60_000)

    // no JSX syntax: OpenCode's solid transform skips node_modules, and Bun's
    // default JSX would import react, so call the solid runtime directly.
    const render = () => {
      if (!state.ok)
        return jsx("text", { fg: context.theme.text.muted, children: "GO ?" })
      if (state.windows.length === 0)
        return jsx("text", { fg: context.theme.text.muted, children: "GO ⋯" })
      const parts = state.windows.map((w: Window, i: number) => {
        const pct = Math.round(w.percent ?? 0)
        // glyph prefix stands in for color: ! = rate-limited, ▲ = nearly spent
        const mark = w.limited ? "!" : pct >= 85 ? "▲" : ""
        const reset = w.limited ? `→${human((w.resetsAt ?? 0) - Date.now())}` : ""
        const warn = pace(state.samples.map((s: Sample) => ({ t: s.t, p: s.p[i] ?? 0 })), w.resetsAt, Date.now())
        return `${mark}${["r", "w", "m"][i]}${pct}%${reset}${warn}`
      })
      return jsx("text", { fg: context.theme.text.muted, children: `GO ${parts.join(" · ")}` })
    }

    context.ui.slot({ append: "prompt.footer.status", render })
    context.ui.slot({ append: "home.footer.status", render })
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "go-usage.debug",
          title: "go-usage: toggle debug logging",
          group: "go-usage",
          palette: true,
          slash: { name: "go-usage-debug" },
          run() {
            update((d) => { d.dbg = !d.dbg })
            const on = state.dbg
            dbg(`debug toggled ${on ? "on" : "off"}`)
            context.ui.toast.show({ title: "go-usage", message: `debug ${on ? "on → " + DEBUG_LOG : "off"}`, duration: 4000 })
          },
        },
      ],
      bindings: ["go-usage.debug"],
    }))
    return () => { clearInterval(timer); clearTimeout(failTimer) }
  },
})
