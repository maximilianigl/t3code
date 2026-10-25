import { describe, expect, it } from "vite-plus/test";

import {
  buildObserverPrompt,
  DEFAULT_OBSERVER_PROMPT,
  observerLearnKey,
  parseObserverAnswer,
} from "./observerPrompt.ts";

describe("parseObserverAnswer", () => {
  it("treats learn: none as nothing to show", () => {
    expect(parseObserverAnswer("learn: none")).toEqual({ kind: "none" });
    expect(parseObserverAnswer("learn: None.")).toEqual({ kind: "none" });
  });

  it("reads the learn line, tag and explanation, including bold labels", () => {
    expect(
      parseObserverAnswer(
        [
          "**learn:** We put multi-turn /ask behind a flag that's off, so users won't see it yet.  ",
          "**tag:** Heads up",
          "explain:",
          "**Multi-turn /ask is switched off**",
          "",
          "Turn the flag on when you're ready.",
        ].join("\n"),
      ),
    ).toEqual({
      kind: "note",
      learn: "We put multi-turn /ask behind a flag that's off, so users won't see it yet.",
      tag: "heads_up",
      explanation: "**Multi-turn /ask is switched off**\n\nTurn the flag on when you're ready.",
    });
  });

  it("defaults the tag and rejects an answer without a learn line", () => {
    expect(parseObserverAnswer("learn: Orders DB encryption uses extra CPU.")).toMatchObject({
      kind: "note",
      tag: "you_should_know",
      explanation: "",
    });
    expect(parseObserverAnswer("I could not find anything.")).toEqual({ kind: "invalid" });
  });
});

describe("buildObserverPrompt", () => {
  it("fills the mod's two lists into the default prompt", () => {
    const prompt = buildObserverPrompt(DEFAULT_OBSERVER_PROMPT, {
      seen: ["Shown before."],
      known: [],
    });
    expect(prompt).toContain("You should skip them:\n- Shown before.");
    expect(prompt).toContain("avoid offering them:\n(nothing yet)");
  });
});

it("observerLearnKey ignores case and a trailing period", () => {
  expect(observerLearnKey("The Flag is off.")).toBe(observerLearnKey("the flag is off"));
});
