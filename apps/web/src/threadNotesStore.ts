import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

interface ThreadNotesStoreState {
  /** One switch for every thread: notes are part of how this client lays out a thread. */
  visible: boolean;
  /** Set when notes are shown on request, and consumed by the pad that takes the keyboard. */
  focusPending: boolean;
  show: () => void;
  hide: () => void;
  consumeFocus: () => void;
}

export const useThreadNotesStore = create<ThreadNotesStoreState>()(
  persist(
    (set) => ({
      visible: false,
      focusPending: false,
      show: () => set({ visible: true, focusPending: true }),
      hide: () => set({ visible: false, focusPending: false }),
      consumeFocus: () => set({ focusPending: false }),
    }),
    {
      name: "t3code:thread-notes:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ visible: state.visible }),
    },
  ),
);

const THREAD_NOTES_TOGGLE_EVENT = "t3:thread-notes-toggle";

/** Lets surfaces outside the chat view, like the command palette, use the chat view's toggle. */
export function requestThreadNotesToggle(): void {
  window.dispatchEvent(new Event(THREAD_NOTES_TOGGLE_EVENT));
}

export function subscribeThreadNotesToggle(listener: () => void): () => void {
  window.addEventListener(THREAD_NOTES_TOGGLE_EVENT, listener);
  return () => window.removeEventListener(THREAD_NOTES_TOGGLE_EVENT, listener);
}
