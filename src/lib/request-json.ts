export async function readBoundedJson(request: Request, limit = 8192): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > limit) throw new RangeError("Solicitud demasiado grande.");
  if (!request.body) throw new SyntaxError("Solicitud vacía.");
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0, expired = false;
  const timer = setTimeout(() => { expired = true; void reader.cancel().catch(() => {}); }, 10000);
  try {
    while (true) {
      const chunk = await reader.read();
      if (expired) throw new Error("Tiempo de recepción agotado.");
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > limit) { await reader.cancel(); throw new RangeError("Solicitud demasiado grande."); }
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString());
  } finally { clearTimeout(timer); reader.releaseLock(); }
}
