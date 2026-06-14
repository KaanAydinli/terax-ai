import type { PreviewTab, Tab } from "@/modules/tabs";

export function selectLivePreview(
  tabs: Tab[],
  activeId: number,
): PreviewTab | null {
  const active = tabs.find((t) => t.id === activeId);
  return active?.kind === "preview" && !active.cold ? active : null;
}
