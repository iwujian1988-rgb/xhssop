'use client';

import { useLayoutEffect, useRef } from 'react';

interface AutoFitOptions {
  min?: number;
  max?: number;
  step?: number;
  /** Extra px of slack allowed before we consider it "overflowing". */
  tolerance?: number;
}

/**
 * Measures the real rendered height of a container against its available
 * height budget and shrinks a CSS variable (--fit-scale) step by step until
 * the content fits (or a floor is reached). This replaces "guess a font size
 * tier from character counts" heuristics with an actual fit-to-content loop,
 * so a section's height is driven by its content instead of a pre-carved
 * equal slice of the card.
 *
 * Usage: attach `ref` to the scroll container, use `var(--fit-scale, 1)`
 * inside font-size / gap calc() expressions of its descendants.
 */
export function useAutoFitScale<T extends HTMLElement>(deps: unknown[], options?: AutoFitOptions) {
  const ref = useRef<T | null>(null);
  const min = options?.min ?? 0.55;
  const max = options?.max ?? 1;
  const step = options?.step ?? 0.03;
  const tolerance = options?.tolerance ?? 1;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    let scale = max;
    el.style.setProperty('--fit-scale', String(scale));

    let guard = 0;
    while (el.scrollHeight > el.clientHeight + tolerance && scale > min && guard < 60) {
      scale = Math.max(min, Number((scale - step).toFixed(3)));
      el.style.setProperty('--fit-scale', String(scale));
      guard += 1;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return ref;
}
