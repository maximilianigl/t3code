const TASK_ITEM = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/;
const LIST_ITEM = /^(\s*(?:[-*+]|\d+[.)])\s+)/;
const INDENT = /^(\s*)/;

interface Edit {
  readonly at: number;
  readonly remove: number;
  readonly insert: string;
}

/**
 * Toggles the task checkbox on every line the selection touches. The first line decides the
 * outcome for all of them: an open task checks them, a done task reopens them, and anything
 * else turns them into open tasks, so a mixed selection ends up in one state.
 */
export function toggleTaskLines(
  text: string,
  selectionStart: number,
  selectionEnd: number,
): { text: string; selectionStart: number; selectionEnd: number } {
  const firstLineStart = text.lastIndexOf("\n", selectionStart - 1) + 1;
  const lastLineEnd = (() => {
    // A selection that ends right after a newline does not include the next line.
    const end =
      selectionEnd > selectionStart && text[selectionEnd - 1] === "\n"
        ? selectionEnd - 1
        : selectionEnd;
    const next = text.indexOf("\n", end);
    return next === -1 ? text.length : next;
  })();
  const lines: Array<{ start: number; value: string }> = [];
  let start = firstLineStart;
  for (const value of text.slice(firstLineStart, lastLineEnd).split("\n")) {
    lines.push({ start, value });
    start += value.length + 1;
  }

  const firstTask = TASK_ITEM.exec(lines[0]?.value ?? "");
  const target = firstTask === null ? "open" : firstTask[2] === " " ? "done" : "open";

  const mark = target === "done" ? "x" : " ";
  const edits: Edit[] = lines.map(({ start: lineStart, value }) => {
    const task = TASK_ITEM.exec(value);
    if (task) return { at: lineStart + task[1]!.length + 1, remove: 1, insert: mark };
    const list = LIST_ITEM.exec(value);
    if (list) return { at: lineStart + list[1]!.length, remove: 0, insert: `[${mark}] ` };
    return { at: lineStart + INDENT.exec(value)![1]!.length, remove: 0, insert: `- [${mark}] ` };
  });

  let next = text;
  for (const edit of edits.toReversed()) {
    next = next.slice(0, edit.at) + edit.insert + next.slice(edit.at + edit.remove);
  }
  // Text inserted at or before a caret pushes it along, so it stays on the same character.
  const move = (position: number) =>
    edits.reduce(
      (shifted, edit) =>
        edit.at <= position ? shifted + edit.insert.length - edit.remove : shifted,
      position,
    );
  return { text: next, selectionStart: move(selectionStart), selectionEnd: move(selectionEnd) };
}
