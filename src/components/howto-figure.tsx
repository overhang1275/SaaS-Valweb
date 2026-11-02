"use client";

import { useEffect, useRef } from "react";

export type HowToFigureData = { svg: string; axis: number[]; orders: string[][]; indices: number[]; pieceCount?: number };

export function HowToFigure({ figure, target, frame }: { figure: HowToFigureData; target: number; frame?: { number: string; title: string; hint: string; readout: string } }) {
  const art = useRef<HTMLDivElement>(null);
  const position = useRef(-100);
  useEffect(() => {
    const container = art.current;
    const svg = container?.querySelector("svg");
    if (!container || !svg) return;
    const nodes = new Map([...svg.querySelectorAll<SVGGElement>("[data-piece]")].map(node => [node.dataset.piece, node]));
    const sheets = [...svg.querySelectorAll("[data-sheet]")];
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0, last = 0, visible = false, order = -1;
    function draw() {
      for (const sheet of sheets) sheet.setAttribute("transform", `translate(${figure.axis[0] * position.current} ${figure.axis[1] * position.current})`);
      const next = figure.indices[Math.round(position.current) + 100];
      if (order !== next) {
        for (const id of figure.orders[next]) svg!.append(nodes.get(id)!);
        order = next;
      }
    }
    function tick(now: number) {
      frame = 0;
      if (!visible || document.hidden) return;
      const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 0;
      last = now;
      position.current = reduced.matches ? target : position.current + (target - position.current) * (1 - Math.exp(-dt / 0.3));
      if (Math.abs(target - position.current) < 0.01) position.current = target;
      draw();
      if (position.current !== target) run();
    }
    function run() { if (!frame && visible && !document.hidden) frame = requestAnimationFrame(tick); }
    function resume() { cancelAnimationFrame(frame); frame = 0; last = 0; run(); }
    function still() { if (reduced.matches) { position.current = target; draw(); } resume(); }
    const observer = new IntersectionObserver(entries => { visible = entries.at(-1)!.isIntersecting; resume(); });
    observer.observe(container);
    document.addEventListener("visibilitychange", resume);
    reduced.addEventListener("change", still);
    still();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); document.removeEventListener("visibilitychange", resume); reduced.removeEventListener("change", still); };
  }, [target, figure]);

  const drawing = <div className="howto-art" ref={art} dangerouslySetInnerHTML={{ __html: figure.svg }} />;
  if (!frame) return drawing;
  return <figure className="howto-anatomy"><div className="howto-figure-bar"><span>{frame.number}</span><strong>{frame.title}</strong></div>{drawing}<figcaption className="howto-figure-bar"><span>{frame.hint}</span><output aria-hidden="true">{frame.readout}</output></figcaption></figure>;
}
