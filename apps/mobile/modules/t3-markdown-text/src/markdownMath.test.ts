import { describe, expect, it } from "vite-plus/test";
import type { MarkdownNode } from "react-native-nitro-markdown/headless";

import { nativeMarkdownWithPandocMath, normalizeMarkdownMathDelimiters } from "./markdownMath";

describe("normalizeMarkdownMathDelimiters", () => {
  it("converts LaTeX delimiters into dollar math", () => {
    expect(normalizeMarkdownMathDelimiters("Let \\( x^2 \\) grow:\n\\[\n\\sum_i x_i\n\\]")).toBe(
      "Let $x^2$ grow:\n$$\n\\sum_i x_i\n$$",
    );
  });

  it("leaves code, escaped backslashes, and unpaired delimiters alone", () => {
    const source = [
      "Inline `\\(x\\)` and \\\\[2pt] stay.",
      "```tex",
      "\\[ y \\]",
      "```",
      "Open \\( without a close.",
      "\\[ split",
      "",
      "by a paragraph \\]",
    ].join("\n");
    expect(normalizeMarkdownMathDelimiters(source)).toBe(source);
  });
});

describe("nativeMarkdownWithPandocMath", () => {
  it("returns whitespace-padded inline math to prose", () => {
    const document: MarkdownNode = {
      type: "document",
      children: [
        {
          type: "paragraph",
          children: [
            { type: "text", content: "costs " },
            { type: "math_inline", content: " 5 and " },
            { type: "math_inline", children: [{ type: "text", content: "x" }] },
          ],
        },
      ],
    };
    const paragraph = nativeMarkdownWithPandocMath(document).children?.[0];
    expect(paragraph?.children?.[1]).toEqual({ type: "text", content: "$ 5 and $" });
    expect(paragraph?.children?.[2]).toBe(document.children?.[0]?.children?.[2]);
  });
});
