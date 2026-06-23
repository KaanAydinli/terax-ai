import { usePreferencesStore } from "@/modules/settings/preferences";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { defaultKeymap } from "@codemirror/commands";
import { searchKeymap } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { buildSharedExtensions } from "./lib/extensions";
import { EDITOR_THEME_EXT } from "./lib/themes";

const CHUNK_BYTES = 2 * 1024 * 1024;
const NEAR_BOTTOM_PX = 1500;
const MAX_INITIAL_CHUNKS = 8;

type ChunkRes = {
  content: string;
  start: number;
  end: number;
  total: number;
  eof: boolean;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function LargeFileViewer({
  path,
  size,
}: {
  path: string;
  size: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeCompartment = useRef(new Compartment());

  const editorThemeId = usePreferencesStore((s) => s.editorTheme);

  const nextOffsetRef = useRef(0);
  const eofRef = useRef(false);
  const loadingRef = useRef(false);

  const [loaded, setLoaded] = useState(0);
  const [total, setTotal] = useState(size);
  const [eof, setEof] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadChunk = useCallback(async (): Promise<void> => {
    if (loadingRef.current || eofRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const res = await invoke<ChunkRes>("fs_read_text_chunk", {
        path,
        offset: nextOffsetRef.current,
        maxBytes: CHUNK_BYTES,
        workspace: currentWorkspaceEnv(),
      });
      const view = viewRef.current;
      if (view && res.content) {
        view.dispatch({
          changes: { from: view.state.doc.length, insert: res.content },
        });
      }
      nextOffsetRef.current = res.end;
      eofRef.current = res.eof;
      setLoaded(res.end);
      setTotal(res.total);
      setEof(res.eof);
    } catch (e) {
      setError(String(e));
      eofRef.current = true;
      setEof(true);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [path]);

  const loadChunkRef = useRef(loadChunk);
  loadChunkRef.current = loadChunk;

  const loadAll = useCallback(async () => {
    while (!eofRef.current) {
      await loadChunkRef.current();
    }
  }, []);

  useEffect(() => {
    nextOffsetRef.current = 0;
    eofRef.current = false;
    loadingRef.current = false;
    setLoaded(0);
    setTotal(size);
    setEof(false);
    setLoading(false);
    setError(null);

    const host = hostRef.current;
    if (!host) return;

    const view = new EditorView({
      doc: "",
      parent: host,
      extensions: [
        ...buildSharedExtensions(),
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        drawSelection(),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorState.allowMultipleSelections.of(true),
        keymap.of([...searchKeymap, ...defaultKeymap]),
        themeCompartment.current.of(
          EDITOR_THEME_EXT[usePreferencesStore.getState().editorTheme] ??
            EDITOR_THEME_EXT.atomone,
        ),
      ],
    });
    viewRef.current = view;

    const onScroll = () => {
      const s = view.scrollDOM;
      if (s.scrollTop + s.clientHeight >= s.scrollHeight - NEAR_BOTTOM_PX) {
        void loadChunkRef.current();
      }
    };
    view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });

    let cancelled = false;
    void (async () => {
      for (let i = 0; i < MAX_INITIAL_CHUNKS; i++) {
        if (cancelled || eofRef.current) break;
        await loadChunkRef.current();
        const s = view.scrollDOM;
        if (s.scrollHeight > s.clientHeight + NEAR_BOTTOM_PX) break;
      }
    })();

    return () => {
      cancelled = true;
      view.scrollDOM.removeEventListener("scroll", onScroll);
      view.destroy();
      viewRef.current = null;
    };
  }, [path, size]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: themeCompartment.current.reconfigure(
        EDITOR_THEME_EXT[editorThemeId] ?? EDITOR_THEME_EXT.atomone,
      ),
    });
  }, [editorThemeId]);

  const pct =
    total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 100;

  return (
    <div className="flex h-full min-h-0 flex-col zoom-exempt">
      <div ref={hostRef} className="flex-1 min-h-0 overflow-hidden" />
      <div className="flex items-center gap-2 border-t border-border/60 px-3 py-1 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground/80">Large file</span>
        <span className="opacity-40">·</span>
        <span>read-only</span>
        <span className="opacity-40">·</span>
        <span>
          {formatBytes(loaded)} / {formatBytes(total)} ({pct}%)
        </span>
        {loading && <span className="animate-pulse">loading…</span>}
        {error && <span className="text-destructive">{error}</span>}
        <div className="ml-auto flex items-center gap-3">
          {eof ? (
            <span className="opacity-60">fully loaded</span>
          ) : (
            <>
              <button
                type="button"
                disabled={loading}
                onClick={() => void loadChunkRef.current()}
                className="rounded px-1.5 py-0.5 hover:bg-foreground/10 disabled:opacity-40"
              >
                Load more
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => void loadAll()}
                className="rounded px-1.5 py-0.5 hover:bg-foreground/10 disabled:opacity-40"
              >
                Load to end
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
