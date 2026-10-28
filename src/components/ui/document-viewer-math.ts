export type ViewTransform = { zoom: number; x: number; y: number };
export type ViewSize = { width: number; height: number };
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 5;
export const FIT_VIEW: ViewTransform = { zoom: 1, x: 0, y: 0 };
export function fitScale(viewport: ViewSize, image: ViewSize) { return Math.min(viewport.width / image.width, viewport.height / image.height); }
export function boundView(view: ViewTransform, viewport: ViewSize, image: ViewSize): ViewTransform {
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.zoom));
  const scale = fitScale(viewport, image) * zoom;
  const maxX = Math.max(0, (image.width * scale - viewport.width) / 2);
  const maxY = Math.max(0, (image.height * scale - viewport.height) / 2);
  return { zoom, x: maxX ? Math.max(-maxX, Math.min(maxX, view.x)) : 0, y: maxY ? Math.max(-maxY, Math.min(maxY, view.y)) : 0 };
}
export function zoomView(view: ViewTransform, zoom: number, anchor: { x: number; y: number }, viewport: ViewSize, image: ViewSize) {
  const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
  const ratio = nextZoom / view.zoom;
  return boundView({ zoom: nextZoom, x: anchor.x - (anchor.x - view.x) * ratio, y: anchor.y - (anchor.y - view.y) * ratio }, viewport, image);
}
