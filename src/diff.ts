import * as Diff from "diff";

export interface DiffResult {
  diff: string;
  firstChangedLine: number | undefined;
}

function formatNumberedDiffLine(prefix: "+" | "-" | " ", lineNum: number, content: string): string {
  return `${prefix}${lineNum}|${content}`;
}

/**
 * Generate a unified diff string with line numbers and context.
 * Returns both the diff string and the first changed line number (in the new file).
 */
export function generateDiffString(
  oldContent: string,
  newContent: string,
  contextLines = 2,
): DiffResult {
  const parts = Diff.diffLines(oldContent, newContent);
  const output: string[] = [];

  let oldLineNum = 1;
  let newLineNum = 1;
  let lastWasChange = false;
  let firstChangedLine: number | undefined;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const raw = part.value.split("\n");
    if (raw[raw.length - 1] === "") {
      raw.pop();
    }

    if (part.added || part.removed) {
      if (firstChangedLine === undefined) {
        firstChangedLine = newLineNum;
      }

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
        let leadingSkip = 0;
        let middleSkip = 0;
        let trailingSkip = 0;
        let linesToShow: string[];

        if (lastWasChange && nextPartIsChange) {
          if (raw.length > contextLimit * 2) {
            const leadingContext = raw.slice(0, contextLimit);
            const trailingContext = raw.slice(raw.length - contextLimit);
            middleSkip = raw.length - leadingContext.length - trailingContext.length;
            linesToShow = [...leadingContext, ...trailingContext];
          } else {
            linesToShow = raw;
          }
        } else if (nextPartIsChange) {
          leadingSkip = Math.max(0, raw.length - contextLimit);
          linesToShow = raw.slice(leadingSkip);
        } else {
          trailingSkip = Math.max(0, raw.length - contextLimit);
          linesToShow = raw.slice(0, contextLimit);
        }

        if (leadingSkip > 0) {
          oldLineNum += leadingSkip;
          newLineNum += leadingSkip;
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

        if (trailingSkip > 0) {
          oldLineNum += trailingSkip;
          newLineNum += trailingSkip;
        }
      } else {
        oldLineNum += raw.length;
        newLineNum += raw.length;
      }

      lastWasChange = false;
    }
  }

  return { diff: output.join("\n"), firstChangedLine };
}
