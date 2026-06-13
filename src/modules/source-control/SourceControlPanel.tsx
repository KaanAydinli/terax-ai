import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { IS_MAC } from "@/lib/platform";
import { cn } from "@/lib/utils";
import {
  type GitBranchEntry,
  type GitLogEntry,
  native,
} from "@/modules/ai/lib/native";
import {
  copyToClipboard,
  revealInFinder,
} from "@/modules/explorer/lib/contextActions";
import { fileIconUrl } from "@/modules/explorer/lib/iconResolver";
import {
  COMPACT_CONTENT,
  COMPACT_ITEM,
} from "@/modules/explorer/lib/menuItemClass";
import { joinPath } from "@/modules/explorer/lib/useFileTree";
import {
  GraphRail,
  MAX_VISIBLE_LANES,
  railWidth,
} from "@/modules/git-history/GraphRail";
import {
  EMPTY_GRAPH_STATE,
  type GraphRow,
  type GraphState,
  layoutGraph,
} from "@/modules/git-history/lib/graph";
import {
  AiContentGenerator02Icon,
  Alert02Icon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  CheckmarkCircle01Icon,
  Download01Icon,
  FolderCloudIcon,
  FolderGitTwoIcon,
  GitBranchIcon,
  Refresh01Icon,
  RemoveSquareIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type KeyboardEvent,
  memo,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { SourceControlSummary } from "./useSourceControl";
import {
  type CheckState,
  type SourceControlFileEntry,
  useSourceControlPanel,
} from "./useSourceControlPanel";

type Props = {
  open: boolean;
  sourceControl: SourceControlSummary;
  onOpenDiff: (input: {
    path: string;
    repoRoot: string;
    mode: "+" | "-";
    originalPath: string | null;
    title?: string;
  }) => void;
  onOpenFile?: (absolutePath: string) => void;
};

const SOURCE_CONTROL_TOOLTIP_CLASS =
  "border border-border/70 bg-zinc-950 text-zinc-100 shadow-lg shadow-black/30 dark:border-border/60 dark:bg-zinc-950 dark:text-zinc-100";

const ROW_HEIGHTS = {
  banner: 32,
  header: 30,
  entry: 30,
} as const;

const GRAPH_PAGE_SIZE = 40;
const GRAPH_ROW_HEIGHT = 30;
const GRAPH_NEAR_BOTTOM_PX = 180;
const MIN_GRAPH_HEIGHT = 140;
const MAX_GRAPH_HEIGHT = 520;
const GRAPH_RAIL_RESERVED_PX = railWidth(MAX_VISIBLE_LANES) + 2;

type RowDescriptor =
  | { kind: "banner-diverged"; key: string }
  | { kind: "list-header"; key: string; count: number }
  | { kind: "entry"; key: string; entry: SourceControlFileEntry };

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

function dirname(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return "";
  return normalized.slice(0, index);
}

function entryPathLabel(entry: SourceControlFileEntry): string {
  if (entry.originalPath) return `${entry.originalPath} → ${entry.path}`;
  return dirname(entry.path);
}

function upstreamBadgeLabel(upstream: string | null | undefined): string {
  if (!upstream) return "No upstream";
  return upstream;
}

function normalizeError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Unknown Git error";
}

function statusAccent(code: string): string {
  switch (code) {
    case "A":
      return "bg-emerald-500/85";
    case "U":
      return "bg-teal-500/85";
    case "M":
      return "bg-amber-500/85";
    case "D":
      return "bg-rose-500/85";
    case "R":
      return "bg-sky-500/85";
    default:
      return "bg-muted-foreground/40";
  }
}

function checkboxValue(state: CheckState): boolean | "indeterminate" {
  if (state === "checked") return true;
  if (state === "indeterminate") return "indeterminate";
  return false;
}

export const SourceControlPanel = memo(function SourceControlPanel({
  open,
  sourceControl,
  onOpenDiff,
  onOpenFile,
}: Props) {
  const scm = useSourceControlPanel(open, sourceControl, onOpenDiff);
  const refreshAnimationRef = useRef<number | null>(null);
  const [refreshAnimating, setRefreshAnimating] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [focusedRowKey, setFocusedRowKey] = useState<string | null>(null);
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const [branches, setBranches] = useState<GitBranchEntry[]>([]);
  const [branchLoading, setBranchLoading] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [switchingBranch, setSwitchingBranch] = useState<string | null>(null);
  const [worktreeCollapsed, setWorktreeCollapsed] = useState(false);
  const [graphCollapsed, setGraphCollapsed] = useState(false);
  const [graphHeight, setGraphHeight] = useState(260);
  const graphResizeRef = useRef<{
    startY: number;
    startHeight: number;
  } | null>(null);

  useEffect(() => {
    return () => {
      if (refreshAnimationRef.current) {
        window.clearTimeout(refreshAnimationRef.current);
      }
    };
  }, []);

  const isRefreshing = scm.panelState === "loading";
  const repoLabel = useMemo(() => {
    if (!scm.status) return "Source Control";
    return scm.status.isDetached ? "detached" : scm.status.branch;
  }, [scm.status]);
  const repoRoot = scm.status?.repoRoot ?? sourceControl.repo?.repoRoot ?? null;

  const commitShortcut = IS_MAC ? "⌘↩" : "Ctrl+Enter";
  const generateShortcut = IS_MAC ? "⌘G" : "Ctrl+G";
  const canCommit =
    scm.stagedEntries.length > 0 &&
    scm.commitMessage.trim().length > 0 &&
    !scm.actionBusy;
  const commitDisabledReason = scm.actionBusy
    ? "Wait for the current Git action to finish."
    : scm.stagedEntries.length === 0
      ? "Stage changes to enable commit."
      : scm.commitMessage.trim().length === 0
        ? "Enter a commit message to enable commit."
        : null;
  const commitHint = canCommit
    ? `Commit with ${commitShortcut}.`
    : (commitDisabledReason ?? `Commit with ${commitShortcut}.`);
  const pushHint = scm.pushHint ?? "Push is unavailable right now.";
  const pushDisabledReason = scm.actionBusy
    ? "Wait for the current Git action to finish."
    : pushHint;
  const stagedCount = scm.stagedEntries.length;
  const changedCount = scm.fileEntries.length;
  const pushStatusLabel = upstreamBadgeLabel(scm.status?.upstream);
  const hasUpstream = !!scm.status?.upstream;
  const isDiverged =
    !!scm.status && scm.status.ahead > 0 && scm.status.behind > 0;
  const graphRefreshKey =
    scm.status && scm.actionBusy === null
      ? [
          scm.status.branch,
          scm.status.ahead,
          scm.status.behind,
          scm.status.changedFiles.length,
        ].join(":")
      : null;

  const canPull =
    hasUpstream &&
    !!scm.status &&
    scm.status.behind > 0 &&
    !isDiverged &&
    !scm.actionBusy &&
    !sourceControl.busyAction;
  const canPush =
    hasUpstream &&
    !!scm.status &&
    scm.status.ahead > 0 &&
    scm.status.behind === 0 &&
    !scm.actionBusy &&
    !sourceControl.busyAction;
  const canFetch = hasUpstream && !scm.actionBusy && !sourceControl.busyAction;
  const canSwitchBranch =
    !!repoRoot && !scm.actionBusy && !sourceControl.busyAction;

  const footerFeedback = useMemo(() => {
    if (scm.actionError)
      return { tone: "error", message: scm.actionError } as const;
    if (scm.remoteError)
      return { tone: "error", message: scm.remoteError } as const;
    if (scm.actionMessage)
      return { tone: "success", message: scm.actionMessage } as const;
    return null;
  }, [scm.actionError, scm.actionMessage, scm.remoteError]);

  const handleCommitShortcut = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      (event.metaKey || event.ctrlKey) &&
      canCommit
    ) {
      event.preventDefault();
      void scm.commit();
      return;
    }
    if (
      event.key.toLowerCase() === "g" &&
      (event.metaKey || event.ctrlKey) &&
      scm.canGenerateCommitMessage
    ) {
      event.preventDefault();
      void scm.generateCommitMessage();
    }
  };

  const handleRefresh = useCallback(() => {
    setRefreshAnimating(true);
    if (refreshAnimationRef.current) {
      window.clearTimeout(refreshAnimationRef.current);
    }
    void scm.refresh().finally(() => {
      refreshAnimationRef.current = window.setTimeout(() => {
        setRefreshAnimating(false);
        refreshAnimationRef.current = null;
      }, 450);
    });
  }, [scm]);

  const beginGraphResize = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (worktreeCollapsed || graphCollapsed) return;
      event.preventDefault();
      graphResizeRef.current = {
        startY: event.clientY,
        startHeight: graphHeight,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [graphCollapsed, graphHeight, worktreeCollapsed],
  );

  const updateGraphResize = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const resize = graphResizeRef.current;
      if (!resize) return;
      const next = resize.startHeight - (event.clientY - resize.startY);
      setGraphHeight(
        Math.min(MAX_GRAPH_HEIGHT, Math.max(MIN_GRAPH_HEIGHT, next)),
      );
    },
    [],
  );

  const endGraphResize = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!graphResizeRef.current) return;
    graphResizeRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  const handleFetch = useCallback(() => {
    void sourceControl.runRemoteAction("fetch");
  }, [sourceControl]);

  const handlePull = useCallback(() => {
    void sourceControl.runRemoteAction("pull");
  }, [sourceControl]);

  const handlePush = useCallback(() => {
    void scm.push();
  }, [scm]);

  const loadBranches = useCallback(async () => {
    if (!repoRoot) return;
    setBranchLoading(true);
    setBranchError(null);
    try {
      setBranches(await native.gitBranches(repoRoot));
    } catch (error) {
      setBranchError(normalizeError(error));
    } finally {
      setBranchLoading(false);
    }
  }, [repoRoot]);

  useEffect(() => {
    if (!branchPickerOpen) return;
    void loadBranches();
  }, [branchPickerOpen, loadBranches]);

  const handleSwitchBranch = useCallback(
    async (branch: GitBranchEntry) => {
      if (!repoRoot || branch.current || switchingBranch) return;
      setSwitchingBranch(branch.name);
      setBranchError(null);
      try {
        await native.gitSwitchBranch(repoRoot, branch);
        setBranchPickerOpen(false);
        await sourceControl.refresh({ remote: "never" });
      } catch (error) {
        setBranchError(normalizeError(error));
      } finally {
        setSwitchingBranch(null);
      }
    },
    [repoRoot, sourceControl, switchingBranch],
  );

  const rows = useMemo<RowDescriptor[]>(() => {
    const result: RowDescriptor[] = [];
    if (isDiverged) {
      result.push({ kind: "banner-diverged", key: "banner-diverged" });
    }
    if (changedCount > 0) {
      result.push({
        kind: "list-header",
        key: "list-header",
        count: changedCount,
      });
      for (const entry of scm.fileEntries) {
        result.push({ kind: "entry", key: entry.key, entry });
      }
    }
    return result;
  }, [changedCount, isDiverged, scm.fileEntries]);

  const rowKeyToIndex = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((row, index) => {
      map.set(row.key, index);
    });
    return map;
  }, [rows]);

  useEffect(() => {
    if (!focusedRowKey) return;
    if (!rowKeyToIndex.has(focusedRowKey)) {
      setFocusedRowKey(null);
    }
  }, [focusedRowKey, rowKeyToIndex]);

  const focusableIndices = useMemo(() => {
    const out: number[] = [];
    rows.forEach((row, index) => {
      if (row.kind === "entry") out.push(index);
    });
    return out;
  }, [rows]);

  const estimateSize = useCallback(
    (index: number) => {
      const row = rows[index];
      if (!row) return ROW_HEIGHTS.entry;
      switch (row.kind) {
        case "banner-diverged":
          return ROW_HEIGHTS.banner;
        case "list-header":
          return ROW_HEIGHTS.header;
        case "entry":
          return ROW_HEIGHTS.entry;
      }
    },
    [rows],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    overscan: 12,
    getItemKey: (index) => rows[index]?.key ?? index,
  });

  const moveFocus = useCallback(
    (direction: 1 | -1) => {
      if (focusableIndices.length === 0) return;
      const currentIndex =
        focusedRowKey === null ? -1 : (rowKeyToIndex.get(focusedRowKey) ?? -1);
      let pos = focusableIndices.indexOf(currentIndex);
      if (pos === -1) pos = direction > 0 ? -1 : focusableIndices.length;
      let nextPos = pos + direction;
      if (nextPos < 0) nextPos = 0;
      if (nextPos > focusableIndices.length - 1)
        nextPos = focusableIndices.length - 1;
      const targetRowIndex = focusableIndices[nextPos];
      const target = rows[targetRowIndex];
      if (!target) return;
      setFocusedRowKey(target.key);
      virtualizer.scrollToIndex(targetRowIndex, { align: "auto" });
    },
    [focusableIndices, focusedRowKey, rowKeyToIndex, rows, virtualizer],
  );

  const focusedEntry = useCallback((): SourceControlFileEntry | null => {
    if (!focusedRowKey) return null;
    const index = rowKeyToIndex.get(focusedRowKey);
    if (index === undefined) return null;
    const row = rows[index];
    return row && row.kind === "entry" ? row.entry : null;
  }, [focusedRowKey, rowKeyToIndex, rows]);

  const handlePanelKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "TEXTAREA" ||
          target.tagName === "INPUT" ||
          target.closest("button"))
      ) {
        return;
      }
      const meta = event.metaKey || event.ctrlKey;
      if (meta && (event.key === "r" || event.key === "R")) {
        event.preventDefault();
        handleRefresh();
        return;
      }
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          moveFocus(1);
          break;
        case "ArrowUp":
          event.preventDefault();
          moveFocus(-1);
          break;
        case "Enter": {
          const entry = focusedEntry();
          if (entry) {
            event.preventDefault();
            void scm.selectFile(entry);
          }
          break;
        }
        case " ":
        case "s":
        case "S": {
          if (meta) break;
          const entry = focusedEntry();
          if (entry) {
            event.preventDefault();
            void scm.toggleStageFile(entry);
          }
          break;
        }
        case "d":
        case "D": {
          if (meta) break;
          const entry = focusedEntry();
          if (entry?.unstaged) {
            event.preventDefault();
            scm.requestDiscardFile(entry);
          }
          break;
        }
      }
    },
    [focusedEntry, handleRefresh, moveFocus, scm],
  );

  if (!open) return null;

  const fetchBusy = sourceControl.busyAction === "fetch";
  const pullBusy = sourceControl.busyAction === "pull";
  const pushBusy = sourceControl.busyAction === "push";

  return (
    <TooltipProvider delayDuration={800} skipDelayDuration={300}>
      <aside className="flex h-full min-w-0 flex-col bg-card/80 backdrop-blur [contain:layout_style]">
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border/50 px-3 pb-2.5 pt-3">
          <div className="flex min-w-0 items-center gap-1.5">
            <Popover open={branchPickerOpen} onOpenChange={setBranchPickerOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={!repoRoot}
                  className="inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md bg-foreground/5 px-2 py-1 text-[11.5px] font-medium leading-none text-foreground transition-colors hover:bg-foreground/10 disabled:cursor-default disabled:opacity-70"
                >
                  <HugeiconsIcon
                    icon={FolderGitTwoIcon}
                    size={12}
                    strokeWidth={1.9}
                    className="shrink-0 text-muted-foreground"
                  />
                  <span className="max-w-[140px] truncate">{repoLabel}</span>
                  <HugeiconsIcon
                    icon={ArrowDown01Icon}
                    size={10}
                    strokeWidth={2}
                    className="shrink-0 text-muted-foreground/70"
                  />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-72 gap-0 rounded-xl border border-border/70 bg-popover p-1 shadow-xl"
              >
                <div className="flex items-center gap-2 px-2 py-1.5 text-[11px] font-semibold text-muted-foreground">
                  <HugeiconsIcon
                    icon={GitBranchIcon}
                    size={13}
                    strokeWidth={1.9}
                  />
                  Branches
                </div>
                <div className="max-h-72 overflow-y-auto py-1">
                  {branchLoading ? (
                    <div className="flex items-center gap-2 px-2 py-2 text-[11.5px] text-muted-foreground">
                      <Spinner className="size-3" />
                      Loading branches...
                    </div>
                  ) : branches.length === 0 ? (
                    <div className="px-2 py-2 text-[11.5px] text-muted-foreground">
                      No branches found.
                    </div>
                  ) : (
                    branches.map((branch) => (
                      <button
                        key={`${branch.kind}:${branch.name}`}
                        type="button"
                        disabled={
                          branch.current ||
                          !canSwitchBranch ||
                          switchingBranch !== null
                        }
                        onClick={() => void handleSwitchBranch(branch)}
                        className={cn(
                          "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors",
                          branch.current
                            ? "bg-accent/45 text-foreground"
                            : "text-muted-foreground hover:bg-accent/35 hover:text-foreground",
                          "disabled:cursor-default",
                        )}
                      >
                        {switchingBranch === branch.name ? (
                          <Spinner className="size-3 shrink-0" />
                        ) : branch.current ? (
                          <HugeiconsIcon
                            icon={CheckmarkCircle01Icon}
                            size={13}
                            strokeWidth={1.9}
                            className="shrink-0 text-emerald-500"
                          />
                        ) : (
                          <HugeiconsIcon
                            icon={GitBranchIcon}
                            size={13}
                            strokeWidth={1.8}
                            className="shrink-0"
                          />
                        )}
                        <span className="min-w-0 flex-1 truncate">
                          {branch.name}
                        </span>
                        <span className="shrink-0 rounded border border-border/55 px-1 py-0.5 text-[9.5px] uppercase leading-none text-muted-foreground/75">
                          {branch.kind}
                        </span>
                      </button>
                    ))
                  )}
                </div>
                {branchError ? (
                  <div className="border-t border-border/60 px-2 py-1.5 text-[11px] text-destructive">
                    {branchError}
                  </div>
                ) : null}
              </PopoverContent>
            </Popover>
            {scm.status && (scm.status.ahead > 0 || scm.status.behind > 0) ? (
              <div className="flex shrink-0 items-center gap-0.5 text-[10px] font-semibold tabular-nums leading-none text-muted-foreground">
                {scm.status.ahead > 0 ? (
                  <span className="inline-flex items-center gap-0.5 rounded-md border border-border/60 px-1 py-0.5">
                    <HugeiconsIcon
                      icon={ArrowUp01Icon}
                      size={9}
                      strokeWidth={2.2}
                    />
                    {scm.status.ahead}
                  </span>
                ) : null}
                {scm.status.behind > 0 ? (
                  <span className="inline-flex items-center gap-0.5 rounded-md border border-border/60 px-1 py-0.5">
                    <HugeiconsIcon
                      icon={ArrowDown01Icon}
                      size={9}
                      strokeWidth={2.2}
                    />
                    {scm.status.behind}
                  </span>
                ) : null}
              </div>
            ) : null}
            {scm.status?.isDetached ? (
              <span className="rounded bg-muted/55 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                detached
              </span>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <IconActionButton
              label={fetchBusy ? "Fetching…" : "Fetch from remote"}
              disabled={!canFetch}
              onClick={handleFetch}
              side="bottom"
            >
              {fetchBusy ? (
                <Spinner className="size-3" />
              ) : (
                <HugeiconsIcon
                  icon={FolderCloudIcon}
                  size={14}
                  strokeWidth={1.85}
                />
              )}
            </IconActionButton>
            <IconActionButton
              label={
                pullBusy
                  ? "Pulling…"
                  : isDiverged
                    ? "Branch diverged — resolve in terminal"
                    : !hasUpstream
                      ? "No upstream configured"
                      : (scm.status?.behind ?? 0) === 0
                        ? "Already up to date"
                        : `Pull ${scm.status?.behind ?? 0} commits (fast-forward)`
              }
              disabled={!canPull}
              onClick={handlePull}
              side="bottom"
            >
              {pullBusy ? (
                <Spinner className="size-3" />
              ) : (
                <HugeiconsIcon
                  icon={Download01Icon}
                  size={14}
                  strokeWidth={1.9}
                />
              )}
            </IconActionButton>
            {scm.status && scm.status.ahead > 0 ? (
              <IconActionButton
                label={
                  pushBusy
                    ? "Pushing…"
                    : isDiverged
                      ? "Branch diverged — pull/rebase before pushing"
                      : !hasUpstream
                        ? "No upstream configured"
                        : `Push ${scm.status.ahead} local ${
                            scm.status.ahead === 1 ? "commit" : "commits"
                          } to ${scm.status.upstream}`
                }
                disabled={!canPush}
                onClick={handlePush}
                side="bottom"
              >
                {pushBusy ? (
                  <Spinner className="size-3" />
                ) : (
                  <HugeiconsIcon
                    icon={ArrowUp01Icon}
                    size={14}
                    strokeWidth={1.9}
                  />
                )}
              </IconActionButton>
            ) : null}
            <IconActionButton
              label="Refresh source control"
              disabled={isRefreshing || !!scm.actionBusy}
              onClick={handleRefresh}
              side="bottom"
            >
              {isRefreshing ? (
                <Spinner className="size-3.5" />
              ) : (
                <HugeiconsIcon
                  icon={Refresh01Icon}
                  size={14}
                  strokeWidth={1.9}
                  className={cn(refreshAnimating && "animate-spin")}
                />
              )}
            </IconActionButton>
          </div>
        </header>

        {scm.panelState === "loading" ? (
          <PanelCenter title="Loading repository" />
        ) : null}

        {scm.panelState === "no-repo" ? (
          <PanelCenter
            title="No repository"
            body="The active workspace is not inside a Git repository."
          />
        ) : null}

        {scm.panelState === "error" ? (
          <PanelCenter
            title="Source control error"
            body={scm.statusError ?? "Unknown source control error"}
            action={
              <Button size="sm" onClick={() => void scm.refresh()}>
                Retry
              </Button>
            }
          />
        ) : null}

        {scm.panelState === "ready" && scm.status ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <SectionToggleHeader
              title="Changes"
              count={changedCount}
              collapsed={worktreeCollapsed}
              onToggle={() => setWorktreeCollapsed((v) => !v)}
            />
            {!worktreeCollapsed ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="relative shrink-0 space-y-2 border-b border-border/40 bg-gradient-to-b from-card/65 to-card/30 px-2.5 pb-2.5 pt-2.5">
                  <div
                    className={cn(
                      "relative rounded-lg border bg-background/95 shadow-sm transition-colors",
                      scm.commitMessage.length > 0
                        ? "border-border/70"
                        : "border-border/45",
                      "focus-within:border-primary/45 focus-within:shadow-md focus-within:shadow-primary/5",
                    )}
                  >
                    <Textarea
                      value={scm.commitMessage}
                      onChange={(event) =>
                        scm.setCommitMessage(event.target.value)
                      }
                      onKeyDown={handleCommitShortcut}
                      placeholder="Commit message"
                      rows={3}
                      className={cn(
                        "min-h-[72px] border-border resize-none rounded-lg bg-transparent px-3 pb-7 pt-2.5 text-[12.5px] leading-snug shadow-none placeholder:text-muted-foreground/65 focus-visible:ring-0 focus:border-0",
                      )}
                    />
                    <div className="pointer-events-none absolute inset-x-3 bottom-1.5 flex items-center justify-between gap-2 p-1 text-[10px] tabular-nums text-muted-foreground/55">
                      {scm.commitMessage.length > 0 ? (
                        <span>Ch: {scm.commitMessage.length}</span>
                      ) : (
                        <span className="flex items-center gap-2">
                          {commitShortcut} <p>to commit</p>
                        </span>
                      )}
                    </div>
                    <div className="absolute right-1 top-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            aria-label={`${scm.generateCommitMessageHint} (${generateShortcut})`}
                            disabled={!scm.canGenerateCommitMessage}
                            onClick={() => void scm.generateCommitMessage()}
                            className={cn(
                              "inline-flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground/65 transition-colors",
                              "hover:bg-foreground/[0.06] hover:text-foreground",
                              "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted-foreground/65",
                            )}
                          >
                            {scm.actionBusy === "generate-message" ? (
                              <Spinner className="size-3" />
                            ) : (
                              <HugeiconsIcon
                                icon={AiContentGenerator02Icon}
                                size={14}
                                strokeWidth={1.75}
                              />
                            )}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent
                          side="left"
                          className={cn(
                            SOURCE_CONTROL_TOOLTIP_CLASS,
                            "text-[10.5px]",
                          )}
                        >
                          {`${scm.generateCommitMessageHint} (${generateShortcut})`}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>

                  <div className="flex min-w-0 items-center gap-1.5 text-[10.5px] text-muted-foreground">
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full transition-colors",
                        canCommit
                          ? "bg-foreground/80"
                          : stagedCount > 0
                            ? "bg-muted-foreground/60"
                            : "bg-muted-foreground/30",
                      )}
                    />
                    <span className="truncate font-medium text-foreground/85">
                      {stagedCount === 0
                        ? "Nothing staged"
                        : `${stagedCount} ${stagedCount === 1 ? "file" : "files"} staged`}
                    </span>
                    <span className="ml-auto shrink-0 truncate text-muted-foreground/65">
                      {pushStatusLabel}
                    </span>
                  </div>

                  <div className="grid w-full grid-cols-2 gap-1.5">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="xs"
                          className="h-7 cursor-pointer text-[11.5px] font-semibold tracking-tight shadow-sm disabled:cursor-not-allowed disabled:shadow-none"
                          disabled={!canCommit}
                          onClick={() => void scm.commit()}
                        >
                          {scm.actionBusy === "commit"
                            ? "Committing..."
                            : "Commit"}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent
                        side="bottom"
                        className={cn(
                          SOURCE_CONTROL_TOOLTIP_CLASS,
                          "text-[10.5px]",
                        )}
                      >
                        {commitHint}
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="xs"
                          variant="secondary"
                          className="h-7 cursor-pointer text-[11.5px] font-medium disabled:cursor-not-allowed"
                          disabled={!scm.canPush || !!scm.actionBusy}
                          onClick={() => void scm.push()}
                        >
                          {scm.actionBusy === "push" ? "Pushing..." : "Push"}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent
                        side="bottom"
                        className={cn(
                          SOURCE_CONTROL_TOOLTIP_CLASS,
                          "max-w-64 text-[10.5px]",
                        )}
                      >
                        {pushDisabledReason}
                      </TooltipContent>
                    </Tooltip>
                  </div>

                  <CommitFeedback feedback={footerFeedback} />
                </div>

                {scm.allClean ? (
                  <CleanTreeHint repoLabel={repoLabel} />
                ) : (
                  <div
                    ref={containerRef}
                    tabIndex={0}
                    role="listbox"
                    aria-label="Changed files"
                    aria-activedescendant={
                      focusedRowKey ? `scm-row-${focusedRowKey}` : undefined
                    }
                    onKeyDown={handlePanelKeyDown}
                    className="relative min-h-0 flex-1 outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
                  >
                    <div
                      ref={scrollRef}
                      className="h-full overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]"
                    >
                      <div
                        style={{
                          height: virtualizer.getTotalSize(),
                          position: "relative",
                          width: "100%",
                        }}
                      >
                        {virtualizer.getVirtualItems().map((virtualRow) => {
                          const row = rows[virtualRow.index];
                          if (!row) return null;
                          return (
                            <div
                              key={virtualRow.key}
                              style={{
                                position: "absolute",
                                top: 0,
                                left: 0,
                                width: "100%",
                                height: virtualRow.size,
                                transform: `translateY(${virtualRow.start}px)`,
                              }}
                            >
                              <RowRenderer
                                row={row}
                                focused={focusedRowKey === row.key}
                                selectedPath={scm.selected?.path ?? null}
                                actionBusy={scm.actionBusy}
                                headerCheckState={scm.headerCheckState}
                                repoRoot={scm.repo?.repoRoot ?? null}
                                onFocusRow={setFocusedRowKey}
                                onToggleAll={scm.toggleAll}
                                onSelectFile={scm.selectFile}
                                onToggleStageFile={scm.toggleStageFile}
                                onDiscardFile={scm.requestDiscardFile}
                                onOpenFile={onOpenFile}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {!worktreeCollapsed && !graphCollapsed ? (
              <div
                title="Resize commit graph"
                onPointerDown={beginGraphResize}
                onPointerMove={updateGraphResize}
                onPointerUp={endGraphResize}
                onPointerCancel={endGraphResize}
                className="group flex h-2 shrink-0 cursor-row-resize items-center justify-center border-y border-border/35 bg-card/65"
              >
                <span className="h-px w-8 rounded-full bg-border transition-colors group-hover:bg-primary/55" />
              </div>
            ) : null}

            <SectionToggleHeader
              title="Commit Graph"
              collapsed={graphCollapsed}
              onToggle={() => setGraphCollapsed((v) => !v)}
            />
            {!graphCollapsed ? (
              <div
                className={cn(
                  "min-h-0 border-t border-border/30",
                  worktreeCollapsed ? "flex-1" : "shrink-0",
                )}
                style={worktreeCollapsed ? undefined : { height: graphHeight }}
              >
                <InlineCommitGraph
                  repoRoot={scm.status.repoRoot}
                  refreshKey={graphRefreshKey}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </aside>

      <AlertDialog
        open={scm.pendingDiscard !== null}
        onOpenChange={(o) => {
          if (!o) scm.cancelPendingDiscard();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard changes?</AlertDialogTitle>
            <AlertDialogDescription>
              {scm.pendingDiscard?.scope === "all"
                ? `This will discard ${scm.pendingDiscard.label} and cannot be undone.`
                : scm.pendingDiscard
                  ? `Discard changes in "${scm.pendingDiscard.label}"? This cannot be undone.`
                  : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => scm.cancelPendingDiscard()}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => void scm.confirmPendingDiscard()}>
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
});

function SectionToggleHeader({
  title,
  count,
  collapsed,
  onToggle,
}: {
  title: string;
  count?: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex h-8 shrink-0 cursor-pointer items-center gap-2 border-b border-border/45 bg-card/70 px-3 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
    >
      <HugeiconsIcon
        icon={collapsed ? ArrowRight01Icon : ArrowDown01Icon}
        size={12}
        strokeWidth={2}
        className="shrink-0"
      />
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {typeof count === "number" ? (
        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-border/60 px-1 text-[9.5px] font-semibold tabular-nums text-muted-foreground">
          {count}
        </span>
      ) : null}
    </button>
  );
}

type InlineCommitGraphProps = {
  repoRoot: string;
  refreshKey: string | null;
};

function compactGraphDate(secs: number): string {
  if (!secs) return "";
  const date = new Date(secs * 1000);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "2-digit",
  });
}

const InlineCommitGraph = memo(function InlineCommitGraph({
  repoRoot,
  refreshKey,
}: InlineCommitGraphProps) {
  const [commits, setCommits] = useState<GitLogEntry[]>([]);
  const [loadStatus, setLoadStatus] = useState<
    "idle" | "initial" | "more" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [endReached, setEndReached] = useState(false);
  const requestIdRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const graphCacheRef = useRef<{
    rows: GraphRow[];
    byCommit: Map<string, GraphRow>;
    tail: GraphState;
    firstSha: string | null;
    len: number;
    maxLaneCount: number;
  }>({
    rows: [],
    byCommit: new Map(),
    tail: EMPTY_GRAPH_STATE,
    firstSha: null,
    len: 0,
    maxLaneCount: 1,
  });

  const { graphByCommit, maxLaneCount } = useMemo(() => {
    const cache = graphCacheRef.current;
    if (commits.length === 0) {
      cache.rows = [];
      cache.byCommit = new Map();
      cache.tail = EMPTY_GRAPH_STATE;
      cache.firstSha = null;
      cache.len = 0;
      cache.maxLaneCount = 1;
      return { graphByCommit: cache.byCommit, maxLaneCount: 1 };
    }

    const firstSha = commits[0].sha;
    const canAppend =
      cache.firstSha === firstSha && commits.length >= cache.len;
    if (!canAppend) {
      const { rows, state } = layoutGraph(commits);
      const byCommit = new Map<string, GraphRow>();
      let max = 1;
      for (const row of rows) {
        byCommit.set(row.sha, row);
        if (row.laneCount > max) max = row.laneCount;
      }
      cache.rows = rows;
      cache.byCommit = byCommit;
      cache.tail = state;
      cache.firstSha = firstSha;
      cache.len = commits.length;
      cache.maxLaneCount = max;
      return { graphByCommit: byCommit, maxLaneCount: max };
    }

    if (commits.length > cache.len) {
      const delta = commits.slice(cache.len);
      const { rows, state } = layoutGraph(delta, cache.tail);
      let max = cache.maxLaneCount;
      for (const row of rows) {
        cache.byCommit.set(row.sha, row);
        if (row.laneCount > max) max = row.laneCount;
      }
      cache.rows = cache.rows.concat(rows);
      cache.tail = state;
      cache.len = commits.length;
      cache.maxLaneCount = max;
    }

    return { graphByCommit: cache.byCommit, maxLaneCount: cache.maxLaneCount };
  }, [commits]);

  const virtualizer = useVirtualizer({
    count: commits.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => GRAPH_ROW_HEIGHT,
    overscan: 8,
    getItemKey: (index) => commits[index]?.sha ?? index,
  });

  const loadInitial = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoadStatus("initial");
    setError(null);
    setEndReached(false);
    try {
      const entries = await native.gitLog(repoRoot, { limit: GRAPH_PAGE_SIZE });
      if (requestId !== requestIdRef.current) return;
      setCommits(entries);
      setLoadStatus("idle");
      if (entries.length < GRAPH_PAGE_SIZE) setEndReached(true);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(normalizeError(err));
      setLoadStatus("error");
    }
  }, [repoRoot]);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || endReached || loadStatus !== "idle") return;
    const last = commits[commits.length - 1];
    if (!last) return;
    loadingMoreRef.current = true;
    setLoadStatus("more");
    setError(null);
    try {
      const entries = await native.gitLog(repoRoot, {
        limit: GRAPH_PAGE_SIZE,
        beforeSha: last.sha,
      });
      setCommits((prev) => {
        const seen = new Set(prev.map((commit) => commit.sha));
        return [...prev, ...entries.filter((commit) => !seen.has(commit.sha))];
      });
      if (entries.length < GRAPH_PAGE_SIZE) setEndReached(true);
      setLoadStatus("idle");
    } catch (err) {
      setError(normalizeError(err));
      setLoadStatus("error");
    } finally {
      loadingMoreRef.current = false;
    }
  }, [commits, endReached, loadStatus, repoRoot]);

  useEffect(() => {
    void refreshKey;
    setCommits([]);
    void loadInitial();
  }, [loadInitial, refreshKey]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (remaining < GRAPH_NEAR_BOTTOM_PX) {
      void loadMore();
    }
  }, [loadMore]);

  if (loadStatus === "initial" && commits.length === 0) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-[11.5px] text-muted-foreground">
        <Spinner className="size-3" />
        Loading commits...
      </div>
    );
  }

  if (loadStatus === "error" && commits.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
        <div className="text-[12px] font-medium">Could not load commits</div>
        <div className="max-w-56 text-[10.5px] leading-relaxed text-muted-foreground">
          {error ?? "Unknown Git error"}
        </div>
        <Button
          size="xs"
          variant="secondary"
          onClick={() => void loadInitial()}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (commits.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-[11.5px] text-muted-foreground">
        No commits yet.
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="h-full overflow-y-auto overflow-x-hidden bg-background/60 [scrollbar-gutter:stable]"
    >
      <div
        style={{
          height: virtualizer.getTotalSize(),
          position: "relative",
          width: "100%",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const commit = commits[virtualRow.index];
          if (!commit) return null;
          return (
            <div
              key={virtualRow.key}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: virtualRow.size,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <InlineCommitRow
                commit={commit}
                graphRow={graphByCommit.get(commit.sha) ?? null}
                maxLaneCount={maxLaneCount}
              />
            </div>
          );
        })}
      </div>
      {loadStatus === "more" ? (
        <div className="flex items-center justify-center gap-2 py-2 text-[10.5px] text-muted-foreground">
          <Spinner className="size-3" />
          Loading more...
        </div>
      ) : null}
      {loadStatus === "error" && commits.length > 0 ? (
        <div className="flex items-center justify-center gap-2 py-2 text-[10.5px] text-destructive">
          {error ?? "Failed to load more"}
          <Button
            size="xs"
            variant="ghost"
            className="h-6 cursor-pointer text-[10.5px]"
            onClick={() => void loadMore()}
          >
            Retry
          </Button>
        </div>
      ) : null}
      {endReached ? (
        <div className="py-2 text-center text-[10px] text-muted-foreground/60">
          End of history
        </div>
      ) : null}
    </div>
  );
});

type InlineCommitRowProps = {
  commit: GitLogEntry;
  graphRow: GraphRow | null;
  maxLaneCount: number;
};

const InlineCommitRow = memo(function InlineCommitRow({
  commit,
  graphRow,
  maxLaneCount,
}: InlineCommitRowProps) {
  const total = commit.insertions + commit.deletions;

  return (
    <div className="grid h-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-border/25 pr-2 text-left transition-colors hover:bg-accent/25">
      <div
        className="flex justify-start pl-1"
        style={{ width: GRAPH_RAIL_RESERVED_PX }}
      >
        {graphRow ? (
          <GraphRail
            row={graphRow}
            rowHeight={GRAPH_ROW_HEIGHT}
            maxLaneCount={maxLaneCount}
          />
        ) : null}
      </div>
      <div className="min-w-0">
        <div className="truncate text-[11.5px] font-medium leading-tight text-foreground">
          {commit.subject || (
            <span className="text-muted-foreground">(no subject)</span>
          )}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[9.5px] leading-none text-muted-foreground">
          <span className="font-mono tabular-nums">{commit.shortSha}</span>
          <span className="size-[3px] rounded-full bg-muted-foreground/35" />
          <span className="truncate">{commit.author || "Unknown"}</span>
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5 text-[9.5px] leading-none text-muted-foreground">
        <span className="font-mono tabular-nums">
          {compactGraphDate(commit.timestampSecs)}
        </span>
        {total > 0 ? (
          <span className="font-mono tabular-nums">
            <span className="text-emerald-500">+{commit.insertions}</span>
            <span className="ml-1 text-rose-500">-{commit.deletions}</span>
          </span>
        ) : (
          <span className="text-muted-foreground/45">
            {commit.filesChanged} files
          </span>
        )}
      </div>
    </div>
  );
});

function PanelCenter({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <div className="text-sm font-medium">{title}</div>
      {body ? (
        <div className="max-w-64 text-[11px] leading-relaxed text-muted-foreground">
          {body}
        </div>
      ) : null}
      {action}
    </div>
  );
}

function CleanTreeHint({ repoLabel }: { repoLabel: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 px-4 text-center">
      <div className="flex size-8 items-center justify-center rounded-full border border-border/55 text-muted-foreground">
        <HugeiconsIcon
          icon={CheckmarkCircle01Icon}
          size={16}
          strokeWidth={1.6}
        />
      </div>
      <div className="text-[12px] font-medium text-foreground">
        Working tree clean
      </div>
      <div className="text-[10.5px] leading-snug text-muted-foreground">
        on <span className="font-mono text-foreground/80">{repoLabel}</span>
      </div>
    </div>
  );
}

type RowRendererProps = {
  row: RowDescriptor;
  focused: boolean;
  selectedPath: string | null;
  actionBusy: string | null;
  headerCheckState: CheckState;
  repoRoot: string | null;
  onFocusRow: (key: string | null) => void;
  onToggleAll: () => Promise<void> | void;
  onSelectFile: (entry: SourceControlFileEntry) => Promise<void>;
  onToggleStageFile: (entry: SourceControlFileEntry) => Promise<void>;
  onDiscardFile: (entry: SourceControlFileEntry) => void;
  onOpenFile?: (absolutePath: string) => void;
};

const RowRenderer = memo(function RowRenderer(props: RowRendererProps) {
  const { row } = props;
  switch (row.kind) {
    case "banner-diverged":
      return <DivergedBanner />;
    case "list-header":
      return <ListHeader {...props} row={row} />;
    case "entry":
      return <EntryRow {...props} row={row} />;
  }
});

function DivergedBanner() {
  return (
    <div className="mx-2 mt-1 flex h-7 items-center gap-1.5 rounded-md border border-border/60 bg-foreground/[0.04] px-2 text-[10.5px] leading-none text-muted-foreground">
      <HugeiconsIcon
        icon={Alert02Icon}
        size={11}
        strokeWidth={1.9}
        className="shrink-0"
      />
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium text-foreground/85">
          Diverged from upstream
        </span>
        <span className="ml-1 opacity-75">— resolve in terminal</span>
      </span>
    </div>
  );
}

function ListHeader({
  row,
  actionBusy,
  headerCheckState,
  onToggleAll,
}: RowRendererProps & {
  row: Extract<RowDescriptor, { kind: "list-header" }>;
}) {
  return (
    <div className="flex h-7 items-center gap-2 px-3">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/85">
        Changes
      </span>
      <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-border/60 px-1 text-[9.5px] font-semibold tabular-nums text-muted-foreground">
        {row.count}
      </span>
      <label
        htmlFor="source-control-stage-all"
        className="ml-auto flex shrink-0 cursor-pointer select-none items-center gap-1.5 text-[10.5px] font-medium text-muted-foreground hover:text-foreground"
      >
        <span>All</span>
        <Checkbox
          id="source-control-stage-all"
          aria-label="Stage all changes"
          checked={checkboxValue(headerCheckState)}
          disabled={actionBusy !== null}
          onCheckedChange={() => void onToggleAll()}
          className="size-3.5"
        />
      </label>
    </div>
  );
}

const EntryRow = memo(function EntryRow({
  row,
  focused,
  selectedPath,
  actionBusy,
  repoRoot,
  onFocusRow,
  onSelectFile,
  onToggleStageFile,
  onDiscardFile,
  onOpenFile,
}: RowRendererProps & {
  row: Extract<RowDescriptor, { kind: "entry" }>;
}) {
  const entry = row.entry;
  const isSelected = selectedPath === entry.path;
  const fileName = basename(entry.path);
  const iconUrl = fileIconUrl(fileName);
  const pathLabel = entryPathLabel(entry);
  const showDiscard = entry.unstaged;
  const isStageBusy =
    actionBusy === `stage:${entry.path}` ||
    actionBusy === `unstage:${entry.path}`;
  const isDiscardBusy = actionBusy === `discard:${entry.path}`;
  const disabled = actionBusy !== null;

  const absolutePath = repoRoot
    ? joinPath(repoRoot.replace(/\\/g, "/"), entry.path.replace(/\\/g, "/"))
    : null;
  const isDeleted = entry.statusCode === "D";
  const revealLabel = IS_MAC ? "Reveal in Finder" : "Reveal in File Manager";

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          id={`scm-row-${row.key}`}
          data-focused={focused || undefined}
          data-selected={isSelected || undefined}
          role="option"
          aria-selected={isSelected}
          tabIndex={focused ? 0 : -1}
          onMouseDown={() => onFocusRow(row.key)}
          className={cn(
            "group relative flex h-[30px] items-center gap-2 rounded-md pl-2 pr-2 transition-all duration-100",
            focused
              ? "bg-accent/60"
              : isSelected
                ? "bg-accent/55 text-foreground"
                : "hover:bg-accent/30",
          )}
        >
          <span
            className={cn(
              "pointer-events-none absolute inset-y-1 left-0 w-[2px] rounded-full transition-opacity",
              statusAccent(entry.statusCode),
              isSelected || focused
                ? "opacity-100"
                : "opacity-55 group-hover:opacity-95",
            )}
            aria-hidden
          />
          <button
            type="button"
            onClick={() => {
              onFocusRow(row.key);
              void onSelectFile(entry);
            }}
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
          >
            {iconUrl ? (
              <img src={iconUrl} alt="" className="size-4 shrink-0" />
            ) : (
              <span className="size-4 shrink-0" />
            )}
            <div className="flex min-w-0 flex-1 items-baseline gap-1.5 leading-none">
              <span
                className={cn(
                  "truncate text-[12px] leading-tight",
                  isSelected || focused
                    ? "font-semibold text-foreground"
                    : "font-medium text-foreground/95",
                  pathLabel ? "max-w-[58%] shrink-0" : "min-w-0 flex-1",
                )}
              >
                {fileName}
              </span>
              {pathLabel ? (
                <span className="min-w-0 flex-1 truncate text-[10.5px] leading-tight text-muted-foreground/75">
                  {pathLabel}
                </span>
              ) : null}
            </div>
          </button>

          {showDiscard ? (
            <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 data-[focused=true]:opacity-100 data-[selected=true]:opacity-100">
              <IconActionButton
                label={`Discard ${entry.path}`}
                disabled={disabled}
                side="top"
                onClick={() => onDiscardFile(entry)}
              >
                {isDiscardBusy ? (
                  <Spinner className="size-3" />
                ) : (
                  <HugeiconsIcon
                    icon={RemoveSquareIcon}
                    size={11}
                    strokeWidth={1.9}
                  />
                )}
              </IconActionButton>
            </div>
          ) : null}

          <span className="flex size-5 shrink-0 items-center justify-center">
            {isStageBusy ? (
              <Spinner className="size-3" />
            ) : (
              <Checkbox
                aria-label={`Stage ${entry.path}`}
                checked={checkboxValue(entry.checkState)}
                disabled={disabled}
                onCheckedChange={() => void onToggleStageFile(entry)}
                className="size-3.5"
              />
            )}
          </span>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className={COMPACT_CONTENT}>
        {/* Open actions */}
        <ContextMenuItem
          className={COMPACT_ITEM}
          onSelect={() => {
            onFocusRow(row.key);
            void onSelectFile(entry);
          }}
        >
          Open Diff
        </ContextMenuItem>
        {!isDeleted && onOpenFile && absolutePath ? (
          <ContextMenuItem
            className={COMPACT_ITEM}
            onSelect={() => onOpenFile(absolutePath)}
          >
            Open File
          </ContextMenuItem>
        ) : null}

        <ContextMenuSeparator />

        {/* Stage / Unstage */}
        <ContextMenuItem
          className={COMPACT_ITEM}
          disabled={disabled}
          onSelect={() => void onToggleStageFile(entry)}
        >
          {entry.checkState === "checked" ? "Unstage" : "Stage"}
        </ContextMenuItem>
        {entry.unstaged ? (
          <ContextMenuItem
            className={COMPACT_ITEM}
            variant="destructive"
            disabled={disabled}
            onSelect={() => onDiscardFile(entry)}
          >
            Discard Changes
          </ContextMenuItem>
        ) : null}

        <ContextMenuSeparator />

        {/* Copy paths */}
        <ContextMenuItem
          className={COMPACT_ITEM}
          onSelect={() => void copyToClipboard(entry.path.replace(/\\/g, "/"))}
        >
          Copy Relative Path
        </ContextMenuItem>
        {absolutePath ? (
          <ContextMenuItem
            className={COMPACT_ITEM}
            onSelect={() => void copyToClipboard(absolutePath)}
          >
            Copy Absolute Path
          </ContextMenuItem>
        ) : null}

        {/* Reveal in Finder — only for existing files */}
        {!isDeleted && absolutePath ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              className={COMPACT_ITEM}
              onSelect={() => void revealInFinder(absolutePath)}
            >
              {revealLabel}
            </ContextMenuItem>
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
});

function IconActionButton({
  label,
  disabled,
  side = "left",
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  side?: "left" | "top" | "right" | "bottom";
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          className="size-6 p-3 cursor-pointer rounded-md text-muted-foreground hover:text-foreground disabled:cursor-not-allowed"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent
        side={side}
        className={cn(SOURCE_CONTROL_TOOLTIP_CLASS, "text-[10.5px]")}
      >
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function CommitFeedback({
  feedback,
}: {
  feedback: { tone: "error" | "success"; message: string } | null;
}) {
  const [visibleFeedback, setVisibleFeedback] = useState(feedback);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!feedback) {
      setIsVisible(false);
      return;
    }
    setVisibleFeedback(feedback);
    setIsVisible(true);
    const hideTimer = window.setTimeout(() => setIsVisible(false), 3600);
    const clearTimer = window.setTimeout(() => {
      setVisibleFeedback((current) =>
        current?.message === feedback.message && current.tone === feedback.tone
          ? null
          : current,
      );
    }, 3900);
    return () => {
      window.clearTimeout(hideTimer);
      window.clearTimeout(clearTimer);
    };
  }, [feedback]);

  if (!visibleFeedback) return null;

  const isError = visibleFeedback.tone === "error";
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-3 top-[calc(100%-0.25rem)] z-20 flex min-w-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] leading-snug shadow-lg shadow-black/15 backdrop-blur transition-all duration-200",
        isVisible ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0",
        isError
          ? "border-destructive/30 bg-card/95 text-destructive"
          : "border-border/70 bg-card/95 text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          isError ? "bg-destructive" : "bg-foreground/70",
        )}
      />
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          isError ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {visibleFeedback.message}
      </span>
    </div>
  );
}
