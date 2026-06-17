import { useEffect, useRef } from "react";
import { native } from "@/modules/ai/lib/native";
import type { Tab } from "@/modules/tabs";
import { DEFAULT_SPACE_ID } from "@/modules/tabs/lib/useTabs";
import { isLeaf, type PaneNode } from "@/modules/terminal/lib/panes";
import { freshTerminalTab, hydrateTabs } from "./serialize";
import { loadAll, saveActiveId, saveSpacesList, type SpaceMeta } from "./store";
import { useSpaces } from "./useSpaces";

type Params = {
  ready: boolean;
  launchCwd: string | null;
  home: string | null;
  allocId: () => number;
  replaceTabs: (tabs: Tab[], activeId: number) => void;
  markBooted: () => void;
  setActiveSpaceForNewTabs: (id: string) => void;
};

function uniqueCwds(tabs: Tab[]): string[] {
  const set = new Set<string>();
  const walk = (n: PaneNode) => {
    if (isLeaf(n)) {
      if (n.cwd) set.add(n.cwd);
      return;
    }
    for (const c of n.children) walk(c);
  };
  for (const t of tabs) {
    if (t.kind !== "terminal") continue;
    if (t.cwd) set.add(t.cwd);
    walk(t.paneTree);
  }
  return [...set];
}

function fixBrokenCwds(
  tabs: Tab[],
  broken: Set<string>,
  fallback: string | null,
): void {
  const fix = (node: PaneNode) => {
    if (isLeaf(node)) {
      if (node.cwd && broken.has(node.cwd)) node.cwd = fallback ?? undefined;
      return;
    }
    for (const child of node.children) fix(child);
  };

  for (const tab of tabs) {
    if (tab.kind !== "terminal") continue;
    fix(tab.paneTree);
    if (tab.cwd && broken.has(tab.cwd)) tab.cwd = fallback ?? undefined;
  }
}

export function useSpacesBoot({
  ready,
  launchCwd,
  home,
  allocId,
  replaceTabs,
  markBooted,
  setActiveSpaceForNewTabs,
}: Params) {
  const done = useRef(false);

  useEffect(() => {
    if (!ready || done.current) return;
    done.current = true;

    void (async () => {
      try {
        const { spaces, activeId, states } = await loadAll();
        const fallback = launchCwd ?? home ?? null;

        if (spaces.length === 0) {
          const meta: SpaceMeta = {
            id: DEFAULT_SPACE_ID,
            name: "Default",
            root: fallback,
            env: { kind: "local" },
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          await saveSpacesList([meta]);
          await saveActiveId(DEFAULT_SPACE_ID);
          setActiveSpaceForNewTabs(DEFAULT_SPACE_ID);
          useSpaces.getState().hydrate([meta], DEFAULT_SPACE_ID);
          return;
        }

        const restored: Tab[] = [];
        for (const space of spaces) {
          const st = states.get(space.id);
          if (!st) continue;
          restored.push(...hydrateTabs(st.tabs, space.id, allocId));
        }

        const active =
          activeId && spaces.some((s) => s.id === activeId)
            ? activeId
            : spaces[0].id;
        setActiveSpaceForNewTabs(active);

        // Active space must never be empty, else its tab list shows nothing.
        if (!restored.some((t) => t.spaceId === active)) {
          restored.push(freshTerminalTab(active, fallback, allocId));
        }

        const cwds = uniqueCwds(restored);
        const authResults = await Promise.allSettled(
          cwds.map((cwd) => native.workspaceAuthorize(cwd)),
        );
        const failedCwds = new Set<string>();
        authResults.forEach((result, index) => {
          if (result.status === "rejected") failedCwds.add(cwds[index]);
        });
        if (failedCwds.size > 0) {
          fixBrokenCwds(restored, failedCwds, fallback);
          if (fallback) {
            await native.workspaceAuthorize(fallback).catch(() => undefined);
          }
        }

        const initialActiveIndex: Record<string, number> = {};
        for (const [id, st] of states)
          initialActiveIndex[id] = st.activeTabIndex;
        useSpaces.getState().hydrate(spaces, active, initialActiveIndex);

        const inActive = restored.filter((t) => t.spaceId === active);
        const idx = states.get(active)?.activeTabIndex ?? 0;
        const activeTab = inActive[idx] ?? inActive[0] ?? restored[0];
        replaceTabs(restored, activeTab.id);
      } catch (e) {
        console.error("[terax] spaces boot failed:", e);
      } finally {
        markBooted();
      }
    })();
  }, [
    ready,
    launchCwd,
    home,
    allocId,
    replaceTabs,
    markBooted,
    setActiveSpaceForNewTabs,
  ]);
}
