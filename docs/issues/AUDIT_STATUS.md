# UX audit session status

**Count:** 806 · **Master:** [MASTER.md](./MASTER.md)

## Goal

Identify UX issues for ~12 hours; maintain master 1–N; keep finding, triaging, prioritizing.

## Critical top

See MASTER top Criticals — secrets, sonnet-5 cluster, effort always xhigh, spawn --yes→yolo,
gaslight empty model + read-mode plan mutation, poe-agent crash, plan --yes, logout,
memory INDEX, root help hides half the product, superintendent help identity.

## Integrity

Master == disk == 806. Continuously committed on main. Claude model restored to sonnet-4.6 after audit incident.
Restored docs/plans after gaslight/agent side effects. Removed audit probe dirs.
**Never commit live secrets** — auth api-key probes must redact in issue docs.

## Session progress (this stretch)

Started ~687 issues → **806**. Critical 18 → **23**. Continuous commits on main.
New Criticals this stretch: gaslight read-mode plan mutation; configure effort always xhigh;
root help hides half the product; spawn --yes→yolo.

## Live reconfirms (still open)

- auth api-key --dry-run still prints full secret
- spawn poe-agent still fs.lstat crash
- skip-if-configured matching sonnet-4.6 still full rewrite dry-run

## Continue

TTY interactive, dashboard, Windows, postinstall, residual edges. Prefer dry-run; never leave gaslight unattended; never print secrets into issue files.
