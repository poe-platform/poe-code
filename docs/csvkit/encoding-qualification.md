# Encoding qualification

This pass extends the existing engine and opt-in safe-bash plugin; it does not
complete the csvkit suite. Procedure: docs/plans/csvkit-encoding-qa.md. Semantics
and remaining encoding divergences: docs/specs/csvkit-encodings.md.

The native oracle used the hash-pinned CPython 3.14.2 executable and existing
hash-locked requirements. The csvkit source archive SHA-256
147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b was independently
downloaded and verified again. Active distribution versions and SQLite version
were compared to reference-profile.json. C locale, UTC, pipe stdio, 80 columns
and 24 rows were supplied exactly; environment overrides are per capture.
Native subprocesses and file creation were confined to isolated research in out.
No product fallback or canonical unit oracle invocation was added.

encoding-reference.json contains 66 byte-exact command observations. Sixty-one
are replayed through the shared engine with bulk and single-byte/empty-fragment
input; stdout, stderr, status and unchanged in-memory file effects match. Five
source output-encoding observations are explicit TODO divergences. The denominator
includes those blockers; the cohort is not 66 parity passes.

codec-primitives-reference.json contains 833 strict bulk decode observations:
all 256 byte values for ASCII, Latin-1 and CP1252, plus UTF-8/sig and UTF-16
signature/endian/surrogate/truncation cases. Successful decode results also retain
native str.encode bytes. These observations qualify the finite primitive subset,
not arbitrary codec/error-handler combinations or TextIO encoding behavior.
src/codecs/aliases.ts was generated from frozen codecs.lookup results over
encodings.aliases keys/values and installed standard encodings module names;
it records factual lookup names, not a copied codec implementation. Names without
ported injected providers remain blockers. Injected custom codec providers remain
trusted host code and are not qualified by this registry inventory.

The first command replay failed 39 cases. Failing alias regressions preceded
the original-spelling diagnostic fix; four failing UTF-16 bulk cases preceded
separating bulk decode from incremental TextIO BOM requirements. Failing direct
UTF-8-sig encode observations preceded its encode fix. Canonical inputs, outputs
and filesystem assertions use memory only.

A different agent independently captured and tested actual safe-bash behavior,
then fixed UTF-8 decoder framing and incomplete signature handling. Its six
Shell regressions cover exported versus local environment values, explicit
encoding override, raw BOM timing, cancellation during an awaited BOM write,
invalid versus truncated bytes across producer fragments, alias spelling and
cancellation while a named producer's next() is pending.
The root fixed the resulting integration regression: owned named producers now
receive return() after normal EOF as well as early closure, without replacing a
primary read failure with a cleanup failure. A failing bounded regression then
demonstrated queued async-generator return deadlocking cooperative cancellation.
The adapter now supplies a direct iterator: Runtime's synchronously registered
cleanup forwards return() without queuing behind next(), shares completion with
EOF/failure cleanup and retains falsey cancellation reasons. The independent
agent rechecked eight lifecycle tests without another validated failure.

Twelve additional UTF-8 encoder tests include seven native successful encode
observations, four explicit unpaired-surrogate refusals and one cancellation
case. The refusals are unit tests of blocker handling, not native parity passes.

The maintained uncached safe-bash build dependency closure passed all ten builds.
Both focused Shell integration files passed 78/78. Safe-bash source/test checks
and all 26 maintained consumer type groups passed; these are type checks, not
runtime qualification. Domain unit checks pass 1,335 tests with five explicit
TODOs; maintained domain build and ESLint/product/test typechecks pass.
The final normal `npm run build` also passed after the direct-iterator change,
including workspace builds, root schema-generation stages and the root bundle.
The final guarded repository ESLint route passes with zero errors and two
warnings outside csvkit. Repository types/contracts and workflow lint also pass.

The final uncached `npm test` returned status 1. Its shared Vitest phase passed
2,818 files and 130,789 tests, with two skipped files/tests and five TODOs.
The safe-bash runner completed 1,193 active files: 39,704 tests passed, 823 were
skipped and exactly two failed. Both failures (committed Pandoc metadata and
clean-packed S3 HTTP exports) reported the same concrete gate violation:
`committed build input differs from reviewed authority: scripts/build.mjs`.
That tracked file was modified at session entry. Committed-archive authentication
was preserved; neither a local overlay, an unrelated-edit revert nor a commit
was used to manufacture a pass. Later workspace tasks beyond the failing
safe-bash task are not certified by this aborted full route.

An actual compiled public SDK/plugin run using pythonCodecs rendered successful
Windows-1252 input, exported suffix LookupError and an ASCII strict-decode error.
The diagnostic screenshot was viewed: accent/euro glyphs and complete messages
were readable without clipping. The owned temporary image and native scratch
environment are removed after reduction.

All earlier suite blockers in implementation-status.md remain. In particular,
Agate inference/Decimal/statistics, binary workbooks/DBF, genuine database backends,
full Python/Agate interaction, compression implementations and exhaustive
original-command acceptance are unfinished. Earlier repository unit archive
gates requiring committed authority remain incompatible with this deliberately
uncommitted worktree; no commit, gate weakening or live overlay is authorized.
No full repository unit success, README publication, staging, commit, push or
release is claimed.
