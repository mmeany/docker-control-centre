// What FileList and ResizableTable share for resizing columns: following the
// pointer from a header edge, and measuring how wide contents want to be.
import type { PointerEvent } from "react";

/**
 * Pointer-down on a header edge: calls `onMove` with the new width as the
 * pointer moves (pointer captured, so it keeps working outside the header),
 * then `onEnd` with the final width if it changed.
 */
export function dragColumn(e: PointerEvent<HTMLElement>, startW: number, onMove: (w: number) => void, onEnd: (w: number) => void) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const el = e.currentTarget;
  const x0 = e.clientX;
  let w = startW;
  el.setPointerCapture(e.pointerId);
  document.body.classList.add("col-resizing");
  const move = (ev: globalThis.PointerEvent) => {
    w = startW + ev.clientX - x0;
    onMove(w);
  };
  const end = () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", end);
    el.removeEventListener("pointercancel", end);
    document.body.classList.remove("col-resizing");
    if (w !== startW) onEnd(w);
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
}

/**
 * Width an element needs to show its contents untruncated, padding included.
 * Measured with a Range: text keeps its full width when ellipsis hides it,
 * and it works whether the element is wider or narrower than its contents.
 */
export function contentWidth(el: Element | undefined | null): number {
  if (!el) return 0;
  const range = document.createRange();
  range.selectNodeContents(el);
  const cs = getComputedStyle(el);
  return Math.ceil(range.getBoundingClientRect().width + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)) + 1;
}
