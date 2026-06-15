import { useTerminalDropStore } from "./dropStore";
import { logicalDropPoint } from "./dropPoint";
import { formatDroppedPaths } from "./quoteShellPath";
import { pasteIntoLeaf } from "./rendererPool";

export function terminalLeafIdAtPoint(x: number, y: number): number | null {
  const point = logicalDropPoint(x, y);
  const el = document.elementFromPoint(point.x, point.y);
  const leafEl = el?.closest<HTMLElement>("[data-pane-leaf]");
  if (!leafEl) return null;
  const id = Number(leafEl.dataset.paneLeaf);
  return Number.isFinite(id) ? id : null;
}

export function setTerminalDropTargetAtPoint(x: number, y: number): boolean {
  const leafId = terminalLeafIdAtPoint(x, y);
  useTerminalDropStore.getState().setTarget(leafId);
  return leafId !== null;
}

export function clearTerminalDropTarget(): void {
  useTerminalDropStore.getState().setTarget(null);
}

export function pasteDroppedPathsAtPoint(
  paths: string[],
  x: number,
  y: number,
): boolean {
  if (!paths.length) return false;
  const leafId = terminalLeafIdAtPoint(x, y);
  if (leafId === null) return false;
  return pasteIntoLeaf(leafId, formatDroppedPaths(paths));
}
