export type DropPoint = {
  x: number;
  y: number;
};

export function logicalDropPoint(
  x: number,
  y: number,
  viewportWidth = window.innerWidth,
  viewportHeight = window.innerHeight,
  devicePixelRatio = window.devicePixelRatio || 1,
): DropPoint {
  if (x <= viewportWidth && y <= viewportHeight) return { x, y };
  return { x: x / devicePixelRatio, y: y / devicePixelRatio };
}
