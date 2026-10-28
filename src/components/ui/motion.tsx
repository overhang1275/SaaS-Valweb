"use client";

import { LazyMotion, domAnimation, MotionConfig, m } from "motion/react";
import type { ReactNode } from "react";

export function MotionProvider({ children }: { children: ReactNode }) {
  return <LazyMotion features={domAnimation} strict><MotionConfig reducedMotion="user" transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}>{children}</MotionConfig></LazyMotion>;
}
export function PageTransition({ children }: { children: ReactNode }) {
  return <m.div className="page-transition" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>{children}</m.div>;
}
