import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Options as ReactMarkdownOptions } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { describe, expect, it } from "vite-plus/test";

import { remarkNormalizeListItemIndentation } from "./markdown-list-indentation";
import {
  MARKDOWN_MATH_CODE_CLASS_NAMES,
  normalizeLatexMathDelimiters,
  rehypeStripKatexErrorTitle,
  remarkPandocSingleDollarMath,
  remarkPromoteBracketDisplayMath,
} from "./markdown-math";

const MATH_SANITIZE_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [
      ...(defaultSchema.attributes?.code ?? []).filter(
        (attribute) => !Array.isArray(attribute) || attribute[0] !== "className",
      ),
      ["className", /^language-./, ...MARKDOWN_MATH_CODE_CLASS_NAMES],
    ],
  },
} satisfies Parameters<typeof rehypeSanitize>[0];

const MATH_REHYPE_PLUGINS = [
  [rehypeKatex, { output: "htmlAndMathml", errorColor: "var(--destructive)" }],
  rehypeStripKatexErrorTitle,
] satisfies NonNullable<ReactMarkdownOptions["rehypePlugins"]>;

const SANITIZED_MATH_REHYPE_PLUGINS = [
  [rehypeSanitize, MATH_SANITIZE_SCHEMA],
  ...MATH_REHYPE_PLUGINS,
] satisfies NonNullable<ReactMarkdownOptions["rehypePlugins"]>;

function renderMarkdown(source: string, sanitize = false): string {
  const remarkPlugins = [
    remarkGfm,
    [remarkMath, { singleDollarTextMath: false }],
    remarkPandocSingleDollarMath,
    [remarkPromoteBracketDisplayMath, { source }],
    remarkNormalizeListItemIndentation,
  ] satisfies NonNullable<ReactMarkdownOptions["remarkPlugins"]>;
  return renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      {
        remarkPlugins,
        rehypePlugins: sanitize ? SANITIZED_MATH_REHYPE_PLUGINS : MATH_REHYPE_PLUGINS,
      },
      normalizeLatexMathDelimiters(source),
    ),
  );
}

describe("normalizeLatexMathDelimiters", () => {
  it("renders normalized delimiters through KaTeX", () => {
    const html = renderMarkdown("Euler: \\(e^{i\\pi} + 1 = 0\\)");
    expect(html).toContain('class="katex"');
    expect(html).toContain("mathml");
  });

  it("renders same-line bracket delimiters as display math", () => {
    const html = renderMarkdown("Before \\[E=mc^2\\] after", true);
    expect(html).toContain('class="katex-display"');
  });

  it("uses the theme error color without a native parse-error title", () => {
    const html = renderMarkdown("Broken: \\(x^\\)", true);
    expect(html).toContain('class="katex-error"');
    expect(html).toContain('style="color:var(--destructive)"');
    expect(html).not.toContain("title=");
  });

  it("keeps parenthesized delimiters inline", () => {
    const html = renderMarkdown("Before \\(E=mc^2\\) after");
    expect(html).toContain('class="katex"');
    expect(html).not.toContain('class="katex-display"');
  });

  it("leaves ordinary dollar amounts as text", () => {
    const html = renderMarkdown("Costs rose from $20,000 to USD$30,000");
    expect(html).not.toContain('class="katex"');
    expect(html).toContain("$20,000 to USD$30,000");
  });

  it("renders single-dollar inline math", () => {
    const html = renderMarkdown("Energy: $E=mc^2$ here");
    expect(html).toContain('class="katex"');
    expect(html).not.toContain('class="katex-display"');
  });

  it("gives single-dollar math precedence over inline markup", () => {
    const html = renderMarkdown("$a*b*c$");
    expect(html).toContain('class="katex"');
    expect(html).not.toContain("<em>");
  });

  it("leaves single dollars as text when they violate Pandoc's rules", () => {
    for (const source of [
      "Pay $5 now and $ later",
      "Pay $ 5 now and 10$ later",
      "Between $5 and $10 tonight",
    ]) {
      const html = renderMarkdown(source);
      expect(html, source).not.toContain('class="katex"');
    }
  });

  it("pairs a closing dollar with the nearest valid opener", () => {
    const html = renderMarkdown("Pay $5 then $x$");
    expect(html.match(/class="katex"/g)).toHaveLength(1);
    expect(html).toContain("Pay $5 then ");
  });

  it("does not treat escaped dollars as math delimiters", () => {
    const html = renderMarkdown("\\$x\\$ then $y$");
    expect(html.match(/class="katex"/g)).toHaveLength(1);
    expect(html).toContain("$x$ then ");
  });

  it("rewrites paired inline and display delimiters", () => {
    expect(normalizeLatexMathDelimiters("inline \\(a+b\\)\n\n\\[\nE=mc^2\n\\]")).toBe(
      "inline $$a+b$$\n\n$$\nE=mc^2\n$$",
    );
  });

  it("preserves source length and task-list offsets", () => {
    const source = "Display \\[a+b\\]\n\n- [ ] task with \\(c+d\\) inline";
    const normalized = normalizeLatexMathDelimiters(source);
    expect(normalized).toHaveLength(source.length);
    expect(normalized.indexOf("[ ]")).toBe(source.indexOf("[ ]"));
  });

  it("leaves unmatched and escaped delimiters unchanged", () => {
    expect(
      normalizeLatexMathDelimiters("\\(open only and a stray \\] plus \\\\(literal\\\\)"),
    ).toBe("\\(open only and a stray \\] plus \\\\(literal\\\\)");
  });

  it("recovers valid pairs after unmatched or mismatched delimiters", () => {
    const cases = [
      ["Mention \\( literally, then \\(a+b\\)", "Mention \\( literally, then $$a+b$$"],
      ["Mention \\[ literally, then \\(a+b\\)", "Mention \\[ literally, then $$a+b$$"],
      ["Mention \\( literally, then \\[a+b\\]", "Mention \\( literally, then $$a+b$$"],
      ["Mismatched \\( text \\] then \\[a+b\\]", "Mismatched \\( text \\] then $$a+b$$"],
    ] as const;

    for (const [source, expected] of cases) {
      expect(normalizeLatexMathDelimiters(source)).toBe(expected);
    }
  });

  it("continues to rewrite adjacent valid pairs", () => {
    expect(normalizeLatexMathDelimiters("\\(a\\) and \\[b\\]")).toBe("$$a$$ and $$b$$");
  });

  it("renders inline math recovered from over-indented list content", () => {
    const source = "-       formula \\(a+b\\)";
    expect(normalizeLatexMathDelimiters(source)).toBe(source);
    expect(renderMarkdown(source)).toContain('class="katex"');
  });

  it("renders display math recovered from over-indented list content", () => {
    expect(renderMarkdown("-       formula \\[a+b\\]", true)).toContain('class="katex-display"');
  });

  it("preserves markdown structure when recovering over-indented list content", () => {
    const html = renderMarkdown(
      '-       `\\(code\\)` [link](https://example.com/\\(path\\)) <https://example.com/\\(path\\)> <span title="\\(attr\\)">html</span> and \\(math\\)',
    );
    expect(html.match(/class="katex"/g)).toHaveLength(1);
    expect(html).toContain("\\(code\\)");
    expect(html).toContain("https://example.com/%5C(path%5C)");
    expect(html).toContain("title=&quot;\\(attr\\)&quot;");
  });

  it("scans long backslash runs without repeatedly rescanning the prefix", () => {
    const prefix = "\\".repeat(100_000);
    expect(normalizeLatexMathDelimiters(`${prefix} then \\(a+b\\)`)).toBe(`${prefix} then $$a+b$$`);
  });

  it("leaves inline, fenced, quoted fenced, and indented code unchanged", () => {
    const source = [
      "`\\(inline\\)`",
      "```md",
      "\\(fenced\\)",
      "```",
      "> ~~~",
      "> \\(quoted\\)",
      "> ~~~",
      "    \\(indented\\)",
      "prose \\(math\\)",
    ].join("\n");
    expect(normalizeLatexMathDelimiters(source)).toBe(
      source.replace("prose \\(math\\)", () => "prose $$math$$"),
    );
  });

  it("leaves link destinations, autolinks, and HTML attributes unchanged", () => {
    const source = [
      "[file](file:///tmp/foo\\(bar\\).ts)",
      "<https://example.com/foo\\(bar\\)>",
      '<span title="\\(attribute\\)">text</span>',
      "[label \\(x\\)](https://example.com)",
    ].join("\n");
    expect(normalizeLatexMathDelimiters(source)).toBe(
      source.replace("label \\(x\\)", () => "label $$x$$"),
    );
  });

  it("does not pair delimiters across separate text nodes", () => {
    const source = "\\(open **bold** close\\)";
    expect(normalizeLatexMathDelimiters(source)).toBe(source);
  });

  it("leaves unrelated escapes and dollar amounts unchanged", () => {
    const source = "just \\* escapes, \\_underscores\\_ and $5 dollars";
    expect(normalizeLatexMathDelimiters(source)).toBe(source);
  });
});
