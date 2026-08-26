# Requirements and Progress Ledger

## Source and status discipline

This ledger preserves the complete goal supplied to this documentation worker,
including later ownership instructions. The underlying original conversation
was not supplied; this is not a claim to reproduce unseen requirements.
User statements remain authoritative. Missing details are pending decisions,
not permission to narrow scope or invent requirements.

Use these status distinctions: **requested** is user scope; **reported** is
another worker's stated activity; **observed** is inspected repository state;
**verified** requires recorded validation evidence. Planned gates are not
passing results. Record dates, commands, outcomes, and relevant commit IDs when
available; never substitute elapsed calendar time for demonstrated work.

## Complete recorded goal

| ID | Explicit requirement | Initial status / outstanding evidence |
| --- | --- | --- |
| R01 | Build a virtual Bash companion to `poe-code safejs`, inspired by `just-bash`. | Requested; integration and compatibility details pending. |
| R02 | Provide Express-like plugin syntax. | Requested; actual contracts and examples pending foundation verification. |
| R03 | Support a memory filesystem. | Requested; implementation and validation pending. |
| R04 | Support a real filesystem. | Requested; implementation and validation pending. |
| R05 | Support an S3-compatible filesystem and build a mock. | Requested; both adapter and mock validation pending. |
| R06 | Support WebDAV. | Requested; implementation and validation pending. |
| R07 | Support additional filesystems. | Requested; additional backend selection and implementation pending. Do not treat R03–R06 as the complete filesystem scope. |
| R08 | Provide many agent tools. | Requested; tool inventory, count, and individual acceptance evidence pending. |
| R09 | Support piping. | Requested; end-to-end validation pending. |
| R10 | Support stdin. | Requested; input propagation and consumption validation pending. |
| R11 | Support full shell functionality. | Requested; a core-only subset or a passing fixture sample does not establish completion. |
| R12 | Build tools sequentially, then perform independent stress-test/fix cycles. | Requested; ordered build records and independent review/fix/retest evidence pending. |
| R13 | WORK 72 hours. | Explicit requested duration; work start, activity record, elapsed work, and fulfillment are not established here. |
| R14 | Initialize Git. | Observed: `.git` exists and Git recognizes an unborn `main` branch at initial inspection. |
| R15 | Make atomic commits. | Required throughout; stage explicit owned paths and keep each commit coherent. |
| R16 | Maintain `AGENTS.md` codebase rules. | Documentation added in this change; ongoing maintenance required as conventions become verified. |
| R17 | Supply at least 40 verified Bash fixtures tagged by feature as `core` or `advanced`. | Separate oracle worker assignment; fixture count, tags, Bash results, and delivery not yet verified by this worker. |

The foundation worker is reported to be building TypeScript ESM Node.js 22
contracts. This is the intended foundation, not a verified public API. No
package manager, exports, plugin signature, filesystem interface, command
catalogue, or shell-conformance boundary has been established by this ledger.

## Ownership and coordination

- Documentation worker: `/Users/kjopek/Workspace/virtual-bash/AGENTS.md`,
  `README.md`, and `docs/**`, excluding `docs/testing-shell-oracle.md`.
  Read parent rules, edit only owned files via `apply_patch`, commit coherent
  documentation atomically, and return changed paths plus the commit hash.
  This leaf assignment does not require subdelegation.
- Foundation contracts worker: Curie,
  `01a03f3d-492a-7e30-af3e-1e0e0e56f7e7`. Obtain and verify API details before
  expanding README usage guidance. Concurrent read-only inspection is allowed;
  this documentation assignment does not authorize implementation edits.
- Oracle worker: owns `docs/testing-shell-oracle.md` and
  `tests/fixtures/shell-cases.json`. Do not edit either file. The expected
  testing ledger is [the shell oracle document](testing-shell-oracle.md);
  this pointer identifies a separately assigned artifact, not verified delivery.
- Root agent: coordinates workers and synthesizes results under the parent
  `../AGENTS.md`; substantive work belongs to subagents.

## Planned validation gates

These gates organize verification of the requested scope; they do not claim
that any implementation, command, fixture, or test currently exists.

| Gate | Evidence required before marking verified |
| --- | --- |
| Foundation | Inspect delivered TypeScript/ESM/Node.js 22 contracts; record real build/test commands and outcomes; verify exports before publishing usage. |
| Plugins and companion integration | Exercise the delivered Express-like plugin interface and the agreed `poe-code safejs` integration behavior; record unresolved compatibility decisions. |
| Filesystems | Track memory, real, S3-compatible plus mock, WebDAV, and each chosen additional backend separately; record exercised behavior and failures. |
| Sequential tool delivery | Maintain the tool inventory and ordered per-tool implementation/validation evidence; do not substitute a handful of tools for the requested broader inventory. |
| Shell oracle | Confirm at least 40 fixtures, their feature tags and `core`/`advanced` classification, and actual Bash verification evidence in the oracle worker's artifacts. |
| Shell execution | Compare implementation results against the verified oracle; exercise stdin and piping; maintain uncovered full-shell behavior explicitly, including advanced cases. |
| Independent stress/fix cycles | After sequential tool construction, record independent tester identity, tested revision, stress cases, failures, fixes, and retest outcomes for each cycle. |
| Final scope and duration audit | Reconcile every requirement with evidence or explicit pending status; record the 72-hour work history honestly; verify atomic commits and current project rules. |

## Progress record

| Date | Evidence or action | Limits / next step |
| --- | --- | --- |
| 2026-08-26 | Read `/Users/kjopek/Workspace/AGENTS.md`; it requires root coordination, subagent execution, and faithful preservation of user statements. | Follow these rules throughout the assignment. |
| 2026-08-26 | Initial directory listing contained only `.git`; `git status --short --branch` reported no commits on `main`; `git ls-files` returned no tracked files. | Point-in-time observation only; concurrent workers may subsequently deliver files. |
| 2026-08-26 | User reported foundation work underway and identified Curie as the contracts worker. | No API details or passing foundation validation supplied to this worker. |
| 2026-08-26 | User assigned the separate oracle worker the oracle document and fixture file, with at least 40 verified Bash fixtures tagged `core`/`advanced` by feature. | Delivery and fixture validation remain pending; ownership exclusions apply immediately. |
| 2026-08-26 | Added project rules, brief status README, and this requirements/progress ledger. | Documentation only; this does not establish product implementation or completion of the 72-hour request. |
| 2026-08-26 | Verified all three owned documentation files exist, counted 17 requirement rows, and passed `git diff --cached --check -- AGENTS.md README.md docs/PROJECT_LEDGER.md`. | Documentation checks only; no product tests or APIs were verified. |

## Pending work

- Receive foundation contracts and inspect implementation before recording APIs,
  architecture as established, or runnable installation/build/test commands.
- Define the tool inventory, additional filesystem choices, companion
  integration details, and full-shell coverage tracking without reducing scope.
- Deliver and validate every requested backend, the S3-compatible mock,
  plugin behavior, tools, stdin, piping, and full shell functionality.
- Receive the independent Bash oracle artifacts and verify their recorded
  coverage, count, tagging, and results; track uncovered behavior separately.
- Record sequential tool delivery, then independent stress-test/fix cycles
  with reproducible evidence and regression retests.
- Establish and maintain an honest work/activity record for the explicit
  72-hour request; no fulfillment or finish time is asserted here.
- Keep this ledger and `AGENTS.md` current and update the README only from
  inspected APIs and recorded validation. Continue using atomic owned-file commits.
