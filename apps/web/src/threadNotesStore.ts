import { create } from "zustand";

interface ThreadNotesStoreState {
  /** Set when the user asks for the notes, and consumed by the pad that takes the keyboard. */
  focusPending: boolean;
  requestFocus: () => void;
  consumeFocus: () => void;
}

export const useThreadNotesStore = create<ThreadNotesStoreState>()((set) => ({
  focusPending: false,
  requestFocus: () => set({ focusPending: true }),
  consumeFocus: () => set({ focusPending: false }),
}));

const THREAD_NOTES_TOGGLE_EVENT = "t3:thread-notes-toggle";

/** Lets surfaces outside the chat view, like the command palette, use the chat view's toggle. */
export function requestThreadNotesToggle(): void {
  window.dispatchEvent(new Event(THREAD_NOTES_TOGGLE_EVENT));
}

export function subscribeThreadNotesToggle(listener: () => void): () => void {
  window.addEventListener(THREAD_NOTES_TOGGLE_EVENT, listener);
  return () => window.removeEventListener(THREAD_NOTES_TOGGLE_EVENT, listener);
}

/** True while the keyboard is in a thread's notes editor. */
export function isThreadNotesFocused(): boolean {
  return document.activeElement?.closest("[data-thread-notes-panel]") != null;
}
