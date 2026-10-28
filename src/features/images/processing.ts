import sharp from "sharp";
import { extname } from "node:path";
import { ImageError, MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS } from "./limits";

const formatForExtension: Record<string, string> = { ".jpg": "jpeg", ".jpeg": "jpeg", ".png": "png", ".webp": "webp" };
const mimeForFormat: Record<string, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

export async function prepareImage(input: Buffer, filename: string, mime: string) {
  if (!input.length) throw new ImageError(400, "El archivo está vacío (0 bytes).");
  if (input.length > MAX_IMAGE_BYTES) throw new ImageError(413, `El archivo pesa ${input.length} bytes y supera el límite de ${MAX_IMAGE_BYTES} bytes (10 MiB).`);
  const expected = formatForExtension[extname(filename).toLowerCase()];
  if (filename.length > 200) throw new ImageError(400, "El nombre del archivo supera los 200 caracteres.");
  if (!expected) throw new ImageError(400, "La extensión no está permitida. Usa JPG, JPEG, PNG o WebP.");
  if (mime !== mimeForFormat[expected]) throw new ImageError(400, `El tipo enviado (${mime.slice(0, 100)}) no corresponde a la extensión ${extname(filename)}.`);
  try {
    const image = sharp(input, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "warning" }).timeout({ seconds: 10 });
    const metadata = await image.metadata();
    if (metadata.format !== expected) throw new ImageError(400, `La extensión es ${extname(filename)}, pero el contenido real es ${metadata.format?.toUpperCase() ?? "desconocido"}. Exporta el archivo en el formato correcto; cambiar su nombre no convierte la imagen.`);
    if ((metadata.pages ?? 1) > 1) throw new ImageError(400, `La imagen contiene ${metadata.pages} fotogramas o páginas. Solo se admiten imágenes estáticas de una página.`);
    const { data, info } = await image.rotate().webp({ quality: 90 }).toBuffer({ resolveWithObject: true });
    if (data.length > MAX_IMAGE_BYTES) throw new ImageError(413, "La imagen procesada supera el límite de 10 MiB.");
    return { data, width: info.width, height: info.height };
  } catch (cause) {
    if (cause instanceof ImageError) throw cause;
    // Sharp receives a buffer, so decoder diagnostics contain no uploaded filesystem path.
    const detail = cause instanceof Error ? cause.message.replace(/[\r\n\t]+/g, " ").slice(0, 500) : "El decodificador no proporcionó un detalle del fallo.";
    const extra = detail.match(/Corrupt JPEG data: (\d+) extraneous bytes before marker (0x[a-f0-9]+)/i);
    if (extra) throw new ImageError(400, `No se pudo leer la imagen. JPEG malformado: ${extra[1]} ${extra[1] === "1" ? "byte sobrante" : "bytes sobrantes"} antes del marcador JPEG ${extra[2]}. La validación estricta rechazó esos datos. Detalle: ${detail}`);
    if (/pixel limit/i.test(detail)) throw new ImageError(413, `La imagen supera el límite de 20 millones de píxeles. Detalle: ${detail}`);
    if (/timeout/i.test(detail)) throw new ImageError(408, `La imagen excedió los 10 segundos permitidos para procesarla. Detalle: ${detail}`);
    throw new ImageError(400, `No se pudo leer la imagen. Detalle del decodificador: ${detail}`);
  }
}

export async function readImageBody(request: Request) {
  const length = Number(request.headers.get("content-length"));
  if (length > MAX_IMAGE_BYTES) throw new ImageError(413, "La imagen supera el límite de 10 MiB.");
  if (!request.body) throw new ImageError(400, "Selecciona una imagen.");
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  let expired = false;
  const timeout = setTimeout(() => { expired = true; void reader.cancel().catch(() => {}); }, 30_000);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (expired) throw new ImageError(408, "La carga tardó demasiado. Inténtalo de nuevo.");
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMAGE_BYTES) {
        await reader.cancel();
        throw new ImageError(413, "La imagen supera el límite de 10 MiB.");
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, size);
  } finally { clearTimeout(timeout); reader.releaseLock(); }
}

let uploads = 0;
export function reserveImageUpload() {
  if (uploads >= 2) throw new ImageError(429, "Hay otras imágenes procesándose. Inténtalo en unos segundos.");
  uploads++;
  let released = false;
  return () => { if (!released) { uploads--; released = true; } };
}
