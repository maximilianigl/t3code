import type {
  OrchestrationV2ObserverNote,
  OrchestrationV2ObserverNoteFeedback,
  ScopedThreadRef,
  ServerProviderSkill,
} from "@t3tools/contracts";
import { LightbulbIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { useState } from "react";

import ChatMarkdown from "../ChatMarkdown";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";

const TAG_LABEL = {
  you_should_know: "You should know",
  heads_up: "Heads up",
} as const;

export function ObserverNoteCard(props: {
  readonly note: OrchestrationV2ObserverNote;
  readonly onFeedback: (feedback: OrchestrationV2ObserverNoteFeedback | null) => void;
  readonly markdownCwd: string | undefined;
  readonly threadRef: ScopedThreadRef | null;
  readonly skills: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">>;
}) {
  const { note } = props;
  const [expanded, setExpanded] = useState(false);
  const respond = props.onFeedback;
  const label = TAG_LABEL[note.tag];

  if (note.feedback !== null) {
    return (
      <div className="mt-2 flex min-w-0 items-center gap-1 text-muted-foreground text-xs">
        <span className="min-w-0 truncate">
          {label}: {note.learn}
        </span>
        <Button size="xs" variant="ghost-muted" onClick={() => respond(null)}>
          Show
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-2">
      <Alert
        variant={note.tag === "heads_up" ? "warning" : "info"}
        controlAlignment="first-line"
        role="note"
      >
        {note.tag === "heads_up" ? <TriangleAlertIcon /> : <LightbulbIcon />}
        <AlertTitle>
          {label} · <span className="font-normal">{note.learn}</span>
        </AlertTitle>
        {expanded && note.explanation !== "" ? (
          <AlertDescription>
            <ChatMarkdown
              text={note.explanation}
              cwd={props.markdownCwd}
              threadRef={props.threadRef ?? undefined}
              skills={props.skills}
              lineBreaks
            />
          </AlertDescription>
        ) : null}
        <AlertAction>
          {note.explanation === "" ? null : (
            <Button size="xs" variant="ghost" onClick={() => setExpanded(!expanded)}>
              {expanded ? "Hide" : "Learn more"}
            </Button>
          )}
          <Button size="xs" variant="ghost" onClick={() => respond("known")}>
            Know this already
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Dismiss"
            onClick={() => respond("dismissed")}
          >
            <XIcon />
          </Button>
        </AlertAction>
      </Alert>
    </div>
  );
}
