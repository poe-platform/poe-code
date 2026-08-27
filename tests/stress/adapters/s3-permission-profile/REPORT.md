# S3 permission profile: observed, not adjudicated

## Decision and ownership

Checkpoint executed August 27, 2026 UTC (August 26 in America/Chicago), against
`7d0fe7b45578cfc3836e9a8d6a5fd4a4d5e9edd3`. **The required permission row remains
RED. No S3 product source, backend author test, or generic expectation changed.**
Only this new evidence directory is delivered. This is a bounded blocked-policy
checkpoint, not a permission fix or approval of potentially misleading modes.

Authority inspected: root and parent AGENTS, committed shared filesystem types
and Markdown, project ledger, S3 README/author tests, original four-reds final
report, `/tmp/safe-bash-four-reds-next-coordination.txt`, and the current Curie
copy-authority review. The shared contract declares the fields but does not
adjudicate explicit creation-mode handling or X_OK under `permissions:false`.
The S3 README describes advisory metadata and explicitly leaves this question
open. Existing author expectations describe implementation, not a contract-owner
ruling. The newer copy-authority proposal explicitly approves no contract
expansion; identity/copy guarantees and mount/WebDAV traversal do not settle
this permission question.

The listed Curie agent `01a03f3d-492a-7e30-af3e-1e0e0e56f7e7` returned
`agent not found`. The following narrow question was sent to Curie and surfaced
to root immediately; no reply or approval was received:

> Under permissions:false, may explicit creation modes be retained only as
> advisory metadata (including readable mode0000), and may X_OK return EACCES
> for regular files but success for directories? Or must explicit modes and/or
> X_OK reject ENOTSUP before effects?

Root/Curie must explicitly choose the creation-mode and execute-check policies
before a source fix or an intentional generic-row delta. They are separate
decisions. No blanket rejection of ordinary remote operations, permission
capability invention, backend identity change, or copy-authority inference is
introduced. The existing mode behavior is not safe private-storage enforcement;
this checkpoint does not certify no exposure. Permission-sensitive callers must
not treat these mode bits or successful access probes as authorization proof.

## Exact old/new expectation and source evidence

The original row still requires typed `ENOTSUP` for chmod, explicit mode0600
creation, and regular-file X_OK when permissions is false. It stops at creation
because that call resolves, masking the distinct X_OK disagreement. The live
source and expectation are identical before and after both runs:

| File | Old = new SHA256 |
| --- | --- |
| `src/contracts/filesystem.ts` | `fc3c8ee2c6d2d1dade397567779543a38a4fb0092a7225975fecf7cfd553b915` |
| `src/contracts/filesystem.md` | `13d82a1a15d9b86370cd54c904608e8eed37da63e5ce05e754dc6e53f0ff821e` |
| `src/fs/s3/filesystem.ts` | `c1515263ae2f213548c236c84cf67bd8ff0651730228e4eed0285e878c9a34ce` |
| `tests/stress/adapters/core.test.ts` | `230ddbe6aaa62c0ead5ed186087540d360ce9c7b103b174782e4de27f6b21326` |

`unchanged-core-fixture.source.txt` freezes the complete generic fixture.
Each run's manifests cover all S3 source/tests and the shared contract, plus
the imported filesystem/conformance fixtures and independent policy inputs.
Both stability records show no changed inputs and no owned source delta.
Unrelated dirty concurrent command/shell/integration work is recorded, not
staged or represented as validated. No full-repository test/build/typecheck ran.

The historical expanded adapter result **98/99**, original revised cohort
**69/70**, and unchanged matrix results remain historical evidence, not rerun
aggregate scores. Neither the frozen four-reds subtree nor independent policy
tests are edited. Their baseline tree IDs are in `provenance.json`.

## Independent mock observations

`02-characterized/observations.stdout` records **166 observations**, with exact
binary bytes, typed errors/paths, and per-operation request counts/inputs.
The probe's assertions validate the captured characterization, **not required
permission-profile acceptance**. They are not added to the passing-test count.

- Explicit modes 0000, 0600, and 0755 persist as decimal `virtual-bash-mode`
  metadata for new files under w/wx/a/ax. New writes make five mock requests,
  including one PUT. wx/ax and missing-file a use If-None-Match `*`; ordinary w
  does not. Fresh instances report the same mode, exact bytes and file size.
- Mode0000 files remain readable through the VFS and directly through the
  authorized mock. R_OK/W_OK succeed (four metadata/list requests), regardless
  of advisory bits. X_OK returns typed EACCES for all regular files tested,
  including mode0755. These are synthetic access policies, not POSIX enforcement.
- Existing wx/ax writes reject EEXIST with no PUT and exact bytes preserved.
  Existing w/a changes bytes as requested but retains the old stored mode even
  when 0777 is supplied. AppendFile and exclusive writeStream also accept
  mode0000 creation and preserve exact binary payloads.
- Mode0000 and mode0700 directories retain their modes, permit child creation,
  readdir and reading children, and resolve X_OK (three metadata/list requests).
  F_OK/R_OK/W_OK and combined access7 also resolve. Directory mode0000 is not an
  isolation boundary. Default child creation remains usable.
- Chmod on a file, directory or missing name is typed ENOTSUP with **zero
  requests**. Invalid creation modes reject EINVAL with zero requests. Missing
  access targets reject ENOENT; no invalid/missing/cancelled object appears in
  the final namespace.
- Read-only writes reject EROFS before requests; read-only W_OK rejects EROFS
  after existence checks. R_OK still succeeds. Mock GET/PUT denials propagate
  EACCES without changing existing bytes. Crucially, R_OK can succeed when GET
  is denied, and W_OK can succeed when PUT is denied. HEAD denial propagates
  EACCES through access rather than becoming absence.
- Pre-aborted supported operations reject ECANCELED before requests for ordinary,
  ENOENT-shaped and EACCES-shaped reasons. In-flight aborts during mock GET/PUT
  also produce ECANCELED with exact old bytes intact. This is cooperative-mock
  evidence, not cancellation rollback or termination of an arbitrary provider.
- **Distinct cancellation observation:** unsupported chmod ignores its optional
  signal and still returns ENOTSUP, zero requests, when pre-aborted. This is
  preserved explicitly, not asserted as successful cancellation or silently
  conflated with supported operations. Any precedence change needs a separate
  scoped decision; no cancellation parity claim is made.

## Scoped validation

Both runs use Node 22.22.2 with recorded installed tsx/TypeScript versions and
strict unhandled rejection handling. `02-characterized` is the final run:

| Check | Result |
| --- | --- |
| Independent observation probe | exit 0, 166 observations; not acceptance |
| Unchanged required S3 metadata row | **0/1, RED**, exit 1 |
| S3 backend tests | 179/179, exit 0 |
| S3 conformance | 50/50 behavior + 2/2 provenance, exit 0 |
| Existing independent S3 policy, read-only | 86/86, exit 0 |
| Targeted S3 adapter stress | **36/37**, same metadata RED, exit 1 |
| Strict S3/backend/profile/core-fixture scoped types | exit 0 |

All test cohorts have zero skips, cancellations and TODOs. The single-row and
targeted-stress failures overlap and must not be summed as separate defects.
No broad superiority, full-shell, deployment-security or 72-hour claim follows.

`01-observed` is retained unchanged. Its new probe failed because its author
incorrectly expected four requests for a marked directory access; the measured
implementation uses three. This is a **probe-author error, not a product failure
or permission ruling**. Only that observational count changed in the probe.
`initial-probe.source.txt` and `initial-runner.source.txt` match that run's hashes.
The second runner additionally freezes its scripts and returns nonzero when any
cohort fails; the first runner's exit0 did not mean all its subprocesses passed.
Both rounds' raw logs and exact subprocess exits remain available.

## Reproduction and seals

- The unchanged product/fixture inputs are recoverable from the recorded Git
  baseline; compare their SHA256 values with the run manifests before replay.
  The final probe and runner source are also frozen in the final run directory.
- Run the recorded executable/argv from each `*.exit.json` at the repository
  root. The required-row and targeted-stress commands should remain nonzero
  until an explicit ruling and reviewed source/expectation change occur.
- `node tests/stress/adapters/s3-permission-profile/reproduce.mjs fresh-label`
  creates a new evidence directory via apply_patch and refuses to overwrite an
  existing label. It exits 1 while the required row remains RED. The runner
  reads the original `/tmp/safe-bash-four-reds-next-coordination.txt`; its exact
  contents are preserved in the run provenance if replaying elsewhere. Individual
  recorded test/probe commands do not depend on that temporary handoff file.
- Per-run SHA256SUMS seal raw outputs/manifests/provenance; top-level SHA256SUMS
  also covers this report, scripts, original attempt snapshots and fixture.
  Do not replace old evidence with later green output.

Pending handoff is solely the explicit permission-profile ruling. Curie retains
contracts/core copy/mv and copy-authority design; the other remote leaf retains
mount/WebDAV traversal. No ownership transfer beyond the user's S3 scope is
inferred, and no substantive task is delegated further.
