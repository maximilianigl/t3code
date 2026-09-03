import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}));

vi.mock("mermaid", () => ({
  default: {
    initialize: mocks.initialize,
    render: mocks.render,
  },
}));

import { renderMermaidDiagram } from "./mermaidRendering";

describe("renderMermaidDiagram", () => {
  beforeEach(() => {
    mocks.initialize.mockClear();
    mocks.render.mockReset();
  });

  it("renders with bounded strict configuration and the requested appearance", async () => {
    mocks.render.mockResolvedValue({
      diagramType: "flowchart-v2",
      svg: '<svg viewBox="0 0 120 80"></svg>',
    });

    await expect(renderMermaidDiagram("flowchart LR\nA --> B", "dark")).resolves.toEqual({
      diagramType: "flowchart-v2",
      svg: '<svg viewBox="0 0 120 80"></svg>',
    });

    expect(mocks.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        maxEdges: 500,
        maxTextSize: 50_000,
        securityLevel: "strict",
        startOnLoad: false,
        suppressErrorRendering: true,
        theme: "dark",
      }),
    );
    expect(mocks.render).toHaveBeenCalledWith(
      expect.stringMatching(/^t3-mermaid-/),
      "flowchart LR\nA --> B",
    );
  });

  it("keeps theme initialization paired with each serialized render", async () => {
    let finishFirst: ((value: { diagramType: string; svg: string }) => void) | undefined;
    mocks.render
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({ diagramType: "sequence", svg: "<svg></svg>" });

    const first = renderMermaidDiagram("flowchart LR\nA --> B", "dark");
    const second = renderMermaidDiagram("sequenceDiagram\nA ->> B: Hello", "light");

    await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(1));
    expect(mocks.initialize).toHaveBeenCalledTimes(1);
    finishFirst?.({ diagramType: "flowchart-v2", svg: "<svg></svg>" });
    await Promise.all([first, second]);

    expect(mocks.initialize.mock.calls.map(([config]) => config.theme)).toEqual([
      "dark",
      "default",
    ]);
    expect(mocks.render).toHaveBeenCalledTimes(2);
  });

  it("continues rendering after a diagram fails", async () => {
    mocks.render
      .mockRejectedValueOnce(new Error("bad diagram"))
      .mockResolvedValueOnce({ diagramType: "flowchart-v2", svg: "<svg></svg>" });

    await expect(renderMermaidDiagram("not a diagram", "light")).rejects.toThrow("bad diagram");
    await expect(renderMermaidDiagram("flowchart LR\nA --> B", "light")).resolves.toEqual({
      diagramType: "flowchart-v2",
      svg: "<svg></svg>",
    });
  });
});
