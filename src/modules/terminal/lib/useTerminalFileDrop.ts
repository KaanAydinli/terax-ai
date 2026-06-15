import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect } from "react";
import {
  clearTerminalDropTarget,
  pasteDroppedPathsAtPoint,
  setTerminalDropTargetAtPoint,
} from "./fileDropTarget";

/** Wires native OS file drops into the terminal pane under the cursor: shows a
 * drop overlay on that pane while dragging, and bracketed-pastes the
 * shell-quoted path(s) on drop. Drops outside any terminal leaf are ignored. */
export function useTerminalFileDrop(): void {
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    void getCurrentWebview()
      .onDragDropEvent((e) => {
        const p = e.payload;
        if (p.type === "enter" || p.type === "over") {
          setTerminalDropTargetAtPoint(p.position.x, p.position.y);
          return;
        }
        if (p.type === "leave") {
          clearTerminalDropTarget();
          return;
        }
        if (p.type === "drop") {
          clearTerminalDropTarget();
          pasteDroppedPathsAtPoint(p.paths, p.position.x, p.position.y);
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch((err) => console.error("[terax] drag-drop listen failed:", err));

    return () => {
      disposed = true;
      clearTerminalDropTarget();
      unlisten?.();
    };
  }, []);
}
