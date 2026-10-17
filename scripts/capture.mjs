// Headless capture: screenshots + video + drag fps. Needs the dev server running.
//   npm run dev            (default port 8765, override with PORT=xxxx)
//   node capture.mjs       (or URL=http://localhost:xxxx node capture.mjs)
import { chromium } from 'playwright'
const URL = process.env.URL || `http://localhost:${process.env.PORT || 8765}`
const out = process.env.OUT || 'captures'
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1.5,
  recordVideo: { dir: out, size: { width: 1440, height: 860 } } })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('pageerror:', e.message))
page.on('console', (m) => m.type() === 'error' && console.log('console error:', m.text()))
await page.goto(URL); await page.evaluate(() => localStorage.clear()); await page.reload()
await page.waitForTimeout(700)
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` })
const ratio = () => page.evaluate(() => { const e = document.querySelector('.editor'); return +(e.getBoundingClientRect().width / document.querySelector('.fill[data-split-view]').clientWidth).toFixed(4) })
const sepBox = async (id) => page.locator(`[aria-label="${id === 'inner' ? 'Resize editor and preview' : 'Resize sidebar'}"]`).boundingBox()
const g = await page.locator('.fill[data-split-view]').boundingBox()
const X = (r) => g.x + g.width * r
const cy = 420

await shot('01-initial')
let b = await sepBox('inner'); const cx = b.x + b.width / 2
await page.mouse.move(cx - 120, cy); await page.mouse.move(cx, cy, { steps: 6 })
await page.waitForTimeout(60); await shot('02a-hover-before-delay')
await page.waitForTimeout(400); await shot('02b-hover-after-150ms')

// FPS probe during a long drag with 480 cards
await page.evaluate(() => { window.__f = []; const loop = (t) => { window.__f.push(t); window.__raf = requestAnimationFrame(loop) }; window.__raf = requestAnimationFrame(loop) })
await page.mouse.down()
for (let i = 0; i <= 120; i++) { await page.mouse.move(cx - Math.sin(i / 120 * Math.PI) * 420, cy) }
const fps = await page.evaluate(() => { cancelAnimationFrame(window.__raf); const f = window.__f; const d = f.slice(1).map((t, i) => t - f[i]); const avg = (f.at(-1) - f[0]) / d.length; return { frames: d.length, avgMs: +avg.toFixed(2), fps: +(1000 / avg).toFixed(1), worstMs: +Math.max(...d).toFixed(1), over20ms: d.filter((x) => x > 20).length } })
console.log('drag fps', JSON.stringify(fps))

// Magnet: approach 25% and sit 9px past it
for (const r of [0.42, 0.33, 0.27]) await page.mouse.move(X(r), cy, { steps: 10 })
await page.mouse.move(X(0.25) + 9, cy, { steps: 6 }); await page.waitForTimeout(60)
await shot('03-magnet-engaged-25')
console.log('pointer at 25%+9px -> editor ratio', await ratio())
// Free spot: 40% (outside every zone)
await page.mouse.move(X(0.4), cy, { steps: 14 }); await page.waitForTimeout(80)
await shot('04-dragging-free-40')
await page.mouse.up(); await page.waitForTimeout(600)
console.log('released at 40% -> stays at', await ratio())
await shot('05-released-stays-40')

// Release inside zone near 75% -> spring settle, sample overshoot
b = await sepBox('inner'); await page.mouse.move(b.x + b.width / 2, cy); await page.mouse.down()
await page.mouse.move(X(0.75) + 18, cy, { steps: 30 })
const samples = []
await page.mouse.up()
for (let i = 0; i < 24; i++) { samples.push(await ratio()); await page.waitForTimeout(16) }
console.log('settle samples toward 0.75', samples.join(' '))
await shot('06-settled-75')

// Double-click reset (spring) and keyboard
b = await sepBox('inner'); await page.mouse.dblclick(b.x + b.width / 2, cy); await page.waitForTimeout(120)
await shot('07-dblclick-resetting'); await page.waitForTimeout(500)
console.log('after dblclick', await ratio())
await page.locator('[aria-label="Resize editor and preview"]').focus(); await page.keyboard.press('Shift+ArrowRight'); await page.waitForTimeout(80)
await shot('08-keyboard-animating'); await page.waitForTimeout(500)
console.log('after Shift+→', await ratio())

// Sidebar: drag past threshold to collapse (springs shut mid-drag)
b = await sepBox('sidebar'); const sx = b.x + b.width / 2
await page.mouse.move(sx, cy); await page.mouse.down()
await page.mouse.move(sx - 60, cy, { steps: 8 }); await page.mouse.move(70, cy, { steps: 6 }); await page.waitForTimeout(90)
await shot('09-drag-collapsing')
await page.mouse.move(40, cy, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(500)
const sbw = () => page.evaluate(() => document.querySelector('.sidebar').parentElement.getBoundingClientRect().width)
console.log('sidebar after drag-collapse', await sbw())
// Hover collapsed edge -> tab, then click to expand (remembers 256)
await page.mouse.move(6, 300); await page.waitForTimeout(400); await shot('10-collapsed-edge-hover')
await page.mouse.click(6, 300); await page.waitForTimeout(120); await shot('11-expanding')
await page.waitForTimeout(600); console.log('sidebar after edge click', await sbw())
// Ctrl+B collapse, then drag out from edge
await page.keyboard.press('Control+b'); await page.waitForTimeout(600)
await page.mouse.move(6, cy); await page.mouse.down(); await page.mouse.move(150, cy, { steps: 10 }); await page.mouse.move(300, cy, { steps: 10 }); await page.mouse.up()
await page.waitForTimeout(600); console.log('sidebar after drag-out', await sbw())
await shot('12-final')
await ctx.close(); await browser.close()
