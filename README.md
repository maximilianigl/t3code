# T3 Code (fork)

This is a personal fork of [T3 Code](https://github.com/pingdotgg/t3code). See the upstream
repository for what the project is, how to install it, and its documentation.

## Changes in this fork

- **LaTeX math in chat.** Inline `$...$` and `\(...\)` math plus `$$` and `\[...\]` display blocks
  render with KaTeX. Dollar amounts stay prose.
- **Mermaid diagrams.** Fenced `mermaid` blocks render as diagrams in chat, plans, PR text, and
  Markdown previews. See [docs/user/markdown.md](./docs/user/markdown.md).
- **Message queue.** `Alt+Enter` queues a message to send as a new turn once the agent is idle,
  instead of steering the running turn. See [docs/user/composer.md](./docs/user/composer.md).
- **Full access without bypass mode for Claude.** A Claude provider setting that keeps Claude in its
  normal permission mode and lets T3 Code approve tool requests.
- **Desktop background notifications.** System notifications when an agent finishes, fails, or needs
  input while the app is in the background. These do not work for unsigned installs of the desktop
  app. See [docs/user/desktop-notifications.md](./docs/user/desktop-notifications.md).
- **Reuse-or-create worktree on branch selection.** Picking a branch in the composer moves the draft
  to that branch's existing worktree, or creates one, instead of checking the branch out in place.
- **Extra keyboard shortcuts.** `thread.rename` (`mod+shift+r`), `traitsPicker.toggle`
  (`mod+shift+e`), and `branchPicker.toggle` (`mod+shift+b`). See
  [docs/user/keybindings.md](./docs/user/keybindings.md).
- **Focus returns to the composer** after selecting a reasoning effort.
- **Route external links to a specific app.** An optional local rules file tells the desktop app to
  open matching links with a command of your choice, for example a managed browser for a corporate
  login. See [docs/user/external-links.md](./docs/user/external-links.md).
- **Fork server tooling.** Scripts under [`scripts/`](./scripts) to pack, deploy, check, and clean up
  the fork's server on a remote machine. The procedure is in the "Updating the remote fork server"
  section of [AGENTS.md](./AGENTS.md).
