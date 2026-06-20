import { cn } from "@/lib/utils";
import type { AudioTab, Tab } from "@/modules/tabs";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { MusicNote01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

type Props = {
  tabs: Tab[];
  activeId: number;
};

export function AudioStack({ tabs, activeId }: Props) {
  const audioTabs = tabs.filter(
    (t): t is AudioTab => t.kind === "audio" && !t.cold,
  );
  if (audioTabs.length === 0) return null;
  return (
    <div className="relative h-full w-full">
      {audioTabs.map((tab) => {
        const visible = tab.id === activeId;
        return (
          <div
            key={tab.id}
            className={cn(
              "absolute inset-0",
              !visible && "invisible pointer-events-none",
            )}
            aria-hidden={!visible}
          >
            <AudioPane tab={tab} />
          </div>
        );
      })}
    </div>
  );
}

type AudioState =
  | { kind: "loading" }
  | { kind: "ready"; url: string }
  | { kind: "error"; message: string };

function AudioPane({ tab }: { tab: AudioTab }) {
  const [state, setState] = useState<AudioState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    setState({ kind: "loading" });
    invoke<ArrayBuffer>("fs_read_binary_file", {
      path: tab.path,
      workspace: currentWorkspaceEnv(),
    })
      .then((buf) => {
        if (cancelled) return;
        url = URL.createObjectURL(new Blob([buf], { type: tab.mediaType }));
        setState({ kind: "ready", url });
      })
      .catch((e) => {
        if (!cancelled) setState({ kind: "error", message: String(e) });
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [tab.path, tab.mediaType]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-md border border-border/60 bg-background">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <HugeiconsIcon
          icon={MusicNote01Icon}
          size={15}
          strokeWidth={1.75}
          className="shrink-0 text-muted-foreground"
        />
        <span className="min-w-0 truncate text-xs font-medium text-foreground/85">
          {tab.title}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
        {state.kind === "loading" ? (
          <p className="text-[12px] text-muted-foreground">Loading audio…</p>
        ) : null}
        {state.kind === "error" ? (
          <div className="max-w-xl space-y-1.5">
            <p className="text-[12px] text-destructive">Failed to load audio.</p>
            <p className="break-words text-[11px] leading-relaxed text-muted-foreground">
              {state.message}
            </p>
          </div>
        ) : null}
        {state.kind === "ready" ? (
          <div className="flex w-full max-w-2xl flex-col items-center gap-3">
            <audio
              src={state.url}
              controls
              preload="metadata"
              className="w-full"
            >
              <track kind="captions" />
            </audio>
            <p className="max-w-full truncate text-[11px] text-muted-foreground">
              {tab.path}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
