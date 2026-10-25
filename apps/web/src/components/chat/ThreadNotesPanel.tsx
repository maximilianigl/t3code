import { useAtomValue } from "@effect/atom-react";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import { THREAD_NOTES_MAX_LENGTH, type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import { isMacPlatform } from "@t3tools/shared/keybindings";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { flushSync } from "react-dom";

import ChatMarkdown from "../ChatMarkdown";
import { setMarkdownTaskChecked } from "../files/filePreviewMode";
import { useEnvironmentQuery } from "../../state/query";
import { threadNotesEnvironment } from "../../state/threadNotes";
import { useAtomCommand } from "../../state/use-atom-command";
import { useThreadNotesStore } from "../../threadNotesStore";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { toggleTaskLines } from "./threadNotesEditing";

const SAVE_DELAY_MS = 600;

/**
 * The user's Markdown scratch pad for one thread. Mount one per thread: a pending save belongs
 * to the thread it was typed in and is sent there when the pad goes away.
 */
export function ThreadNotesPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly cwd: string | undefined;
}) {
  const { environmentId, threadId } = props;
  const query = useEnvironmentQuery(
    threadNotesEnvironment.notes({ environmentId, input: { threadId } }),
  );
  const canEdit = useAtomValue(threadNotesEnvironment.setNotes.permissionAtom(environmentId));
  const setNotes = useAtomCommand(threadNotesEnvironment.setNotes, { reportFailure: false });
  const focusPending = useThreadNotesStore((state) => state.focusPending);

  // What the user typed since the pad opened. The server's copy shows until then.
  const [localMarkdown, setLocalMarkdown] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unsaved = useRef<string | null>(null);

  const markdown = localMarkdown ?? query.data?.markdown ?? "";
  const loaded = query.data !== null;

  const save = () => {
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const pending = unsaved.current;
    if (pending === null) return;
    unsaved.current = null;
    void setNotes({ environmentId, input: { threadId, markdown: pending } }).then((result) => {
      if (result._tag === "Success" || isAtomCommandInterrupted(result)) return;
      // Kept for the next edit or blur, so a dropped save is retried rather than lost.
      if (unsaved.current === null) unsaved.current = pending;
      toastManager.add({ type: "error", title: "Could not save notes" });
    });
  };
  const saveOnLeave = useEffectEvent(save);
  useEffect(() => () => saveOnLeave(), []);

  const change = (next: string) => {
    setLocalMarkdown(next);
    unsaved.current = next;
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(save, SAVE_DELAY_MS);
  };

  const startEditing = () => {
    if (!canEdit || !loaded) return;
    setEditing(true);
  };

  // Showing notes on request hands them the keyboard once; switching threads later does not.
  const wantsFocus = focusPending && canEdit && loaded;
  const showEditor = editing || wantsFocus || (canEdit && loaded && markdown.trim() === "");

  useEffect(() => {
    if (!editing && !wantsFocus) return;
    const textarea = textareaRef.current;
    if (!textarea || document.activeElement === textarea) return;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    if (wantsFocus) useThreadNotesStore.getState().consumeFocus();
  }, [editing, wantsFocus]);

  return (
    <ThreadDetailsSection
      headingId="thread-details-notes-heading"
      title="Notes"
      data-thread-notes-panel
    >
      <div className="px-1.5">
        {query.error !== null && !loaded ? (
          <p className="py-1.5 text-2xs text-destructive">Could not load notes: {query.error}</p>
        ) : !loaded ? null : showEditor ? (
          <Textarea
            ref={textareaRef}
            size="sm"
            value={markdown}
            maxLength={THREAD_NOTES_MAX_LENGTH}
            placeholder="Notes for this thread, in Markdown"
            aria-label="Thread notes"
            onChange={(event) => change(event.currentTarget.value)}
            onFocus={() => setEditing(true)}
            onBlur={() => {
              save();
              setEditing(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.blur();
                return;
              }
              const mod = isMacPlatform(navigator.platform)
                ? event.metaKey && !event.ctrlKey
                : event.ctrlKey && !event.metaKey;
              if (!mod || event.shiftKey || event.altKey || event.key.toLowerCase() !== "l") return;
              event.preventDefault();
              event.stopPropagation();
              const textarea = event.currentTarget;
              const toggled = toggleTaskLines(
                textarea.value,
                textarea.selectionStart,
                textarea.selectionEnd,
              );
              // A controlled textarea moves the caret to the end when code sets its value.
              flushSync(() => change(toggled.text));
              textarea.setSelectionRange(toggled.selectionStart, toggled.selectionEnd);
            }}
          />
        ) : markdown.trim() === "" ? (
          <p className="py-1.5 text-2xs text-muted-foreground">No notes for this thread.</p>
        ) : (
          // Clicking the rendered notes edits them; links and checkboxes keep their own clicks.
          <div
            className="cursor-text py-1"
            onClick={(event) => {
              if (event.target instanceof Element && event.target.closest("a, button, input"))
                return;
              startEditing();
            }}
          >
            <ChatMarkdown
              text={markdown}
              cwd={props.cwd}
              threadRef={{ environmentId, threadId }}
              environmentId={environmentId}
              onTaskListChange={
                canEdit
                  ? ({ markerOffset, checked }) => {
                      change(setMarkdownTaskChecked(markdown, markerOffset, checked));
                      save();
                    }
                  : undefined
              }
            />
          </div>
        )}
      </div>
    </ThreadDetailsSection>
  );
}
