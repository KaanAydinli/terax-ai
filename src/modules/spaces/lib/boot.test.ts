import { describe, expect, it } from "vitest";
import type { PaneNode } from "@/modules/terminal/lib/panes";
import type { Tab } from "@/modules/tabs";
import {
  fallbackCwd,
  recoverMissingTerminalCwds,
  sanitizeSpaceRoots,
} from "./boot";
import type { SpaceMeta } from "./store";

function terminal(overrides: Partial<Extract<Tab, { kind: "terminal" }>>): Tab {
  return {
    id: 1,
    kind: "terminal",
    spaceId: "s1",
    title: "deleted",
    cold: true,
    cwd: "/deleted",
    paneTree: { kind: "leaf", id: 2, cwd: "/deleted" },
    activeLeafId: 2,
    ...overrides,
  } as Tab;
}

function space(root: string | null): SpaceMeta {
  return {
    id: "s1",
    name: "Default",
    root,
    env: { kind: "local" },
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("fallbackCwd", () => {
  it("prefers launch cwd over home", () => {
    expect(fallbackCwd("/launch", "/home/me")).toBe("/launch");
    expect(fallbackCwd(null, "/home/me")).toBe("/home/me");
  });
});

describe("recoverMissingTerminalCwds", () => {
  it("replaces missing terminal leaf cwd with the fallback cwd", () => {
    const recovered = recoverMissingTerminalCwds(
      [terminal({})],
      new Set(["/home/me"]),
      "/home/me",
    );

    expect(recovered.changed).toBe(true);
    const [tab] = recovered.tabs;
    expect(tab.kind).toBe("terminal");
    if (tab.kind !== "terminal") return;
    expect(tab.cwd).toBe("/home/me");
    expect(tab.title).toBe("me");
    expect(tab.paneTree).toMatchObject({ kind: "leaf", cwd: "/home/me" });
  });

  it("keeps valid split leaves untouched", () => {
    const tree: PaneNode = {
      kind: "split",
      id: 10,
      dir: "row",
      children: [
        { kind: "leaf", id: 11, cwd: "/ok" },
        { kind: "leaf", id: 12, cwd: "/also-ok" },
      ],
    };
    const tab = terminal({
      title: "ok",
      cwd: "/also-ok",
      paneTree: tree,
      activeLeafId: 12,
    });

    const recovered = recoverMissingTerminalCwds(
      [tab],
      new Set(["/ok", "/also-ok"]),
      "/home/me",
    );

    expect(recovered.changed).toBe(false);
    expect(recovered.tabs[0]).toBe(tab);
  });

  it("clears missing cwd when no fallback exists", () => {
    const recovered = recoverMissingTerminalCwds(
      [terminal({})],
      new Set(),
      null,
    );

    const [tab] = recovered.tabs;
    expect(tab.kind).toBe("terminal");
    if (tab.kind !== "terminal") return;
    expect(tab.cwd).toBeUndefined();
    expect(tab.paneTree).toMatchObject({ kind: "leaf" });
    if (tab.paneTree.kind === "leaf") expect(tab.paneTree.cwd).toBeUndefined();
  });
});

describe("sanitizeSpaceRoots", () => {
  it("falls back missing space roots", () => {
    const recovered = sanitizeSpaceRoots(
      [space("/deleted")],
      new Set(["/home/me"]),
      "/home/me",
    );

    expect(recovered.changed).toBe(true);
    expect(recovered.spaces[0].root).toBe("/home/me");
    expect(recovered.spaces[0].updatedAt).toBeGreaterThan(1);
  });

  it("keeps valid roots unchanged", () => {
    const original = space("/ok");
    const recovered = sanitizeSpaceRoots([original], new Set(["/ok"]), "/home");

    expect(recovered.changed).toBe(false);
    expect(recovered.spaces[0]).toBe(original);
  });
});
