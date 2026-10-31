import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { human, pace } from "./usage.ts"

const H = 3.6e6
const now = 1_700_000_000_000

test("human formats compact durations", () => {
  assert.equal(human(-1), "now")
  assert.equal(human(30_000), "1m")
  assert.equal(human(H), "1h")
  assert.equal(human(48 * H), "2d")
  assert.equal(human(90 * 6e4), "2h")
})

test("pace needs history", () => {
  assert.equal(pace([], now, now), "")
  assert.equal(pace([{ t: now, p: 50 }], now + H, now), "")
  // under 10 minutes of samples is too noisy to project
  assert.equal(pace([{ t: now - 5 * 6e4, p: 10 }, { t: now, p: 20 }], now + H, now), "")
})

test("pace stays silent when the window lasts until reset", () => {
  const s = [{ t: now - 2 * H, p: 10 }, { t: now, p: 12 }] // 1%/h, 88 left -> 88h
  assert.equal(pace(s, now + 5 * H, now), "")
})

test("pace warns when exhaustion precedes reset", () => {
  const s = [{ t: now - 10 * H, p: 40 }, { t: now, p: 70 }] // 3%/h -> 10h left
  assert.equal(pace(s, now + 48 * H, now), " ⚠10h/2d")
})

test("pace ignores flat or falling usage", () => {
  assert.equal(pace([{ t: now - 2 * H, p: 50 }, { t: now, p: 50 }], now + H, now), "")
})

test("pace restarts the slope after a reset drop", () => {
  const s = [
    { t: now - 4 * H, p: 80 }, // previous cycle
    { t: now - 2 * H, p: 5 },  // reset
    { t: now - H, p: 25 },
    { t: now, p: 45 },         // 20%/h -> 2.75h left, reset in 3h
  ]
  assert.equal(pace(s, now + 3 * H, now), " ⚠3h/3h")
})

test("pace stays silent without a known reset time", () => {
  const s = [{ t: now - 10 * H, p: 40 }, { t: now, p: 70 }]
  assert.equal(pace(s, undefined, now), "")
})

// Regression guard: JSX here would be compiled by Bun's default react runtime
// for npm installs (OpenCode's solid transform skips node_modules).
test("tui.tsx contains no JSX and no react import", () => {
  const src = readFileSync(new URL("./tui.tsx", import.meta.url), "utf8")
  assert.doesNotMatch(src, /<(text|box|span)[\s>]/)
  assert.doesNotMatch(src, /from\s+["']react["']/)
  assert.match(src, /@opentui\/solid\/jsx-runtime/)
})
