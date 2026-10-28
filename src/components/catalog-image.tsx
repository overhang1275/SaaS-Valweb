"use client";

import Image from "next/image";
import { useState } from "react";
import { ImageOff, RotateCw } from "lucide-react";

export function CatalogImage({ src, alt, width, height, detail = false }: { src: string; alt: string; width: number; height: number; detail?: boolean }) {
  const [failed, setFailed] = useState(false), [loaded, setLoaded] = useState(false), [attempt, setAttempt] = useState(0);
  if (failed) return <div className="catalog-image-error" role="status"><ImageOff size={22} aria-hidden="true" /><span>No se pudo cargar</span><button type="button" className="text-link" onClick={() => { setFailed(false); setLoaded(false); setAttempt(value => value + 1); }}><RotateCw size={14} aria-hidden="true" />Reintentar</button></div>;
  return <div className={`catalog-image-frame ${loaded ? "is-loaded" : "is-loading"}`} aria-busy={!loaded}><Image key={attempt} src={`${src}${src.includes("?") ? "&" : "?"}retry=${attempt}`} width={width} height={height} alt={alt} unoptimized loading={detail ? "eager" : "lazy"} onLoad={() => setLoaded(true)} onError={() => setFailed(true)} /></div>;
}
