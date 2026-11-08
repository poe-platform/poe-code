# Independent expr component v1 — preflight abort

Authorization date: August 28, 2026. The original August 27 nine-file freeze and
the approved five-file component-admission checkpoint are unchanged.

Freeze commit: `eaca395fd0f90051676798971750515d04b0c005`.
The single invocation stopped while authenticating frozen `LAYOUTS.json` with
Git: the exact absolute-path manifest exceeds the frozen 4 MiB `execFileSync`
buffer. Git reports `ENOBUFS`/SIGTERM; the runner exits 1 before creating its run
directory, materializing candidate input, building, importing product or entering
its reporting try/finally. `EXECUTION.raw.txt` preserves the complete emitted raw
error. This is a harness-preflight defect, not a candidate build/test failure.

## Actual disposition

- P01: **UNEXECUTED**. Preparation authenticated the complete selected 357 Git
  inputs, but no independent build or exact c109 wholepack reproduction occurred.
- Authorpack: read-only authentication/layout planning only; **no installed-runtime
  proof**, no substituted P01 pass, no reused held resource acceptance.
- Installed/moved × Node22/24: **0 executed, 0 passed, 0 failed, 104 unrun** runtime
  ID-context assertions. The 26 IDs and two variants are preserved, not rescored.
- R25 EXEC-only and R26 direct/Shell/sibling protocols: **UNRUN**. No worker creation,
  cancellation, cleanup, sibling, natural-settlement or supervised-kill evidence.
- Runtime controls/type invocations: **0/0**. P01–P08 remain unrun.
- Read-only preparation, syntax and post-integrity checks are **not product passes**.

The frozen recipe was not modified or rerun. The separate post-failure streaming
Git inspection verifies frozen bytes and original evidence without importing or
executing product; it does not replace the failed runner's admission predicate.
Tool manifests include new-entry checks, and the original nine/admission five
remain unchanged. No whole archive was read or materialized by this execution.
The earlier successful preparation shell-wrapper `status` error is separately
retained in `PREPARATION-NOTES.md`; neither error was hidden or retried to green.

The first read-only evidence writer also stopped on the same 4 MiB helper while
reading the whole index. Its unchanged source is `finalize-abort.mjs`; the tool
output was transcribed verbatim to `POSTCHECK-ATTEMPT-1.raw.txt`. The separately
versioned `finalize-abort-v2.mjs` streams both index and file hashes only to finish
the abort report. Neither writer runs candidate code or retries `run.mjs`.

Accepted-DU75 stays **HELD/unrescored**, and HTML34, whole76 and global acceptance
stay **HELD**. No product defect or superiority result can be inferred here.
The next attempt requires an explicitly versioned/refrozen streaming Git reader
and root authorization; v1 remains a failed preflight record, not a mutable test.
