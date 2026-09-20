# behavior-fmt implementation review

Reviewed the existing uncommitted private command implementation on 2026-09-19,
preserving all unrelated edits. This receipt qualifies the focused changes below,
not complete GNU compatibility or the other contributors' historical receipts.
The package pattern is currently at
[its archived path](archive/safe-bash-command-package-pattern.md); the requested
original path was already deleted when this review began.

## Baseline and reviewed increments

Downloaded released coreutils 9.10 and verified archive SHA256
`16535a9adf0b10037364e2d612aad3d9f4eca3a344949ced74d12faf4bd51d25`.
Read `src/fmt.c`, the corresponding manual section and all five upstream fmt
tests. Compared `fmt.c` with development revision
`b25722854370b8206d7f53f8934c36710cdd9974`: only default initialization placement
differs. No native fmt or host locale was executed. Source fixtures are distinct
from the task's supplied native observations and historical 8.30 snapshots.

1. A failing memory-source test reproduced accepting invented UTF-8 locales and
   acquiring input under an unavailable profile. Diagnostic profile resolution
   now accepts only C/POSIX and the explicitly named C/en_US UTF-8 profiles;
   aliases, empty variables and LC_ALL/LC_CTYPE/LANG precedence are tested.
   Unavailable profiles return status 1 with the same PROFILE diagnostic through
   CLI and SDK, before source acquisition. Existing UTF-8 diagnostic tables are
   glibc 2.31 policy, not universal released-9.10 locale equivalence.
2. A failing accounting test established the missing explicit decoded-byte
   counter. Engine accounting now reports `decodedBytes: 0`, alongside admitted
   input, emitted output (including invented LF), retained bytes and work.
3. Exact independently transcribed released `goal-option.sh` and `long-line.sh`
   fixtures passed without algorithm changes. Goal costs and split-only bounded
   word windows are therefore exercised by maintained memory-only unit tests.
   Additional CLI/SDK checks pass for separate files, stdin, repeated stdin,
   missing final LF and tab-state reset between files.

## Resource contract

Formatting retains raw bytes and allocates no decoded input storage. Input and
output default to 32 MiB each; output is charged per byte before buffering.
The engine reserves 5000 paragraph bytes, 4096 input bytes, 1024 pending output
bytes and its owned prefix. Returned output is receiver-owned, at most 1024
bytes. There are at most 999 completed/unfinished word records and bounded
cost/break/length arrays; JS object overhead is not represented as physical
bytes by `retainedBytes`. VFS source buffers have a separate allowance within
the invocation retention limit and fallback reads receive `maxBytes`.

Argument parsing is separately bounded to 4096 arguments and 65536 encoded
bytes by default. If their total length is S, the parser owns S raw bytes,
creates at most S UTF-16 units for its byte option projection and at most S
UTF-16 units for decoded operand names (at most 4S logical string bytes across
those two projections). Prefix capture is at most S more raw bytes. Invocation
argument capture adds at most S raw bytes before parsing. Diagnostic quoting
and escaping are linear in these bounded argument/message lengths; UTF-8 units
and printable-table searches use the pinned decoder/table. These parser and
diagnostic allocations are separate from engine accounting; no unbounded
decoded paragraph or implicit Unicode width operation exists.

Work admission covers byte input copies/scans, punctuation scans, suffix moves,
output bytes and DP candidates. Each word window has at most 998 optimized
completed words; candidate work is quadratic within that fixed window and
additionally capped by the invocation work limit (default 128 Mi units).
Costs use checked safe integers with integer truncation; rejecting unsafe
arithmetic is a documented deviation from native overflow. Generator delegation
has fixed call depth; paragraphs, lines and words do not recurse. Cooperative
checkpoints occur between bounded units; invocation output awaits writes and
cleanup disposes buffers and retires iterators.

## Acceptance disposition

| Cell | Fresh review disposition |
| --- | --- |
| Released width7/8, goal and maximum selection | Passing package controls, including exact upstream goal fixture |
| Crown/tagged/split and spacing | Passing existing original byte controls; complete native cross-product OPEN |
| Prefix and final-LF rules | Passing original controls and separate multi-file/stdin checks |
| MAXCHARS and MAXWORDS | Existing boundary controls pass; missing full 200/144 native byte captures OPEN |
| Punctuation/ties/window/margin combinations | Upstream goal fixture passes; remaining combined native qualification OPEN |
| Byte identity, limits, cancellation and cleanup | Passing package and focused integration controls |
| Locale availability | New failing-before-fix admission and precedence controls pass; full 9.10 non-C diagnostics OPEN |
| Private ownership and public export | Private `safe-bash-command-fmt`, no external runtime dependencies; Safe Bash composition preserved |
| Public artifact | Fresh public-only consumer runtime and NodeNext declaration fixtures pass; shipped JS/declarations contain no fmt/contracts private package names |
| Browser/workerd execution | OPEN; this review executes Node only |

Fresh checks: 51 private package tests, package ESLint and source/test typechecks,
719 focused fmt/adversarial/registration tests, and the maintained selected Safe
Bash build closure (18 builds) passed. Public artifacts were generated with
`package-safe.mjs` at version `0.0.0-behavior-fmt-review`; only the three public
Safe Platform directories were copied into the consumer. Canonical runtime
identity, cross-realm input, byte argv, VFS scripts, pipes and SDK execution
passed via the maintained fmt runtime fixture. No private command package was
packed or published. An ad hoc terminal PNG was visually inspected for width8
output and the new locale rejection/status. `git diff --check` passed.

Initial screenshot execution started before artifact copying completed, then
used an incorrect renderer-relative path; both tooling errors were corrected
before the successful screenshot. An initial private-name search used the
checkout-style artifact directory, then was corrected to search all shipped
JS/declarations. Neither failed invocation was counted as successful evidence.

Repository-wide suites were not repeated for these focused changes. Temporary
archives, artifacts, logs and screenshots used repository `out/behavior-fmt`
(filesystem `/out` is unavailable here) and were purged after review. Local
commits: none. Verified remote-main delivery: none. Successful release: none.
