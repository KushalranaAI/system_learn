import { useEffect, useState, type KeyboardEvent, type PointerEvent } from "react";

export const LEFT = { def: 340, min: 260, max: 560 };
export const RIGHT = { def: 330, min: 280, max: 720, wide: 560 };

const KEY = "system-learn:panels:v1";
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface Saved {
  leftW: number;
  rightW: number;
  rightOpen: boolean;
}

function read(): Saved {
  const wide = typeof window === "undefined" || window.innerWidth >= 900;
  const base: Saved = { leftW: LEFT.def, rightW: RIGHT.def, rightOpen: wide };
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (v)
      return {
        leftW: clamp(Number(v.leftW) || base.leftW, LEFT.min, LEFT.max),
        rightW: clamp(Number(v.rightW) || base.rightW, RIGHT.min, RIGHT.max),
        // on narrow screens the guide is an overlay, so it starts closed whatever was saved
        rightOpen: wide ? v.rightOpen !== false : false,
      };
  } catch {
    /* storage blocked or corrupt: fall back to defaults */
  }
  return base;
}

/** Panel widths and the guide's open state, remembered in this browser. */
export function usePanels() {
  const [p, setP] = useState<Saved>(read);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(p));
    } catch {
      /* not persisted */
    }
  }, [p]);
  return {
    ...p,
    setLeftW: (leftW: number) => setP((s) => ({ ...s, leftW: clamp(leftW, LEFT.min, LEFT.max) })),
    setRightW: (rightW: number) => setP((s) => ({ ...s, rightW: clamp(rightW, RIGHT.min, RIGHT.max) })),
    setRightOpen: (rightOpen: boolean) => setP((s) => ({ ...s, rightOpen })),
    toggleRight: () => setP((s) => ({ ...s, rightOpen: !s.rightOpen })),
    resetWidths: () => setP((s) => ({ ...s, leftW: LEFT.def, rightW: RIGHT.def })),
  };
}

/**
 * A draggable edge between a side panel and the canvas. Drag it, use the arrow keys when it is focused,
 * or double-click to restore the default width. The canvas always keeps at least `keep` px.
 */
export function Resizer({ side, width, min, max, onChange, onReset, otherWidth }: {
  side: "left" | "right";
  width: number;
  min: number;
  max: number;
  onChange: (w: number) => void;
  onReset: () => void;
  /** width of the panel on the other side, so the canvas is never squeezed out */
  otherWidth: number;
}) {
  const keep = 380;
  const limit = () => Math.max(min, Math.min(max, window.innerWidth - otherWidth - keep));
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    const startX = e.clientX;
    const startW = width;
    el.setPointerCapture(e.pointerId);
    document.body.classList.add("resizing");
    const move = (ev: globalThis.PointerEvent) => onChange(clamp(startW + (side === "left" ? ev.clientX - startX : startX - ev.clientX), min, limit()));
    const up = () => {
      document.body.classList.remove("resizing");
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!dir) return e.key === "Enter" ? onReset() : undefined;
    e.preventDefault();
    onChange(clamp(width + 24 * dir * (side === "left" ? 1 : -1), min, limit()));
  };
  return (
    <div
      className={`resizer ${side}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize the ${side} panel`}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    />
  );
}
