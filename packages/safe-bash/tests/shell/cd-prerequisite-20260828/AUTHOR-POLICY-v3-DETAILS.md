# Exact cd accounting recommendations for ROOT/Locke

This additive clarification preserves v2 in `882085678862a23cfeef6505fa41a03891743439`.
It is an author recommendation for ROOT's normative decision, not implementation
authorization or a new native observation. All values are inclusive.

## Enforcement order

After existing command admission/expansion/prefix handling, check the existing
runtime signal. Then:

1. More than one operand: existing status1 argument diagnostic, no cap scan or FS.
2. Resolve omitted operand through visible HOME or dash through visible OLDPWD.
   Missing variable: existing named status1 diagnostic, no cap scan or FS, even
   when CDPATH is oversized. Preserve empty resolved target to `.` conversion.
3. Scan effective target:65,536 UTF8 bytes maximum. If relative, scan the logical
   cwd needed for search/fallback against the same bound. Absolute operands do
   not gain an unused-cwd cap. These are the raw path inputs before normalization.
4. Only if target is search-eligible (relative, first component not dot/dot-dot),
   scan CDPATH. Absolute/dot-prefixed targets do not inspect or charge CDPATH.
   Unset/empty CDPATH has zero search slots. Otherwise initialize slot count1;
   each colon adds one, including a trailing empty slot. Maximum4096 slots and
   65,536 raw UTF8 bytes. Complete this bounded preflight before the first probe.
   At each scanned scalar, byte-cap violation wins if byte and slot caps first
   exceed together; otherwise reject the first encountered violation.
5. For each candidate, compute raw joined byte length R from validated lengths
   without constructing the joined string. Reject R>65,536 before work reservation
   or allocation. Reserve2R work units, construct/lexically normalize, then scan
   normalized output N against the65,536-byte cap and charge its byte-work.
6. Admit/count a probe (maximum4097) and one work unit immediately before stat.
   A returned directory admits one further work unit immediately before X_OK;
   a non-directory never makes that call. Check the runtime signal before and
   after each provider await and before any classification/publication.

The missing-variable and argument rules precede private limits. Actual caller or
shared-budget abort retains existing precedence, including errno-shaped reasons;
none is converted to a cap failure or ordinary search miss. Existing prefix and
redirection side effects before builtin entry are not rolled back or rescored.

## Work and repeated paths

Limit8,388,608 local logical byte-work units per invocation. Charge exactly:

- One unit per UTF8 byte in each used input scan: effective target, relative cwd,
  eligible CDPATH. Component metadata is obtained during that same CDPATH scan.
-2R per attempted raw candidate, reserved before construction/normalization.
- One unit per UTF8 byte in the normalized-candidate scan (N).
- One unit before stat; one before access when admitted.

A `charge(n)` reservation first checks `n <= limit - spent`. If it does not fit,
fail immediately before charging, yielding or performing its associated operation;
do not consume the remaining budget or partially allocate the candidate. Admitted
reservations advance in chunks to the next128-unit boundary; await the existing
interruptible setImmediate at every reached boundary, including an exact final
boundary. Input/output scans reserve each scalar's encoded byte count before
advancing it. Check the signal before/after yields. No refund for failed probes.
The bounded native lexical-normalization call is not itself preemptible.

This describes deterministic accounting units, not every engine instruction.
No extra Budget.tick/loop charge, new global work counter, shared-budget reset or
deadline is introduced. Diagnostics/output retain their separate caps/accounting.

Raw joins are exact: absolute operand itself; absolute component plus `/` plus
operand; relative component uses `cwd + '/' + component + '/' + operand`; empty
component/fallback uses `cwd + '/' + operand`. No separator elision before R.

Duplicate/equivalent paths are never deduplicated. Every empty or repeated search
slot consumes its own2R+N and stat/access charges if reached. After all misses,
make a **fresh fallback probe even when equivalent to an earlier empty/repeated
slot**. Maximum4096 search probes plus one fallback, hence8194 public VFS method
calls, not provider-internal requests. Stop at the first fully successful probe.
Absolute/bypass and unset/empty-CDPATH cases have one candidate only. No native
syscall-count observation is invented for these explicit implementation rules.

## Continue, fatal and state publication

Only typed FsError ENOENT/ENOTDIR/EACCES from search probes continue. Treat a
non-directory stat as an ENOTDIR search miss without access. EPERM/ELOOP and
every other typed/untyped error are fatal to this cd under the proposed bounded
profile; continuation for them was not measured by native28. Unknown provider
ENOTSUP/EIO/timeout/limit failures must not fall back into a false success.

Check live caller/shared cancellation before classifying any thrown value.
The fresh final fallback's result supplies the final failure diagnostic, rather
than a remembered earlier miss. Preserve existing error identity internally,
diagnostic association, command/status mapping and middleware replacement rules.

Publication remains checked OLDPWD, cwd, checked PWD, export PWD, export OLDPWD,
then required awaited logical-path print. No rollback: readonly OLDPWD blocks
all publication; readonly PWD retains the earlier OLD/cwd changes but not later
export additions/print. Output failure preserves completed state and existing
5137 mapping (including EPIPE141 and ordinary mapped status1), not universal
raw sink-error rejection. Prefix restoration, clones, middleware, cleanup and
caller/control precedence remain unchanged. Relative HOME/OLDPWD search and
single printing follow the preserved observations; `cd ''` stays legacy `.`.

## Diagnostic recommendation requiring ROOT confirmation

Recommend65,792 UTF8 bytes for **cd-owned diagnostic text**, including an explicit
` [truncated]` suffix if shortened. No newline is part of this payload. The suffix
is12 ASCII bytes; retain the longest whole-scalar prefix fitting65,780 bytes,
then append it. Never first encode/concatenate an unbounded diagnostic. Short
existing messages and normal human FsError descriptions remain unchanged.

The existing shell origin prefix and newline remain outside this private payload
cap but inside the existing parent output-byte budget. This is **not a65,792-byte
whole-line guarantee**. A full-line requirement needs an explicitly cd-tagged
private diagnostic-envelope change, not global truncation or prefix guessing.
ROOT must choose the boundary before Locke binds that assertion.

Private cap errors are ordinary status1 command failures, with proposed payloads:

```
cd: CDPATH exceeds 65536 UTF-8 bytes
cd: CDPATH exceeds 4096 components
cd: path exceeds 65536 UTF-8 bytes
cd: probe limit exceeded
cd: helper work limit exceeded
```

Do not fabricate a public ShellLimitError key or abort the shared budget for a
private cap. Existing shared-limit/caller failures and diagnostic-sink handling
retain their real5137 policy. Byte-work/cap error strings and continuation set
are recommendations to be accepted explicitly, not unmeasured native claims.

No source changes or new probe runs. Fixed composition stays5137 plus the two
accepted provider blobs, tree7c68831a81fc49c94ad9177e58ca9fd7d0aca352. Provider
compatibility reuses Locke2ec9bcda and original unchanged-adapter evidence.
Implementation and directory-stack remain held pending independent freeze/root go.
