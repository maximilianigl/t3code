import { math as micromarkMath } from "micromark-extension-math";
import type { Code, Construct } from "micromark-util-types";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import type { Processor } from "unified";
import { unified } from "unified";

interface MarkdownNode {
  readonly type?: string;
  data?: {
    hProperties?: Record<string, unknown>;
  };
  readonly position?: {
    readonly start?: { readonly offset?: number };
    readonly end?: { readonly offset?: number };
  };
  readonly children?: readonly MarkdownNode[];
}

interface PromoteBracketDisplayMathOptions {
  readonly source: string;
}

interface HtmlNode {
  readonly type?: string;
  properties?: Record<string, unknown>;
  readonly children?: readonly HtmlNode[];
}

export const MARKDOWN_MATH_CODE_CLASS_NAMES = ["math-inline", "math-display"] as const;

const markdownParser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath, { singleDollarTextMath: false })
  .use(attachPandocSingleDollarMath);

const DOLLAR_SIGN = 36;

const singleDollarMathText = micromarkMath({ singleDollarTextMath: true }).text?.[
  DOLLAR_SIGN
] as Construct;

function isWhitespaceCode(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13;
}

function isDigitCode(code: Code): boolean {
  return code !== null && code >= 48 && code <= 57;
}

/**
 * `$...$` inline math under Pandoc's rules: the opening `$` is followed by a
 * non-space character, the closing `$` is preceded by one and not followed by
 * a digit. `$E=mc^2$` renders while `$20,000 to USD$30,000` stays prose.
 *
 * `remark-math` only offers all-or-nothing single dollars, so this lets its
 * tokenizer match and then rejects matches that break the rules. A rejected
 * `$` falls through to plain text and the next `$` gets its own attempt, so
 * `Pay $5 then $x$` still renders `x`.
 */
const pandocSingleDollarMathText: Construct = {
  name: "pandocMathText",
  // remark-math's construct handles `$$`; it must run first.
  add: "after",
  previous: singleDollarMathText.previous,
  tokenize(effects, ok, nok) {
    const afterMath = (code: Code) => {
      const mathText = this.sliceSerialize(this.events[this.events.length - 1]![1]);
      if (
        isWhitespaceCode(mathText.charCodeAt(1)) ||
        isWhitespaceCode(mathText.charCodeAt(mathText.length - 2)) ||
        isDigitCode(code)
      ) {
        return nok(code);
      }
      return ok(code);
    };
    return effects.attempt(singleDollarMathText, afterMath, nok);
  },
};

/**
 * Enables Pandoc-style `$...$` inline math. Use after `remark-math` configured
 * with `singleDollarTextMath: false`, which keeps `$$...$$` working.
 */
function attachPandocSingleDollarMath(this: Processor): void {
  const data = this.data();
  const micromarkExtensions = data.micromarkExtensions ?? (data.micromarkExtensions = []);
  micromarkExtensions.push({ text: { [DOLLAR_SIGN]: pandocSingleDollarMathText } });
}

export const remarkPandocSingleDollarMath = attachPandocSingleDollarMath;

type Delimiter = "(" | ")" | "[" | "]";

interface DelimiterMatch {
  readonly index: number;
  readonly delimiter: Delimiter;
}

/**
 * Converts LaTeX delimiters into the syntax understood by `remark-math`.
 *
 * Parse provisional replacements with math enabled so Markdown cannot split
 * formulas at emphasis, line breaks, or blank lines. Keep only pairs parsed as
 * entire math nodes: code, HTML, URLs, and existing dollar math stay untouched.
 * Replacements preserve source length so task-list offsets remain valid.
 */
export function normalizeLatexMathDelimiters(source: string): string {
  if (!source.includes("\\(") && !source.includes("\\[")) return source;

  const pairs = collectDelimiterPairs(source);
  if (pairs.size === 0) return source;

  const provisional = replaceDelimiterPairs(source, pairs);
  const tree = markdownParser.parse(provisional) as MarkdownNode;
  const accepted = new Map<number, number>();
  const visit = (node: MarkdownNode) => {
    if (node.type === "math" || node.type === "inlineMath") {
      const start = node.position?.start?.offset;
      const end = node.position?.end?.offset;
      const closer = start === undefined ? undefined : pairs.get(start);
      if (
        start !== undefined &&
        end !== undefined &&
        closer !== undefined &&
        closer + 2 <= end &&
        /^[\t ]*$/.test(source.slice(closer + 2, end))
      ) {
        accepted.set(start, closer);
      }
      return;
    }
    node.children?.forEach(visit);
  };

  visit(tree);
  return accepted.size === pairs.size ? provisional : replaceDelimiterPairs(source, accepted);
}

function replaceDelimiterPairs(source: string, pairs: ReadonlyMap<number, number>): string {
  if (pairs.size === 0) return source;
  const output = source.split("");
  for (const [opener, closer] of pairs) {
    output[opener] = output[opener + 1] = "$";
    output[closer] = output[closer + 1] = "$";
  }
  return output.join("");
}

/**
 * Preserves the display semantics of same-line `\[...\]` expressions.
 *
 * `remark-math` parses their length-preserving `$$...$$` normalization as
 * inline math unless the delimiters occupy their own lines. The original
 * source has matching offsets, so it can distinguish bracket-display math
 * without inserting newlines and invalidating task-list source positions.
 */
export function remarkPromoteBracketDisplayMath(options: PromoteBracketDisplayMathOptions) {
  return (tree: MarkdownNode): void => {
    const visit = (node: MarkdownNode) => {
      if (node.type === "inlineMath") {
        const start = node.position?.start?.offset;
        const end = node.position?.end?.offset;
        if (
          start !== undefined &&
          end !== undefined &&
          options.source.slice(start, start + 2) === "\\[" &&
          options.source.slice(end - 2, end) === "\\]"
        ) {
          node.data = {
            ...node.data,
            hProperties: {
              ...node.data?.hProperties,
              className: ["language-math", "math-display"],
            },
          };
        }
      }

      node.children?.forEach(visit);
    };

    visit(tree);
  };
}

/** Removes KaTeX's native parse-error tooltip after KaTeX generates its HTML. */
export function rehypeStripKatexErrorTitle() {
  return (tree: HtmlNode): void => {
    const visit = (node: HtmlNode) => {
      const className = node.properties?.className;
      if (
        node.type === "element" &&
        Array.isArray(className) &&
        className.includes("katex-error")
      ) {
        delete node.properties?.title;
      }
      node.children?.forEach(visit);
    };

    visit(tree);
  };
}

function collectDelimiterPairs(source: string): Map<number, number> {
  const delimiters: DelimiterMatch[] = [];
  const end = source.length;
  let index = 0;
  while (index < end - 1) {
    if (source[index] !== "\\") {
      index += 1;
      continue;
    }

    const runStart = index;
    while (index < end && source[index] === "\\") index += 1;
    const delimiter = source[index];
    if ((index - runStart) % 2 === 0) continue;
    if (delimiter === "(" || delimiter === ")" || delimiter === "[" || delimiter === "]") {
      delimiters.push({ index: index - 1, delimiter });
      index += 1;
    }
  }

  const pairs = new Map<number, number>();
  let opener: DelimiterMatch | null = null;
  for (const match of delimiters) {
    if (match.delimiter === "(" || match.delimiter === "[") {
      // Math delimiters do not nest. Prefer the newest opener so malformed
      // prose cannot prevent a later valid expression from rendering.
      opener = match;
      continue;
    }
    if (opener === null) continue;

    const expectedCloser = opener.delimiter === "(" ? ")" : "]";
    if (match.delimiter !== expectedCloser) continue;

    pairs.set(opener.index, match.index);
    opener = null;
  }
  return pairs;
}
