export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 20_000_000;

export class ImageError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
