import { invoke } from "@tauri-apps/api/core";

let cached: string | undefined;
let explicit = false;

export async function initLaunchDir(): Promise<void> {
  const cliDir = await invoke<string | null>("get_launch_dir").catch(
    () => null,
  );
  explicit = cliDir !== null;
  const dir =
    cliDir ?? (await invoke<string>("workspace_current_dir").catch(() => null));
  cached = dir ? dir.replace(/\\/g, "/") : undefined;
}

export function getLaunchDir(): string | undefined {
  return cached;
}

export function isLaunchDirExplicit(): boolean {
  return explicit;
}
