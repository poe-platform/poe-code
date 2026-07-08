# UX audit session status

**Count:** 831 · **Master:** [MASTER.md](./MASTER.md)

## Goal

Identify UX issues for ~12 hours; maintain master 1–N; keep finding, triaging, prioritizing.

## Critical top

See MASTER top Criticals — secrets, sonnet-5, effort xhigh, spawn --yes→yolo,
skill unconfigure --force wipes skills dir, gaslight mutation, poe-agent crash,
plan --yes, logout, memory INDEX, root help, superintendent help.

## Integrity

Master == disk == 831. Continuously committed on main.
Claude model was found corrupted to `claude-fable-5[1m]` mid-session and **restored to claude-sonnet-4-6**.
Restored docs/plans and .claude/skills after audit side effects. Removed audit probe dirs.
**Never commit live secrets**. Do not revert concurrent untracked work.

## Session progress (this stretch)

Started ~687 issues → **831**. Critical 18 → **26**. Continuous commits on main.

## Live reconfirms (still open)

- auth api-key --dry-run still prints full secret
- spawn poe-agent still fs.lstat crash
- skip-if-configured matching sonnet-4.6 still full rewrite dry-run
- configure haiku still plans effortLevel xhigh
- test kimi Provider poe not found

## Continue

TTY interactive, dashboard, Windows, postinstall, residual edges. Prefer dry-run; never leave gaslight unattended; never print secrets into issue files; never skill unconfigure --force without backup; verify Claude model after probes.
