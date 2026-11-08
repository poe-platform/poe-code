# Locke: ratified directory-stack precode handoff

ROOT ratified R1-R4. Read `ROOT-RATIFICATION.md` together with the byte-bound
`../PACKET.md` from `053505fcb5b63d8872991eb09655bc927dd7080d`. Historical pending
labels in that packet are preserved; the new overlay resolves them without a
native rescore or feature implementation. `SEAL.json` binds both documents, all
parent evidence files and the accepted CD source references.

## Scheduling and exact composition

**Runtime window released to LET first.** Stack author is docs/precode-only.
Do not interpret this freeze handoff as a production GO. Freeze behavior now;
bind execution later to ROOT's accepted CD+LET composition. No LET hash exists in
this seal. The prior accepted CD baseline is fixed5137 + ca1d3342 two DAV blobs +
runtime4641075d, package SHA256
`06ea635b201a1296268adaa452a2419682f92ec93906cb9083e327dc69f85914`.
The new verifier authenticates those pinned source blobs, not whatever a future
LET writer has in the live checkout. It does not load product modules or claim
that a moving checkout equals a future accepted composition.

## Independent freeze targets

This is a requirements map for the different reviewer, NOT executed cases or a
replacement for independently selected tests. Preserve historical inputs/results.

| Family | Positive and negative boundary |
| --- | --- |
| Process scope | Fresh consecutive/concurrent exec and interpreted sh/bash; shared function/source/braces; copied subshell/pipeline/substitution/invoke; no parent/sibling writeback across all settlements |
| State construction | Every existing clone/spread/process initializer, including redirect and shebang paths; no mutable tail alias; env replacement and scalar DIRSTACK do not seed tail |
| Stamp same-path | Nested borrowed-cwd function trace, source/command frames, later ordinary cd back to borrowed path; verify cwd/PWD/tail independently |
| Stamp exclusions | Ordinary cd-only baseline, dirs/-n/non-top-pop restoration, lookup/readonly-OLDPWD failures, child-only stamp, no blanket middleware change |
| Stamp partial failure | Actual cwd assignment followed by readonly-PWD or required-print failure preserves publication; pre-cd tail effects distinguished from after-cd tail effects |
| Grammar | Packet complete parser tables; separate-only dirs flags, repeated selectors, early versus late range validation, --/empty/extra tokens, raw dash, signed64 project bounds |
| Native transition profile | Preserved34+4+8 provenance, raw -n/rotation/swap/pop ordering, failed cd partial mutation; no generic rollback or help/overflow parity claim |
| Capacity/work | Inserted cwd pre-admission, reached versus ignored tokens, used/unused HOME, separate stack/CdLookup counters, final flush/yields, no extra command charge |
| Output/error | Combined required-cd+stack bytes, awaited chunks, partial sink failure/caller abort, diagnostic payload boundaries, no state rollback or error identity conversion |
| Existing behavior | Accepted cd X_OK/CDPATH/readonly/middleware; getopts and invoke cancellation; owned output; builtin discovery/function shadowing; unchanged default plugin count |

Use appropriate declared provider profiles for strings a concrete filesystem
cannot represent. Keep source-invariant versus dynamically measured roles honest.
Installed/moved execution must authenticate actual loaded bytes when a candidate
exists. No runtime, installed or native stack cases execute in this ratification.

## Read-only seal check

```
node tests/shell/directory-stack-design-20260828/final-v1/ratification-v1/verify.mjs
```

This checks the ratification/parent artifacts and pinned Git source hashes without
starting a product/native child, copying source snapshots, or writing a temp root.
Git read subprocesses are synchronous. Parent source-live verifier is preserved
unchanged and is not the replay command after another owner starts LET work.

No active author service/child or stack source write remains. Future candidate
needs a new source seal, different review and explicit ROOT acceptance; this
design seal alone supplies none of them.
