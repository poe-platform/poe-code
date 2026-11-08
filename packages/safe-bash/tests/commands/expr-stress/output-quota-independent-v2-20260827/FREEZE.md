# Independent quota v2 controls — 2026-08-27

Ownership: this new evidence directory only. No production or old fixture edits.
Leaf performs all work directly, without delegation. Candidate receipt and source
are not read until this freeze is committed and baseline replay has begun.

The canonical original cohort is the exact 47 cases, probe and common helper from
064f3381 in output-emergency-review-20260827. They are copied byte-for-byte, not
rescored or edited. Historical candidate is 7623599c995c42f62ec1cd9ad78ced2913970f66;
historical results remain 36/47 with 11 quota failures. Replay retains all original
assertions, including stdout-rejection-normal-quota. That original may fail under
the new caller-error identity policy; it must not be counted green. The explicit
v2-old-stdout-rejection-explicit-identity case is a proposed versioned replacement,
reported separately, not a silent old-oracle correction.

Normal output, including every normal diagnostic, obeys maxOutputBytes. Exactly
one fixed 34-byte `expr: output bytes limit exceeded\n` emergency may bypass that
normal budget. This is not an absolute combined stdout/stderr cap. Admission must
precede stdout writes and diagnostic byte encoding. Sink/caller errors, even an
ExprError shaped like quota or falsy reasons, retain exact identity rather than
being converted to diagnostics. Emergency writes are awaited, not retried, honor
abort and have no user-controlled bytes. Registered cooperative cleanup is awaited.

Additional cases are bounded identity, admission/allocation and worker/caller/close
precedence probes, not a broad new corpus. They use actual compiled worker jobs on
`a` or `[` only. Allocation instrumentation observes TextEncoder diagnostic
encoding, not all JavaScript allocations/RSS. Controlled close delays/rejections
wrap and await real session cleanup; they are not claims about arbitrary hosts.

Replays extract only selected committed source/config/tests into task-owned scratch,
build source and actual worker, compile four existing scoped test files and helper,
and run the unchanged old47 and new controls against that build. No native oracle,
historical capture writer, full gate, package install, live overlay or SIGSTOP.
Compare full inventories before/after, including newly appended entries. Immutable
Git input controls govern the archive; unrelated live edits neither enter nor veto.
Fresh result directories only. All owned children have bounded timeouts and all
owned temporary files are removed. Results and source/build hashes are separate
from author provenance. The exact receipted quota commit stays pinned even if a
different parser author later changes the live index.
