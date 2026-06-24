use std::io::Write;
use std::process::{Command, Stdio};

use serde::de::DeserializeOwned;
use serde::Deserialize;

use super::file::{FileStat, ReadResult, StatKind};
use super::grep::{GlobHit, GlobResponse, GrepHit, GrepResponse};
use super::search::{ListFilesResult, SearchHit, SearchResult};
use super::tree::{DirEntry, EntryKind};
use crate::modules::workspace::{ssh_command, WorkspaceEnv};

const MAX_READ_BYTES: u64 = 20 * 1024 * 1024;
const BINARY_SNIFF_BYTES: usize = 8 * 1024;

const PY_HELPER: &str = r#"
import fnmatch, json, os, re, shutil, sys
def arg(i):
    return bytes.fromhex(sys.argv[i]).decode("utf-8", "surrogateescape")
def bool_arg(i):
    return arg(i) == "1"
def int_arg(i):
    return int(arg(i))
def j(value):
    print(json.dumps(value, ensure_ascii=False, separators=(",", ":")))
def kind_of(path):
    if os.path.islink(path):
        return "symlink"
    if os.path.isdir(path):
        return "dir"
    return "file"
def entry(path, name):
    full = os.path.join(path, name)
    st = os.stat(full)
    return {
        "name": name,
        "kind": kind_of(full),
        "size": st.st_size,
        "mtime": int(st.st_mtime * 1000),
        "gitignored": False,
    }
PRUNE = {
    "node_modules", ".git", "target", "dist", "build", ".next", ".turbo",
    ".cache", ".venv", "__pycache__"
}
"#;

fn hex_arg(value: &str) -> String {
    let mut out = String::with_capacity(value.len() * 2);
    for b in value.as_bytes() {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn python_command(
    workspace: &WorkspaceEnv,
    script: &str,
    args: &[String],
) -> Result<Command, String> {
    let mut cmd = ssh_command(workspace, true)?;
    let mut remote = format!("python3 -c {}", shell_quote(script));
    for arg in args {
        remote.push(' ');
        remote.push_str(arg);
    }
    cmd.arg(remote);
    Ok(cmd)
}

fn run_python(workspace: &WorkspaceEnv, body: &str, args: &[&str]) -> Result<Vec<u8>, String> {
    run_python_with_input(workspace, body, args, None)
}

fn run_python_with_input(
    workspace: &WorkspaceEnv,
    body: &str,
    args: &[&str],
    input: Option<&[u8]>,
) -> Result<Vec<u8>, String> {
    let script = format!("{PY_HELPER}\n{body}");
    let hex_args: Vec<String> = args.iter().map(|arg| hex_arg(arg)).collect();
    let mut cmd = python_command(workspace, &script, &hex_args)?;
    cmd.stdin(if input.is_some() {
        Stdio::piped()
    } else {
        Stdio::null()
    })
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
    crate::modules::proc::hide_console(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    if let Some(bytes) = input {
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "ssh stdin unavailable".to_string())?;
        stdin.write_all(bytes).map_err(|e| e.to_string())?;
    }
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(output.stdout)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if stderr.is_empty() {
            "remote SSH command failed".into()
        } else {
            stderr
        })
    }
}

fn json<T: DeserializeOwned>(bytes: Vec<u8>) -> Result<T, String> {
    serde_json::from_slice(&bytes).map_err(|e| e.to_string())
}

#[derive(Deserialize)]
struct RemoteEntry {
    name: String,
    kind: String,
    size: u64,
    mtime: u64,
    gitignored: bool,
}

fn entry_kind(kind: &str) -> EntryKind {
    match kind {
        "dir" => EntryKind::Dir,
        "symlink" => EntryKind::Symlink,
        _ => EntryKind::File,
    }
}

fn stat_kind(kind: &str) -> StatKind {
    match kind {
        "dir" => StatKind::Dir,
        "symlink" => StatKind::Symlink,
        _ => StatKind::File,
    }
}

pub fn read_dir_in(
    workspace: &WorkspaceEnv,
    path: &str,
    show_hidden: bool,
) -> Result<Vec<DirEntry>, String> {
    let body = r#"
path = arg(1)
show_hidden = bool_arg(2)
items = []
with os.scandir(path) as it:
    for e in it:
        if not show_hidden and e.name.startswith("."):
            continue
        try:
            items.append(entry(path, e.name))
        except OSError:
            pass
rank = {"dir": 0, "symlink": 1, "file": 2}
items.sort(key=lambda x: (rank.get(x["kind"], 2), x["name"].lower()))
j(items)
"#;
    let hidden = if show_hidden { "1" } else { "0" };
    let entries: Vec<RemoteEntry> = json(run_python(workspace, body, &[path, hidden])?)?;
    Ok(entries
        .into_iter()
        .map(|entry| DirEntry {
            name: entry.name,
            kind: entry_kind(&entry.kind),
            size: entry.size,
            mtime: entry.mtime,
            gitignored: entry.gitignored,
        })
        .collect())
}

#[derive(Deserialize)]
struct RemoteStat {
    size: u64,
    mtime: u64,
    kind: String,
}

#[derive(Deserialize)]
struct RemoteSearchResult {
    hits: Vec<SearchHit>,
    truncated: bool,
}

#[derive(Deserialize)]
struct RemoteListFilesResult {
    files: Vec<String>,
    truncated: bool,
}

#[derive(Deserialize)]
struct RemoteGrepResponse {
    hits: Vec<GrepHit>,
    truncated: bool,
    files_scanned: usize,
}

#[derive(Deserialize)]
struct RemoteGlobResponse {
    hits: Vec<GlobHit>,
    truncated: bool,
}

pub fn stat(workspace: &WorkspaceEnv, path: &str) -> Result<FileStat, String> {
    let body = r#"
path = arg(1)
st = os.stat(path)
j({"size": st.st_size, "mtime": int(st.st_mtime * 1000), "kind": kind_of(path)})
"#;
    let stat: RemoteStat = json(run_python(workspace, body, &[path])?)?;
    Ok(FileStat {
        size: stat.size,
        mtime: stat.mtime,
        kind: stat_kind(&stat.kind),
    })
}

pub fn canonicalize(workspace: &WorkspaceEnv, path: &str) -> Result<String, String> {
    let body = r#"
print(os.path.realpath(arg(1)))
"#;
    let out = run_python(workspace, body, &[path])?;
    Ok(String::from_utf8_lossy(&out).trim().to_string())
}

const SEEK_READ_BODY: &str = r#"
path = arg(1)
off = int_arg(2)
n = int_arg(3)
with open(path, "rb") as f:
    f.seek(off)
    remaining = n
    while remaining > 0:
        chunk = f.read(min(65536, remaining))
        if not chunk:
            break
        sys.stdout.buffer.write(chunk)
        remaining -= len(chunk)
"#;

fn seek_read(
    workspace: &WorkspaceEnv,
    path: &str,
    offset: u64,
    max_bytes: u64,
) -> Result<Vec<u8>, String> {
    run_python(
        workspace,
        SEEK_READ_BODY,
        &[path, &offset.to_string(), &max_bytes.to_string()],
    )
}

pub fn read_text_chunk(
    workspace: &WorkspaceEnv,
    path: &str,
    offset: u64,
    max_bytes: u64,
) -> Result<super::file::ChunkResult, String> {
    use super::file::{process_chunk, ChunkResult};
    let total = stat(workspace, path)?.size;
    if offset >= total {
        return Ok(ChunkResult {
            content: String::new(),
            start: offset,
            end: total,
            total,
            eof: true,
        });
    }
    let raw = seek_read(workspace, path, offset, max_bytes)?;
    Ok(process_chunk(raw, offset, total))
}

pub fn count_lines(workspace: &WorkspaceEnv, path: &str) -> Result<u64, String> {
    let body = r#"
path = arg(1)
n = 0
last = b""
with open(path, "rb") as f:
    while True:
        chunk = f.read(1 << 20)
        if not chunk:
            break
        n += chunk.count(b"\n")
        last = chunk[-1:]
if last == b"":
    print(0)
elif last == b"\n":
    print(n)
else:
    print(n + 1)
"#;
    let out = run_python(workspace, body, &[path])?;
    String::from_utf8_lossy(&out)
        .trim()
        .parse::<u64>()
        .map_err(|e| e.to_string())
}

pub fn read_file(workspace: &WorkspaceEnv, path: &str) -> Result<ReadResult, String> {
    let meta = stat(workspace, path)?;
    if meta.size > MAX_READ_BYTES {
        let head = seek_read(workspace, path, 0, BINARY_SNIFF_BYTES as u64)?;
        if super::file::head_looks_like_text(&head) {
            return Ok(ReadResult::LargeText { size: meta.size });
        }
        return Ok(ReadResult::TooLarge {
            size: meta.size,
            limit: MAX_READ_BYTES,
        });
    }
    let body = r#"
path = arg(1)
with open(path, "rb") as f:
    while True:
        chunk = f.read(65536)
        if not chunk:
            break
        sys.stdout.buffer.write(chunk)
"#;
    let bytes = run_python(workspace, body, &[path])?;
    let sniff_len = bytes.len().min(BINARY_SNIFF_BYTES);
    if bytes[..sniff_len].contains(&0) {
        return Ok(ReadResult::Binary { size: meta.size });
    }
    match String::from_utf8(bytes) {
        Ok(content) => Ok(ReadResult::Text {
            content,
            size: meta.size,
        }),
        Err(_) => Ok(ReadResult::Binary { size: meta.size }),
    }
}

pub fn read_binary_file(
    workspace: &WorkspaceEnv,
    path: &str,
    max_bytes: u64,
) -> Result<Vec<u8>, String> {
    let meta = stat(workspace, path)?;
    if meta.size > max_bytes {
        return Err(format!(
            "file is too large: {} bytes exceeds {} byte limit",
            meta.size, max_bytes
        ));
    }
    let body = r#"
path = arg(1)
with open(path, "rb") as f:
    while True:
        chunk = f.read(65536)
        if not chunk:
            break
        sys.stdout.buffer.write(chunk)
"#;
    run_python(workspace, body, &[path])
}

pub fn write_file(workspace: &WorkspaceEnv, path: &str, content: &str) -> Result<(), String> {
    let body = r#"
path = arg(1)
parent = os.path.dirname(path) or "."
os.makedirs(parent, exist_ok=True)
tmp = os.path.join(parent, ".terax-write-" + os.urandom(8).hex())
with open(tmp, "wb") as f:
    shutil.copyfileobj(sys.stdin.buffer, f)
try:
    st = os.stat(path)
    os.chmod(tmp, st.st_mode)
except OSError:
    pass
os.replace(tmp, path)
"#;
    run_python_with_input(workspace, body, &[path], Some(content.as_bytes()))?;
    Ok(())
}

pub fn create_file(workspace: &WorkspaceEnv, path: &str) -> Result<(), String> {
    let body = r#"
path = arg(1)
if os.path.exists(path):
    raise FileExistsError(path)
open(path, "xb").close()
"#;
    run_python(workspace, body, &[path]).map(|_| ())
}

pub fn create_dir(workspace: &WorkspaceEnv, path: &str) -> Result<(), String> {
    let body = r#"
path = arg(1)
if os.path.exists(path):
    raise FileExistsError(path)
os.makedirs(path)
"#;
    run_python(workspace, body, &[path]).map(|_| ())
}

pub fn rename(workspace: &WorkspaceEnv, from: &str, to: &str) -> Result<(), String> {
    let body = r#"
src = arg(1)
dst = arg(2)
if not os.path.exists(src) and not os.path.islink(src):
    raise FileNotFoundError(src)
if os.path.exists(dst) or os.path.islink(dst):
    raise FileExistsError(dst)
os.rename(src, dst)
"#;
    run_python(workspace, body, &[from, to]).map(|_| ())
}

pub fn delete(workspace: &WorkspaceEnv, path: &str) -> Result<(), String> {
    let body = r#"
path = arg(1)
if os.path.islink(path) or os.path.isfile(path):
    os.unlink(path)
elif os.path.isdir(path):
    shutil.rmtree(path)
else:
    raise FileNotFoundError(path)
"#;
    run_python(workspace, body, &[path]).map(|_| ())
}

pub fn list_subdirs(
    workspace: &WorkspaceEnv,
    path: &str,
    show_hidden: bool,
) -> Result<Vec<String>, String> {
    let body = r#"
path = arg(1)
show_hidden = bool_arg(2)
items = []
with os.scandir(path) as it:
    for e in it:
        if not show_hidden and e.name.startswith("."):
            continue
        try:
            if e.is_dir(follow_symlinks=True):
                items.append(e.name)
        except OSError:
            pass
items.sort(key=lambda x: x.lower())
j(items)
"#;
    let hidden = if show_hidden { "1" } else { "0" };
    json(run_python(workspace, body, &[path, hidden])?)
}

pub fn search(
    workspace: &WorkspaceEnv,
    root: &str,
    query: &str,
    limit: usize,
    show_hidden: bool,
) -> Result<SearchResult, String> {
    let body = r#"
root = arg(1)
query = arg(2).lower()
limit = int_arg(3)
show_hidden = bool_arg(4)
hits = []
scanned = 0
truncated = False
for base, dirs, files in os.walk(root, topdown=True, followlinks=False):
    dirs[:] = [d for d in dirs if (show_hidden or not d.startswith(".")) and d not in PRUNE]
    names = [(d, True) for d in dirs] + [(f, False) for f in files if show_hidden or not f.startswith(".")]
    for name, is_dir in names:
        scanned += 1
        if scanned > 50000:
            truncated = True
            break
        full = os.path.join(base, name)
        rel = os.path.relpath(full, root).replace(os.sep, "/")
        hay = rel.lower()
        if query not in hay and not all(ch in hay for ch in query):
            continue
        hits.append({"path": full, "rel": rel, "name": name, "is_dir": is_dir})
        if len(hits) >= limit:
            truncated = True
            break
    if truncated:
        break
hits.sort(key=lambda h: (0 if query in h["name"].lower() else 1, len(h["rel"]), h["rel"].lower()))
j({"hits": hits[:limit], "truncated": truncated})
"#;
    let cap = limit.min(1000).to_string();
    let hidden = if show_hidden { "1" } else { "0" };
    let result: RemoteSearchResult =
        json(run_python(workspace, body, &[root, query, &cap, hidden])?)?;
    Ok(SearchResult {
        hits: result.hits,
        truncated: result.truncated,
    })
}

pub fn list_files(
    workspace: &WorkspaceEnv,
    root: &str,
    limit: usize,
    max_depth: usize,
    show_hidden: bool,
) -> Result<ListFilesResult, String> {
    let body = r#"
root = arg(1)
limit = int_arg(2)
max_depth = int_arg(3)
show_hidden = bool_arg(4)
files = []
scanned = 0
truncated = False
root_depth = root.rstrip(os.sep).count(os.sep)
for base, dirs, names in os.walk(root, topdown=True, followlinks=False):
    depth = base.rstrip(os.sep).count(os.sep) - root_depth
    dirs[:] = [d for d in dirs if depth < max_depth and (show_hidden or not d.startswith(".")) and d not in PRUNE]
    for name in names:
        if not show_hidden and name.startswith("."):
            continue
        scanned += 1
        if scanned > 50000:
            truncated = True
            break
        full = os.path.join(base, name)
        rel = os.path.relpath(full, root).replace(os.sep, "/")
        files.append(rel)
        if len(files) >= limit:
            truncated = True
            break
    if truncated:
        break
files.sort(key=lambda x: x.lower())
j({"files": files, "truncated": truncated})
"#;
    let limit = limit.to_string();
    let depth = max_depth.to_string();
    let hidden = if show_hidden { "1" } else { "0" };
    let result: RemoteListFilesResult = json(run_python(
        workspace,
        body,
        &[root, &limit, &depth, hidden],
    )?)?;
    Ok(ListFilesResult {
        files: result.files,
        truncated: result.truncated,
    })
}

pub fn grep(
    workspace: &WorkspaceEnv,
    root: &str,
    pattern: &str,
    glob: &[String],
    case_insensitive: bool,
    max_results: usize,
    literal: bool,
) -> Result<GrepResponse, String> {
    let body = r#"
root = arg(1)
pattern = arg(2)
globs = json.loads(arg(3))
flags = re.IGNORECASE if bool_arg(4) else 0
cap = int_arg(5)
literal = bool_arg(6)
rx = re.compile(re.escape(pattern) if literal else pattern, flags)
hits = []
files_scanned = 0
truncated = False
for base, dirs, names in os.walk(root, topdown=True, followlinks=False):
    dirs[:] = [d for d in dirs if not d.startswith(".") and d not in PRUNE]
    for name in names:
        if name.startswith("."):
            continue
        full = os.path.join(base, name)
        rel = os.path.relpath(full, root).replace(os.sep, "/")
        if globs and not any(fnmatch.fnmatch(rel, g) for g in globs):
            continue
        try:
            if os.path.getsize(full) > 5 * 1024 * 1024:
                continue
            with open(full, "rb") as f:
                data = f.read()
            if b"\0" in data[:8192]:
                continue
            text = data.decode("utf-8")
        except Exception:
            continue
        files_scanned += 1
        for idx, line in enumerate(text.splitlines(), 1):
            if rx.search(line):
                hits.append({"path": full, "rel": rel, "line": idx, "text": line})
                if len(hits) >= cap:
                    truncated = True
                    break
        if truncated:
            break
    if truncated:
        break
j({"hits": hits, "truncated": truncated, "files_scanned": files_scanned})
"#;
    let glob_json = serde_json::to_string(glob).map_err(|e| e.to_string())?;
    let insensitive = if case_insensitive { "1" } else { "0" };
    let cap = max_results.to_string();
    let literal = if literal { "1" } else { "0" };
    let result: RemoteGrepResponse = json(run_python(
        workspace,
        body,
        &[root, pattern, &glob_json, insensitive, &cap, literal],
    )?)?;
    Ok(GrepResponse {
        hits: result.hits,
        truncated: result.truncated,
        files_scanned: result.files_scanned,
    })
}

pub fn glob(
    workspace: &WorkspaceEnv,
    root: &str,
    pattern: &str,
    max_results: usize,
) -> Result<GlobResponse, String> {
    let body = r#"
root = arg(1)
pattern = arg(2)
cap = int_arg(3)
hits = []
truncated = False
for base, dirs, names in os.walk(root, topdown=True, followlinks=False):
    dirs[:] = [d for d in dirs if not d.startswith(".") and d not in PRUNE]
    for name in names:
        if name.startswith("."):
            continue
        full = os.path.join(base, name)
        rel = os.path.relpath(full, root).replace(os.sep, "/")
        if fnmatch.fnmatch(rel, pattern):
            hits.append({"path": full, "rel": rel})
            if len(hits) >= cap:
                truncated = True
                break
    if truncated:
        break
j({"hits": hits, "truncated": truncated})
"#;
    let cap = max_results.to_string();
    let result: RemoteGlobResponse = json(run_python(workspace, body, &[root, pattern, &cap])?)?;
    Ok(GlobResponse {
        hits: result.hits,
        truncated: result.truncated,
    })
}
