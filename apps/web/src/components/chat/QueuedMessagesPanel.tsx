import { ListEndIcon, PencilIcon, RotateCcwIcon, SendHorizontalIcon, XIcon } from "lucide-react";
import { memo } from "react";

import { cn } from "~/lib/utils";
import type { QueuedComposerMessage } from "~/queuedMessagesStore";
import { stripInlineTerminalContextPlaceholders } from "~/lib/terminalContext";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerBanner } from "./ComposerBanner";

function queuedMessagePreview(message: QueuedComposerMessage): string {
  const text = stripInlineTerminalContextPlaceholders(message.prompt).trim().replace(/\s+/g, " ");
  if (text.length > 0) return text;
  const extras = queuedMessageExtrasLabel(message);
  return extras ?? "Empty message";
}

function queuedMessageExtrasLabel(message: QueuedComposerMessage): string | null {
  const parts: string[] = [];
  const attachmentCount = message.images.length + message.files.length;
  if (attachmentCount > 0) {
    parts.push(attachmentCount === 1 ? "1 attachment" : `${attachmentCount} attachments`);
  }
  const contextCount =
    message.terminalContexts.length +
    message.elementContexts.length +
    message.previewAnnotations.length +
    message.reviewComments.length;
  if (contextCount > 0) {
    parts.push(contextCount === 1 ? "1 context" : `${contextCount} contexts`);
  }
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * Messages waiting for the agent to finish, shown attached above the composer.
 * The head sends automatically once the thread is idle; a failed head pauses
 * the queue and shows why. Rows stay editable until they are sent.
 */
export const QueuedMessagesPanel = memo(function QueuedMessagesPanel(props: {
  messages: ReadonlyArray<QueuedComposerMessage>;
  sendingMessageId: string | null;
  onSendNow: (messageId: string) => void;
  onEdit: (messageId: string) => void;
  onRemove: (messageId: string) => void;
  onRetry: (messageId: string) => void;
}) {
  if (props.messages.length === 0) return null;
  const hasFailure = props.messages.some((message) => message.failureMessage !== null);
  return (
    <ComposerBanner.Attachment>
      <ComposerBanner.Root
        data-chat-composer-queued-messages="true"
        variant={hasFailure ? "warning" : "default"}
      >
        <ComposerBanner.Row>
          <ComposerBanner.Icon>
            <ListEndIcon />
          </ComposerBanner.Icon>
          <ComposerBanner.Content className="text-muted-foreground">
            Queued
            <ComposerBanner.Separator />
            <span className="truncate">
              {hasFailure
                ? "Paused until the failed message is retried or removed"
                : "Sends when the agent finishes"}
            </span>
          </ComposerBanner.Content>
          <ComposerBanner.Actions>
            <ComposerBanner.Count>{props.messages.length}</ComposerBanner.Count>
          </ComposerBanner.Actions>
        </ComposerBanner.Row>
        <ComposerBanner.Children>
          {props.messages.map((message, index) => {
            const sending = props.sendingMessageId === message.id;
            const extras = queuedMessageExtrasLabel(message);
            const preview = queuedMessagePreview(message);
            return (
              <ComposerBanner.Row key={message.id} layout="wrap-actions">
                <ComposerBanner.Icon>
                  <ComposerBanner.Count className="text-muted-foreground/70">
                    {index + 1}
                  </ComposerBanner.Count>
                </ComposerBanner.Icon>
                <ComposerBanner.Content
                  className={cn("flex-col items-start gap-0", sending && "text-muted-foreground")}
                >
                  <span className="line-clamp-2 min-w-0 text-foreground/90">{preview}</span>
                  {message.failureMessage ? (
                    <span className="truncate text-warning">{message.failureMessage}</span>
                  ) : sending ? (
                    <span className="truncate text-muted-foreground">Sending…</span>
                  ) : extras && preview !== extras ? (
                    <span className="truncate text-muted-foreground">{extras}</span>
                  ) : null}
                </ComposerBanner.Content>
                <ComposerBanner.Actions>
                  {message.failureMessage ? (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            aria-label="Retry sending"
                            disabled={sending}
                            onClick={() => props.onRetry(message.id)}
                          />
                        }
                      >
                        <RotateCcwIcon />
                      </TooltipTrigger>
                      <TooltipPopup>Retry</TooltipPopup>
                    </Tooltip>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            aria-label="Send now"
                            disabled={sending}
                            onClick={() => props.onSendNow(message.id)}
                          />
                        }
                      >
                        <SendHorizontalIcon />
                      </TooltipTrigger>
                      <TooltipPopup>Send now</TooltipPopup>
                    </Tooltip>
                  )}
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label="Move back to composer"
                          disabled={sending}
                          onClick={() => props.onEdit(message.id)}
                        />
                      }
                    >
                      <PencilIcon />
                    </TooltipTrigger>
                    <TooltipPopup>Edit in composer</TooltipPopup>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label="Remove from queue"
                          disabled={sending}
                          onClick={() => props.onRemove(message.id)}
                        />
                      }
                    >
                      <XIcon />
                    </TooltipTrigger>
                    <TooltipPopup>Remove</TooltipPopup>
                  </Tooltip>
                </ComposerBanner.Actions>
              </ComposerBanner.Row>
            );
          })}
        </ComposerBanner.Children>
      </ComposerBanner.Root>
    </ComposerBanner.Attachment>
  );
});
