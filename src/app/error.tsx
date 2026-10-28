"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main id="main-content" className="standalone-error"><h1>No pudimos cargar esta página</h1><p>Ocurrió un error temporal. Inténtalo de nuevo en unos momentos.</p><button className="button" onClick={reset}>Intentar de nuevo</button></main>;
}
