# T3 Code (fork)

This is a personal fork of [T3 Code](https://github.com/pingdotgg/t3code). See the upstream
repository for what the project is, how to install it, and its documentation.

## Changes in this fork

- **Side chats.** Ported from upstream
  [#18243](https://github.com/pingdotgg/t3code/pull/18243) without the `/side` and `/btw` composer
  commands. Each assistant reply gets an "Ask in side chat" button next to its fork button that
  starts a side chat seeing the thread up to that reply. See
  [docs/user/side-chats.md](./docs/user/side-chats.md).
- **You should know.** For Claude threads, a side question to the live session after each finished
  run flags anything you might have missed, under the reply. Uses Claude Code's own prompt and the
  session's prompt cache. Off by default in General settings. See
  [docs/user/providers-claude.md](./docs/user/providers-claude.md).
- **Thread notes.** A private Markdown notes pad per thread, stored on the server, in the thread
  details card. `mod+shift+u` jumps in and out, and `mod+l` toggles a line's checkbox. See
  [docs/user/thread-notes.md](./docs/user/thread-notes.md).
- **Full access without bypass mode for Claude.** A Claude provider setting that keeps Claude in its
  normal permission mode and lets T3 Code approve tool requests instead of asking.
- **Reuse-or-create worktree on branch selection.** Picking a branch in the composer moves the draft
  to that branch's existing worktree, or creates one, instead of checking the branch out in place.
- **Rename thread shortcut.** `thread.rename` (`mod+shift+r`). See
  [docs/user/keybindings.md](./docs/user/keybindings.md).
- **Focus returns to the composer** after selecting a reasoning effort.
- **Math renders by default.** Upstream's **Render math** setting starts on.
- **Route external links to a specific app.** An optional local rules file tells the desktop app to
  open matching links with a command of your choice, for example a managed browser for a corporate
  login. See [docs/user/external-links.md](./docs/user/external-links.md).
- **Fork server tooling.** Scripts under [`scripts/`](./scripts) to pack, deploy, check, and clean up
  the fork's server on a remote machine. The procedure is in the "Updating the remote fork server"
  section of [AGENTS.md](./AGENTS.md).
