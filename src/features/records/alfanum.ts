import { z } from "zod";
import { basename, extname } from "node:path";

export const alfanumSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9]+$/, "Usa únicamente letras y números.");
export function normalizeAlfanum(value: string) { return alfanumSchema.parse(value).toUpperCase(); }
export function imageAlfanum(filename: string) {
  const name = basename(filename);
  if (name.length > 200 || !/\.(jpg|jpeg|png|webp)$/i.test(name)) throw new Error("Formato de imagen no admitido.");
  return normalizeAlfanum(name.slice(0, -extname(name).length));
}
