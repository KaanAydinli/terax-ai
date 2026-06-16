import { useCallback, useEffect, useRef } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";

export const SECONDARY_SIDEBAR_DEFAULT_WIDTH = 320;
export const SECONDARY_SIDEBAR_MIN_WIDTH = 240;
export const SECONDARY_SIDEBAR_MAX_WIDTH = 560;

const SECONDARY_SIDEBAR_WIDTH_STORAGE_KEY = "terax.secondarySidebar.width";

function clampSecondarySidebarWidth(width: number): number {
  return Math.min(
    SECONDARY_SIDEBAR_MAX_WIDTH,
    Math.max(SECONDARY_SIDEBAR_MIN_WIDTH, Math.round(width)),
  );
}

function readSecondarySidebarWidth(): number {
  try {
    const stored = window.localStorage.getItem(
      SECONDARY_SIDEBAR_WIDTH_STORAGE_KEY,
    );
    const parsed = stored ? Number.parseInt(stored, 10) : NaN;
    return Number.isFinite(parsed)
      ? clampSecondarySidebarWidth(parsed)
      : SECONDARY_SIDEBAR_DEFAULT_WIDTH;
  } catch {
    return SECONDARY_SIDEBAR_DEFAULT_WIDTH;
  }
}

export function useSecondarySidebarPanel() {
  const secondarySidebarRef = useRef<PanelImperativeHandle | null>(null);
  const secondarySidebarWidthRef = useRef(readSecondarySidebarWidth());
  const secondarySidebarWidthWriteTimerRef = useRef(0);

  const toggleSecondarySidebar = useCallback(() => {
    const panel = secondarySidebarRef.current;
    if (!panel) return;
    if (panel.getSize().asPercentage <= 0) {
      panel.resize(`${secondarySidebarWidthRef.current}px`);
    } else {
      panel.collapse();
    }
  }, []);

  const persistSecondarySidebarWidth = useCallback((next: number) => {
    secondarySidebarWidthRef.current = clampSecondarySidebarWidth(next);
    if (secondarySidebarWidthWriteTimerRef.current) {
      window.clearTimeout(secondarySidebarWidthWriteTimerRef.current);
    }
    secondarySidebarWidthWriteTimerRef.current = window.setTimeout(() => {
      secondarySidebarWidthWriteTimerRef.current = 0;
      try {
        window.localStorage.setItem(
          SECONDARY_SIDEBAR_WIDTH_STORAGE_KEY,
          String(secondarySidebarWidthRef.current),
        );
      } catch {
        // ignore
      }
    }, 200);
  }, []);

  useEffect(() => {
    return () => {
      if (secondarySidebarWidthWriteTimerRef.current) {
        window.clearTimeout(secondarySidebarWidthWriteTimerRef.current);
      }
    };
  }, []);

  return {
    secondarySidebarRef,
    toggleSecondarySidebar,
    persistSecondarySidebarWidth,
  };
}
