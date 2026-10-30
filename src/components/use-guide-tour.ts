"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";

const preference = "(prefers-reduced-motion: reduce)";
const subscribe = (notify: () => void) => {
  const query = matchMedia(preference);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
};

export function useGuideTour(region: RefObject<HTMLElement | null>, onStep: (step: number) => void) {
  const callback = useRef(onStep);
  const interacted = useRef(false);
  const visible = useRef(false);
  const [touring, setTouring] = useState(false);
  const manual = useSyncExternalStore(subscribe, () => matchMedia(preference).matches, () => true);
  const manualStep = useRef(0);
  useEffect(() => { callback.current = onStep; }, [onStep]);
  useEffect(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const observer = new IntersectionObserver(entries => { visible.current = entries.at(-1)!.isIntersecting; });
    if (region.current) observer.observe(region.current);
    const start = setTimeout(() => { if (!interacted.current && !reduced.matches) setTouring(true); }, 1500);
    const still = () => { if (reduced.matches) setTouring(false); };
    reduced.addEventListener("change", still);
    return () => { clearTimeout(start); observer.disconnect(); reduced.removeEventListener("change", still); };
  }, [region]);
  useEffect(() => {
    if (!touring) return;
    let step = 0;
    const timer = setInterval(() => {
      if (visible.current && !document.hidden && !matchMedia("(prefers-reduced-motion: reduce)").matches) callback.current(step++);
    }, 4000);
    return () => clearInterval(timer);
  }, [touring]);
  const stop = () => { interacted.current = true; manualStep.current = 0; setTouring(false); };
  const toggle = () => {
    interacted.current = true;
    if (manual) { callback.current(manualStep.current++); return; }
    setTouring(value => !value);
  };
  return { touring, manual, stop, toggle };
}
