# 2026-06-24 Update, Worktrees, and Toolcraft Markdown Updates

This entry summarizes the commits that landed on `main` during the 24-hour window ending 2026-06-25 00:35 UTC.

## CLI and SDK

- Added `poe-code update`, which detects the package manager from npm runtime environment, checks the latest published `poe-code` version by default, and runs the matching global installer. It supports `--package-manager`, `--force`, `--no-version-check`, and `--dry-run`.
- Root help output was trimmed to the primary command surface instead of listing every nested utility command.

## Managed worktrees

- Added managed worktree execution for multi-step agent harnesses and SDK runners. Worktree-enabled runs create isolated checkouts under `.poe-code/worktrees/`, record metadata in `.poe-code/worktrees.yaml`, and reconcile successful output back to the source checkout.
- The CLI now exposes `poe-code worktree list`, `poe-code worktree reconcile <name> --agent <agent>`, and `poe-code worktree remove <name> [--delete-branch]` for inspecting, repairing, and cleaning up managed worktrees.
- `gaslight`, `pipeline run`, `ralph run`, `experiment run`, `harness run`, and `superintendent run` accept `--worktree` for isolated execution where supported.
- The root SDK exports `runInWorktree`, `runWithOptionalWorktree`, `createManagedWorktree`, `listManagedWorktrees`, `reconcileManagedWorktree`, and `removeManagedWorktree`. `spawn(...)` and the SDK runners for Gaslight, Pipeline, Ralph, and Experiment accept `worktree: true`.
- Worktree reconciliation was simplified so successful runs always attempt reconciliation and managed worktree cleanup; failed changed worktrees remain available for inspection or explicit reconciliation.

## Toolcraft Markdown

- `toolcraft-design` now renders Markdown ASTs and Markdown strings to safe HTML fragments with `renderHtml` and `renderMarkdownHtml`, exposed through both `toolcraft/design` and direct workspace imports.
- Markdown fenced-code syntax highlighting is opt-in with `syntaxHighlight: true` for both terminal and HTML renderers. Highlighted HTML emits escaped code plus neutral `tc-token-*` spans and leaves styling to consumers.
- The no-dependency highlighter now recognizes common JavaScript/TypeScript, data, CSS, shell, Python, SQL, markup, diff, Dockerfile, config, JVM, C-family, Rust, PHP, scripting, functional, schema, infrastructure, Vue, and Svelte fence labels while rendering unknown/plain-text fences as plain escaped code.
- Toolcraft Markdown token types are exported from the design package root.

## ACP compatibility

- `@poe-code/poe-acp-client` accepts `end_turn` as a valid ACP prompt stop reason in addition to `completed`, `cancelled`, and `max_tokens`.

## Tests

- The terminal-pilot separate-process session regression was sped up to keep the targeted unit test below the timeout.
