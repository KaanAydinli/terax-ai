import { cn } from "@/lib/utils";
import { memo } from "react";
import { InlineInput } from "./InlineInput";
import { explorerGitTextClass } from "./lib/gitStatusColor";
import type { GitStatusCode } from "./lib/gitStatusUtils";
import { fileIconUrl, folderIconUrl } from "./lib/iconResolver";

export type RowActions = {
  toggle: (path: string) => void;
  enterDir: (path: string) => void;
  beginRename: (path: string) => void;
  commitRename: (newName: string) => void | Promise<void>;
  cancelRename: () => void;
};

export type EntryRowProps = {
  path: string;
  name: string;
  isDir: boolean;
  isExpanded: boolean;
  depth: number;
  actions: RowActions;
  renameInProgress: boolean;
  isSelected: boolean;
  isRenaming: boolean;
  isDropTarget?: boolean;
  onOpenFile: (path: string, pin?: boolean) => void;
  onSelectPath: (path: string) => void;
  gitStatusCode?: GitStatusCode | null;
  gitignored?: boolean;
};

function EntryRowImpl(props: EntryRowProps) {
  const {
    path,
    name,
    isDir,
    depth,
    actions,
    renameInProgress,
    isSelected,
    isRenaming,
    isDropTarget = false,
    onOpenFile,
    onSelectPath,
    gitStatusCode,
    gitignored = false,
  } = props;

  const iconUrl = isDir
    ? folderIconUrl(name, props.isExpanded)
    : fileIconUrl(name);
  const paddingLeft = 6 + depth * 12;

  if (isRenaming) {
    return (
      <div
        className="flex h-6 w-full min-w-0 items-center gap-2 px-1.5 text-[13px]"
        style={{ paddingLeft }}
      >
        {iconUrl ? (
          <img src={iconUrl} alt="" className="size-4 shrink-0" />
        ) : (
          <span className="size-4 shrink-0" />
        )}
        <InlineInput
          initial={name}
          onCommit={actions.commitRename}
          onCancel={actions.cancelRename}
        />
      </div>
    );
  }

  const handleClick = () => {
    if (renameInProgress) return;
    onSelectPath(path);
    if (isDir) actions.toggle(path);
    else onOpenFile(path);
  };

  return (
    <div
      data-fs-path={path}
      className={cn(
        "group flex h-6 w-full min-w-0 items-center rounded-sm transition-colors hover:bg-accent/70",
        isSelected
          ? "bg-accent text-foreground"
          : gitignored
            ? "text-muted-foreground/70"
            : "text-foreground/85",
        isDropTarget && "bg-primary/10 ring-1 ring-inset ring-primary/60",
      )}
    >
      <button
        type="button"
        onClick={handleClick}
        onDoubleClick={() => !isDir && actions.beginRename(path)}
        className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 px-1.5 text-left text-[13px]"
        style={{ paddingLeft }}
      >
        {iconUrl ? (
          <img src={iconUrl} alt="" className="size-4 shrink-0" />
        ) : (
          <span className="size-4 shrink-0" />
        )}
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            !isSelected &&
              !gitignored &&
              gitStatusCode &&
              explorerGitTextClass(gitStatusCode),
          )}
        >
          {name}
        </span>
      </button>
      {isDir ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (!renameInProgress) actions.enterDir(path);
          }}
          title="Enter folder"
          aria-label={`Enter folder ${name}`}
          className={cn(
            "flex h-full w-5 shrink-0 cursor-pointer items-center justify-center text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100",
            isSelected && "opacity-100",
          )}
        >
          <span className="size-1.5 rounded-full bg-current" />
        </button>
      ) : null}
    </div>
  );
}

export const EntryRow = memo(EntryRowImpl);

export type PendingRowProps = {
  depth: number;
  kind: "file" | "dir";
  onCommit: (name: string) => void | Promise<void>;
  onCancel: () => void;
};

export function PendingRow({
  depth,
  kind,
  onCommit,
  onCancel,
}: PendingRowProps) {
  return (
    <div
      className="flex h-6 w-full min-w-0 items-center gap-2 px-1.5 text-[13px]"
      style={{ paddingLeft: 6 + depth * 12 }}
    >
      <img
        src={
          kind === "dir" ? folderIconUrl("", false) : fileIconUrl("untitled")
        }
        alt=""
        className="size-4 shrink-0 opacity-70"
      />
      <InlineInput
        initial=""
        placeholder={kind === "dir" ? "New folder" : "New file"}
        onCommit={onCommit}
        onCancel={onCancel}
      />
    </div>
  );
}

export function StatusRow({
  depth,
  message,
  tone,
}: {
  depth: number;
  message: string;
  tone: "muted" | "error";
}) {
  return (
    <div
      className={cn(
        "h-6 truncate px-2 text-[11px] leading-6",
        tone === "error" ? "text-destructive" : "text-muted-foreground",
      )}
      style={{ paddingLeft: 6 + depth * 12 }}
    >
      {message}
    </div>
  );
}
