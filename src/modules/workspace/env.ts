import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { setLastWslDistro } from "@/modules/settings/store";

export type WorkspaceEnv =
  | { kind: "local" }
  | { kind: "wsl"; distro: string }
  | {
      kind: "ssh";
      host: string;
      user?: string | null;
      port?: number | null;
      root?: string | null;
    };

export type WslDistro = {
  name: string;
  default: boolean;
  running: boolean;
};

export type SshConnection = Extract<WorkspaceEnv, { kind: "ssh" }> & {
  id: string;
  label: string;
};

type State = {
  env: WorkspaceEnv;
  distros: WslDistro[];
  sshConnections: SshConnection[];
  loading: boolean;
  error: string | null;
  setEnv: (env: WorkspaceEnv) => void;
  addSshConnection: (connection: SshConnection) => void;
  removeSshConnection: (id: string) => void;
  refreshDistros: () => Promise<WslDistro[]>;
};

export const LOCAL_WORKSPACE: WorkspaceEnv = { kind: "local" };
const SSH_CONNECTIONS_KEY = "terax:ssh-connections";

function loadSshConnections(): SshConnection[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SSH_CONNECTIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SshConnection =>
        item?.kind === "ssh" &&
        typeof item.id === "string" &&
        typeof item.host === "string" &&
        typeof item.label === "string",
    );
  } catch {
    return [];
  }
}

function saveSshConnections(connections: SshConnection[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SSH_CONNECTIONS_KEY, JSON.stringify(connections));
  } catch {
    /* ignore */
  }
}

export const useWorkspaceEnvStore = create<State>((set) => ({
  env: LOCAL_WORKSPACE,
  distros: [],
  sshConnections: loadSshConnections(),
  loading: false,
  error: null,
  setEnv: (env) => {
    set({ env });
    if (env.kind === "wsl") void setLastWslDistro(env.distro);
  },
  addSshConnection: (connection) => {
    set((state) => {
      const next = [
        connection,
        ...state.sshConnections.filter((item) => item.id !== connection.id),
      ];
      saveSshConnections(next);
      return { sshConnections: next };
    });
  },
  removeSshConnection: (id) => {
    set((state) => {
      const next = state.sshConnections.filter((item) => item.id !== id);
      saveSshConnections(next);
      const env =
        state.env.kind === "ssh" && sshLabel(state.env) === id
          ? LOCAL_WORKSPACE
          : state.env;
      return { sshConnections: next, env };
    });
  },
  refreshDistros: async () => {
    set({ loading: true, error: null });
    try {
      const distros = await invoke<WslDistro[]>("wsl_list_distros");
      set({ distros, loading: false });
      return distros;
    } catch (e) {
      set({ distros: [], loading: false, error: String(e) });
      return [];
    }
  },
}));

export function currentWorkspaceEnv(): WorkspaceEnv {
  return useWorkspaceEnvStore.getState().env;
}

export function workspaceScopeKey(env: WorkspaceEnv): string {
  if (env.kind === "wsl") return `wsl:${env.distro}`;
  if (env.kind === "ssh") {
    const user = env.user ? `${env.user}@` : "";
    const port = env.port ? `:${env.port}` : "";
    return `ssh:${user}${env.host}${port}`;
  }
  return "local";
}

export function currentWorkspaceScopeKey(): string {
  return workspaceScopeKey(currentWorkspaceEnv());
}

export async function getWslHome(distro: string): Promise<string> {
  return invoke<string>("wsl_home", { distro });
}

export async function getSshHome(env: Extract<WorkspaceEnv, { kind: "ssh" }>): Promise<string> {
  return invoke<string>("ssh_home", { workspace: env });
}

export async function getSshDefaultRoot(
  env: Extract<WorkspaceEnv, { kind: "ssh" }>,
): Promise<string> {
  return invoke<string>("ssh_default_root", { workspace: env });
}

export function sshLabel(env: Extract<WorkspaceEnv, { kind: "ssh" }>): string {
  const user = env.user ? `${env.user}@` : "";
  const port = env.port ? `:${env.port}` : "";
  return `${user}${env.host}${port}`;
}

export function parseSshConnection(input: string): SshConnection | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const [targetRaw, rootRaw] = splitSshInput(trimmed);
  const at = targetRaw.lastIndexOf("@");
  const user = at >= 0 ? targetRaw.slice(0, at) : null;
  let hostPort = at >= 0 ? targetRaw.slice(at + 1) : targetRaw;
  let root = rootRaw;
  const pathIdx = hostPort.indexOf(":/");
  if (pathIdx >= 0) {
    root = hostPort.slice(pathIdx + 1);
    hostPort = hostPort.slice(0, pathIdx);
  }
  const portMatch = hostPort.match(/^(.*):(\d+)$/);
  const host = portMatch ? portMatch[1] : hostPort;
  const port = portMatch ? Number(portMatch[2]) : null;
  if (!host || /\s/.test(host) || (user != null && (!user || /\s/.test(user)))) {
    return null;
  }
  const env = {
    kind: "ssh" as const,
    host,
    user,
    port: port && port > 0 && port <= 65535 ? port : null,
    root: root || null,
  };
  return {
    ...env,
    id: sshLabel(env),
    label: sshLabel(env),
  };
}

function splitSshInput(input: string): [string, string | null] {
  const firstSpace = input.search(/\s/);
  if (firstSpace < 0) return [input, null];
  const target = input.slice(0, firstSpace).trim();
  const root = input.slice(firstSpace).trim();
  return [target, root || null];
}
