import type { Tab, TerminalAgentKind } from "./useTabs";

export function terminalAgentLabel(agent: TerminalAgentKind): string {
  switch (agent) {
    case "claude":
      return "Claude Code";
    case "codex":
      return "Codex";
    case "opencode":
      return "opencode";
    case "antigravity":
      return "Antigravity";
  }
}

/**
 * The label shown on a tab. Non-terminal tabs use their stored title; terminal
 * tabs prefer a user-set custom name, then active coding-agent identity, then a
 * stable terminal label. Keeping this pure makes the "custom name survives a cd"
 * invariant testable without rendering the bar.
 */
export function labelFor(t: Tab): string {
  if (t.kind === "editor") return t.title;
  if (t.kind === "preview") return t.title;
  if (t.kind === "markdown") return t.title;
  if (t.kind === "ai-diff") return t.title;
  if (t.kind === "git-diff") return t.title;
  if (t.kind === "git-history") return t.title;
  if (t.kind === "git-commit-file") return t.title;
  if (t.customTitle) return t.customTitle;
  if (t.agent) return terminalAgentLabel(t.agent);
  if (t.blocks) return "Blocks";
  if (t.private) return "Private";
  return "Terminal";
}
