export function isJsonl(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith(".jsonl") || lower.endsWith(".ndjson");
}

export function countRows(text: string): number {
  if (text.length === 0) return 0;
  let newlines = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) newlines++;
  }
  return text.charCodeAt(text.length - 1) === 10 ? newlines : newlines + 1;
}
