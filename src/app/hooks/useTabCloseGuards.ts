import type { Tab } from "@/modules/tabs";
import { leafHasForegroundProcess, leafIds } from "@/modules/terminal";
import { useCallback, useState } from "react";

type Params = {
  tabs: Tab[];
  disposeTab: (id: number) => void;
};

export type PendingBatchClose = {
  ids: number[];
  title: string;
  description: string;
} | null;

/**
 * Guards tab closing: dirty editors and terminals with a live foreground
 * process route through a confirmation dialog instead of closing immediately.
 * Owns the three pending-close states the dialogs render from.
 */
export function useTabCloseGuards({ tabs, disposeTab }: Params) {
  const [pendingCloseTab, setPendingCloseTab] = useState<number | null>(null);
  const [pendingTerminalCloseTab, setPendingTerminalCloseTab] = useState<
    number | null
  >(null);
  const [pendingDeleteTabs, setPendingDeleteTabs] = useState<number[] | null>(
    null,
  );
  const [pendingBatchClose, setPendingBatchClose] =
    useState<PendingBatchClose>(null);

  const handleClose = useCallback(
    async (id: number) => {
      const t = tabs.find((x) => x.id === id);
      if (t?.kind === "editor" && t.dirty) {
        setPendingCloseTab(id);
        return;
      }
      if (t?.kind === "terminal") {
        const leaves = leafIds(t.paneTree);
        const checks = await Promise.all(leaves.map(leafHasForegroundProcess));
        if (checks.some(Boolean)) {
          setPendingTerminalCloseTab(id);
          return;
        }
      }
      disposeTab(id);
    },
    [tabs, disposeTab],
  );

  const confirmClose = useCallback(() => {
    if (pendingCloseTab !== null) {
      disposeTab(pendingCloseTab);
      setPendingCloseTab(null);
    }
  }, [pendingCloseTab, disposeTab]);

  const cancelClose = useCallback(() => {
    setPendingCloseTab(null);
  }, []);

  const confirmTerminalClose = useCallback(() => {
    if (pendingTerminalCloseTab !== null) disposeTab(pendingTerminalCloseTab);
    setPendingTerminalCloseTab(null);
  }, [pendingTerminalCloseTab, disposeTab]);

  const cancelTerminalClose = useCallback(() => {
    setPendingTerminalCloseTab(null);
  }, []);

  const handleCloseMany = useCallback(
    async (
      ids: number[],
      label: { title: string; description: string },
    ): Promise<void> => {
      const requested = new Set(ids);
      const selected = tabs.filter((tab) => requested.has(tab.id));
      if (selected.length === 0) return;

      const hasDirtyEditor = selected.some(
        (tab) => tab.kind === "editor" && tab.dirty,
      );
      const terminalTabs = selected.filter((tab) => tab.kind === "terminal");
      const terminalChecks = await Promise.all(
        terminalTabs.flatMap((tab) =>
          tab.kind === "terminal"
            ? leafIds(tab.paneTree).map(leafHasForegroundProcess)
            : [],
        ),
      );
      const hasRunningTerminal = terminalChecks.some(Boolean);

      if (hasDirtyEditor || hasRunningTerminal) {
        setPendingBatchClose({
          ids: selected.map((tab) => tab.id),
          title: label.title,
          description: label.description,
        });
        return;
      }

      for (const tab of selected) disposeTab(tab.id);
    },
    [tabs, disposeTab],
  );

  const confirmBatchClose = useCallback(() => {
    if (pendingBatchClose !== null) {
      for (const id of pendingBatchClose.ids) disposeTab(id);
      setPendingBatchClose(null);
    }
  }, [pendingBatchClose, disposeTab]);

  const cancelBatchClose = useCallback(() => {
    setPendingBatchClose(null);
  }, []);

  const confirmDeleteClose = useCallback(() => {
    if (pendingDeleteTabs !== null) {
      for (const id of pendingDeleteTabs) disposeTab(id);
      setPendingDeleteTabs(null);
    }
  }, [pendingDeleteTabs, disposeTab]);

  const cancelDeleteClose = useCallback(() => {
    setPendingDeleteTabs(null);
  }, []);

  const handlePathDeleted = useCallback(
    (path: string) => {
      const dirty: number[] = [];
      for (const t of tabs) {
        if (t.kind !== "editor") continue;
        if (t.path !== path && !t.path.startsWith(`${path}/`)) continue;
        if (t.dirty) {
          dirty.push(t.id);
        } else {
          disposeTab(t.id);
        }
      }
      if (dirty.length > 0) setPendingDeleteTabs(dirty);
    },
    [tabs, disposeTab],
  );

  return {
    pendingCloseTab,
    pendingTerminalCloseTab,
    pendingDeleteTabs,
    pendingBatchClose,
    handleClose,
    handleCloseMany,
    confirmClose,
    cancelClose,
    confirmTerminalClose,
    cancelTerminalClose,
    confirmBatchClose,
    cancelBatchClose,
    confirmDeleteClose,
    cancelDeleteClose,
    handlePathDeleted,
  };
}
