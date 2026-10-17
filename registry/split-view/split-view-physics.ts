/**
 * Physics layer for <SplitView>, on top of motion-panels' core.
 *
 * motion-panels owns sizing, constraints, overshoot, keyboard, a11y and the
 * collapse state. It does not let you configure *how* things move (its settle
 * is a fixed tween) and has no snap points. We take the panel controller the
 * separator registered (via the exported, undocumented `grips` registry, so
 * motion-panels is pinned to 0.6.x) and wrap its drag session:
 *
 *  - magnet: soft resistance curve around snap points (no jumps, no jitter)
 *  - release: snap only if released inside the magnet zone, else stay put
 *  - settle: every non-drag size change (release, double-click, keyboard,
 *    collapse toggle) is re-driven by a real spring that keeps velocity
 *  - collapse while dragging: crossing the threshold springs shut/open
 *    instead of jumping, then hands control back to the pointer seamlessly
 *
 * Everything runs on MotionValues; React does not re-render during a drag.
 */
import { animate, type AnimationPlaybackControls, type Transition } from "motion"
import { grips, reducedMotion, type PanelController } from "motion-panels"

export interface MagnetConfig {
  /** Separator positions as fractions of the group extent, from the group start. */
  points: number[]
  /** Pull radius in px (each side). */
  zone: number
  /** 0 = no resistance, 1 = fully sticky centre. */
  strength: number
  /** Extent (px) of the group the fractions refer to. */
  extent: () => number
}

export interface DragFrame {
  /** Panel size in px. */
  size: number
  /** Separator position as a fraction of the group extent. */
  ratio: number
  /** Separator position in px from the group start. */
  position: number
  /** Snap point currently engaged (with hysteresis), or null. */
  active: number | null
  /** True on the frame the magnet engaged a point (for a visual tick). */
  entered: boolean
  limit: "min" | "max" | "collapsed" | null
}

export interface PhysicsOptions {
  id: string
  axis: "x" | "y"
  settle: Transition
  collapse: Transition
  /** Used to chase the pointer after a collapse/expand jump mid-drag. */
  follow: Transition
  /** Collapse when dragged below `minSize * collapseThreshold` (0..1). */
  collapseThreshold: number
  magnet?: MagnetConfig
  onStart?: () => void
  onFrame?: (frame: DragFrame) => void
  onEnd?: () => void
}

export interface PanelPhysics {
  /** Set synchronously while motion-panels reports the release size. */
  release: {
    pending: boolean
    inZone: boolean
    /** Snapped panel size as a fraction of the group extent. */
    fraction: number
  }
  dispose: () => void
}

const instant = { duration: 0 }
const t = (tr: Transition) => (reducedMotion.get() ? instant : tr)

export function controllerFor(separator: Element | null): PanelController | undefined {
  return separator ? grips.partners([separator as HTMLElement], null)[0] : undefined
}

export function attachPhysics(c: PanelController, opts: PhysicsOptions): PanelPhysics {
  const { size, content } = c.motion
  const drag = c.drag
  const orig = { start: drag.start, move: drag.move, end: drag.end, cancel: drag.cancel }
  const root = document.documentElement
  const release = { pending: false, inZone: false, fraction: 0 }

  let start = 0
  let min = 0
  let max = Infinity
  let points: number[] = []
  let shut = false // collapsed state as seen by our drag session
  let chasing = false
  let active: number | null = null
  let inZone = false
  let nearest = 0
  let settleAnim: AnimationPlaybackControls | null = null
  let intended = 0 // where the pointer wants the panel (chase target)
  let carry: number | null = null // velocity handed from a chase into the settle

  // state.end === true means the panel sits *before* the fill panel.
  const before = () => !!c.state.end
  const sign = () => (before() ? 1 : -1)
  const extent = () => opts.magnet?.extent() ?? 1
  /** Panel size (px) <-> separator position (px from the group start). */
  const toPos = (s: number) => (before() ? s : extent() - s)
  const fromPos = (p: number) => (before() ? p : extent() - p)

  /** Re-drive any pending size change with a spring (keeps current velocity). */
  const springToTarget = () => {
    if (c.state.dragging) return
    const to = c.target
    const from = size.get()
    if (Math.abs(from - to) < 0.5) return
    const tr = t(from === 0 || to === 0 ? opts.collapse : opts.settle)
    const velocity = carry ?? size.getVelocity()
    carry = null
    settleAnim = animate(size, to, { ...tr, velocity } as Transition)
    if (from > 0 && to > 0) animate(content, to, tr)
  }
  const unsubscribe = c.subscribe(() => queueMicrotask(springToTarget))

  const frame: DragFrame = { size: 0, ratio: 0, position: 0, active: null, entered: false, limit: null }

  const magnetize = (raw: number): number => {
    const m = opts.magnet
    if (!m || points.length === 0) return raw
    const E = extent()
    const pos = toPos(raw)
    let d = Infinity
    for (const p of points) {
      const dd = pos - p * E
      if (Math.abs(dd) < Math.abs(d)) {
        d = dd
        nearest = p
      }
    }
    const ad = Math.abs(d)
    inZone = ad < m.zone
    // Hysteresis: engage at 42% of the zone, let go at 65%.
    let entered = false
    if (active !== null && (active !== nearest || ad > m.zone * 0.65)) active = null
    if (active === null && ad < m.zone * 0.42) {
      active = nearest
      entered = true
    }
    let out = pos
    if (inZone) {
      // g(0)=0, g'(0)=1-s (resistance), g(1)=1, g'(1)=1 (seamless exit)
      const x = ad / m.zone
      const g = x + m.strength * (x * x * (2 - x) - x)
      out = nearest * E + Math.sign(d) * g * m.zone
    }
    frame.active = active
    frame.entered = entered
    return fromPos(out)
  }

  const emit = () => {
    const s = size.get()
    const E = extent()
    frame.size = s
    frame.position = toPos(s)
    frame.ratio = frame.position / E
    frame.limit = shut ? "collapsed" : s <= min + 0.5 ? "min" : s >= max - 0.5 ? "max" : null
    root.dataset.splitViewLimit = frame.limit ?? ""
    opts.onFrame?.(frame)
    frame.entered = false
  }

  drag.start = (cursor) => {
    settleAnim?.stop()
    start = size.get()
    ;({ min, max } = c.bounds())
    const E = extent()
    // Only snap to points the panel can actually reach.
    points = (opts.magnet?.points ?? []).filter((p) => {
      const s = fromPos(p * E)
      return s >= min - 0.5 && s <= max + 0.5
    })
    shut = !!c.options.collapsed
    chasing = false
    active = null
    inZone = false
    root.classList.add("split-view-resizing")
    root.dataset.splitViewAxis = opts.axis
    root.dataset.splitViewSide = before() ? "start" : "end"
    opts.onStart?.()
    orig.start(cursor)
  }

  drag.move = (offset) => {
    const s = sign()
    const raw = start + offset[opts.axis] * s
    const px = shut ? raw : magnetize(raw)
    const wantShut = !!c.options.onCollapsedChange && px < min * opts.collapseThreshold

    // Already shut and staying shut: leave the spring alone.
    if (wantShut && shut) return emit()

    // motion-panels collapses at min/2; steer it to our own threshold.
    const half = min / 2
    const fed = wantShut ? Math.min(px, half - 1) : Math.max(px, half)

    const prev = size.get()
    const v = size.getVelocity()
    const delta = (fed - start) * s
    orig.move(opts.axis === "x" ? { x: delta, y: offset.y } : { x: offset.x, y: delta })
    const next = size.get()
    intended = next

    if (wantShut !== shut) {
      shut = wantShut
      chasing = true
    }
    if (chasing) {
      if (Math.abs(prev - next) < 1.5 && Math.abs(v) < 60) chasing = false
      else {
        size.jump(prev)
        animate(size, next, { ...t(shut ? opts.collapse : opts.follow), velocity: v } as Transition)
      }
    }
    emit()
  }

  const finish = () => {
    root.classList.remove("split-view-resizing")
    delete root.dataset.splitViewLimit
    delete root.dataset.splitViewAxis
    delete root.dataset.splitViewSide
    chasing = false
    active = null
    opts.onFrame?.({ ...frame, active: null, entered: false })
    opts.onEnd?.()
  }

  drag.end = () => {
    release.pending = true
    release.inZone = !!opts.magnet && inZone && !shut
    release.fraction = before() ? nearest : 1 - nearest
    // If a chase spring is still catching up, report where the pointer *is*,
    // then put the visual back and let the settle spring continue from there.
    const lagging = chasing && !shut
    const shown = size.get()
    if (lagging) {
      carry = size.getVelocity()
      size.jump(intended)
    }
    orig.end()
    if (lagging) size.jump(shown)
    release.pending = false
    finish()
    // After React flushes the new size into the controller, spring to it.
    queueMicrotask(() => queueMicrotask(springToTarget))
  }

  drag.cancel = () => {
    orig.cancel()
    finish()
  }

  return {
    release,
    dispose: () => {
      Object.assign(drag, orig)
      unsubscribe()
      if (root.classList.contains("split-view-resizing")) finish()
    },
  }
}
