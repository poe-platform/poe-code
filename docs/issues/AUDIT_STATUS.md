# UX audit session status

**Count:** 925 · **Master:** [MASTER.md](./MASTER.md)

## Goal

Identify UX issues for ~12 hours; maintain master 1–N; keep finding, triaging, prioritizing.

## Critical top

See MASTER top Criticals — secrets, sonnet-5, effort flag ignored (was always xhigh; now always high),
spawn --yes→yolo, skill unconfigure --force wipes skills dir, gaslight mutation, poe-agent crash,
plan --yes, logout, memory INDEX, root help, superintendent help.

## Integrity

Master == disk == 925. Continuously committed on main.
Claude settings: model `claude-sonnet-4-6`, effortLevel `high`.
Auth: **Not logged in** (mid-session). Catalog: sonnet-5 = 0 matches; opus-4.7 has xhigh; sonnet-4.6 does not.
Source still has sonnet-5 in constants.ts + goose.ts context map. Root help still hides 13 working commands.
Restored docs/plans and .claude/skills after audit side effects. Removed audit probe dirs.
**Never commit live secrets**. Do not revert concurrent untracked work.

## Session progress (this stretch)

Started ~687 issues → **925**. Critical 18 → **28**. Continuous commits on main (~62 commits this stretch).

## Live reconfirms (still open)

- auth api-key --dry-run still prints full secret (when logged in)
- spawn poe-agent still fs.lstat crash
- skip-if-configured matching sonnet-4.6 still full rewrite dry-run (cursor skip path works)
- configure --reasoning-effort still ignored (always high after restore; was always xhigh)
- configure --model "" accepted as blank
- configure goose with haiku still embeds sonnet-5 in models list + goose.ts map
- models --search sonnet-5 → 0 (catalog dead); constants.ts still has sonnet-5
- configure --model sonnet|haiku writes literal short names
- opus-4.7 catalog has xhigh; sonnet-4.6 does not
- experiment install --force still Skill already exists
- plan archive/delete help still omit --yes
- root help Usage npm run dev + hides 13 commands
- gaslight help still says plan to implement
- package.json extra bins still present
- memory INDEX still not showable after init
- runtime jobs ls no --limit/--since
- doctor still missing
- gaslight ingest non-TTY POE_NO_PROMPT
- live Claude settings intermittently corrupted (fable/sonnet/xhigh)
- auth status became Not logged in mid-session

## Continue

TTY interactive, dashboard, Windows, postinstall, residual edges. Prefer dry-run; never leave gaslight unattended; never print secrets into issue files; never skill unconfigure --force without backup; **verify Claude model after every probe**. Auth currently logged out — avoid spawn/test that need keys unless relogin.
