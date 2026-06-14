import { describe, expect, it } from "vitest";
import type { SpaceMeta, SpaceState } from "./store";
import { resolveSpacesBoot } from "./useSpacesBoot";

function counter(start = 100): () => number {
  let n = start;
  return () => n++;
}

function space(id: string, root: string): SpaceMeta {
  return {
    id,
    name: id,
    root,
    env: { kind: "local" },
    createdAt: 1,
    updatedAt: 1,
  };
}

function terminalState(cwd: string): SpaceState {
  return {
    tabs: [{ kind: "terminal", tree: { kind: "leaf", cwd, active: true } }],
    activeTabIndex: 0,
  };
}

describe("resolveSpacesBoot", () => {
  it("restores saved spaces for a plain launch", () => {
    const boot = resolveSpacesBoot({
      spaces: [space("old", "/old")],
      activeId: "old",
      states: new Map([["old", terminalState("/old")]]),
      launchCwd: "/new",
      explicitLaunch: false,
      home: "/home/me",
      allocId: counter(),
      createSpaceId: () => "new",
      now: () => 1,
    });

    expect(boot.activeId).toBe("old");
    expect(boot.spaces).toHaveLength(1);
    expect(boot.tabs[0]).toMatchObject({ kind: "terminal", cwd: "/old" });
    expect(boot.saveSpaces).toBe(false);
    expect(boot.saveActiveId).toBe(false);
  });

  it("adds and activates a workspace for an explicit launch directory", () => {
    const boot = resolveSpacesBoot({
      spaces: [space("old", "/old")],
      activeId: "old",
      states: new Map([["old", terminalState("/old")]]),
      launchCwd: "/home/me/project",
      explicitLaunch: true,
      home: "/home/me",
      allocId: counter(),
      createSpaceId: () => "new",
      now: () => 1,
    });

    expect(boot.activeId).toBe("new");
    expect(boot.spaces.map((s) => [s.id, s.root, s.name])).toEqual([
      ["old", "/old", "old"],
      ["new", "/home/me/project", "project"],
    ]);
    expect(boot.tabs[boot.tabs.length - 1]).toMatchObject({
      kind: "terminal",
      spaceId: "new",
      cwd: "/home/me/project",
    });
    expect(boot.saveSpaces).toBe(true);
    expect(boot.saveActiveId).toBe(true);
  });

  it("activates an existing matching workspace for an explicit launch directory", () => {
    const boot = resolveSpacesBoot({
      spaces: [space("old", "/old"), space("project", "/home/me/project/")],
      activeId: "old",
      states: new Map([
        ["old", terminalState("/old")],
        ["project", terminalState("/home/me/project")],
      ]),
      launchCwd: "/home/me/project",
      explicitLaunch: true,
      home: "/home/me",
      allocId: counter(),
      createSpaceId: () => "new",
      now: () => 1,
    });

    expect(boot.activeId).toBe("project");
    expect(boot.spaces).toHaveLength(2);
    expect(boot.activeTabId).toBe(
      boot.tabs.find((t) => t.spaceId === "project")?.id,
    );
    expect(boot.saveSpaces).toBe(false);
    expect(boot.saveActiveId).toBe(true);
  });
});
