use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::time::UNIX_EPOCH;
use std::{fs, io::Write};

use serde::Serialize;
use tauri::ipc::Response;
use tauri::Emitter;
use tempfile::NamedTempFile;

use crate::modules::workspace::{resolve_path, WorkspaceEnv};

pub const MAX_READ_BYTES: u64 = 20 * 1024 * 1024; // 20 MB
const MAX_BINARY_READ_BYTES: u64 = 100 * 1024 * 1024; // 100 MB
const BINARY_SNIFF_BYTES: usize = 8 * 1024;

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ReadResult {
    Text {
        content: String,
        size: u64,
    },
    Binary {
        size: u64,
    },
    LargeText {
        size: u64,
    },
    TooLarge {
        size: u64,
        limit: u64,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkResult {
    pub content: String,
    pub start: u64,
    pub end: u64,
    pub total: u64,
    pub eof: bool,
}

pub fn head_looks_like_text(head: &[u8]) -> bool {
    let sniff_len = head.len().min(BINARY_SNIFF_BYTES);
    if head[..sniff_len].contains(&0) {
        return false;
    }
    match std::str::from_utf8(head) {
        Ok(_) => true,
        Err(e) => e.error_len().is_none(),
    }
}

pub fn process_chunk(raw: Vec<u8>, offset: u64, total: u64) -> ChunkResult {
    if raw.is_empty() {
        return ChunkResult {
            content: String::new(),
            start: offset,
            end: offset.max(total),
            total,
            eof: true,
        };
    }
    let read_end = offset + raw.len() as u64;
    let at_file_end = read_end >= total;

    let mut keep = raw.len();
    if !at_file_end {
        if let Some(pos) = raw.iter().rposition(|&b| b == b'\n') {
            keep = pos + 1;
        }
    }
    let slice = &raw[..keep];

    let valid_len = match std::str::from_utf8(slice) {
        Ok(_) => slice.len(),
        Err(e) => e.valid_up_to(),
    };
    let content = String::from_utf8_lossy(&slice[..valid_len]).into_owned();
    let end = offset + valid_len as u64;
    ChunkResult {
        content,
        start: offset,
        end,
        total,
        eof: end >= total,
    }
}

#[derive(Serialize)]
#[serde(rename_all = "lowercase")]
pub enum StatKind {
    File,
    Dir,
    Symlink,
}

#[derive(Serialize)]
pub struct FileStat {
    pub size: u64,
    pub mtime: u64,
    pub kind: StatKind,
}

#[tauri::command]
pub fn fs_read_file(path: String, workspace: Option<WorkspaceEnv>) -> Result<ReadResult, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    if workspace.is_ssh() {
        return super::ssh::read_file(&workspace, &path);
    }
    let p = resolve_path(&path, &workspace);
    let meta = std::fs::metadata(&p).map_err(|e| {
        log::debug!("fs_read_file stat({}) failed: {e}", p.display());
        e.to_string()
    })?;

    let size = meta.len();
    if size > MAX_READ_BYTES {
        let head = read_head(&p, BINARY_SNIFF_BYTES).unwrap_or_default();
        if head_looks_like_text(&head) {
            return Ok(ReadResult::LargeText { size });
        }
        return Ok(ReadResult::TooLarge {
            size,
            limit: MAX_READ_BYTES,
        });
    }

    let bytes = std::fs::read(&p).map_err(|e| {
        log::debug!("fs_read_file read({}) failed: {e}", p.display());
        e.to_string()
    })?;

    // Null-byte sniff on the first chunk. Not perfect (misses UTF-16 BOM
    // cases) but catches the common "this is a PNG" mistake cheaply.
    let sniff_len = bytes.len().min(BINARY_SNIFF_BYTES);
    if bytes[..sniff_len].contains(&0) {
        return Ok(ReadResult::Binary { size });
    }

    match String::from_utf8(bytes) {
        Ok(content) => Ok(ReadResult::Text { content, size }),
        Err(_) => Ok(ReadResult::Binary { size }),
    }
}

fn read_head(p: &Path, n: usize) -> std::io::Result<Vec<u8>> {
    let f = std::fs::File::open(p)?;
    let mut buf = Vec::with_capacity(n);
    f.take(n as u64).read_to_end(&mut buf)?;
    Ok(buf)
}

#[tauri::command]
pub fn fs_read_text_chunk(
    path: String,
    offset: u64,
    max_bytes: u64,
    workspace: Option<WorkspaceEnv>,
) -> Result<ChunkResult, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    if workspace.is_ssh() {
        return super::ssh::read_text_chunk(&workspace, &path, offset, max_bytes);
    }
    let p = resolve_path(&path, &workspace);
    let total = std::fs::metadata(&p).map_err(|e| e.to_string())?.len();
    if offset >= total {
        return Ok(ChunkResult {
            content: String::new(),
            start: offset,
            end: total,
            total,
            eof: true,
        });
    }
    let mut f = std::fs::File::open(&p).map_err(|e| e.to_string())?;
    f.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
    let mut raw = Vec::new();
    f.take(max_bytes)
        .read_to_end(&mut raw)
        .map_err(|e| e.to_string())?;
    Ok(process_chunk(raw, offset, total))
}

pub fn count_lines_reader<R: Read>(mut r: R) -> std::io::Result<u64> {
    let mut buf = vec![0u8; 256 * 1024];
    let mut newlines: u64 = 0;
    let mut last: Option<u8> = None;
    loop {
        let n = r.read(&mut buf)?;
        if n == 0 {
            break;
        }
        let chunk = &buf[..n];
        newlines += chunk.iter().filter(|&&b| b == b'\n').count() as u64;
        last = Some(chunk[n - 1]);
    }
    Ok(match last {
        None => 0,
        Some(b'\n') => newlines,
        Some(_) => newlines + 1,
    })
}

#[tauri::command]
pub fn fs_count_lines(path: String, workspace: Option<WorkspaceEnv>) -> Result<u64, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    if workspace.is_ssh() {
        return super::ssh::count_lines(&workspace, &path);
    }
    let p = resolve_path(&path, &workspace);
    let f = std::fs::File::open(&p).map_err(|e| e.to_string())?;
    count_lines_reader(f).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_read_binary_file(
    path: String,
    workspace: Option<WorkspaceEnv>,
) -> Result<Response, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    if workspace.is_ssh() {
        return super::ssh::read_binary_file(&workspace, &path, MAX_BINARY_READ_BYTES)
            .map(Response::new);
    }
    let p = resolve_path(&path, &workspace);
    let meta = std::fs::metadata(&p).map_err(|e| {
        log::debug!("fs_read_binary_file stat({}) failed: {e}", p.display());
        e.to_string()
    })?;
    if meta.len() > MAX_BINARY_READ_BYTES {
        return Err(format!(
            "file is too large: {} bytes exceeds {} byte limit",
            meta.len(),
            MAX_BINARY_READ_BYTES
        ));
    }
    std::fs::read(&p).map(Response::new).map_err(|e| {
        log::debug!("fs_read_binary_file read({}) failed: {e}", p.display());
        e.to_string()
    })
}

#[derive(Serialize, Clone)]
struct FileWrittenEvent {
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    source: Option<String>,
}

/// Atomic write via O_EXCL tempfile in the target's parent, then rename.
/// The random suffix is what blocks pre-staged symlink attacks.
fn write_atomic(target: &Path, content: &[u8]) -> std::io::Result<()> {
    let parent = target.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "path has no parent")
    })?;
    let mut tmp = NamedTempFile::new_in(parent)?;
    tmp.as_file_mut().write_all(content)?;
    tmp.as_file_mut().sync_all()?;
    tmp.persist(target).map_err(|e| e.error)?;
    Ok(())
}

#[tauri::command]
pub fn fs_write_file(
    path: String,
    content: String,
    workspace: Option<WorkspaceEnv>,
    source: Option<String>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    if workspace.is_ssh() {
        super::ssh::write_file(&workspace, &path, &content)?;
        let _ = app.emit(
            "fs:file-written",
            FileWrittenEvent {
                path: path.clone(),
                source,
            },
        );
        return Ok(());
    }
    let target = resolve_path(&path, &workspace);
    let original_permissions = fs::metadata(&target).ok().map(|m| m.permissions());
    write_atomic(&target, content.as_bytes()).map_err(|e| {
        log::warn!("fs_write_file({}) failed: {e}", target.display());
        e.to_string()
    })?;

    if let Some(perms) = original_permissions {
        let _ = fs::set_permissions(&target, perms);
    }
    let _ = app.emit(
        "fs:file-written",
        FileWrittenEvent {
            path: path.clone(),
            source,
        },
    );

    Ok(())
}

#[tauri::command]
pub fn fs_canonicalize(path: String, workspace: Option<WorkspaceEnv>) -> Result<String, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    if workspace.is_ssh() {
        return super::ssh::canonicalize(&workspace, &path);
    }
    let p = resolve_path(&path, &workspace);
    let canon = std::fs::canonicalize(&p).map_err(|e| e.to_string())?;
    Ok(super::to_canon(&canon))
}

#[tauri::command]
pub fn fs_stat(path: String, workspace: Option<WorkspaceEnv>) -> Result<FileStat, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    if workspace.is_ssh() {
        return super::ssh::stat(&workspace, &path);
    }
    let p = resolve_path(&path, &workspace);
    let meta = std::fs::metadata(&p).map_err(|e| e.to_string())?;
    let kind = if meta.is_dir() {
        StatKind::Dir
    } else if meta.file_type().is_symlink() {
        StatKind::Symlink
    } else {
        StatKind::File
    };
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Ok(FileStat {
        size: meta.len(),
        mtime,
        kind,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_file_classifies_utf8_as_text() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.txt");
        std::fs::write(&f, b"hello world").unwrap();
        match fs_read_file(f.to_string_lossy().into_owned(), None).unwrap() {
            ReadResult::Text { content, size } => {
                assert_eq!(content, "hello world");
                assert_eq!(size, 11);
            }
            _ => panic!("expected text"),
        }
    }

    #[test]
    fn read_file_detects_binary_via_null_byte() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.bin");
        std::fs::write(&f, b"PNG\0\x89image").unwrap();
        assert!(matches!(
            fs_read_file(f.to_string_lossy().into_owned(), None).unwrap(),
            ReadResult::Binary { .. }
        ));
    }

    #[test]
    fn read_file_detects_binary_via_invalid_utf8() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.bin");
        // Invalid UTF-8 with no null byte: must still classify as binary.
        std::fs::write(&f, [0xff, 0xfe, 0xfd, 0xfc]).unwrap();
        assert!(matches!(
            fs_read_file(f.to_string_lossy().into_owned(), None).unwrap(),
            ReadResult::Binary { .. }
        ));
    }

    #[test]
    fn overwrites_existing_target() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("note.txt");
        std::fs::write(&target, b"old").unwrap();
        write_atomic(&target, b"new").unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"new");
    }

    #[test]
    fn chunk_trims_to_last_newline_when_not_at_eof() {
        let raw = b"aaa\nbbb\nccc".to_vec();
        let r = process_chunk(raw, 0, 100);
        assert_eq!(r.content, "aaa\nbbb\n");
        assert_eq!(r.end, 8);
        assert!(!r.eof);
    }

    #[test]
    fn chunk_keeps_everything_at_eof() {
        let raw = b"aaa\nbbb\nccc".to_vec();
        let r = process_chunk(raw, 0, 11);
        assert_eq!(r.content, "aaa\nbbb\nccc");
        assert_eq!(r.end, 11);
        assert!(r.eof);
    }

    #[test]
    fn chunk_makes_progress_on_a_line_longer_than_the_window() {
        let raw = b"a very long single line".to_vec();
        let r = process_chunk(raw.clone(), 0, 1000);
        assert_eq!(r.content, "a very long single line");
        assert_eq!(r.end, raw.len() as u64);
        assert!(!r.eof);
    }

    #[test]
    fn chunk_does_not_split_a_multibyte_char_mid_line() {
        let mut raw = b"abc".to_vec();
        raw.push(0xC3);
        let r = process_chunk(raw, 0, 1000);
        assert_eq!(r.content, "abc");
        assert_eq!(r.end, 3);
        assert!(!r.eof);
    }

    #[test]
    fn empty_chunk_is_eof() {
        let r = process_chunk(Vec::new(), 50, 50);
        assert_eq!(r.content, "");
        assert!(r.eof);
    }

    #[test]
    fn chunked_read_reconstructs_the_whole_file() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("big.jsonl");
        let mut original = String::new();
        for i in 0..5000 {
            original.push_str(&format!("{{\"i\":{i},\"v\":\"café\"}}\n"));
        }
        std::fs::write(&f, &original).unwrap();
        let path = f.to_string_lossy().into_owned();

        let mut rebuilt = String::new();
        let mut offset = 0u64;
        let mut guard = 0;
        loop {
            guard += 1;
            assert!(guard < 100_000, "chunk loop did not terminate");
            let r = fs_read_text_chunk(path.clone(), offset, 64, None).unwrap();
            rebuilt.push_str(&r.content);
            offset = r.end;
            if r.eof {
                break;
            }
            assert!(r.end > r.start || !r.content.is_empty());
        }
        assert_eq!(rebuilt, original);
    }

    #[test]
    fn counts_rows_with_trailing_newline() {
        assert_eq!(count_lines_reader(&b"a\nb\nc\n"[..]).unwrap(), 3);
    }

    #[test]
    fn counts_rows_without_trailing_newline() {
        assert_eq!(count_lines_reader(&b"a\nb\nc"[..]).unwrap(), 3);
    }

    #[test]
    fn counts_single_line_without_newline() {
        assert_eq!(count_lines_reader(&b"{\"a\":1}"[..]).unwrap(), 1);
    }

    #[test]
    fn empty_file_has_zero_rows() {
        assert_eq!(count_lines_reader(&b""[..]).unwrap(), 0);
    }

    #[test]
    fn fs_count_lines_counts_a_real_file() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("x.jsonl");
        std::fs::write(&f, "a\nb\nc\n").unwrap();
        assert_eq!(
            fs_count_lines(f.to_string_lossy().into_owned(), None).unwrap(),
            3
        );
    }

    #[test]
    fn read_file_classifies_large_text_vs_too_large_binary() {
        let dir = tempfile::tempdir().unwrap();
        let big = (MAX_READ_BYTES + 4096) as usize;

        let text = dir.path().join("big.txt");
        std::fs::write(&text, "a".repeat(big)).unwrap();
        assert!(matches!(
            fs_read_file(text.to_string_lossy().into_owned(), None).unwrap(),
            ReadResult::LargeText { .. }
        ));

        let bin = dir.path().join("big.bin");
        let mut bytes = vec![0u8; big];
        bytes[10] = 0;
        std::fs::write(&bin, &bytes).unwrap();
        assert!(matches!(
            fs_read_file(bin.to_string_lossy().into_owned(), None).unwrap(),
            ReadResult::TooLarge { .. }
        ));
    }

    #[test]
    fn head_sniff_accepts_text_rejects_binary() {
        assert!(head_looks_like_text(b"{\"a\":1}\n{\"b\":2}\n"));
        assert!(!head_looks_like_text(b"PNG\0\x89data"));
        // Truncated trailing multibyte char is still text.
        assert!(head_looks_like_text(&[b'h', b'i', 0xC3]));
    }

    #[cfg(unix)]
    #[test]
    fn does_not_follow_legacy_staging_symlink() {
        use std::os::unix::fs::symlink;
        let dir = tempfile::tempdir().unwrap();
        let outside = dir.path().join("outside.txt");
        std::fs::write(&outside, b"untouched").unwrap();

        let target = dir.path().join("note.txt");
        // Pre-stage a symlink at the legacy deterministic staging path.
        let legacy = dir.path().join(".note.txt.terax.tmp");
        symlink(&outside, &legacy).unwrap();

        write_atomic(&target, b"payload").unwrap();

        assert_eq!(std::fs::read(&target).unwrap(), b"payload");
        // The pre-staged symlink target must not have been written through.
        assert_eq!(std::fs::read(&outside).unwrap(), b"untouched");
    }
}
