import { describe, expect, it } from "vitest";
import type { Tab } from "@/modules/tabs";
import { selectLivePreview } from "./livePreview";

function preview(id: number, over: Partial<Tab> = {}): Tab {
  return {
    id,
    kind: "preview",
    spaceId: "s1",
    title: "localhost:3000",
    url: "http://localhost:3000",
    ...over,
  } as Tab;
}

describe("selectLivePreview", () => {
  it("selects only the active warm preview", () => {
    const tabs: Tab[] = [
      preview(1),
      {
        id: 2,
        kind: "terminal",
        spaceId: "s1",
        title: "Terminal",
        paneTree: { kind: "leaf", id: 20 },
        activeLeafId: 20,
      },
      preview(3),
    ];

    expect(selectLivePreview(tabs, 3)?.id).toBe(3);
  });

  it("excludes hidden, non-preview, and cold preview tabs", () => {
    const tabs: Tab[] = [
      preview(1),
      preview(2, { cold: true }),
      {
        id: 3,
        kind: "editor",
        spaceId: "s1",
        title: "x",
        path: "/x.ts",
        dirty: false,
        preview: false,
      },
    ];

    expect(selectLivePreview(tabs, 1)?.id).toBe(1);
    expect(selectLivePreview(tabs, 2)).toBeNull();
    expect(selectLivePreview(tabs, 3)).toBeNull();
  });
});
