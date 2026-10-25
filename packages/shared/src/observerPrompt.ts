export { DEFAULT_OBSERVER_PROMPT } from "./observerPromptDefault.ts";

export type ObserverAnswer =
  | { readonly kind: "none" }
  | { readonly kind: "invalid" }
  | {
      readonly kind: "note";
      readonly learn: string;
      readonly tag: "you_should_know" | "heads_up";
      readonly explanation: string;
    };

const formatList = (items: ReadonlyArray<string>): string =>
  items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "(nothing yet)";

export function buildObserverPrompt(
  template: string,
  lists: { readonly seen: ReadonlyArray<string>; readonly known: ReadonlyArray<string> },
): string {
  return template
    .replaceAll("{{seen}}", formatList(lists.seen))
    .replaceAll("{{known}}", formatList(lists.known));
}

/** Matches the mod's dedupe: a repeat differs at most in case or a trailing period. */
export function observerLearnKey(learn: string): string {
  return learn.trim().toLowerCase().replace(/\.+$/, "");
}

const LABEL = (name: string) => new RegExp(String.raw`^\**${name}\**\s*:\s*\**\s*`, "i");
const LEARN_LINE = LABEL("learn");
const TAG_LINE = LABEL("tag");
const EXPLAIN_LINE = LABEL("explain");
const NONE = /^none\s*(?:[.!?()[\]:;,-]|$)/i;
const HEADS_UP = /^heads[\s-]*up/i;
const WRAPPING_QUOTES = /^["'`“‘](.*)["'`”’]$/s;

export function parseObserverAnswer(text: string): ObserverAnswer {
  const lines = text.split("\n");
  const learnIndex = lines.findIndex((line) => LEARN_LINE.test(line.trim()));
  if (learnIndex === -1) return { kind: "invalid" };
  const learn = lines[learnIndex]!.trim()
    .replace(LEARN_LINE, "")
    .replace(/\**\s*$/, "")
    .replace(WRAPPING_QUOTES, "$1")
    .trim();
  if (learn === "" || NONE.test(learn)) return { kind: "none" };

  const rest = lines.slice(learnIndex + 1);
  const tagLine = rest.find((line) => TAG_LINE.test(line.trim()));
  const tag =
    tagLine !== undefined && HEADS_UP.test(tagLine.trim().replace(TAG_LINE, ""))
      ? "heads_up"
      : "you_should_know";
  const explainIndex = rest.findIndex((line) => EXPLAIN_LINE.test(line.trim()));
  const explanation =
    explainIndex === -1
      ? ""
      : [rest[explainIndex]!.trim().replace(EXPLAIN_LINE, ""), ...rest.slice(explainIndex + 1)]
          .join("\n")
          .trim();
  return { kind: "note", learn, tag, explanation };
}
