"use client";

import { useEffect, useLayoutEffect, type ComponentProps, type ReactNode, type RefObject } from "react";
import { badgeVariants } from "@/components/ui/badge";

export const storyboardMarker = "\uFFFC";
export const characterMarker = "\uE000";
const badgePattern = /\uFFFC|\uE000(@[^\uE000]+)\uE000/g;

export function promptText(value: string) {
  return value.replaceAll(storyboardMarker, "").replaceAll(characterMarker, "");
}

function readDraft(node: HTMLElement | DocumentFragment) {
  let value = "";
  let first = true;
  let previousWasBlock = false;
  for (const child of node.childNodes) {
    if (child instanceof HTMLBRElement) {
      if (child.nextSibling) value += "\n";
      continue;
    }
    if (child instanceof Text && !child.length) continue;
    // Chromium can represent pasted lines as divs inside a plaintext-only editor.
    const block = child instanceof HTMLDivElement;
    if (!first && (block || previousWasBlock)) value += "\n";
    value += child instanceof HTMLElement
      ? child.dataset.promptBadge ?? readDraft(child)
      : promptText(child.textContent ?? "");
    first = false;
    previousWasBlock = block;
  }
  return value;
}

const badgeClass = badgeVariants({ variant: "secondary", className: "mx-0.5 align-middle max-w-full whitespace-normal break-all" });

/** Read-only prompt text with its command and @Character badges, for chat history. */
export function PromptBadgeText({ value }: { value: string }) {
  const nodes: ReactNode[] = [];
  let offset = 0;
  for (const match of value.matchAll(badgePattern)) {
    nodes.push(value.slice(offset, match.index), <span key={match.index} className={badgeClass}>{match[1] ?? "storyboard"}</span>);
    offset = match.index + match[0].length;
  }
  nodes.push(value.slice(offset));
  return <>{nodes}</>;
}

function writeDraft(input: HTMLDivElement, value: string) {
  const nodes: (string | HTMLElement)[] = [];
  let offset = 0;
  for (const match of value.matchAll(badgePattern)) {
    const badge = document.createElement("span");
    badge.dataset.promptBadge = match[0];
    badge.contentEditable = "false";
    badge.className = badgeClass;
    badge.textContent = match[1] ?? "storyboard";
    nodes.push(value.slice(offset, match.index), badge);
    offset = match.index + match[0].length;
  }
  input.replaceChildren(...nodes, value.slice(offset));
}

export function setStoryboardCaret(input: HTMLDivElement, offset: number) {
  const selection = document.getSelection();
  for (const [index, node] of Array.from(input.childNodes).entries()) {
    if (node instanceof Text) {
      if (offset <= node.length) {
        selection?.collapse(node, offset);
        return;
      }
      offset -= node.length;
    } else if (node instanceof HTMLElement && node.dataset.promptBadge) {
      const length = node.dataset.promptBadge.length;
      if (offset <= length) {
        selection?.collapse(input, index + Number(offset > 0));
        return;
      }
      offset -= length;
    }
  }
  selection?.collapse(input, input.childNodes.length);
}

function readCaret(input: HTMLDivElement) {
  const selection = document.getSelection();
  const anchor = selection?.anchorNode;
  if (!selection?.isCollapsed || !anchor || !input.contains(anchor)) return null;
  const range = document.createRange();
  range.setStart(input, 0);
  range.setEnd(anchor, selection.anchorOffset);
  return readDraft(range.cloneContents()).length;
}

export function StoryboardInput({ inputRef, value, disabled, onEdit, onCaretChange, onKeyDown, ...props }: Omit<ComponentProps<"div">, "onInput"> & {
  inputRef: RefObject<HTMLDivElement | null>;
  value: string;
  disabled: boolean;
  onEdit: (value: string, caret: number | null) => void;
  onCaretChange: (caret: number | null) => void;
}) {
  useLayoutEffect(() => {
    const input = inputRef.current;
    // Leave native edits in place so typing and selection survive React updates.
    if (input && readDraft(input) !== value) writeDraft(input, value);
  }, [inputRef, value]);

  useEffect(() => {
    function updateCaret() {
      const input = inputRef.current;
      if (input === document.activeElement && input) onCaretChange(readCaret(input));
    }
    document.addEventListener("selectionchange", updateCaret);
    return () => document.removeEventListener("selectionchange", updateCaret);
  }, [inputRef, onCaretChange]);

  return <div
    {...props}
    ref={inputRef}
    role="textbox"
    aria-multiline="true"
    aria-disabled={disabled}
    contentEditable={disabled ? false : "plaintext-only"}
    onKeyDown={(event) => {
      if (!disabled && !event.nativeEvent.isComposing && (event.key === "Backspace" || event.key === "Delete")) {
        const caret = readCaret(event.currentTarget);
        const badge = [...value.matchAll(badgePattern)].find(match =>
          event.key === "Backspace" ? match.index + match[0].length === caret : match.index === caret);
        if (badge) {
          event.preventDefault();
          const next = value.slice(0, badge.index) + value.slice(badge.index + badge[0].length);
          writeDraft(event.currentTarget, next);
          setStoryboardCaret(event.currentTarget, badge.index);
          onEdit(next, badge.index);
          return;
        }
      }
      onKeyDown?.(event);
    }}
    onInput={(event) => {
      const input = event.currentTarget;
      const draft = readDraft(input);
      const caret = readCaret(input);
      if (promptText(draft).length > 8000) {
        writeDraft(input, value);
        setStoryboardCaret(input, Math.min(caret ?? value.length, value.length));
        return;
      }
      onEdit(draft, caret);
    }}
  />;
}
