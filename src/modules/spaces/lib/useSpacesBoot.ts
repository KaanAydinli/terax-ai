import { useEffect, useRef } from "react";
import { native } from "@/modules/ai/lib/native";
import type { Tab } from "@/modules/tabs";
import { DEFAULT_SPACE_ID } from "@/modules/tabs/lib/useTabs";
import { isLeaf, type PaneNode } from "@/modules/terminal/lib/panes";
import {
  fallbackCwd,
  recoverMissingTerminalCwds,
  sanitizeSpaceRoots,
} from "./boot";
import { freshTerminalTab, hydrateTabs, serializeTabs } from "./serialize";
import {
  loadAll,
  saveActiveId,
  saveSpacesList,
  saveState,
  type SpaceMeta,
} from "./store";
import { useSpaces } from "./useSpaces";

type Params = {
  ready: boolean;
  launchCwd: string | null;
  home: string | null;
  restoreWorkspaces: boolean;
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
  for (const t of tabs) if (t.kind === "terminal") walk(t.paneTree);
  return [...set];
}

async function existingDirectories(paths: string[]): Promise<Set<string>> {
  const unique = [...new Set(paths.filter(Boolean))];
  const result = await Promise.all(
    unique.map(async (path) => {
      try {
        const stat = await native.stat(path);
        return stat.kind === "dir" ? path : null;
      } catch {
        return null;
      }
    }),
  );
  return new Set(result.filter((path): path is string => path !== null));
}

async function bootFresh(
  root: string | null,
  allocId: () => number,
  replaceTabs: (tabs: Tab[], activeId: number) => void,
  setActiveSpaceForNewTabs: (id: string) => void,
): Promise<void> {
  const meta: SpaceMeta = {
    id: DEFAULT_SPACE_ID,
    name: "Default",
    root,
    env: { kind: "local" },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const tab = freshTerminalTab(DEFAULT_SPACE_ID, root, allocId);
  await saveSpacesList([meta]);
  await saveActiveId(DEFAULT_SPACE_ID);
  await saveState(DEFAULT_SPACE_ID, {
    tabs: serializeTabs([tab]),
    activeTabIndex: 0,
  });
  setActiveSpaceForNewTabs(DEFAULT_SPACE_ID);
  useSpaces.getState().hydrate([meta], DEFAULT_SPACE_ID, {
    [DEFAULT_SPACE_ID]: 0,
  });
  replaceTabs([tab], tab.id);
}

export function useSpacesBoot({
  ready,
  launchCwd,
  home,
  restoreWorkspaces,
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
        const root = fallbackCwd(launchCwd, home);
        if (!restoreWorkspaces) {
          await bootFresh(root, allocId, replaceTabs, setActiveSpaceForNewTabs);
          return;
        }

        const { spaces, activeId, states } = await loadAll();

        if (spaces.length === 0) {
          await bootFresh(root, allocId, replaceTabs, setActiveSpaceForNewTabs);
          return;
        }

        const restored: Tab[] = [];
        for (const space of spaces) {
          const st = states.get(space.id);
          if (!st) continue;
          restored.push(...hydrateTabs(st.tabs, space.id, allocId));
        }

        const validCwds = await existingDirectories([
          ...uniqueCwds(restored),
          ...spaces.flatMap((space) => (space.root ? [space.root] : [])),
        ]);
        const spaceRecovery = sanitizeSpaceRoots(spaces, validCwds, root);
        const tabRecovery = recoverMissingTerminalCwds(
          restored,
          validCwds,
          root,
        );
        const bootSpaces = spaceRecovery.spaces;
        const bootTabs = tabRecovery.tabs;

        const active =
          activeId && bootSpaces.some((s) => s.id === activeId)
            ? activeId
            : bootSpaces[0].id;
        setActiveSpaceForNewTabs(active);

        // Active space must never be empty, else its tab list shows nothing.
        let changed = spaceRecovery.changed || tabRecovery.changed;
        if (!bootTabs.some((t) => t.spaceId === active)) {
          bootTabs.push(freshTerminalTab(active, root, allocId));
          changed = true;
        }

        await Promise.allSettled(
          uniqueCwds(bootTabs).map((cwd) => native.workspaceAuthorize(cwd)),
        );

        const initialActiveIndex: Record<string, number> = {};
        for (const [id, st] of states)
          initialActiveIndex[id] = st.activeTabIndex;
        useSpaces.getState().hydrate(bootSpaces, active, initialActiveIndex);

        const inActive = bootTabs.filter((t) => t.spaceId === active);
        const idx = states.get(active)?.activeTabIndex ?? 0;
        const activeTab = inActive[idx] ?? inActive[0] ?? bootTabs[0];
        replaceTabs(bootTabs, activeTab.id);

        if (changed) {
          await saveSpacesList(bootSpaces);
          if (active !== activeId) await saveActiveId(active);
          for (const space of bootSpaces) {
            const tabsForSpace = bootTabs.filter((t) => t.spaceId === space.id);
            if (tabsForSpace.length === 0) continue;
            await saveState(space.id, {
              tabs: serializeTabs(tabsForSpace),
              activeTabIndex: states.get(space.id)?.activeTabIndex ?? 0,
            });
          }
        }
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
    restoreWorkspaces,
    allocId,
    replaceTabs,
    markBooted,
    setActiveSpaceForNewTabs,
  ]);
}
