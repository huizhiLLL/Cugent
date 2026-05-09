import { ComposerAttachments, UserMessageAttachments } from "@/components/attachment";
import { CubeResponseToolCall } from "@/components/cube-response-details";
import { MarkdownText } from "@/components/markdown-text";
import {
  Reasoning,
  ReasoningContent,
  ReasoningRoot,
  ReasoningText,
  ReasoningTrigger,
} from "@/components/reasoning";
import { TooltipIconButton } from "@/components/tooltip-icon-button";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ActionBarMorePrimitive,
  ActionBarPrimitive,
  AuiIf,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
  useAuiState,
} from "@assistant-ui/react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RefreshCwIcon,
  SquareIcon,
  Trash2Icon,
  PlusIcon,
} from "lucide-react";
import { useEffect, useRef } from "react";

export const Thread = ({ onOpenSmartCube, onDeleteMessage }) => {
  return (
    <ThreadPrimitive.Root
      className="aui-root aui-thread-root @container flex h-full flex-col bg-background"
      style={{
        ["--thread-max-width"]: "44rem",
        ["--composer-radius"]: "24px",
        ["--composer-padding"]: "10px",
      }}>
      <ThreadPrimitive.Viewport
        turnAnchor="top"
        data-slot="aui_thread-viewport"
        className="relative flex flex-1 flex-col overflow-x-auto overflow-y-scroll scroll-smooth">
        <div
          className="mx-auto flex w-full max-w-(--thread-max-width) flex-1 flex-col px-4 pt-4">
          <AuiIf condition={(s) => s.thread.isEmpty}>
            <ThreadWelcome onOpenSmartCube={onOpenSmartCube} />
          </AuiIf>

          <AuiIf condition={(s) => !s.thread.isEmpty}>
            <div
              data-slot="aui_message-group"
              className="mb-6 flex flex-col gap-y-1 empty:hidden">
              <ThreadPrimitive.Messages>
                {() => <ThreadMessage onDeleteMessage={onDeleteMessage} />}
              </ThreadPrimitive.Messages>
            </div>

            <ThreadPrimitive.ViewportFooter
              className="aui-thread-viewport-footer sticky bottom-0 mt-auto flex flex-col gap-4 overflow-visible rounded-t-(--composer-radius) bg-background pb-4 md:pb-6">
              <ThreadScrollToBottom />
              <Composer onOpenSmartCube={onOpenSmartCube} />
            </ThreadPrimitive.ViewportFooter>
          </AuiIf>
        </div>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
};

const ThreadMessage = ({ onDeleteMessage }) => {
  const role = useAuiState((s) => s.message.role);
  const isEditing = useAuiState((s) => s.message.composer.isEditing);

  if (isEditing) return <EditComposer />;
  if (role === "user") return <UserMessage onDeleteMessage={onDeleteMessage} />;
  return <AssistantMessage onDeleteMessage={onDeleteMessage} />;
};

const ThreadScrollToBottom = () => {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        tooltip="Scroll to bottom"
        variant="outline"
        className="aui-thread-scroll-to-bottom absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible dark:border-border dark:bg-background dark:hover:bg-accent">
        <ArrowDownIcon />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  );
};

const ThreadWelcome = ({ onOpenSmartCube }) => {
  return (
    <div className="aui-thread-welcome-root flex min-h-full flex-1 flex-col items-center justify-center gap-7 pb-20">
      <h1 className="aui-thread-welcome-title fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-center font-medium text-2xl duration-200">
        今天想分析什么？
      </h1>
      <Composer onOpenSmartCube={onOpenSmartCube} />
    </div>
  );
};

const Composer = ({ onOpenSmartCube }) => {
  return (
    <ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col">
      <ComposerPrimitive.AttachmentDropzone asChild>
        <div
          data-slot="aui_composer-shell"
          className="flex w-full flex-col gap-2 rounded-(--composer-radius) border bg-background p-(--composer-padding) transition-shadow focus-within:border-ring/75 focus-within:ring-2 focus-within:ring-ring/20 data-[dragging=true]:border-ring data-[dragging=true]:border-dashed data-[dragging=true]:bg-accent/50">
          <ComposerAttachments />
          <ComposerPrimitive.Input
            placeholder="Send a message..."
            className="aui-composer-input max-h-32 min-h-10 w-full resize-none bg-transparent px-1.75 py-1 text-sm outline-none placeholder:text-muted-foreground/80"
            rows={1}
            autoFocus
            aria-label="Message input" />
          <ComposerAction onOpenSmartCube={onOpenSmartCube} />
        </div>
      </ComposerPrimitive.AttachmentDropzone>
    </ComposerPrimitive.Root>
  );
};

const ComposerAction = ({ onOpenSmartCube }) => {
  return (
    <div
      className="aui-composer-action-wrapper relative flex items-center justify-between">
      <TooltipIconButton
        tooltip="智能魔方"
        side="bottom"
        type="button"
        variant="ghost"
        size="icon"
        className="aui-composer-add-attachment size-8 rounded-full p-1"
        aria-label="智能魔方导入"
        onClick={onOpenSmartCube}>
        <PlusIcon />
      </TooltipIconButton>
      <AuiIf condition={(s) => !s.thread.isRunning}>
        <ComposerPrimitive.Send asChild>
          <TooltipIconButton
            tooltip="Send message"
            side="bottom"
            type="button"
            variant="default"
            size="icon"
            className="aui-composer-send size-8 rounded-full"
            aria-label="Send message">
            <ArrowUpIcon className="aui-composer-send-icon size-4" />
          </TooltipIconButton>
        </ComposerPrimitive.Send>
      </AuiIf>
      <AuiIf condition={(s) => s.thread.isRunning}>
        <ComposerPrimitive.Cancel asChild>
          <Button
            type="button"
            variant="default"
            size="icon"
            className="aui-composer-cancel size-8 rounded-full"
            aria-label="Stop generating">
            <SquareIcon className="aui-composer-cancel-icon size-3 fill-current" />
          </Button>
        </ComposerPrimitive.Cancel>
      </AuiIf>
    </div>
  );
};

const MessageError = () => {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root
        className="aui-message-error-root mt-2 rounded-md border border-destructive bg-destructive/10 p-3 text-destructive text-sm dark:bg-destructive/5 dark:text-red-200">
        <ErrorPrimitive.Message className="aui-message-error-message line-clamp-2" />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
};

const AssistantMessage = ({ onDeleteMessage }) => {
  const cubeResponse = useAuiState((s) => s.message.metadata.custom?.cubeResponse);
  const toolCalls = useAuiState((s) => s.message.metadata.custom?.toolCalls ?? []);
  const messageStatus = useAuiState((s) => s.message.status);

  return (
    <MessagePrimitive.Root
      data-slot="aui_assistant-message-root"
      data-role="assistant"
      className="aui-assistant-message-shell fade-in slide-in-from-bottom-1 relative animate-in duration-150 [contain-intrinsic-size:auto_300px] [content-visibility:auto]">
      <div
        data-slot="aui_assistant-message-content"
        className="wrap-break-word px-2 text-foreground leading-relaxed">
        {shouldRenderCubeToolCall(cubeResponse, toolCalls) ? (
          <CubeResponseToolCall response={cubeResponse} toolCalls={toolCalls} status={messageStatus} />
        ) : null}
        <MessagePrimitive.GroupedParts
          groupBy={(part) => {
            if (part.type === "reasoning")
              return ["group-chainOfThought", "group-reasoning"];
            return null;
          }}>
          {({ part, children }) => {
            switch (part.type) {
              case "group-chainOfThought":
                return <div data-slot="aui_chain-of-thought">{children}</div>;
              case "group-reasoning": {
                const running = part.status.type === "running";
                return (
                  <ReasoningRoot defaultOpen={running}>
                    <ReasoningTrigger active={running} />
                    <ReasoningContent aria-busy={running}>
                      <ReasoningText>{children}</ReasoningText>
                    </ReasoningContent>
                  </ReasoningRoot>
                );
              }
              case "text":
                return <MarkdownText />;
              case "reasoning":
                return <Reasoning {...part} />;
              default:
                return null;
            }
          }}
        </MessagePrimitive.GroupedParts>
        <MessageError />
      </div>
      <div
        data-slot="aui_assistant-message-footer"
        className="aui-assistant-message-footer ms-2 flex items-center">
        <BranchPicker />
        <AssistantActionBar onDeleteMessage={onDeleteMessage} />
      </div>
    </MessagePrimitive.Root>
  );
};

function shouldRenderCubeToolCall(response, toolCalls) {
  return Boolean(
    (response
      && response.kind !== "chat-fallback"
      && response.kind !== "error")
    || (Array.isArray(toolCalls) && toolCalls.length > 0)
  );
}

const AssistantActionBar = ({ onDeleteMessage }) => {
  const messageId = useAuiState((s) => s.message.id);

  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      className="aui-assistant-action-bar-root col-start-3 row-start-2 -ms-1 flex gap-1 text-muted-foreground">
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton>
          <AuiIf condition={(s) => s.message.isCopied}>
            <CheckIcon />
          </AuiIf>
          <AuiIf condition={(s) => !s.message.isCopied}>
            <CopyIcon />
          </AuiIf>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload asChild>
        <TooltipIconButton>
          <RefreshCwIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Reload>
      <TooltipIconButton onClick={() => onDeleteMessage?.(messageId)}>
        <Trash2Icon />
      </TooltipIconButton>
      <ActionBarMorePrimitive.Root>
        <ActionBarMorePrimitive.Trigger asChild>
          <TooltipIconButton className="data-[state=open]:bg-accent">
            <MoreHorizontalIcon />
          </TooltipIconButton>
        </ActionBarMorePrimitive.Trigger>
        <ActionBarMorePrimitive.Content
          side="bottom"
          align="start"
          className="aui-action-bar-more-content z-50 min-w-32 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          <ActionBarPrimitive.ExportMarkdown asChild>
            <ActionBarMorePrimitive.Item
              className="aui-action-bar-more-item flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground">
              <DownloadIcon className="size-4" />
              Export as Markdown
            </ActionBarMorePrimitive.Item>
          </ActionBarPrimitive.ExportMarkdown>
        </ActionBarMorePrimitive.Content>
      </ActionBarMorePrimitive.Root>
    </ActionBarPrimitive.Root>
  );
};

const UserMessage = ({ onDeleteMessage }) => {
  return (
    <MessagePrimitive.Root
      data-slot="aui_user-message-root"
      className="aui-user-message-shell fade-in slide-in-from-bottom-1 grid animate-in auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 duration-150 [contain-intrinsic-size:auto_60px] [content-visibility:auto] [&:where(>*)]:col-start-2"
      data-role="user">
      <UserMessageAttachments />
      <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0">
        <div
          className="aui-user-message-content wrap-break-word peer rounded-2xl bg-muted px-4 py-2.5 text-foreground empty:hidden">
          <MessagePrimitive.Parts />
        </div>
        <div className="aui-user-message-footer">
          <div className="aui-user-action-bar-wrapper peer-empty:hidden">
            <UserActionBar onDeleteMessage={onDeleteMessage} />
          </div>
        </div>
      </div>
      <div className="aui-user-message-footer-spacer col-start-2" aria-hidden="true">
        <div className="aui-user-action-bar-wrapper-placeholder" />
      </div>
    </MessagePrimitive.Root>
  );
};

const UserActionBar = ({ onDeleteMessage }) => {
  const messageId = useAuiState((s) => s.message.id);
  const canEdit = useAuiState((s) => {
    if (s.message.role !== "user") return false;

    for (let index = s.thread.messages.length - 1; index >= 0; index -= 1) {
      if (s.thread.messages[index]?.role === "user") {
        return s.message.index === index;
      }
    }

    return false;
  });

  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-user-action-bar-root flex flex-col items-end">
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton className="aui-user-action-copy p-4">
          <AuiIf condition={(s) => s.message.isCopied}>
            <CheckIcon />
          </AuiIf>
          <AuiIf condition={(s) => !s.message.isCopied}>
          <CopyIcon />
        </AuiIf>
      </TooltipIconButton>
      </ActionBarPrimitive.Copy>
      {canEdit ? (
        <ActionBarPrimitive.Edit asChild>
          <TooltipIconButton className="aui-user-action-edit p-4">
            <PencilIcon />
          </TooltipIconButton>
        </ActionBarPrimitive.Edit>
      ) : null}
      <TooltipIconButton className="aui-user-action-delete p-4" onClick={() => onDeleteMessage?.(messageId)}>
        <Trash2Icon />
      </TooltipIconButton>
    </ActionBarPrimitive.Root>
  );
};

const EditComposer = () => {
  const aui = useAui();
  const rootRef = useRef(null);
  const isEmpty = useAuiState((s) => s.composer.isEmpty);

  useEffect(() => {
    const handlePointerDown = (event) => {
      const element = rootRef.current;
      if (!element || element.contains(event.target)) return;
      aui.composer().cancel();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [aui]);

  return (
    <MessagePrimitive.Root data-slot="aui_edit-composer-wrapper" className="flex flex-col px-2">
      <ComposerPrimitive.Root
        ref={rootRef}
        className="aui-edit-composer-root ms-auto flex w-full max-w-[85%] flex-col rounded-2xl bg-muted">
        <ComposerPrimitive.Input
          className="aui-edit-composer-input min-h-14 w-full resize-none bg-transparent p-4 text-foreground text-sm outline-none"
          autoFocus />
        <div
          className="aui-edit-composer-footer mx-3 mb-3 flex items-center justify-end gap-2 self-end">
          <TooltipIconButton
            tooltip="发送"
            side="bottom"
            type="button"
            variant="default"
            size="icon"
            className="aui-edit-composer-send size-8 rounded-full"
            aria-label="发送编辑内容"
            disabled={isEmpty}
            onClick={() => {
              void aui.composer().send();
            }}
          >
            <ArrowUpIcon className="aui-composer-send-icon size-4" />
          </TooltipIconButton>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
};

const BranchPicker = ({
  className,
  ...rest
}) => {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn(
        "aui-branch-picker-root -ms-2 me-2 inline-flex items-center text-muted-foreground text-xs",
        className
      )}
      {...rest}>
      <BranchPickerPrimitive.Previous asChild>
        <TooltipIconButton tooltip="Previous">
          <ChevronLeftIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Previous>
      <span className="aui-branch-picker-state font-medium">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <TooltipIconButton tooltip="Next">
          <ChevronRightIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};
