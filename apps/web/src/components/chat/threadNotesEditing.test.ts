import { describe, expect, it } from "vite-plus/test";

import { toggleTaskLines } from "./threadNotesEditing";

function toggle(text: string, caret: number, end = caret) {
  return toggleTaskLines(text, caret, end);
}

describe("toggleTaskLines", () => {
  it("checks and reopens the task under the caret", () => {
    const open = "intro\n- [ ] ship it\noutro";
    const checked = toggle(open, open.indexOf("ship"));
    expect(checked.text).toBe("intro\n- [x] ship it\noutro");
    expect(checked.selectionStart).toBe(open.indexOf("ship"));
    expect(toggle(checked.text, checked.selectionStart).text).toBe(open);
  });

  it("adds a checkbox to list items and plain lines, keeping the caret on its character", () => {
    expect(toggle("  * item", 8).text).toBe("  * [ ] item");
    const plain = toggle("  buy milk", 4);
    expect(plain.text).toBe("  - [ ] buy milk");
    expect(plain.text[plain.selectionStart]).toBe("y");
    expect(toggle("1. first", 0).text).toBe("1. [ ] first");
  });

  it("applies the first line's outcome to every selected line", () => {
    const text = "- [ ] a\n- [x] b\nc\nnot selected";
    const result = toggle(text, 0, text.indexOf("not"));
    expect(result.text).toBe("- [x] a\n- [x] b\n- [x] c\nnot selected");
  });
});
