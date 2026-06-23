import { LazyStore } from "@tauri-apps/plugin-store";

export type TaskLaneId = "todo" | "fix" | "urgent" | "done";

export type TaskCard = {
  id: string;
  title: string;
  lane: TaskLaneId;
  createdAt: number;
  updatedAt: number;
};

export type TaskBoardData = {
  cards: TaskCard[];
  collapsed: Record<TaskLaneId, boolean>;
};

export const TASK_LANE_IDS = ["todo", "fix", "urgent", "done"] as const;

const STORE_PATH = "terax-task-board.json";
const BOARD_PREFIX = "board:";

const DEFAULT_COLLAPSED: Record<TaskLaneId, boolean> = {
  todo: false,
  fix: false,
  urgent: false,
  done: true,
};

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 200 });

function boardKey(workspaceKey: string): string {
  return `${BOARD_PREFIX}${workspaceKey || "global"}`;
}

function isLaneId(value: unknown): value is TaskLaneId {
  return (
    typeof value === "string" &&
    (TASK_LANE_IDS as readonly string[]).includes(value)
  );
}

export function emptyTaskBoard(): TaskBoardData {
  return {
    cards: [],
    collapsed: { ...DEFAULT_COLLAPSED },
  };
}

export function normalizeTaskBoard(value: unknown): TaskBoardData {
  if (!value || typeof value !== "object") return emptyTaskBoard();
  const raw = value as Partial<TaskBoardData>;
  const now = Date.now();
  const cards = Array.isArray(raw.cards)
    ? raw.cards
        .map((card): TaskCard | null => {
          if (!card || typeof card !== "object") return null;
          const c = card as Partial<TaskCard>;
          const title = typeof c.title === "string" ? c.title.trim() : "";
          if (!title || !isLaneId(c.lane)) return null;
          return {
            id: typeof c.id === "string" && c.id ? c.id : newTaskCardId(),
            title,
            lane: c.lane,
            createdAt: typeof c.createdAt === "number" ? c.createdAt : now,
            updatedAt: typeof c.updatedAt === "number" ? c.updatedAt : now,
          };
        })
        .filter((card): card is TaskCard => card !== null)
    : [];

  const collapsed = { ...DEFAULT_COLLAPSED };
  if (raw.collapsed && typeof raw.collapsed === "object") {
    for (const lane of TASK_LANE_IDS) {
      const value = raw.collapsed[lane];
      if (typeof value === "boolean") collapsed[lane] = value;
    }
  }

  return { cards, collapsed };
}

export async function loadTaskBoard(
  workspaceKey: string,
): Promise<TaskBoardData> {
  return normalizeTaskBoard(await store.get(boardKey(workspaceKey)));
}

export async function saveTaskBoard(
  workspaceKey: string,
  board: TaskBoardData,
): Promise<void> {
  await store.set(boardKey(workspaceKey), board);
}

export function newTaskCardId(): string {
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
