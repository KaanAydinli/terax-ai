import { tokenizeShell } from "./sshCommand";

type RemoteCwdContext = {
  current: string | null;
  home: string | null;
  previous: string | null;
};

export type RemoteCwdChange = {
  cwd: string;
  previous: string | null;
};

export function remoteCwdFromCommand(
  command: string,
  ctx: RemoteCwdContext,
): RemoteCwdChange | null {
  const trimmed = command.trim();
  if (!trimmed || /[;&|<>`$()]/.test(trimmed)) return null;
  const tokens = tokenizeShell(trimmed);
  let idx = 0;
  if (tokens[idx] === "builtin") idx += 1;
  if (tokens[idx] !== "cd") return null;
  idx += 1;
  if (tokens[idx] === "--") idx += 1;
  if (tokens.length - idx > 1) return null;

  const target = tokens[idx] ?? "~";
  const next = resolveRemotePath(target, ctx);
  if (!next || next === ctx.current) return null;
  return { cwd: next, previous: ctx.current };
}

function resolveRemotePath(
  target: string,
  { current, home, previous }: RemoteCwdContext,
): string | null {
  if (target === "-") return previous;
  if (target === "~" || target === "") return home;
  if (target.startsWith("~/")) {
    if (!home) return null;
    return normalizePosixPath(`${home}/${target.slice(2)}`);
  }
  if (target.startsWith("~")) return null;
  if (target.startsWith("/")) return normalizePosixPath(target);
  if (!current) return null;
  return normalizePosixPath(`${current}/${target}`);
}

function normalizePosixPath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}
