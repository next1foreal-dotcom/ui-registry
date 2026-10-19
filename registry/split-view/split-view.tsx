"use client"

import * as React from "react"
import type { Transition } from "motion"
import { Group, Panel, Separator, type Size } from "motion-panels/react"

import { cn } from "@/lib/utils"
import {
  attachPhysics,
  controllerFor,
  type DragFrame,
  type PanelPhysics,
  type PhysicsOptions,
} from "./split-view-physics"

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/** Pixels (`256`) or a percentage of the group (`"30%"`). */
export type SplitViewSize = Size

/** Any Motion spring option. `visualDuration` + `bounce` is the easiest pair. */
export interface SplitViewSpring {
  visualDuration?: number
  bounce?: number
  stiffness?: number
  damping?: number
  mass?: number
}

export interface SplitViewApi {
  collapse: (index: number) => void
  expand: (index: number) => void
  toggle: (index: number) => void
  /** Spring every pane back to its default size and expand collapsed panes. */
  reset: () => void
  getSizes: () => (SplitViewSize | null)[]
  getCollapsed: () => boolean[]
}

/**
 * Overrides used while the SplitView itself (its container, not the window) is
 * narrower than `below` px (shorter, when vertical). Sizes and collapsed state
 * are kept and persisted separately for the narrow layout.
 */
export interface SplitViewNarrow {
  below: number
  defaultSizes?: (SplitViewSize | undefined)[]
  minSizes?: (SplitViewSize | undefined)[]
  maxSizes?: (SplitViewSize | undefined)[]
  defaultCollapsed?: boolean[]
}

export interface SplitViewProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "children" | "onResize"> {
  /** Two or three panes. The pane at `fill` takes the remaining space. */
  children: React.ReactNode
  orientation?: "horizontal" | "vertical"
  /** Index of the flexible pane. Default `1` (`[sized, fill]` or `[sized, fill, sized]`). */
  fill?: number
  /** Per pane (by child index; the fill entry is ignored). Default `"50%"`, or `"25%"` with 3 panes. */
  defaultSizes?: (SplitViewSize | undefined)[]
  minSizes?: (SplitViewSize | undefined)[]
  maxSizes?: (SplitViewSize | undefined)[]
  /** `true` = every sized pane, or per pane. */
  collapsible?: boolean | boolean[]
  /** Collapse when dragged below `minSize * collapseThreshold`. Default `0.5`. */
  collapseThreshold?: number
  /** Controlled collapsed state, per pane. */
  collapsed?: boolean[]
  defaultCollapsed?: boolean[]
  onCollapsedChange?: (collapsed: boolean[]) => void
  /** Different sizes for small containers (phones), e.g. `{ below: 600, defaultSizes: ["45%"] }`. */
  narrow?: SplitViewNarrow
  /** Separator positions as fractions of the group, e.g. `[0.25, 0.5, 0.75]`. `[]` disables. */
  snapPoints?: number[]
  /** Magnet radius in px around each snap point. Default `30`. */
  magnetRange?: number
  /** 0 = no pull, 1 = very sticky. Default `0.78`. */
  magnetStrength?: number
  /** Settle spring after release / double-click / keyboard. */
  spring?: SplitViewSpring
  /** Spring used for collapsing and expanding. */
  collapseSpring?: SplitViewSpring
  /** Rubber-band past min/max, in px. Default `12`. */
  overshoot?: number | boolean
  /** Remember sizes + collapsed state in localStorage under `split-view:<key>`. */
  persistKey?: string
  /** Called when sizes commit (not on every drag frame). Fill pane is `null`. */
  onResize?: (sizes: (SplitViewSize | null)[]) => void
  /** Show dashed snap guides while dragging. Default `true` when there are snap points. */
  showGuides?: boolean
  /** Show the live percentage badge while dragging. Default same as `showGuides`. */
  showBadge?: boolean
  /** `aria-label` per handle (by the sized pane's index). */
  handleLabels?: (string | undefined)[]
  /** className per pane (by child index). */
  panelClassNames?: (string | undefined)[]
  handleClassName?: string
  /** Imperative API: collapse / expand / toggle / reset. */
  apiRef?: React.Ref<SplitViewApi>
}

/* -------------------------------------------------------------------------- */
/* Defaults (the "feel")                                                       */
/* -------------------------------------------------------------------------- */

const DEFAULT_SNAPS = [0.25, 0.5, 0.75]
const DEFAULT_SPRING: SplitViewSpring = { visualDuration: 0.32, bounce: 0.12 }
const DEFAULT_COLLAPSE_SPRING: SplitViewSpring = { visualDuration: 0.36, bounce: 0.06 }
const FOLLOW: Transition = { type: "spring", visualDuration: 0.16, bounce: 0 }

const toSpring = (s: SplitViewSpring): Transition => ({ type: "spring", ...s }) as Transition

/* -------------------------------------------------------------------------- */
/* Persistence                                                                 */
/* -------------------------------------------------------------------------- */

interface Stored {
  s: (SplitViewSize | null)[]
  c: boolean[]
}

const storage = {
  get(key: string | undefined, count: number): Stored | null {
    if (!key || typeof window === "undefined") return null
    try {
      const raw = window.localStorage.getItem(`split-view:${key}`)
      const v = raw ? (JSON.parse(raw) as Stored) : null
      return v && Array.isArray(v.s) && v.s.length === count && Array.isArray(v.c) ? v : null
    } catch {
      return null
    }
  },
  set(key: string | undefined, value: Stored) {
    if (!key || typeof window === "undefined") return
    try {
      window.localStorage.setItem(`split-view:${key}`, JSON.stringify(value))
    } catch {
      /* private mode / quota */
    }
  },
}

/* -------------------------------------------------------------------------- */
/* Global drag styles (cursor + no text selection), injected once              */
/* -------------------------------------------------------------------------- */

const GLOBAL_CSS = `
html.split-view-pressing,html.split-view-pressing *,html.split-view-resizing,html.split-view-resizing *{-webkit-user-select:none!important;user-select:none!important}
html.split-view-resizing[data-split-view-axis=x] *{cursor:col-resize!important}
html.split-view-resizing[data-split-view-axis=y] *{cursor:row-resize!important}
html.split-view-resizing[data-split-view-axis=x][data-split-view-side=start]:is([data-split-view-limit=min],[data-split-view-limit=collapsed]) *,html.split-view-resizing[data-split-view-axis=x][data-split-view-side=end][data-split-view-limit=max] *{cursor:e-resize!important}
html.split-view-resizing[data-split-view-axis=x][data-split-view-side=start][data-split-view-limit=max] *,html.split-view-resizing[data-split-view-axis=x][data-split-view-side=end]:is([data-split-view-limit=min],[data-split-view-limit=collapsed]) *{cursor:w-resize!important}
html.split-view-resizing[data-split-view-axis=y][data-split-view-side=start]:is([data-split-view-limit=min],[data-split-view-limit=collapsed]) *,html.split-view-resizing[data-split-view-axis=y][data-split-view-side=end][data-split-view-limit=max] *{cursor:s-resize!important}
html.split-view-resizing[data-split-view-axis=y][data-split-view-side=start][data-split-view-limit=max] *,html.split-view-resizing[data-split-view-axis=y][data-split-view-side=end]:is([data-split-view-limit=min],[data-split-view-limit=collapsed]) *{cursor:n-resize!important}
html.split-view-resizing iframe{pointer-events:none}
`

function useGlobalStyles() {
  React.useInsertionEffect(() => {
    if (document.getElementById("split-view-styles")) return
    const el = document.createElement("style")
    el.id = "split-view-styles"
    el.textContent = GLOBAL_CSS
    document.head.appendChild(el)
  }, [])
}

/* -------------------------------------------------------------------------- */
/* Pointer safety: release on alt-tab / blur / lost capture                    */
/* -------------------------------------------------------------------------- */

function usePointerSafety(rootRef: React.RefObject<HTMLDivElement | null>) {
  React.useEffect(() => {
    const html = document.documentElement
    let pressed: HTMLElement | null = null
    const down = (e: PointerEvent) => {
      const sep = (e.target as HTMLElement | null)?.closest?.(
        "[data-split-view-handle]"
      ) as HTMLElement | null
      if (!sep || e.button !== 0 || !rootRef.current?.contains(sep)) return
      if (sep.closest("[data-split-view]") !== rootRef.current) return
      pressed = sep
      html.classList.add("split-view-pressing")
    }
    const release = (x = 0, y = 0) => {
      if (!pressed) return
      const el = pressed
      pressed = null
      html.classList.remove("split-view-pressing")
      el.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, clientX: x, clientY: y, pointerId: 1 })
      )
    }
    const move = (e: PointerEvent) => {
      if (pressed && e.buttons === 0) release(e.clientX, e.clientY)
    }
    const up = () => {
      if (!pressed) return
      pressed = null
      html.classList.remove("split-view-pressing")
    }
    const blur = () => release()
    window.addEventListener("pointerdown", down, true)
    window.addEventListener("pointermove", move, true)
    window.addEventListener("pointerup", up)
    window.addEventListener("blur", blur)
    return () => {
      window.removeEventListener("pointerdown", down, true)
      window.removeEventListener("pointermove", move, true)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("blur", blur)
    }
  }, [rootRef])
}

/* -------------------------------------------------------------------------- */
/* Physics hook: wires the spring/magnet layer to one separator                */
/* -------------------------------------------------------------------------- */

function usePhysics(
  rootRef: React.RefObject<HTMLDivElement | null>,
  id: string,
  enabled: boolean,
  build: () => Omit<PhysicsOptions, "id">
) {
  const ref = React.useRef<PanelPhysics | null>(null)
  const buildRef = React.useRef(build)
  React.useLayoutEffect(() => {
    buildRef.current = build
  })
  React.useLayoutEffect(() => {
    if (!enabled) return
    let raf = 0
    let alive = true
    const tryAttach = () => {
      if (!alive) return
      const el = rootRef.current?.querySelector(`[data-split-view-handle="${id}"]`) ?? null
      const c = controllerFor(el)
      if (!c) {
        raf = requestAnimationFrame(tryAttach)
        return
      }
      // Read the latest options lazily so prop changes apply without re-attaching.
      const opts = () => buildRef.current()
      const first = opts()
      ref.current = attachPhysics(c, {
        id,
        ...first,
        get axis() { return opts().axis },
        get settle() { return opts().settle },
        get collapse() { return opts().collapse },
        get follow() { return opts().follow },
        get collapseThreshold() { return opts().collapseThreshold },
        get magnet() { return opts().magnet },
        onStart: () => opts().onStart?.(),
        onFrame: (f) => opts().onFrame?.(f),
        onEnd: () => opts().onEnd?.(),
      })
    }
    tryAttach()
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      ref.current?.dispose()
      ref.current = null
    }
  }, [rootRef, id, enabled])
  return ref
}

/* -------------------------------------------------------------------------- */
/* Handle                                                                      */
/* -------------------------------------------------------------------------- */

interface HandleProps {
  id: string
  label: string
  vertical: boolean
  /** The sized pane sits before (`start`) or after (`end`) the fill pane. */
  side: "start" | "end"
  collapsed: boolean
  onExpand?: () => void
  className?: string
}

function SplitViewHandle({ id, label, vertical, side, collapsed, onExpand, className }: HandleProps) {
  const down = React.useRef<{ x: number; y: number } | null>(null)
  const start = side === "start"
  return (
    <Separator
      aria-label={label}
      data-split-view-handle={id}
      data-collapsed={collapsed ? "" : undefined}
      title={collapsed && onExpand ? "Click or drag to open" : undefined}
      className={cn(
        "group/handle relative z-10 touch-none outline-none select-none",
        vertical ? "-my-2 h-4 !cursor-row-resize" : "-mx-2 w-4 !cursor-col-resize",
        collapsed &&
          (vertical
            ? start
              ? "mt-0 -mb-3.5 h-3.5"
              : "-mt-3.5 mb-0 h-3.5"
            : start
              ? "ml-0 -mr-3.5 w-3.5"
              : "-ml-3.5 mr-0 w-3.5"),
        collapsed &&
          (vertical
            ? start ? "!cursor-s-resize" : "!cursor-n-resize"
            : start ? "!cursor-e-resize" : "!cursor-w-resize"),
        className
      )}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        e.currentTarget.style.setProperty(
          "--split-view-pointer",
          `${vertical ? e.clientX - r.left : e.clientY - r.top}px`
        )
      }}
      onPointerDown={(e) => {
        down.current = { x: e.clientX, y: e.clientY }
      }}
      onClick={(e) => {
        const d = down.current
        if (collapsed && onExpand && d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) onExpand()
      }}
    >
      {/* hairline */}
      <span
        aria-hidden
        className={cn(
          "bg-border pointer-events-none absolute transition-[width,height,background-color,box-shadow] duration-150 ease-out",
          "group-hover/handle:bg-foreground/20 group-hover/handle:delay-150",
          "group-focus-visible/handle:bg-primary group-data-[resizing]/handle:bg-primary group-data-[resizing]/handle:delay-0",
          "group-data-[resizing]/handle:shadow-[0_0_12px_color-mix(in_oklab,var(--color-primary)_35%,transparent)]",
          vertical
            ? "inset-x-0 h-px group-hover/handle:h-0.5 group-focus-visible/handle:h-0.5 group-data-[resizing]/handle:h-0.5"
            : "inset-y-0 w-px group-hover/handle:w-0.5 group-focus-visible/handle:w-0.5 group-data-[resizing]/handle:w-0.5",
          collapsed
            ? vertical
              ? start ? "top-0" : "bottom-0"
              : start ? "left-0" : "right-0"
            : vertical
              ? "top-1/2 -translate-y-1/2"
              : "left-1/2 -translate-x-1/2"
        )}
      />
      {/* pointer-following glow */}
      <span
        aria-hidden
        className={cn(
          "via-primary pointer-events-none absolute rounded-full from-transparent to-transparent opacity-0 transition-[opacity,scale] duration-300 ease-out",
          "group-hover/handle:opacity-100 group-hover/handle:delay-150 group-data-[resizing]/handle:opacity-0 group-data-[resizing]/handle:delay-0",
          collapsed && "hidden",
          vertical
            ? "top-1/2 left-[var(--split-view-pointer,50%)] h-0.5 w-36 -translate-x-1/2 -translate-y-1/2 scale-x-30 bg-linear-to-r group-hover/handle:scale-x-100"
            : "top-[var(--split-view-pointer,50%)] left-1/2 h-36 w-0.5 -translate-x-1/2 -translate-y-1/2 scale-y-30 bg-linear-to-b group-hover/handle:scale-y-100"
        )}
      />
      {collapsed && (
        <span
          aria-hidden
          className={cn(
            "bg-popover text-foreground ring-border pointer-events-none absolute grid place-items-center rounded-full shadow-md ring-1",
            "opacity-0 transition-[opacity,translate] duration-200 ease-out group-hover/handle:opacity-100 group-hover/handle:delay-150",
            vertical
              ? cn(
                  "left-[var(--split-view-pointer,50%)] -ml-[15px] h-3.5 w-[30px] group-hover/handle:translate-y-0",
                  start ? "top-[3px] -translate-y-1.5" : "bottom-[3px] translate-y-1.5"
                )
              : cn(
                  "top-[var(--split-view-pointer,50%)] -mt-[15px] h-[30px] w-3.5 group-hover/handle:translate-x-0",
                  start ? "left-[3px] -translate-x-1.5" : "right-[3px] translate-x-1.5"
                )
          )}
        >
          <svg
            width="8"
            height="12"
            viewBox="0 0 8 12"
            className={cn(vertical && "rotate-90", !start && "rotate-180", vertical && !start && "-rotate-90")}
          >
            <path
              d="M2 2l4 4-4 4"
              stroke="currentColor"
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      )}
    </Separator>
  )
}

/* -------------------------------------------------------------------------- */
/* SplitView                                                                   */
/* -------------------------------------------------------------------------- */

const isPercent = (s: SplitViewSize | null | undefined): s is `${number}%` => typeof s === "string"
const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d

function SplitView({
  children,
  orientation = "horizontal",
  fill = 1,
  defaultSizes: defaultSizesProp,
  minSizes: minSizesProp,
  maxSizes: maxSizesProp,
  narrow,
  collapsible = false,
  collapseThreshold = 0.5,
  collapsed: collapsedProp,
  defaultCollapsed: defaultCollapsedProp,
  onCollapsedChange,
  snapPoints = DEFAULT_SNAPS,
  magnetRange = 30,
  magnetStrength = 0.78,
  spring = DEFAULT_SPRING,
  collapseSpring = DEFAULT_COLLAPSE_SPRING,
  overshoot = 12,
  persistKey,
  onResize,
  showGuides,
  showBadge,
  handleLabels,
  panelClassNames,
  handleClassName,
  apiRef,
  className,
  ...props
}: SplitViewProps) {
  useGlobalStyles()
  const panes = React.Children.toArray(children)
  const count = panes.length
  if (count < 2 || count > 3) {
    console.warn(`<SplitView> expects 2 or 3 children, got ${count}. Nest SplitViews for more panes.`)
  }
  const vertical = orientation === "vertical"
  const fillIndex = Math.min(Math.max(fill, 0), count - 1)
  const sized = (i: number) => i !== fillIndex
  const rootRef = React.useRef<HTMLDivElement>(null)

  // Narrow layout: decided by the container's own size, measured before paint.
  // First guess from the window (a container is never wider than it), so a phone
  // renders the narrow sizes on the very first paint; the observer refines it.
  const [isNarrow, setIsNarrow] = React.useState(
    () =>
      narrow !== undefined &&
      typeof window !== "undefined" &&
      (vertical ? window.innerHeight : window.innerWidth) < narrow.below
  )
  const narrowNow = React.useRef(isNarrow)
  const pick = <T,>(wide: T, small: T | undefined, n: boolean) => (n && small !== undefined ? small : wide)
  const defaultSizes = pick(defaultSizesProp, narrow?.defaultSizes, isNarrow)
  const minSizes = pick(minSizesProp, narrow?.minSizes, isNarrow)
  const maxSizes = pick(maxSizesProp, narrow?.maxSizes, isNarrow)
  const defaultCollapsed = pick(defaultCollapsedProp, narrow?.defaultCollapsed, isNarrow)
  const storeKey = (n: boolean) => (persistKey && n ? `${persistKey}:narrow` : persistKey)

  const defaultsFor = (given: (SplitViewSize | undefined | null)[] | undefined) =>
    Array.from({ length: count }, (_, i) =>
      i === fillIndex ? null : (given?.[i] ?? ((count === 3 ? "25%" : "50%") as SplitViewSize))
    )
  const defaultsKey = JSON.stringify(defaultSizes ?? null)
  const defaults = React.useMemo(
    () => defaultsFor(JSON.parse(defaultsKey) as (SplitViewSize | null)[] | null ?? undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [count, fillIndex, defaultsKey]
  )

  const [sizes, setSizes] = React.useState<(SplitViewSize | null)[]>(
    () => storage.get(storeKey(isNarrow), count)?.s ?? defaults
  )
  const [collapsedState, setCollapsedState] = React.useState<boolean[]>(
    () =>
      storage.get(storeKey(isNarrow), count)?.c ??
      panes.map((_, i) => !!defaultCollapsed?.[i])
  )

  // Switch layouts (and their remembered sizes) when the container crosses `below`.
  const narrowBelow = narrow?.below
  React.useLayoutEffect(() => {
    const el = rootRef.current
    if (!el || narrowBelow === undefined) return
    const check = () => {
      const px = vertical ? el.clientHeight : el.clientWidth
      if (px === 0) return // detached / hidden: keep the current layout
      const next = px < narrowBelow
      if (next === narrowNow.current) return
      narrowNow.current = next
      const n = narrowRef.current
      const stored = storage.get(storeKey(next), count)
      setIsNarrow(next)
      setSizes(stored?.s ?? defaultsFor(next ? (n?.defaultSizes ?? defaultSizesRef.current) : defaultSizesRef.current))
      const dc = next ? (n?.defaultCollapsed ?? defaultCollapsedRef.current) : defaultCollapsedRef.current
      setCollapsedState(stored?.c ?? Array.from({ length: count }, (_, i) => !!dc?.[i]))
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrowBelow, vertical, count, persistKey])
  const collapsed = collapsedProp ?? collapsedState
  const narrowRef = React.useRef(narrow)
  const defaultSizesRef = React.useRef(defaultSizesProp)
  const defaultCollapsedRef = React.useRef(defaultCollapsedProp)
  React.useLayoutEffect(() => {
    narrowRef.current = narrow
    defaultSizesRef.current = defaultSizesProp
    defaultCollapsedRef.current = defaultCollapsedProp
  })

  // Keep arrays in step if the number of panes changes.
  const safeSizes = sizes.length === count ? sizes : defaults
  const latest = React.useRef({ sizes: safeSizes, collapsed })
  React.useLayoutEffect(() => {
    latest.current = { sizes: safeSizes, collapsed }
  })

  const activeKey = storeKey(isNarrow)
  React.useEffect(() => {
    storage.set(activeKey, { s: safeSizes, c: collapsed })
  }, [activeKey, safeSizes, collapsed])

  const commitSizes = React.useCallback(
    (next: (SplitViewSize | null)[]) => {
      setSizes(next)
      onResize?.(next)
    },
    [onResize]
  )
  const commitCollapsed = React.useCallback(
    (next: boolean[]) => {
      if (collapsedProp === undefined) setCollapsedState(next)
      onCollapsedChange?.(next)
    },
    [collapsedProp, onCollapsedChange]
  )
  const setOne = (i: number, value: boolean) => {
    const cur = latest.current.collapsed
    if (!!cur[i] === value) return
    const next = panes.map((_, j) => (j === i ? value : !!cur[j]))
    commitCollapsed(next)
  }

  React.useImperativeHandle(
    apiRef,
    () => ({
      collapse: (i) => setOne(i, true),
      expand: (i) => setOne(i, false),
      toggle: (i) => setOne(i, !latest.current.collapsed[i]),
      reset: () => {
        commitSizes(defaults)
        commitCollapsed(panes.map(() => false))
      },
      getSizes: () => latest.current.sizes,
      getCollapsed: () => latest.current.collapsed,
    })
  )

  const guidesRef = React.useRef<HTMLDivElement>(null)
  const badgeRef = React.useRef<HTMLDivElement>(null)
  usePointerSafety(rootRef)

  const baseId = React.useId().replace(/:/g, "")
  const handleId = (i: number) => `${baseId}-${i}`
  const guides = showGuides ?? snapPoints.length > 0
  const badge = showBadge ?? guides

  const extent = () => {
    const g = rootRef.current
    return g ? (vertical ? g.clientHeight : g.clientWidth) || 1 : 1
  }

  const onFrame = (f: DragFrame) => {
    const b = badgeRef.current
    const g = guidesRef.current
    if (b && badge) {
      b.style.transform = vertical
        ? `translate3d(0,${f.position}px,0)`
        : `translate3d(${f.position}px,0,0)`
      b.textContent = f.active !== null ? `${round(f.active * 100, 1)}%` : `${Math.round(f.ratio * 100)}%`
      b.toggleAttribute("data-on", f.active !== null)
    }
    if (g && guides) {
      for (const el of Array.from(g.children) as HTMLElement[]) {
        const on = f.active === Number(el.dataset.p)
        el.toggleAttribute("data-on", on)
        if (on && f.entered) {
          el.animate(
            [
              { boxShadow: "0 0 0 1px var(--color-primary), 0 0 28px 4px color-mix(in oklab, var(--color-primary) 30%, transparent)" },
              { boxShadow: "0 0 0 0 transparent" },
            ],
            { duration: 420, easing: "cubic-bezier(.2,.8,.2,1)" }
          )
          if (b && badge) {
            b.animate(
              [{ transform: `${b.style.transform} scale(1.12)` }, { transform: `${b.style.transform} scale(1)` }],
              { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" }
            )
          }
        }
      }
    }
  }
  const setDragging = (on: boolean) => {
    guidesRef.current?.toggleAttribute("data-dragging", on)
    badgeRef.current?.toggleAttribute("data-dragging", on)
  }

  const physicsOptions = (): Omit<PhysicsOptions, "id"> => ({
    axis: vertical ? "y" : "x",
    settle: toSpring(spring),
    collapse: toSpring(collapseSpring),
    follow: FOLLOW,
    collapseThreshold,
    magnet:
      snapPoints.length > 0
        ? { points: snapPoints, zone: magnetRange, strength: magnetStrength, extent }
        : { points: [], zone: 0, strength: 0, extent },
    rtl: () => !vertical && !!rootRef.current && getComputedStyle(rootRef.current).direction === "rtl",
    onStart: () => setDragging(true),
    onFrame,
    onEnd: () => setDragging(false),
  })

  // Max 3 panes -> at most 2 handles; hooks are called unconditionally.
  const physicsA = usePhysics(rootRef, handleId(0), count > 0 && sized(0), physicsOptions)
  const physicsB = usePhysics(rootRef, handleId(2), count > 2 && sized(2), physicsOptions)
  const physicsC = usePhysics(rootRef, handleId(1), count > 1 && sized(1), physicsOptions)
  const physicsFor = (i: number) => (i === 0 ? physicsA : i === 2 ? physicsB : physicsC)

  const isCollapsible = (i: number) =>
    Array.isArray(collapsible) ? !!collapsible[i] : collapsible

  const renderSized = (i: number) => {
    const current = safeSizes[i] ?? defaults[i] ?? "50%"
    const canCollapse = isCollapsible(i)
    return (
      <Panel
        key={`p${i}`}
        size={current}
        defaultSize={defaults[i] ?? undefined}
        minSize={minSizes?.[i]}
        maxSize={maxSizes?.[i]}
        overshoot={overshoot}
        transition={toSpring(collapseSpring)}
        collapsed={canCollapse ? !!collapsed[i] : undefined}
        onCollapsedChange={canCollapse ? (c: boolean) => setOne(i, c) : undefined}
        onSizeChange={(s: SplitViewSize) => {
          const r = physicsFor(i).current?.release
          let next: SplitViewSize = s
          if (r?.pending && r.inZone) {
            next = isPercent(current)
              ? (`${round(r.fraction * 100)}%` as SplitViewSize)
              : Math.round(r.fraction * extent())
          }
          const arr = latest.current.sizes.map((v, j) => (j === i ? next : v))
          commitSizes(arr)
        }}
        className={cn("min-h-0 min-w-0 overflow-hidden", panelClassNames?.[i])}
      >
        {panes[i]}
      </Panel>
    )
  }

  const renderHandle = (i: number) => (
    <SplitViewHandle
      key={`h${i}`}
      id={handleId(i)}
      label={handleLabels?.[i] ?? "Resize panel"}
      vertical={vertical}
      side={i < fillIndex ? "start" : "end"}
      collapsed={isCollapsible(i) && !!collapsed[i]}
      onExpand={isCollapsible(i) ? () => setOne(i, false) : undefined}
      className={handleClassName}
    />
  )

  const items: React.ReactNode[] = []
  panes.forEach((_, i) => {
    if (i === fillIndex) {
      items.push(
        <Panel key={`p${i}`} className={cn("min-h-0 min-w-0 overflow-hidden", panelClassNames?.[i])}>
          {panes[i]}
        </Panel>
      )
    } else if (i < fillIndex) {
      items.push(renderSized(i), renderHandle(i))
    } else {
      items.push(renderHandle(i), renderSized(i))
    }
  })

  return (
    <div
      ref={rootRef}
      data-split-view=""
      data-orientation={orientation}
      className={cn("relative isolate flex min-h-0 min-w-0", className)}
      {...props}
    >
      <Group
        orientation={orientation}
        className={cn("flex min-h-0 min-w-0 flex-1", vertical && "flex-col")}
      >
        {items}
      </Group>

      {guides && snapPoints.length > 0 && (
        <div
          ref={guidesRef}
          aria-hidden
          className="pointer-events-none absolute inset-0 z-[5] opacity-0 transition-opacity duration-200 ease-out data-[dragging]:opacity-100 data-[dragging]:duration-100"
        >
          {snapPoints.map((p) => (
            <div
              key={p}
              data-p={p}
              className={cn(
                "group/guide border-foreground/15 data-[on]:border-primary absolute border-dashed transition-colors duration-100 data-[on]:border-solid",
                vertical ? "inset-x-0 -mt-px h-0 border-t" : "inset-y-0 -ml-px w-0 border-l"
              )}
              style={vertical ? { top: `${p * 100}%` } : { left: `${p * 100}%` }}
            >
              <span
                className={cn(
                  "text-muted-foreground group-data-[on]/guide:text-primary absolute font-mono text-[10.5px] leading-none tabular-nums",
                  vertical ? "top-1.5 right-2.5" : "bottom-2.5 left-2"
                )}
              >
                {round(p * 100, 1)}%
              </span>
            </div>
          ))}
        </div>
      )}
      {badge && snapPoints.length > 0 && (
        <div
          ref={badgeRef}
          aria-hidden
          className={cn(
            "bg-popover/90 text-popover-foreground ring-border data-[on]:text-primary data-[on]:ring-primary pointer-events-none absolute top-0 left-0 z-[12] rounded-md px-1.5 py-0.5 font-mono text-[11px] leading-tight font-semibold tabular-nums opacity-0 shadow-lg ring-1 backdrop-blur-md transition-[opacity,color] duration-200 will-change-transform empty:hidden data-[dragging]:opacity-100 data-[dragging]:duration-100",
            vertical ? "mt-2.5 ml-12" : "mt-12 ml-2.5"
          )}
        />
      )}
    </div>
  )
}

export { SplitView, SplitViewHandle }
