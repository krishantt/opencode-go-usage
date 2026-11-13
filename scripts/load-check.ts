// Runtime-parity check: loads the plugin the way OpenCode does (Bun, from a
// node_modules path) and runs setup() against stubs. Catches load/transform
// regressions that only appear in npm installs, such as the react JSX crash.
import { cp, mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const pkg = join(root, "node_modules", ".load-check", "@krishantt", "opencode-go-usage")
const files = ["package.json", "index.ts", "tui.tsx", "usage.ts"]

await mkdir(pkg, { recursive: true })
for (const f of files) await cp(join(root, f), join(pkg, f))

try {
  const mod = await import(pathToFileURL(join(pkg, "tui.tsx")).href)
  const plugin = mod.default?.setup ? mod.default : mod.default?.plugin
  if (typeof plugin?.setup !== "function") throw new Error("tui.tsx did not export a plugin with setup()")

  const now = Date.now()
  const state = { windows: [], mode: "loading", samples: [], dbg: false }
  const renders: unknown[] = []
  const ctx = {
    storage: {
      memory: (_name: string, { initial }: { initial: object }) => {
        Object.assign(state, initial)
        return [state, (fn: (d: typeof state) => void) => fn(state)]
      },
    },
    client: {
      experimental: {
        usage: {
          limits: async () => ({
            data: {
              go: {
                rolling: { percent: 4, limited: false, resetsAt: now + 5 * 3.6e6 },
                weekly: { percent: 42, limited: false, resetsAt: now + 48 * 3.6e6 },
                monthly: { percent: 21, limited: false, resetsAt: now + 18 * 864e5 },
              },
            },
          }),
        },
      },
    },
    ui: { slot: ({ render }: { render: unknown }) => renders.push(render), toast: { show() {} } },
    keymap: { layer() {} },
    theme: { text: { muted: "gray" } },
  }

  const dispose = plugin.setup(ctx)
  await new Promise((resolve) => setTimeout(resolve, 50))

  if (renders.length !== 2) throw new Error(`expected 2 status slots, got ${renders.length}`)
  if (state.mode !== "ok") throw new Error(`expected mode ok, got ${state.mode}`)
  if (state.windows.length !== 3) throw new Error("windows were not populated from the envelope")
  const percents = state.windows.map((w: { percent: number }) => w.percent).join(",")
  if (percents !== "4,42,21") throw new Error(`unexpected percents: ${percents}`)

  dispose()

  // the API-key-only shape: 200 with data:null must read as signed-out, not failed
  const disposeOut = plugin.setup({
    ...ctx,
    client: { experimental: { usage: { limits: async () => ({ location: {}, data: null }) } } },
  })
  await new Promise((resolve) => setTimeout(resolve, 50))
  if ((state.mode as string) !== "out") throw new Error(`expected mode out for data:null, got ${state.mode}`)
  disposeOut()

  console.log(`bun load check: ok (r4, w42, m21; data:null -> out)`)
} finally {
  await rm(join(root, "node_modules", ".load-check"), { recursive: true, force: true })
}
