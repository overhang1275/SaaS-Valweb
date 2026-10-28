import { createHash } from "node:crypto";

export const IMAGE_VIEWER_COOKIE = "valweb_image_viewer";
export function validViewerSecret(value: string | undefined) { return value && /^[a-f0-9]{64}$/.test(value) ? value : null; }
export function imageViewerHash(value: string) { return createHash("sha256").update(value).digest("hex"); }
