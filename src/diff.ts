import * as Diff from "diff";

function formatNumberedDiffLine(prefix: "+" | "-" | " ", lineNum: number, content: string): string {
  return `${prefix}${lineNum}|${content}`;
}

/**
 * Generate a numbered diff in the `<sign><lineNum>|<content>` shape that
 * `buildCompactDiffPreview` consumes: `+` lines carry the post-edit number, `-`
 * lines the pre-edit number, context lines the pre-edit number. Unchanged
 * regions adjacent to a change are trimmed to `contextLines` per side — the
 * package only elides long *added* runs, not context, so the producer must cap
 * context itself or the whole unchanged file floods the preview. The elided
 * middle of a between-changes block is dropped (line numbers jump across it).
 */
export function generateDiffString(oldContent: string, newContent: string, contextLines = 2): string {
  const parts = Diff.diffLines(oldContent, newContent);
  const output: string[] = [];

  let oldLineNum = 1;
  let newLineNum = 1;
  let lastWasChange = false;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const raw = part.value.split("\n");
    if (raw[raw.length - 1] === "") {
      raw.pop();
    }

    if (part.added || part.removed) {
      for (const line of raw) {
        if (part.added) {
          output.push(formatNumberedDiffLine("+", newLineNum, line));
          newLineNum++;
        } else {
          output.push(formatNumberedDiffLine("-", oldLineNum, line));
          oldLineNum++;
        }
      }
      lastWasChange = true;
    } else {
      const nextPartIsChange = i < parts.length - 1 && (parts[i + 1].added || parts[i + 1].removed);

      if (lastWasChange || nextPartIsChange) {
        const contextLimit = Math.max(0, contextLines);
        let middleSkip = 0;
        let linesToShow: string[];

        if (lastWasChange && nextPartIsChange) {
          // Context sandwiched between two changes: keep both edges, drop the middle.
          if (raw.length > contextLimit * 2) {
            middleSkip = raw.length - contextLimit * 2;
            linesToShow = [...raw.slice(0, contextLimit), ...raw.slice(raw.length - contextLimit)];
          } else {
            linesToShow = raw;
          }
        } else if (nextPartIsChange) {
          // Leading context before a change: keep the tail, skip past the head.
          const skip = Math.max(0, raw.length - contextLimit);
          oldLineNum += skip;
          newLineNum += skip;
          linesToShow = raw.slice(skip);
        } else {
          // Trailing context after the final change: keep the head. diffLines never
          // emits a change after this block, so the unshown tail needs no counting.
          linesToShow = raw.slice(0, contextLimit);
        }

        const firstChunkLength = middleSkip > 0 ? contextLimit : linesToShow.length;
        for (const line of linesToShow.slice(0, firstChunkLength)) {
          output.push(formatNumberedDiffLine(" ", oldLineNum, line));
          oldLineNum++;
          newLineNum++;
        }

        if (middleSkip > 0) {
          oldLineNum += middleSkip;
          newLineNum += middleSkip;
          for (const line of linesToShow.slice(firstChunkLength)) {
            output.push(formatNumberedDiffLine(" ", oldLineNum, line));
            oldLineNum++;
            newLineNum++;
          }
        }
      } else {
        oldLineNum += raw.length;
        newLineNum += raw.length;
      }

      lastWasChange = false;
    }
  }

  return output.join("\n");
}
