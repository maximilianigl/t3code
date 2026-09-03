import { CheckIcon, Code2Icon, CopyIcon, EyeIcon, TriangleAlertIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { markdownCodeFenceFor } from "../../markdown-clipboard";
import {
  renderMermaidDiagram,
  type MermaidAppearance,
  type RenderedMermaidDiagram,
} from "../../lib/mermaidRendering";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface MermaidDiagramProps {
  readonly appearance: MermaidAppearance;
  readonly source: string;
}

type MermaidRenderState =
  | { readonly status: "loading"; readonly appearance: MermaidAppearance; readonly source: string }
  | {
      readonly status: "success";
      readonly appearance: MermaidAppearance;
      readonly source: string;
      readonly result: RenderedMermaidDiagram;
    }
  | {
      readonly status: "error";
      readonly appearance: MermaidAppearance;
      readonly source: string;
      readonly message: string;
    };

function mermaidMarkdownSource(source: string): string {
  const fence = markdownCodeFenceFor(source);
  return `${fence}mermaid\n${source.replace(/\n$/, "")}\n${fence}\n\n`;
}

function mermaidErrorMessage(cause: unknown): string {
  const fallback = "The Mermaid source could not be rendered.";
  const message = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
  const firstLine = message
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return fallback;
  return firstLine.length > 240 ? `${firstLine.slice(0, 237)}...` : firstLine;
}

function sizeRenderedSvg(container: HTMLDivElement | null): void {
  const svg = container?.querySelector(":scope > svg");
  if (!(svg instanceof SVGSVGElement)) return;

  const viewBox = svg
    .getAttribute("viewBox")
    ?.trim()
    .split(/[,\s]+/)
    .map(Number);
  const intrinsicWidth = viewBox?.[2];
  if (typeof intrinsicWidth === "number" && Number.isFinite(intrinsicWidth) && intrinsicWidth > 0) {
    svg.style.setProperty("width", `${Math.ceil(intrinsicWidth)}px`, "important");
  }
  svg.style.setProperty("height", "auto", "important");
  svg.style.setProperty("max-width", "none", "important");
}

export function MermaidDiagram({ appearance, source }: MermaidDiagramProps) {
  const [renderState, setRenderState] = useState<MermaidRenderState>({
    status: "loading",
    appearance,
    source,
  });
  const [showSource, setShowSource] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const diagramRef = useRef<HTMLDivElement | null>(null);
  const stateMatchesRequest =
    renderState.appearance === appearance && renderState.source === source;
  const visibleState: MermaidRenderState = stateMatchesRequest
    ? renderState
    : { status: "loading", appearance, source };

  useEffect(() => {
    let cancelled = false;
    setRenderState({ status: "loading", appearance, source });
    void renderMermaidDiagram(source, appearance).then(
      (result) => {
        if (!cancelled) setRenderState({ status: "success", appearance, source, result });
      },
      (cause: unknown) => {
        if (!cancelled) {
          console.warn("[chat-markdown] Mermaid rendering failed", cause);
          setRenderState({
            status: "error",
            appearance,
            source,
            message: mermaidErrorMessage(cause),
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [appearance, source]);

  useEffect(() => {
    if (visibleState.status === "success" && !showSource) {
      sizeRenderedSvg(diagramRef.current);
    }
  }, [showSource, visibleState]);

  useEffect(
    () => () => {
      if (copiedTimerRef.current !== null) clearTimeout(copiedTimerRef.current);
    },
    [],
  );

  const copySource = useCallback(() => {
    if (navigator.clipboard == null) return;
    void navigator.clipboard.writeText(source).then(
      () => {
        if (copiedTimerRef.current !== null) clearTimeout(copiedTimerRef.current);
        setCopied(true);
        copiedTimerRef.current = setTimeout(() => {
          setCopied(false);
          copiedTimerRef.current = null;
        }, 1200);
      },
      (cause: unknown) => {
        console.error("[chat-markdown] Mermaid source copy failed", cause);
      },
    );
  }, [source]);

  const hasDiagram = visibleState.status === "success";
  const showingSource = showSource || visibleState.status !== "success";
  const toggleLabel = showingSource ? "Show diagram" : "Show Mermaid source";

  return (
    <div
      className="chat-markdown-mermaid my-[0.65rem] overflow-hidden rounded-[var(--radius)] border border-border/70 bg-secondary dark:border-transparent dark:bg-input/32"
      data-language="mermaid"
      data-markdown-copy={mermaidMarkdownSource(source)}
    >
      <div className="chat-markdown-mermaid-header flex items-center justify-between gap-2 px-1.5 py-1.5 pl-3 select-none">
        <span className="inline-flex min-w-0 items-center gap-1.5 [font-family:var(--font-mono,ui-monospace,SFMono-Regular,monospace)] text-[0.6875rem]">
          <Code2Icon aria-hidden className="size-3.5" />
          <span>mermaid</span>
          {visibleState.status === "loading" ? (
            <span className="text-muted-foreground" role="status">
              Rendering diagram
            </span>
          ) : null}
        </span>
        <span className="flex items-center gap-0.5" role="toolbar" aria-label="Diagram actions">
          {hasDiagram ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="chat-markdown-chrome-action"
                    aria-pressed={showingSource}
                    onClick={() => setShowSource((value) => !value)}
                    aria-label={toggleLabel}
                  />
                }
              >
                {showingSource ? (
                  <EyeIcon aria-hidden className="size-3" />
                ) : (
                  <Code2Icon aria-hidden className="size-3" />
                )}
              </TooltipTrigger>
              <TooltipPopup side="top">{toggleLabel}</TooltipPopup>
            </Tooltip>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="chat-markdown-chrome-action"
                  onClick={copySource}
                  aria-label={copied ? "Copied" : "Copy Mermaid source"}
                />
              }
            >
              {copied ? (
                <CheckIcon aria-hidden className="size-3" />
              ) : (
                <CopyIcon aria-hidden className="size-3" />
              )}
            </TooltipTrigger>
            <TooltipPopup side="top">{copied ? "Copied" : "Copy Mermaid source"}</TooltipPopup>
          </Tooltip>
        </span>
      </div>
      {showingSource ? (
        <div className="chat-markdown-mermaid-source">
          {visibleState.status === "error" ? (
            <div
              className="flex items-start gap-2 border-y border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive"
              role="alert"
            >
              <TriangleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              <span>{visibleState.message}</span>
            </div>
          ) : null}
          <pre>
            <code className="language-mermaid">{source}</code>
          </pre>
        </div>
      ) : visibleState.status === "success" ? (
        <div
          ref={diagramRef}
          className="chat-markdown-mermaid-diagram max-w-full overflow-auto bg-background/45 p-4"
          data-diagram-type={visibleState.result.diagramType}
          tabIndex={0}
          // Mermaid's strict security level sanitizes the generated SVG and disables click handlers.
          dangerouslySetInnerHTML={{ __html: visibleState.result.svg }}
        />
      ) : null}
    </div>
  );
}
