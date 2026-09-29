import type { MarkdownNode } from "react-native-nitro-markdown/headless";

const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})/;
const BLANK_LINE_PATTERN = /\n[\t ]*\n/;

/**
 * Converts LaTeX `\(...\)` and `\[...\]` delimiters into the `$...$` and
 * `$$...$$` spans md4c understands. Fenced code, inline code, escaped
 * backslashes (`\\[2pt]`), and pairs split by a blank line stay untouched.
 */
export function normalizeMarkdownMathDelimiters(source: string): string {
  if (!source.includes("\\(") && !source.includes("\\[")) return source;

  let output = "";
  let fence: string | null = null;
  let prose = "";
  const flushProse = () => {
    output += normalizeProseMath(prose);
    prose = "";
  };

  for (const line of source.split(/(?<=\n)/)) {
    const marker = FENCE_PATTERN.exec(line)?.[1];
    if (fence) {
      output += line;
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
    } else if (marker) {
      flushProse();
      output += line;
      fence = marker;
    } else {
      prose += line;
    }
  }
  flushProse();
  return output;
}

function normalizeProseMath(source: string): string {
  let output = "";
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === "`") {
      let runEnd = index;
      while (source[runEnd] === "`") runEnd += 1;
      const run = source.slice(index, runEnd);
      const closer = source.indexOf(run, runEnd);
      const end = closer === -1 ? runEnd : closer + run.length;
      output += source.slice(index, end);
      index = end;
      continue;
    }
    if (char === "\\") {
      const next = source[index + 1];
      if (next === "(" || next === "[") {
        const closing = next === "(" ? "\\)" : "\\]";
        const closer = source.indexOf(closing, index + 2);
        const body = closer === -1 ? "" : source.slice(index + 2, closer);
        if (closer !== -1 && !BLANK_LINE_PATTERN.test(body)) {
          output += next === "(" ? `$${body.trim()}$` : `$$${body}$$`;
          index = closer + 2;
          continue;
        }
      }
      output += source.slice(index, index + 2);
      index += 2;
      continue;
    }
    output += char;
    index += 1;
  }
  return output;
}

function nodeText(node: MarkdownNode): string {
  return node.content ?? (node.children ?? []).map(nodeText).join("");
}

/**
 * Applies Pandoc's rule that `$...$` math cannot start or end with whitespace,
 * matching web. md4c alone would read `costs $ 5 and $ 10` as math.
 */
export function nativeMarkdownWithPandocMath(node: MarkdownNode): MarkdownNode {
  if (node.type === "math_inline") {
    const content = nodeText(node);
    return /^\s|\s$/.test(content) ? { type: "text", content: `$${content}$` } : node;
  }
  const children = node.children?.map(nativeMarkdownWithPandocMath);
  return children?.some((child, index) => child !== node.children?.[index])
    ? { ...node, children }
    : node;
}
