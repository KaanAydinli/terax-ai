import { describe, expect, it } from "vitest";
import { labelFor } from "./tabLabel";
import type { TerminalTab } from "./useTabs";

function terminalTab(over: Partial<TerminalTab> = {}): TerminalTab {
  return {
    id: 1,
    kind: "terminal",
    spaceId: "default",
    title: "Terminal",
    paneTree: { kind: "leaf", id: 2 },
    activeLeafId: 2,
    ...over,
  };
}

describe("labelFor (terminal tabs)", () => {
  it("uses a stable terminal label instead of the cwd segment", () => {
    expect(labelFor(terminalTab({ cwd: "/Users/me/projects/terax-ai" }))).toBe(
      "Terminal",
    );
  });

  it("uses terminal mode labels", () => {
    expect(labelFor(terminalTab({ blocks: true }))).toBe("Blocks");
    expect(labelFor(terminalTab({ private: true }))).toBe("Private");
  });

  it("uses coding agent labels", () => {
    expect(labelFor(terminalTab({ agent: "claude" }))).toBe("Claude Code");
    expect(labelFor(terminalTab({ agent: "codex" }))).toBe("Codex");
    expect(labelFor(terminalTab({ agent: "opencode" }))).toBe("opencode");
  });

  it("prefers a custom title over the default name", () => {
    expect(
      labelFor(
        terminalTab({
          cwd: "/Users/me/projects/terax-ai",
          customTitle: "Server",
        }),
      ),
    ).toBe("Server");
  });

  it("keeps the custom title after the cwd changes (survives cd)", () => {
    const renamed = terminalTab({ cwd: "/Users/me/a", customTitle: "Server" });
    const afterCd = { ...renamed, cwd: "/Users/me/b/c" };
    expect(labelFor(afterCd)).toBe("Server");
  });
});
