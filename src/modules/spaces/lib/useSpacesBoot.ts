import { useEffect, useRef } from "react";
import { native } from "@/modules/ai/lib/native";
import type { Tab } from "@/modules/tabs";
import { DEFAULT_SPACE_ID } from "@/modules/tabs/lib/useTabs";
import { isLeaf, type PaneNode } from "@/modules/terminal/lib/panes";
import { LOCAL_WORKSPACE } from "@/modules/workspace";
import { freshTerminalTab, hydrateTabs } from "./serialize";
import {
  loadAll,
  newSpaceId,
  saveActiveId,
  saveSpacesList,
  type SpaceMeta,
  type SpaceState,
} from "./store";
import { useSpaces } from "./useSpaces";

type Params = {
  ready: boolean;
  launchCwd: string | null;
  explicitLaunch: boolean;
  home: string | null;
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

export function useSpacesBoot({
  ready,
  launchCwd,
  explicitLaunch,
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
        const boot = resolveSpacesBoot({
          spaces,
          activeId,
          states,
          launchCwd,
          explicitLaunch,
          home,
          allocId,
        });

        if (boot.saveSpaces) await saveSpacesList(boot.spaces);
        if (boot.saveActiveId) await saveActiveId(boot.activeId);

        setActiveSpaceForNewTabs(boot.activeId);
        await Promise.allSettled(
          uniqueCwds(boot.tabs).map((cwd) => native.workspaceAuthorize(cwd)),
        );
        useSpaces
          .getState()
          .hydrate(boot.spaces, boot.activeId, boot.initialActiveIndex);
        replaceTabs(boot.tabs, boot.activeTabId);
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
    allocId,
    replaceTabs,
    markBooted,
    setActiveSpaceForNewTabs,
  ]);
}
