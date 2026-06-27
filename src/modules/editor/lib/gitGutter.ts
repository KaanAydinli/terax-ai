import { diff } from "@codemirror/merge";
import {
  type Extension,
  RangeSet,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Text,
} from "@codemirror/state";
import { GutterMarker, gutterLineClass } from "@codemirror/view";

// Colors the line-number gutter to mark git changes against a baseline (the
// file's HEAD version). Added / modified lines turn green; lines sitting next
// to a deletion get a red marker. The baseline is pushed in via setGitBaseline
// and diffed against the live editor buffer, so unsaved edits show too.

export const setGitBaseline = StateEffect.define<string | null>();

class ChangeMarker extends GutterMarker {
  override elementClass: string;
  constructor(cls: string) {
    super();
    this.elementClass = cls;
  }
}

const addedMarker = new ChangeMarker("cm-gitAdded");
const deletedMarker = new ChangeMarker("cm-gitDeleted");

type GitState = {
  baseline: string | null;
  markers: RangeSet<GutterMarker>;
};

function computeMarkers(
  doc: Text,
  baseline: string | null,
): RangeSet<GutterMarker> {
  if (baseline == null) return RangeSet.empty;
  const current = doc.toString();
  if (baseline === current) return RangeSet.empty;

  const changes = diff(baseline, current);
  // line number (1-based) -> marker. Additions win over deletion markers.
  const lineMarks = new Map<number, GutterMarker>();

  for (const ch of changes) {
    const inserted = ch.toB - ch.fromB;
    const deleted = ch.toA - ch.fromA;
    if (inserted > 0) {
      const startLine = doc.lineAt(ch.fromB).number;
      // toB may sit at the very start of the following line; clamp back so we
      // don't paint a line that wasn't actually touched.
      const endLine = doc.lineAt(Math.max(ch.fromB, ch.toB - 1)).number;
      for (let l = startLine; l <= endLine; l++) lineMarks.set(l, addedMarker);
    } else if (deleted > 0) {
      // Pure deletion: nothing remains on this side, flag the surviving line.
      const line = doc.lineAt(Math.min(ch.fromB, current.length)).number;
      if (!lineMarks.has(line)) lineMarks.set(line, deletedMarker);
    }
  }

  const builder = new RangeSetBuilder<GutterMarker>();
  for (const ln of [...lineMarks.keys()].sort((a, b) => a - b)) {
    const at = doc.line(ln).from;
    const marker = lineMarks.get(ln);
    if (marker) builder.add(at, at, marker);
  }
  return builder.finish();
}

const gitGutterField = StateField.define<GitState>({
  create() {
    return { baseline: null, markers: RangeSet.empty };
  },
  update(value, tr) {
    let baseline = value.baseline;
    let baselineChanged = false;
    for (const e of tr.effects) {
      if (e.is(setGitBaseline)) {
        baseline = e.value;
        baselineChanged = true;
      }
    }
    if (!baselineChanged && !tr.docChanged) return value;
    return {
      baseline,
      markers: computeMarkers(tr.state.doc, baseline),
    };
  },
  provide: (f) => gutterLineClass.from(f, (v) => v.markers),
});

export function gitChangeGutter(): Extension {
  return [gitGutterField];
}
