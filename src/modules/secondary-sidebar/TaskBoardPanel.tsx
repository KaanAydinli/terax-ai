import { cn } from "@/lib/utils";
import {
  closestCenter,
  CSS,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  type Modifier,
  PointerSensor,
  SortableContext,
  sortableKeyboardCoordinates,
  useDroppable,
  useSensor,
  useSensors,
  useSortable,
  verticalListSortingStrategy,
} from "@/modules/dnd";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Delete02Icon,
  PlusSignIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  emptyTaskBoard,
  loadTaskBoard,
  newTaskCardId,
  saveTaskBoard,
  TASK_LANE_IDS,
  type TaskBoardData,
  type TaskCard,
  type TaskLaneId,
} from "./lib/taskBoardStore";

type Props = {
  workspaceKey: string;
};

type ActiveDrag = {
  card: TaskCard;
  width: number | null;
} | null;

type LaneDef = {
  id: TaskLaneId;
  label: string;
  dot: string;
  ring: string;
};

const LANES: LaneDef[] = [
  {
    id: "todo",
    label: "TODO",
    dot: "bg-sky-500",
    ring: "group-data-[over=true]:border-sky-500/45",
  },
  {
    id: "fix",
    label: "FIX",
    dot: "bg-amber-500",
    ring: "group-data-[over=true]:border-amber-500/45",
  },
  {
    id: "urgent",
    label: "URGENT",
    dot: "bg-rose-500",
    ring: "group-data-[over=true]:border-rose-500/45",
  },
  {
    id: "done",
    label: "DONE",
    dot: "bg-emerald-500",
    ring: "group-data-[over=true]:border-emerald-500/45",
  },
];

const ADDABLE_LANES = LANES.filter((lane) => lane.id !== "done");

const cardDndId = (id: string) => `card:${id}`;
const laneDndId = (id: TaskLaneId) => `lane:${id}`;
const shiftDragGhostLeft: Modifier = ({ activeNodeRect, transform }) => ({
  ...transform,
  x: transform.x - (activeNodeRect?.width ?? 0) * 0.5,
  y: transform.y - (activeNodeRect?.height ?? 0) * 0.5,
});

function cardIdFromDnd(id: unknown): string | null {
  const value = String(id);
  return value.startsWith("card:") ? value.slice(5) : null;
}

function moveCard(
  cards: TaskCard[],
  cardId: string,
  targetLane: TaskLaneId,
  targetCardId: string | null,
): TaskCard[] {
  const moving = cards.find((card) => card.id === cardId);
  if (!moving) return cards;
  if (targetCardId === cardId) return cards;

  const next = cards.filter((card) => card.id !== cardId);
  const moved = { ...moving, lane: targetLane, updatedAt: Date.now() };
  if (!targetCardId) return [...next, moved];

  const targetIndex = next.findIndex((card) => card.id === targetCardId);
  if (targetIndex < 0) return [...next, moved];
  return [...next.slice(0, targetIndex), moved, ...next.slice(targetIndex)];
}

export function TaskBoardPanel({ workspaceKey }: Props) {
  const [board, setBoard] = useState<TaskBoardData>(() => emptyTaskBoard());
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [draftLane, setDraftLane] = useState<TaskLaneId>("todo");
  const [activeDrag, setActiveDrag] = useState<ActiveDrag>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadTaskBoard(workspaceKey)
      .then((data) => {
        if (!cancelled) setBoard(data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceKey]);

  const updateBoard = useCallback(
    (
      nextOrUpdater: TaskBoardData | ((prev: TaskBoardData) => TaskBoardData),
    ) => {
      setBoard((prev) => {
        const next =
          typeof nextOrUpdater === "function"
            ? nextOrUpdater(prev)
            : nextOrUpdater;
        void saveTaskBoard(workspaceKey, next);
        return next;
      });
    },
    [workspaceKey],
  );

  const counts = useMemo(() => {
    const next: Record<TaskLaneId, number> = {
      todo: 0,
      fix: 0,
      urgent: 0,
      done: 0,
    };
    for (const card of board.cards) next[card.lane] += 1;
    return next;
  }, [board.cards]);

  const addCard = useCallback(() => {
    const title = draft.trim();
    if (!title) return;
    const now = Date.now();
    updateBoard((prev) => ({
      ...prev,
      cards: [
        ...prev.cards,
        {
          id: newTaskCardId(),
          title,
          lane: draftLane,
          createdAt: now,
          updatedAt: now,
        },
      ],
      collapsed: { ...prev.collapsed, [draftLane]: false },
    }));
    setDraft("");
  }, [draft, draftLane, updateBoard]);

  const toggleLane = useCallback(
    (lane: TaskLaneId) => {
      updateBoard((prev) => ({
        ...prev,
        collapsed: { ...prev.collapsed, [lane]: !prev.collapsed[lane] },
      }));
    },
    [updateBoard],
  );

  const markDone = useCallback(
    (cardId: string) => {
      updateBoard((prev) => ({
        ...prev,
        cards: moveCard(prev.cards, cardId, "done", null),
      }));
    },
    [updateBoard],
  );

  const deleteCard = useCallback(
    (cardId: string) => {
      updateBoard((prev) => ({
        ...prev,
        cards: prev.cards.filter((card) => card.id !== cardId),
      }));
    },
    [updateBoard],
  );

  const onDragStart = useCallback(
    (event: DragStartEvent) => {
      const id = cardIdFromDnd(event.active.id);
      const card = board.cards.find((card) => card.id === id);
      setActiveDrag(
        card
          ? {
              card,
              width: event.active.rect.current.initial?.width ?? null,
            }
          : null,
      );
    },
    [board.cards],
  );

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDrag(null);
      const cardId = cardIdFromDnd(event.active.id);
      const over = event.over;
      if (!cardId || !over) return;

      const data = over.data.current;
      const targetLane =
        data?.kind === "card"
          ? data.laneId
          : data?.kind === "lane"
            ? data.laneId
            : null;
      if (!TASK_LANE_IDS.includes(targetLane)) return;

      const targetCardId =
        data?.kind === "card" ? cardIdFromDnd(over.id) : null;
      updateBoard((prev) => ({
        ...prev,
        cards: moveCard(prev.cards, cardId, targetLane, targetCardId),
      }));
    },
    [updateBoard],
  );

  return (
    <aside className="flex h-full min-h-0 flex-col bg-card/80">
      <div className="border-b border-border/60 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-[12px] font-semibold text-foreground">
              Task Board
            </h2>
            <p className="truncate text-[10.5px] text-muted-foreground">
              {board.cards.length} card{board.cards.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>
        <form
          className="mt-2.5 space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            addCard();
          }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="New card"
            className="h-8 w-full rounded-md border border-border/60 bg-background/70 px-2.5 text-[12px] outline-none placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20"
          />
          <div className="flex items-center gap-1.5">
            <div className="flex min-w-0 flex-1 rounded-md border border-border/60 bg-background/45 p-0.5">
              {ADDABLE_LANES.map((lane) => {
                const selected = lane.id === draftLane;
                return (
                  <button
                    key={lane.id}
                    type="button"
                    onClick={() => setDraftLane(lane.id)}
                    className={cn(
                      "flex h-6 min-w-0 flex-1 items-center justify-center rounded-[5px] px-1.5 text-[10px] font-semibold transition-colors",
                      selected
                        ? "bg-foreground/[0.08] text-foreground"
                        : "text-muted-foreground hover:bg-foreground/[0.045] hover:text-foreground",
                    )}
                  >
                    {lane.label}
                  </button>
                );
              })}
            </div>
            <button
              type="submit"
              disabled={!draft.trim()}
              aria-label="Add card"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border/60 bg-background/70 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
            >
              <HugeiconsIcon icon={PlusSignIcon} size={14} strokeWidth={2} />
            </button>
          </div>
        </form>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveDrag(null)}
      >
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {loading ? (
            <div className="px-2 py-6 text-center text-[11px] text-muted-foreground">
              Loading board
            </div>
          ) : (
            <div className="space-y-2">
              {LANES.map((lane) => (
                <TaskLane
                  key={lane.id}
                  lane={lane}
                  cards={board.cards.filter((card) => card.lane === lane.id)}
                  count={counts[lane.id]}
                  collapsed={board.collapsed[lane.id]}
                  onToggle={() => toggleLane(lane.id)}
                  onDone={markDone}
                  onDelete={deleteCard}
                />
              ))}
            </div>
          )}
        </div>
        <DragOverlay adjustScale={false} modifiers={[shiftDragGhostLeft]}>
          {activeDrag ? (
            <TaskCardPreview card={activeDrag.card} width={activeDrag.width} />
          ) : null}
        </DragOverlay>
      </DndContext>
    </aside>
  );
}

function TaskLane({
  lane,
  cards,
  count,
  collapsed,
  onToggle,
  onDone,
  onDelete,
}: {
  lane: LaneDef;
  cards: TaskCard[];
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  onDone: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: laneDndId(lane.id),
    data: { kind: "lane", laneId: lane.id },
  });

  return (
    <section
      ref={setNodeRef}
      data-over={isOver}
      className={cn(
        "group rounded-lg border border-border/60 bg-background/35 transition-colors",
        lane.ring,
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex h-9 w-full items-center gap-2 px-2 text-left"
      >
        <HugeiconsIcon
          icon={collapsed ? ArrowRight01Icon : ArrowDown01Icon}
          size={13}
          strokeWidth={1.8}
          className="shrink-0 text-muted-foreground"
        />
        <span className={cn("h-2 w-2 shrink-0 rounded-full", lane.dot)} />
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold tracking-normal text-foreground">
          {lane.label}
        </span>
        <span className="rounded-full bg-foreground/[0.06] px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
          {count}
        </span>
      </button>

      {!collapsed ? (
        <SortableContext
          items={cards.map((card) => cardDndId(card.id))}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-1.5 px-2 pb-2">
            {cards.length > 0 ? (
              cards.map((card) => (
                <TaskCardRow
                  key={card.id}
                  card={card}
                  onDone={onDone}
                  onDelete={onDelete}
                />
              ))
            ) : (
              <div className="rounded-md border border-dashed border-border/60 px-2 py-3 text-center text-[10.5px] text-muted-foreground">
                Drop cards here
              </div>
            )}
          </div>
        </SortableContext>
      ) : null}
    </section>
  );
}

function TaskCardRow({
  card,
  onDone,
  onDelete,
}: {
  card: TaskCard;
  onDone: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: cardDndId(card.id),
    data: { kind: "card", cardId: card.id, laneId: card.lane },
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        "group/card flex min-h-10 items-start gap-2 rounded-md border border-border/60 bg-card/90 px-2 py-2 shadow-sm shadow-black/[0.03]",
        isDragging && "opacity-45",
      )}
    >
      <TaskCardContent
        card={card}
        dragHandleProps={{ attributes, listeners }}
        onDone={onDone}
        onDelete={onDelete}
      />
    </div>
  );
}

function TaskCardContent({
  card,
  dragHandleProps,
  onDone,
  onDelete,
}: {
  card: TaskCard;
  dragHandleProps?: {
    attributes: ReturnType<typeof useSortable>["attributes"];
    listeners: ReturnType<typeof useSortable>["listeners"];
  };
  onDone?: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  return (
    <>
      <button
        type="button"
        aria-label="Drag card"
        className="mt-0.5 flex h-5 w-3 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground/55 outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-primary/30"
        {...dragHandleProps?.attributes}
        {...dragHandleProps?.listeners}
      >
        <span className="text-[12px] leading-none">::</span>
      </button>
      <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[12px] leading-5 text-foreground">
        {card.title}
      </p>
      <div className="flex shrink-0 items-center gap-1 opacity-70 transition-opacity group-hover/card:opacity-100">
        {card.lane !== "done" ? (
          <button
            type="button"
            aria-label="Move to done"
            onClick={() => onDone?.(card.id)}
            className="grid h-5 w-5 place-items-center rounded text-muted-foreground outline-none transition-colors hover:bg-emerald-500/12 hover:text-emerald-600 focus-visible:ring-2 focus-visible:ring-primary/30 dark:hover:text-emerald-400"
          >
            <HugeiconsIcon icon={Tick02Icon} size={12} strokeWidth={2} />
          </button>
        ) : null}
        <button
          type="button"
          aria-label="Delete card"
          onClick={() => onDelete?.(card.id)}
          className="grid h-5 w-5 place-items-center rounded text-muted-foreground outline-none transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          <HugeiconsIcon icon={Delete02Icon} size={12} strokeWidth={1.8} />
        </button>
      </div>
    </>
  );
}

function TaskCardPreview({
  card,
  width,
}: {
  card: TaskCard;
  width: number | null;
}) {
  return (
    <div
      style={width ? { width } : undefined}
      className="group/card flex min-h-10 items-start gap-2 rounded-md border border-border/70 bg-popover px-2 py-2 text-popover-foreground shadow-xl"
    >
      <TaskCardContent card={card} />
    </div>
  );
}
