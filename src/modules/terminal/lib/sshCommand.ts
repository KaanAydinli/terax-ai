import type { WorkspaceEnv } from "@/modules/workspace";

type SshEnv = Extract<WorkspaceEnv, { kind: "ssh" }>;

const OPTIONS_WITH_VALUE = new Set([
  "-B",
  "-b",
  "-c",
  "-D",
  "-E",
  "-e",
  "-F",
  "-I",
  "-i",
  "-J",
  "-L",
  "-l",
  "-m",
  "-O",
  "-o",
  "-p",
  "-Q",
  "-R",
  "-S",
  "-W",
  "-w",
]);

export function parseSshWorkspaceFromCommand(command: string): SshEnv | null {
  const tokens = tokenizeShell(command.trim());
  if (tokens.length < 2) return null;
  let idx = 0;
  if (tokens[idx] === "exec") idx += 1;
  if (tokens[idx] !== "ssh") return null;
  idx += 1;

  let user: string | null = null;
  let port: number | null = null;
  let host: string | null = null;

  while (idx < tokens.length) {
    const token = tokens[idx];
    if (token === "--") {
      idx += 1;
      break;
    }
    if (!token.startsWith("-") || token === "-") break;

    if (token.startsWith("-p") && token.length > 2) {
      port = parsePort(token.slice(2));
      idx += 1;
      continue;
    }
    if (token.startsWith("-l") && token.length > 2) {
      user = token.slice(2);
      idx += 1;
      continue;
    }

    if (OPTIONS_WITH_VALUE.has(token)) {
      const value = tokens[idx + 1];
      if (token === "-p") port = parsePort(value);
      if (token === "-l") user = value ?? null;
      idx += 2;
      continue;
    }

    idx += 1;
  }

  const destination = tokens[idx];
  if (!destination || destination.startsWith("-")) return null;
  const at = destination.lastIndexOf("@");
  if (at >= 0) {
    user = destination.slice(0, at);
    host = destination.slice(at + 1);
  } else {
    host = destination;
  }

  if (!host || hasUnsafeSshComponent(host)) return null;
  if (user != null && (!user || hasUnsafeSshComponent(user))) return null;

  return { kind: "ssh", host, user, port, root: null };
}

function parsePort(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535
    ? parsed
    : null;
}

function hasUnsafeSshComponent(value: string): boolean {
  return /[\s"'`$;&|<>()\u0000-\u001f\u007f]/.test(value);
}

export function tokenizeShell(input: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (const ch of input) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        out.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }

  if (escaped) current += "\\";
  if (current) out.push(current);
  return out;
}
