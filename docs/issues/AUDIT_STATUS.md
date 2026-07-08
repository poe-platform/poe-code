# UX audit session status

**Count:** 894 · **Master:** [MASTER.md](./MASTER.md)

## Goal

Identify UX issues for ~12 hours; maintain master 1–N; keep finding, triaging, prioritizing.

## Critical top

See MASTER top Criticals — secrets, sonnet-5, effort xhigh, spawn --yes→yolo,
skill unconfigure --force wipes skills dir, gaslight mutation, poe-agent crash,
plan --yes, logout, memory INDEX, root help, superintendent help.

## Integrity

Master == disk == 894. Continuously committed on main.
Claude settings: model `claude-sonnet-4-6`, effortLevel `high`.
Auth: **Not logged in** (mid-session). Catalog: sonnet-5 = 0 matches; opus-4.7 has xhigh; sonnet-4.6 does not.
Restored docs/plans and .claude/skills after audit side effects. Removed audit probe dirs.
**Never commit live secrets**. Do not revert concurrent untracked work.

## Session progress (this stretch)

Started ~687 issues → **894**. Critical 18 → **27**. Continuous commits on main (~53 commits this stretch).

## Live reconfirms (still open)

- auth api-key --dry-run still prints full secret (when logged in)
- spawn poe-agent still fs.lstat crash
- skip-if-configured matching sonnet-4.6 still full rewrite dry-run
- configure haiku still plans effortLevel xhigh
- configure goose with haiku still embeds sonnet-5 in models list
- models --search sonnet-5 → 0 (catalog dead)
- configure --model sonnet|haiku writes literal short names
- opus-4.7 catalog has xhigh; sonnet-4.6 does not
- experiment install --force still Skill already exists
- plan archive/delete help still omit --yes
- root help Usage npm run dev
- install/unconfigure help still sparse
- doctor still missing
- gaslight ingest non-TTY POE_NO_PROMPT
- live Claude settings intermittently corrupted (fable/sonnet/xhigh)
- auth status became Not logged in mid-session

## Continue

TTY interactive, dashboard, Windows, postinstall, residual edges. Prefer dry-run; never leave gaslight unattended; never print secrets into issue files; never skill unconfigure --force without backup; **verify Claude model after every probe**. Auth currently logged out — avoid spawn/test that need keys unless relogin.
