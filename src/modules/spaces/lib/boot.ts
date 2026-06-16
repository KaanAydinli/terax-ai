import type { Tab } from "@/modules/tabs";
import { isLeaf, type PaneNode } from "@/modules/terminal/lib/panes";
import type { SpaceMeta } from "./store";

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

export function fallbackCwd(
  launchCwd: string | null,
  home: string | null,
): string | null {
  return launchCwd ?? home ?? null;
}

function mapNodeCwd(
  node: PaneNode,
  validCwds: Set<string>,
  fallback: string | null,
): { node: PaneNode; changed: boolean } {
  if (isLeaf(node)) {
    if (!node.cwd || validCwds.has(node.cwd)) return { node, changed: false };
    const next = { ...node };
    if (fallback) next.cwd = fallback;
    else delete next.cwd;
    return {
      node: next,
      changed: true,
    };
  }

  let changed = false;
  const children = node.children.map((child) => {
    const mapped = mapNodeCwd(child, validCwds, fallback);
    if (mapped.changed) changed = true;
    return mapped.node;
  });
  return { node: changed ? { ...node, children } : node, changed };
}

function leaves(node: PaneNode): Array<{ id: number; cwd?: string }> {
  if (isLeaf(node)) return [{ id: node.id, cwd: node.cwd }];
  return node.children.flatMap(leaves);
}

export function recoverMissingTerminalCwds(
  tabs: Tab[],
  validCwds: Set<string>,
  fallback: string | null,
): { tabs: Tab[]; changed: boolean } {
  let changed = false;
  const next = tabs.map((tab) => {
    if (tab.kind !== "terminal") return tab;
    const mapped = mapNodeCwd(tab.paneTree, validCwds, fallback);
    if (!mapped.changed) return tab;

    changed = true;
    const leafList = leaves(mapped.node);
    const active = leafList.find((leaf) => leaf.id === tab.activeLeafId);
    const cwd = active?.cwd ?? leafList[0]?.cwd;
    return {
      ...tab,
      paneTree: mapped.node,
      cwd,
      title:
        tab.customTitle ??
        (cwd ? basename(cwd) : tab.blocks ? "blocks" : "shell"),
    };
  });
  return { tabs: next, changed };
}

export function sanitizeSpaceRoots(
  spaces: SpaceMeta[],
  validCwds: Set<string>,
  fallback: string | null,
): { spaces: SpaceMeta[]; changed: boolean } {
  let changed = false;
  const next = spaces.map((space) => {
    if (!space.root || validCwds.has(space.root)) return space;
    changed = true;
    return { ...space, root: fallback, updatedAt: Date.now() };
  });
  return { spaces: next, changed };
}
