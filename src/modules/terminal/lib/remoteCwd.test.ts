import { describe, expect, it } from "vitest";
import { remoteCwdFromCommand } from "./remoteCwd";

const ctx = {
  current: "/home/me/project/src",
  home: "/home/me",
  previous: "/tmp",
};

describe("remoteCwdFromCommand", () => {
  it("resolves simple relative and absolute cd commands", () => {
    expect(remoteCwdFromCommand("cd ..", ctx)).toEqual({
      cwd: "/home/me/project",
      previous: "/home/me/project/src",
    });
    expect(remoteCwdFromCommand("cd /var/log", ctx)).toEqual({
      cwd: "/var/log",
      previous: "/home/me/project/src",
    });
  });

  it("resolves home and previous-directory cd forms", () => {
    expect(remoteCwdFromCommand("cd", ctx)?.cwd).toBe("/home/me");
    expect(remoteCwdFromCommand("cd ~/repo", ctx)?.cwd).toBe("/home/me/repo");
    expect(remoteCwdFromCommand("cd -", ctx)?.cwd).toBe("/tmp");
  });

  it("ignores unsupported or compound commands", () => {
    expect(remoteCwdFromCommand("cd missing && ls", ctx)).toBeNull();
    expect(remoteCwdFromCommand("pushd /tmp", ctx)).toBeNull();
    expect(remoteCwdFromCommand("cd $PROJECT", ctx)).toBeNull();
  });
});
