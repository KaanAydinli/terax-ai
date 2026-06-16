import { useEffect, useRef } from "react";
import { native } from "@/modules/ai/lib/native";
import type { Tab } from "@/modules/tabs";
import { DEFAULT_SPACE_ID } from "@/modules/tabs/lib/useTabs";
import { isLeaf, type PaneNode } from "@/modules/terminal/lib/panes";
import { LOCAL_WORKSPACE } from "@/modules/workspace";
import {
  fallbackCwd,
  recoverMissingTerminalCwds,
  sanitizeSpaceRoots,
} from "./boot";
import { freshTerminalTab, hydrateTabs, serializeTabs } from "./serialize";
import {
  loadAll,
  newSpaceId,
  saveActiveId,
  saveSpacesList,
  saveState,
  type SpaceMeta,
  type SpaceState,
} from "./store";
import { useSpaces } from "./useSpaces";

type Params = {
  ready: boolean;
  launchCwd: string | null;
  explicitLaunch: boolean;
  home: string | null;
  restoreWorkspaces: boolean;
  allocId: () => number;
  replaceTabs: (tabs: Tab[], activeId: number) => void;
  markBooted: () => void;
  setActiveSpaceForNewTabs: (id: string) => void;
};

type ResolveSpacesBootParams = {
  spaces: SpaceMeta[];
  activeId: string | null;
  states: Map<string, SpaceState>;
  launchCwd: string | null;
  explicitLaunch: boolean;
  home: string | null;
  allocId: () => number;
  createSpaceId?: () => string;
  now?: () => number;
};

type SpacesBootResolution = {
  spaces: SpaceMeta[];
  activeId: string;
  tabs: Tab[];
  activeTabId: number;
  initialActiveIndex: Record<string, number>;
  saveSpaces: boolean;
  saveActiveId: boolean;
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

function pathKey(path: string | null): string | null {
  if (!path) return null;
  const trimmed = path.replace(/\/+$/, "");
  return trimmed || "/";
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? "Workspace";
}

function findLaunchSpace(
  spaces: SpaceMeta[],
  launchCwd: string,
): SpaceMeta | undefined {
  const key = pathKey(launchCwd);
  return spaces.find(
    (space) => space.env.kind === "local" && pathKey(space.root) === key,
  );
}

export function resolveSpacesBoot({
  spaces,
  activeId,
  states,
  launchCwd,
  explicitLaunch,
  home,
  allocId,
  createSpaceId = newSpaceId,
  now = Date.now,
}: ResolveSpacesBootParams): SpacesBootResolution {
  let nextSpaces = spaces;
  let nextActiveId =
    activeId && spaces.some((s) => s.id === activeId)
      ? activeId
      : spaces[0]?.id;
  let saveSpaces = false;
  let saveActive = nextActiveId !== activeId;

  if (nextSpaces.length === 0) {
    const root = launchCwd ?? home ?? null;
    const meta: SpaceMeta = {
      id: DEFAULT_SPACE_ID,
      name: "Default",
      root,
      env: LOCAL_WORKSPACE,
      createdAt: now(),
      updatedAt: now(),
    };
    nextSpaces = [meta];
    nextActiveId = DEFAULT_SPACE_ID;
    saveSpaces = true;
    saveActive = activeId !== DEFAULT_SPACE_ID;
  } else if (explicitLaunch && launchCwd) {
    const existing = findLaunchSpace(nextSpaces, launchCwd);
    if (existing) {
      nextActiveId = existing.id;
      saveActive = activeId !== existing.id;
    } else {
      const meta: SpaceMeta = {
        id: createSpaceId(),
        name: basename(launchCwd),
        root: launchCwd,
        env: LOCAL_WORKSPACE,
        createdAt: now(),
        updatedAt: now(),
      };
      nextSpaces = [...nextSpaces, meta];
      nextActiveId = meta.id;
      saveSpaces = true;
      saveActive = true;
    }
  }

  const active = nextActiveId ?? DEFAULT_SPACE_ID;
  const restored: Tab[] = [];
  for (const space of nextSpaces) {
    const st = states.get(space.id);
    if (!st) continue;
    restored.push(...hydrateTabs(st.tabs, space.id, allocId));
  }

  if (!restored.some((t) => t.spaceId === active)) {
    const root = nextSpaces.find((s) => s.id === active)?.root;
    restored.push(freshTerminalTab(active, root ?? launchCwd ?? home, allocId));
  }

  const initialActiveIndex: Record<string, number> = {};
  for (const [id, st] of states) initialActiveIndex[id] = st.activeTabIndex;

  const inActive = restored.filter((t) => t.spaceId === active);
  const idx = states.get(active)?.activeTabIndex ?? 0;
  const activeTab = inActive[idx] ?? inActive[0] ?? restored[0];

  return {
    spaces: nextSpaces,
    activeId: active,
    tabs: restored,
    activeTabId: activeTab.id,
    initialActiveIndex,
    saveSpaces,
    saveActiveId: saveActive,
  };
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
    env: LOCAL_WORKSPACE,
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
  explicitLaunch,
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
        const boot = resolveSpacesBoot({
          spaces,
          activeId,
          states,
          launchCwd,
          explicitLaunch,
          home,
          allocId,
        });

        const validCwds = await existingDirectories([
          ...uniqueCwds(boot.tabs),
          ...boot.spaces.flatMap((space) => (space.root ? [space.root] : [])),
        ]);
        const spaceRecovery = sanitizeSpaceRoots(boot.spaces, validCwds, root);
        const tabRecovery = recoverMissingTerminalCwds(
          boot.tabs,
          validCwds,
          root,
        );
        const bootSpaces = spaceRecovery.spaces;
        const bootTabs = tabRecovery.tabs;
        const changed =
          boot.saveSpaces || spaceRecovery.changed || tabRecovery.changed;

        if (changed) await saveSpacesList(bootSpaces);
        if (boot.saveActiveId) await saveActiveId(boot.activeId);

        setActiveSpaceForNewTabs(boot.activeId);
        await Promise.allSettled(
          uniqueCwds(bootTabs).map((cwd) => native.workspaceAuthorize(cwd)),
        );
        useSpaces
          .getState()
          .hydrate(bootSpaces, boot.activeId, boot.initialActiveIndex);
        replaceTabs(bootTabs, boot.activeTabId);

        if (spaceRecovery.changed || tabRecovery.changed) {
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
    explicitLaunch,
    home,
    restoreWorkspaces,
    allocId,
    replaceTabs,
    markBooted,
    setActiveSpaceForNewTabs,
  ]);
}
