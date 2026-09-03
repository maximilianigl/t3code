export type MermaidAppearance = "light" | "dark";

export interface RenderedMermaidDiagram {
  readonly diagramType: string;
  readonly svg: string;
}

type MermaidApi = (typeof import("mermaid"))["default"];

const MERMAID_SECURE_CONFIG_KEYS = [
  "secure",
  "securityLevel",
  "startOnLoad",
  "maxTextSize",
  "maxEdges",
  "suppressErrorRendering",
  "theme",
  "themeCSS",
  "themeVariables",
  "dompurifyConfig",
];

let mermaidPromise: Promise<MermaidApi> | null = null;
let renderQueue: Promise<void> = Promise.resolve();
let fallbackDiagramId = 0;

function loadMermaid(): Promise<MermaidApi> {
  mermaidPromise ??= import("mermaid")
    .then((module) => module.default)
    .catch((cause: unknown) => {
      mermaidPromise = null;
      throw cause;
    });
  return mermaidPromise;
}

function nextDiagramId(): string {
  fallbackDiagramId += 1;
  return `t3-mermaid-${Date.now()}-${fallbackDiagramId}`;
}

/** Mermaid keeps configuration globally, so initialization and rendering must stay in one queue. */
export function renderMermaidDiagram(
  source: string,
  appearance: MermaidAppearance,
): Promise<RenderedMermaidDiagram> {
  const run = renderQueue.then(async () => {
    const mermaid = await loadMermaid();
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      maxTextSize: 50_000,
      maxEdges: 500,
      secure: MERMAID_SECURE_CONFIG_KEYS,
      theme: appearance === "dark" ? "dark" : "default",
      fontFamily: "var(--font-sans), ui-sans-serif, sans-serif",
    });

    const { diagramType, svg } = await mermaid.render(nextDiagramId(), source);
    return { diagramType, svg };
  });

  renderQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
