"use client";

import { useCallback, useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ImageOff, Move, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { boundView, fitScale, zoomView, FIT_VIEW, MIN_ZOOM, MAX_ZOOM, type ViewSize, type ViewTransform } from "./document-viewer-math";

type Point = { x: number; y: number };
type Gesture = { distance: number; midpoint: Point; view: ViewTransform };
export function DocumentViewer({ grant, alt, onRetry }: { grant: string; alt: string; onRetry: () => void }) {
  const canvasId = useId(), helpId = useId();
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const bitmap = useRef<ImageBitmap | null>(null);
  const viewport = useRef<ViewSize>({ width: 1, height: 1 });
  const transform = useRef<ViewTransform>({ ...FIT_VIEW });
  const animation = useRef(0);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const drag = useRef<{ point: Point; view: ViewTransform } | null>(null);
  const [view, setView] = useState<ViewTransform>({ ...FIT_VIEW });
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);

  const paint = useCallback(() => {
    const surface = canvas.current, image = bitmap.current; if (!surface || !image) return;
    const context = surface.getContext("2d"); if (!context) return;
    const size = viewport.current, current = transform.current;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(size.width * dpr)), height = Math.max(1, Math.round(size.height * dpr));
    if (surface.width !== width || surface.height !== height) { surface.width = width; surface.height = height; }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, size.width, size.height);
    context.translate(size.width / 2 + current.x, size.height / 2 + current.y);
    const scale = fitScale(size, image) * current.zoom;
    context.scale(scale, scale);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, -image.width / 2, -image.height / 2);
    surface.dataset.imageWidth = String(image.width);
    surface.dataset.imageHeight = String(image.height);
  }, []);
  const commit = useCallback((next: ViewTransform) => {
    const image = bitmap.current; if (!image) return;
    transform.current = boundView(next, viewport.current, image);
    if (!animation.current) animation.current = requestAnimationFrame(() => {
      animation.current = 0; paint(); setView({ ...transform.current });
    });
  }, [paint]);
  function changeZoom(zoom: number, anchor: Point = { x: 0, y: 0 }) {
    const image = bitmap.current; if (image) commit(zoomView(transform.current, zoom, anchor, viewport.current, image));
  }
  function localPoint(clientX: number, clientY: number): Point {
    const rect = frame.current!.getBoundingClientRect();
    return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 };
  }
  function startGesture() {
    const points = [...pointers.current.values()];
    drag.current = points.length === 1 ? { point: points[0], view: { ...transform.current } } : null;
    gesture.current = points.length >= 2 ? { distance: Math.max(1, Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)), midpoint: { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 }, view: { ...transform.current } } : null;
  }
  function pointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (status !== "ready" || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, localPoint(event.clientX, event.clientY));
    startGesture(); setDragging(true);
  }
  function pointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    const point = localPoint(event.clientX, event.clientY);
    pointers.current.set(event.pointerId, point);
    const points = [...pointers.current.values()], initial = gesture.current;
    if (points.length >= 2 && initial) {
      const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, initial.view.zoom * Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) / initial.distance));
      const midpoint = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 }, ratio = zoom / initial.view.zoom;
      commit({ zoom, x: midpoint.x - (initial.midpoint.x - initial.view.x) * ratio, y: midpoint.y - (initial.midpoint.y - initial.view.y) * ratio });
    } else if (drag.current) commit({ ...drag.current.view, x: drag.current.view.x + point.x - drag.current.point.x, y: drag.current.view.y + point.y - drag.current.point.y });
  }
  function pointerEnd(event: ReactPointerEvent<HTMLCanvasElement>) {
    pointers.current.delete(event.pointerId); startGesture(); setDragging(pointers.current.size > 0);
  }
  useEffect(() => {
    const controller = new AbortController(); let disposed = false;
    const timer = setTimeout(() => controller.abort(), 30000);
    void (async () => {
      try {
        const response = await fetch("/api/public/images", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ grant }), signal: controller.signal });
        if (!response.ok) {
          const result = await response.json().catch(() => null);
          throw new Error(result?.message || "No se pudo entregar la imagen. Vuelve a consultar el código.");
        }
        const image = await createImageBitmap(await response.blob());
        if (disposed) { image.close(); return; }
        if (!canvas.current?.getContext("2d")) { image.close(); throw new Error("Tu navegador no permite mostrar este visor. Prueba con otro navegador."); }
        bitmap.current = image; paint(); setStatus("ready");
      } catch (cause) {
        if (!disposed) { setError(controller.signal.aborted ? "La imagen tardó demasiado en cargar. Inténtalo de nuevo." : cause instanceof Error ? cause.message : "No se pudo leer la imagen."); setStatus("error"); }
      } finally { clearTimeout(timer); }
    })();
    return () => { disposed = true; clearTimeout(timer); controller.abort(); bitmap.current?.close(); bitmap.current = null; };
  }, [grant, paint]);
  useEffect(() => {
    const element = frame.current, surface = canvas.current; if (!element || !surface) return;
    const resize = () => {
      const rect = element.getBoundingClientRect(); if (rect.width < 1 || rect.height < 1) return;
      viewport.current = { width: rect.width, height: rect.height };
      if (bitmap.current) commit(transform.current);
    };
    const observer = new ResizeObserver(resize); observer.observe(element); resize();
    const wheel = (event: WheelEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || !bitmap.current) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
      commit(zoomView(transform.current, transform.current.zoom * Math.exp(-delta * .002), { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 }, viewport.current, bitmap.current));
    };
    surface.addEventListener("wheel", wheel, { passive: false });
    return () => { observer.disconnect(); surface.removeEventListener("wheel", wheel); cancelAnimationFrame(animation.current); animation.current = 0; };
  }, [commit]);

  return <section className="document-viewer" aria-label="Visor del documento">
    <div className="document-viewer-toolbar" role="group" aria-label="Controles de imagen">
      <button type="button" className="icon-button" aria-label="Alejar imagen" aria-controls={canvasId} disabled={status !== "ready" || view.zoom <= MIN_ZOOM} onClick={() => changeZoom(transform.current.zoom - .25)}><ZoomOut size={19} aria-hidden="true" /></button>
      <output className="document-zoom-value" aria-label="Nivel de zoom">{Math.round(view.zoom * 100)}%</output>
      <button type="button" className="icon-button" aria-label="Acercar imagen" aria-controls={canvasId} disabled={status !== "ready" || view.zoom >= MAX_ZOOM} onClick={() => changeZoom(transform.current.zoom + .25)}><ZoomIn size={19} aria-hidden="true" /></button>
      <button type="button" className="button button-secondary viewer-fit" aria-controls={canvasId} disabled={status !== "ready"} onClick={() => commit(FIT_VIEW)}><RotateCcw size={16} aria-hidden="true" />Ajustar imagen</button>
    </div>
    <div ref={frame} className={`document-viewport ${status === "loading" ? "skeleton" : ""} ${dragging ? "is-dragging" : ""}`} aria-busy={status === "loading"}>
      <canvas ref={canvas} id={canvasId} className="document-canvas" role="img" aria-label={alt || "Imagen del documento"} aria-describedby={helpId} tabIndex={status === "ready" ? 0 : -1} data-state={status} data-zoom={view.zoom} data-offset-x={view.x} data-offset-y={view.y} onContextMenu={event => event.preventDefault()} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} onLostPointerCapture={pointerEnd} style={{ cursor: view.zoom > 1 ? dragging ? "grabbing" : "grab" : "default" }} onKeyDown={event => {
        if (status !== "ready") return;
        if (["+", "="].includes(event.key)) { event.preventDefault(); changeZoom(transform.current.zoom + .25); }
        else if (["-", "_"].includes(event.key)) { event.preventDefault(); changeZoom(transform.current.zoom - .25); }
        else if (["0", "Home"].includes(event.key)) { event.preventDefault(); commit(FIT_VIEW); }
        else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
          event.preventDefault(); const step = event.shiftKey ? 96 : 32;
          commit({ ...transform.current, x: transform.current.x + (event.key === "ArrowLeft" ? step : event.key === "ArrowRight" ? -step : 0), y: transform.current.y + (event.key === "ArrowUp" ? step : event.key === "ArrowDown" ? -step : 0) });
        }
      }}>Imagen del documento. Usa los datos de texto del resultado para consultar su información.</canvas>
      {status === "loading" && <span className="sr-only" role="status">Cargando imagen del documento…</span>}
      {status === "error" && <div className="image-fallback viewer-error" role="alert"><ImageOff size={28} aria-hidden="true" /><p>{error}</p><button className="button button-secondary" onClick={onRetry}>Reintentar imagen</button></div>}
    </div>
    <p className="help viewer-help" id={helpId}><Move size={15} aria-hidden="true" />Amplía y arrastra dentro del visor. Usa dos dedos en pantalla táctil, Ctrl + rueda o las teclas + / −. Flechas para mover y 0 para ajustar.</p>
  </section>;
}
