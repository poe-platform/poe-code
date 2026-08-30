# Independent targeted shell holdout

This leaf owns only the new `tests/shell-stress/targeted-holdout/` and
`benchmarks/shell-stress/targeted-holdout/` trees. It changes no product source,
existing tests, original Bash 3.2 references, manifests, or shared harnesses.
There are 49 frozen compatibility cases and eight native-free lifecycle probes.
Known failures remain ordinary failing tests, not skips or expected-failure gates.

## Reference policy and reproducibility

`references.json` records both native versions, executable SHA256s, platform,
literal scripts, input, initial files, stdout/stderr text and base64, statuses,
and complete file/directory snapshots. Every case was captured twice per binary
with identical observations. The primary binary is pinned GNU Bash 5.3.0(1),
not a claim about the newest release. The legacy binary is Apple Bash 3.2.57.
Twenty-five of the 49 paired observations differ; those differences remain raw.
The reference source is hashed and tests reject stale or reordered fixtures.

The capture generator requires both binary paths explicitly. It launches literal
argv with `shell: false`, a sanitized environment, per-run isolated temporary
directories, a two-second deadline, and a 65,536-byte combined-output ceiling.
The existing process-group cleanup helper is reused. Temporary capture files are
removed in `finally`. No comparator package or runtime dependency is added.

Optional explicit recapture, from the project root:

```sh
set -o pipefail
node --import tsx benchmarks/shell-stress/targeted-holdout/capture.ts \
  /absolute/path/to/gnu-bash-5.3 /absolute/path/to/legacy-bash-3.2 | apply_patch
```

Recapture replaces only this leaf's new reference artifact. Review any resulting
expectation change independently; do not use recapture to bless virtual output.

## Harness correction

`baseline.json` preserves the initial uncorrected comparison. Its prefix rule
recognized `shell-stress:` and `bash:` but omitted the actual virtual `shell:`.
`calibrated.json` corrects that omission symmetrically, replacing only those
line-leading executable names with `<shell>:`. Validation explicitly checks that
line numbers and embedded name-like payloads remain unchanged. The product is
not asked to emit a fixture program name. No diagnostic wording, line numbers,
stdout, status, or file bytes are otherwise normalized; raw observations remain
in both artifacts. The correction does not remove any of the 22 failures.

The calibrated runner also explicitly supplies each fixture's `LANG` and
`LC_ALL` to virtual execution, matching the native locale instead of relying
on the virtual default. C-byte and C-locale ANSI Unicode differences remain
active failures, not exceptions.

## Recorded checkpoint

The single calibrated 49-case rerun and eight lifecycle probes used one stable
source aggregate:
`0095b36d26fb02680712acadd3bc753051eb3e565dbe0cd3cc34bf3e321570f8`.
The calibrated run began at revision `6e1240ef82679996c2a6ba9a3566ec6a38f6e5a9`.
Per-case before/after hashes are retained. There were no invalidated samples.
These are checkpoint results, not assertions about later author fixes.

| Group | Pass / total | Diagnostic-only failures | Other failures |
| --- | ---: | ---: | ---: |
| Descriptor | 4 / 10 | 6 | 0 |
| Read | 10 / 12 | 0 | 2 |
| File shortcut | 2 / 6 | 3 | 1 |
| ANSI-C words | 7 / 8 | 0 | 1 |
| Pathname classes | 4 / 4 | 0 | 0 |
| Fatal errors | 0 / 6 | 5 | 1 |
| Upfront substitution validation | 0 / 3 | 0 | 3 |
| Total compatibility | 27 / 49 | 14 | 8 |

The eight non-diagnostic failures are: closed-fd `read -n0` returns zero rather
than one; C-locale `read -n2` counts Unicode characters rather than bytes;
directory shortcut status differs from this pinned Darwin native observation;
C-locale ANSI Unicode escapes differ; fatal required-parameter expansion in a
function exits one rather than 127; and all three malformed-substitution forms
return two rather than 127. Descriptor scope/output/status/file effects agree
after author commit `1c66038`; their six remaining failures are missing diagnostic
line numbers, not evidence that descriptor restoration is still broken.

Fatal/prevalidation implementation was still pending at capture, and ANSI had
recently landed in `0aeaaf4`. These pending-group failures are not presented as
new regressions. Fourteen diagnostic-only failures still count as failures.

Lifecycle probes pass 7/8. The failing probe confirms no input acquisition,
plugin invocation, or file effects for malformed substitution, but fails on
the same two-versus-127 status. Passing probes cover moved input provenance,
transparent invocation, explicit/closed/file/pipeline input, no-pull zero reads,
fragmented UTF8/shared offsets/EOF, cancellation and iterator cleanup, injected
shortcut read failure with preserved outer stdin, and bounded case cancellation.

`validation.json` contains the full lifecycle TAP, exit statuses, source guards,
and the exact strict TypeScript invocation over only the new TypeScript entry
files. Scoped typechecking exits zero. No global test, typecheck, or build ran.

## Running after author fixes

The tests need neither native Bash binary nor network access:

```sh
node --unhandled-rejections=strict --import tsx --test --test-concurrency=1 \
  tests/shell-stress/targeted-holdout/*.test.ts
```

To produce another snapshot-aware raw report and the compact root routing file:

```sh
set -o pipefail
node --unhandled-rejections=strict --import tsx \
  benchmarks/shell-stress/targeted-holdout/run.ts after-author | apply_patch
```

The reporter exits one for any failure, error, or source invalidation; the patch
is still emitted and can be applied. An optional final argument selects a group
or case-name substring for a focused invalidation rerun. All full reports retain
their actual denominator. Never relabel a filtered report as the full suite.
`/tmp/safe-bash-shell-heldout-findings.txt` contains the compact case/mismatch
table and the full raw report path for root routing. No superiority or complete
Bash compatibility claim follows from these targeted results.
