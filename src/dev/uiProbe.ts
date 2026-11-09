/**
 * Dev-only geometry probe: checks a screen for the defects screenshots are
 * usually taken to find, and returns JSON instead of pixels.
 *
 * Installed by main.tsx only when `import.meta.env.DEV`, as
 * `window.__tempoProbe(options)`. Nothing here is bundled for production.
 */

export interface ProbeOptions {
  /** Element (and subtree) to inspect. Defaults to the whole page. */
  scope?: string;
  /** Row selector used for sibling-overlap and content-spill checks. */
  rows?: string;
  /** Reference element the scope should line up with, usually its trigger. */
  alignTo?: string;
  /** Edge of the reference the scope should share. Defaults to "left". */
  align?: "left" | "right";
  /** Require the scope to be exactly as wide as the reference. Default true. */
  matchWidth?: boolean;
}

export interface ProbeFinding {
  element: string;
  text?: string;
  detail: string;
}

export interface ProbeReport {
  ok: boolean;
  scope: string;
  viewport: { width: number; height: number };
  elements: number;
  rows: number;
  counts: {
    offViewport: number;
    overlaps: number;
    textSpill: number;
    clipped: number;
    hitFailures: number;
  };
  offViewport: ProbeFinding[];
  overlaps: ProbeFinding[];
  textSpill: ProbeFinding[];
  clipped: ProbeFinding[];
  hitTest: { checked: number; failed: ProbeFinding[] };
  align?: {
    reference: string;
    leftDelta: number;
    rightDelta: number;
    widthDelta: number;
    gap: number;
    overlapsRef: boolean;
    ok: boolean;
  };
  error?: string;
}

const ROW_SELECTOR = '[role="option"], .menu-item';
const INTERACTIVE_SELECTOR =
  'button, a[href], input, textarea, select, [role="option"], [role="combobox"], [role="button"], [tabindex]:not([tabindex="-1"])';
const LIMIT = 8;

const round = (n: number) => Math.round(n * 100) / 100;

function label(el: Element): string {
  const id = el.id ? `#${el.id}` : "";
  const raw = typeof el.className === "string" ? el.className.trim() : "";
  const cls = raw ? `.${raw.split(/\s+/).slice(0, 3).join(".")}` : "";
  return `${el.tagName.toLowerCase()}${id}${cls}`;
}

function snippet(el: Element): string | undefined {
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 60) : undefined;
}

function isVisible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  const s = getComputedStyle(el);
  return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.01;
}

function floats(el: Element): boolean {
  const position = getComputedStyle(el).position;
  return position === "fixed" || position === "absolute";
}

/** Inside a scroll container, being outside the viewport is normal. */
function insideScroller(el: Element): boolean {
  let parent = el.parentElement;
  while (parent && parent !== document.body) {
    const s = getComputedStyle(parent);
    const scrollable = /(auto|scroll)/.test(`${s.overflow} ${s.overflowX} ${s.overflowY}`);
    if (
      scrollable &&
      (parent.scrollWidth > parent.clientWidth + 1 || parent.scrollHeight > parent.clientHeight + 1)
    ) {
      return true;
    }
    parent = parent.parentElement;
  }
  return false;
}

/** True when the point is inside every clipping ancestor of the element. */
function pointIsClipped(el: Element, x: number, y: number): boolean {
  let parent = el.parentElement;
  while (parent && parent !== document.body) {
    const s = getComputedStyle(parent);
    if (s.overflow !== "visible" || s.overflowX !== "visible" || s.overflowY !== "visible") {
      const r = parent.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) return true;
    }
    parent = parent.parentElement;
  }
  return false;
}

function clippedBy(el: Element): ProbeFinding | null {
  const r = el.getBoundingClientRect();
  let parent = el.parentElement;
  while (parent && parent !== document.body) {
    const s = getComputedStyle(parent);
    if (s.overflow !== "visible" || s.overflowX !== "visible" || s.overflowY !== "visible") {
      const p = parent.getBoundingClientRect();
      if (r.left < p.left - 1 || r.right > p.right + 1 || r.top < p.top - 1 || r.bottom > p.bottom + 1) {
        return { element: label(el), text: snippet(el), detail: `extends past ${label(parent)}` };
      }
    }
    parent = parent.parentElement;
  }
  return null;
}

function contentSpill(row: HTMLElement): ProbeFinding | null {
  const dy = row.scrollHeight - row.clientHeight;
  const dx = row.scrollWidth - row.clientWidth;
  const s = getComputedStyle(row);
  // Single-line labels truncate on purpose.
  if (s.textOverflow === "ellipsis" && dy <= 1) return null;

  // Flex-centered content can overflow a fixed-height row without growing
  // scrollHeight, so compare the text boxes against the row as well.
  let past = 0;
  if (dy <= 1 && dx <= 1) {
    const rowRect = row.getBoundingClientRect();
    for (const child of row.querySelectorAll("*")) {
      if (!snippet(child)) continue;
      const r = child.getBoundingClientRect();
      if (r.height < 1) continue;
      const over = Math.max(rowRect.top - r.top, r.bottom - rowRect.bottom, 0);
      if (over > 1) {
        past = over;
        break;
      }
    }
  }

  if (dy <= 1 && dx <= 1 && past <= 1) return null;
  const parts: string[] = [];
  if (dy > 1) parts.push(`+${dy}px tall`);
  if (dx > 1) parts.push(`+${dx}px wide`);
  if (past > 1) parts.push(`${round(past)}px outside`);
  return {
    element: label(row),
    text: snippet(row),
    detail: `content overflows a ${row.clientHeight}px row: ${parts.join(", ")}`,
  };
}

export function probeUI(options: ProbeOptions = {}): ProbeReport {
  const {
    scope: scopeSelector = "body",
    rows: rowSelector = ROW_SELECTOR,
    alignTo,
    align = "left",
    matchWidth = true,
  } = options;

  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const base: ProbeReport = {
    ok: false,
    scope: scopeSelector,
    viewport,
    elements: 0,
    rows: 0,
    counts: { offViewport: 0, overlaps: 0, textSpill: 0, clipped: 0, hitFailures: 0 },
    offViewport: [],
    overlaps: [],
    textSpill: [],
    clipped: [],
    hitTest: { checked: 0, failed: [] },
  };

  const scope = document.querySelector(scopeSelector);
  if (!scope) return { ...base, error: `No element matches ${scopeSelector}` };

  const all = [scope, ...scope.querySelectorAll("*")];
  base.elements = all.length;

  const floating = all.filter((el) => floats(el) && isVisible(el) && !insideScroller(el));
  const offViewport: ProbeFinding[] = [];
  for (const el of floating) {
    const r = el.getBoundingClientRect();
    const out =
      r.left < -1 || r.top < -1 || r.right > viewport.width + 1 || r.bottom > viewport.height + 1;
    if (out) {
      offViewport.push({
        element: label(el),
        text: snippet(el),
        detail: `box ${round(r.left)},${round(r.top)} ${round(r.width)}×${round(r.height)} leaves ${viewport.width}×${viewport.height}`,
      });
    }
  }

  const rowEls = [...scope.querySelectorAll<HTMLElement>(rowSelector)].filter(isVisible);
  base.rows = rowEls.length;

  const textSpill = rowEls
    .map(contentSpill)
    .filter((finding): finding is ProbeFinding => finding != null);
  const clipped = floating
    .map(clippedBy)
    .filter((finding): finding is ProbeFinding => finding != null);

  const overlaps: ProbeFinding[] = [];
  const byParent = new Map<Element, HTMLElement[]>();
  for (const row of rowEls) {
    const parent = row.parentElement;
    if (!parent) continue;
    const list = byParent.get(parent) ?? [];
    list.push(row);
    byParent.set(parent, list);
  }
  for (const [parent, siblings] of byParent) {
    for (let i = 0; i < siblings.length; i++) {
      for (let j = i + 1; j < siblings.length; j++) {
        const a = siblings[i].getBoundingClientRect();
        const b = siblings[j].getBoundingClientRect();
        const dx = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const dy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (dx > 1 && dy > 1) {
          overlaps.push({
            element: label(parent),
            detail: `rows ${i} (${snippet(siblings[i]) ?? "…"}) and ${j} (${snippet(siblings[j]) ?? "…"}) intersect by ${round(dy)}px`,
          });
        }
      }
    }
  }

  const candidates = [...scope.querySelectorAll<HTMLElement>(INTERACTIVE_SELECTOR)].filter(
    (el) => isVisible(el) && getComputedStyle(el).pointerEvents !== "none",
  );
  const failed: ProbeFinding[] = [];
  for (const el of candidates) {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > viewport.width || y > viewport.height) continue;
    if (pointIsClipped(el, x, y)) continue;
    const hit = document.elementFromPoint(x, y);
    if (hit && (hit === el || el.contains(hit))) continue;
    failed.push({
      element: label(el),
      text: snippet(el),
      detail: hit ? `covered by ${label(hit)}` : "nothing hit at its center",
    });
  }

  base.counts = {
    offViewport: offViewport.length,
    overlaps: overlaps.length,
    textSpill: textSpill.length,
    clipped: clipped.length,
    hitFailures: failed.length,
  };
  base.offViewport = offViewport.slice(0, LIMIT);
  base.overlaps = overlaps.slice(0, LIMIT);
  base.textSpill = textSpill.slice(0, LIMIT);
  base.clipped = clipped.slice(0, LIMIT);
  base.hitTest = { checked: candidates.length, failed: failed.slice(0, LIMIT) };

  let alignOk = true;
  if (alignTo) {
    const reference = document.querySelector(alignTo);
    if (!reference) {
      return { ...base, error: `No align reference matches ${alignTo}` };
    }
    const a = scope.getBoundingClientRect();
    const b = reference.getBoundingClientRect();
    const leftDelta = Math.abs(a.left - b.left);
    const rightDelta = Math.abs(a.right - b.right);
    const widthDelta = Math.abs(a.width - b.width);
    const gap = a.top >= b.bottom ? a.top - b.bottom : b.top - a.bottom;
    const overlapsRef =
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    const edgeOk = align === "right" ? rightDelta < 1 : leftDelta < 1;
    alignOk = edgeOk && (!matchWidth || widthDelta < 1) && !overlapsRef;
    base.align = {
      reference: alignTo,
      leftDelta: round(leftDelta),
      rightDelta: round(rightDelta),
      widthDelta: round(widthDelta),
      gap: round(gap),
      overlapsRef,
      ok: alignOk,
    };
  }

  base.ok =
    alignOk &&
    base.counts.offViewport === 0 &&
    base.counts.overlaps === 0 &&
    base.counts.textSpill === 0 &&
    base.counts.clipped === 0 &&
    base.counts.hitFailures === 0;

  return base;
}

export function installProbe(): void {
  window.__tempoProbe = (options?: ProbeOptions) => probeUI(options);
  console.info(
    '[probe] UI probe ready — __tempoProbe({ scope: ".dd-menu", alignTo: \'button[aria-label="Status"]\' })',
  );
}

declare global {
  interface Window {
    __tempoProbe?: (options?: ProbeOptions) => ProbeReport;
  }
}
