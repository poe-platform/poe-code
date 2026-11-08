# TEXT-BOUND-001 author correction

This is a bounded source fix, not independent replay or public integration.
Only new author regressions and the reported static finding were used; no new
hidden corpus, proposal, runner or oracle was read.

## Original failures retained

Original product snapshot was the SQLite-corrected source from
9f7fed68077a68ef3decb114ace83ad47b75ae14 (same path bytes verified at this task).

| Source | Original SHA256 |
| --- | --- |
| src/commands/file/index.ts | 1753ac81d099b329d52bb83b0047d5241ca25ec74f9c57b62399f254404ee825 |
| src/commands/file/shared.ts | fa4d86f5cc1eb3a642aac34845737566c89e2b2b4983ec21a111441c3b94f87a |
| src/commands/file/classify.ts | fcdee375d2f97afae9d8dc6a23eff64440258aea0a8c2adff7b2968875bc6535 |

`text-bound-original.tap` records the initial11 tests: 0pass/11fail. Ten exposed
the reported source gap. The last was an author assertion defect: the expected
small permission diagnostic accidentally omitted the existing `EACCES: ` prefix.
That exact prefix was restored in the expectation, not removed from the product.
`text-bound-original-corrected.tap` records the same unchanged product with the
corrected expectation: 1pass/10fail. No original input was enlarged or replaced.

Actual failures before the source fix:

- Direct and actual-Shell oversized symlink targets returned success, despite a
  maxInputBytes16 limit and a128-unit control target.
- A backend control-filled EACCES message was fully escaped instead of refused
  by the16-byte input quota. The complete escaped stderr is in the raw TAP.
- MIME-only symlink processing unnecessarily called whole-target replace once.
- Output encoded128 ASCII units before rejecting a16-byte output quota.
- Emergency failure encoded256 UTF-16 units before slicing to17 output bytes;
  that prefix could also split a UTF-8 codepoint (the initial assertion failed
  earlier at the oversized-encoding observation).
- Ten entries ignored cumulative metadata input and text work quotas; repeated
  backend errors also ignored cumulative diagnostic input.
- An oversized argument underwent UTF-8 scanning before its length rejection.

The original text-bound.test.ts SHA256 before the prefix-expectation correction:
ca8bc51d6f0ef12a67b85bf0855452a822e7e0317891abf3a118816826dd4b59.
The initial raw TAP SHA256:
6f7207c374aaed75390cb00aca2c7730ca2bd31ecec1b3bc791c66dc3be5c3c2.
Both raw files are retained rather than relabeled as passing evidence.

The first source fix passed all11 corrected tests. Six additional boundary
checks cover exact UTF-8 output admission, emergency-reserve accumulation,
metadata UTF-8 costs, MIME readlink error preservation, cancellation during
escaping, and complete long usage diagnostics. An intermediate16/17 result
was a test-instrumentation defect: encoder spying included two empty stdin
setup encodes. Setup was moved before spying; no product behavior or expected
encoding assertion was relaxed.

## Bound argument and regex audit

No new limit fields/default values. Existing maxInputBytes now includes admitted
metadata UTF-8, and maxSteps includes raw argument/escaping/output UTF-16 work.
Output and argument length lower bounds are checked before scans/encodes;
metadata length is checked before codepoint iteration. Every retained escape
piece has output admission. Periodic yields retain cancellation responsiveness.
See the product README for the explicit cumulative64-unit terminal-diagnostic
reserve when normal work is exhausted; it cannot authorize normal processing.

All product regexes are trusted constants, with these actual input bounds:

| Regex use | Input bound in command execution |
| --- | --- |
| PDF header test | at most16 ASCII bytes |
| tar NUL cleanup and octal checksum test | at most8 ASCII bytes |
| JSON object/array prefix test | decoded admitted maxSniffBytes sample |
| control/format/line/paragraph character escaping | exactly one codepoint, at most2 UTF-16 units |

The old global replace over backend text is removed. There is no dynamic regex
construction or claim that the original expression was catastrophically slow.
The internal classifier still expects a bounded caller-provided sample; command
execution provides that bound and charges sampled-byte work before classification.
No classifier source, native input bytes or MIME profile changed in this fix.

The output builder retains at most bounded per-field pieces, and a final line
contains at most two bounded fields plus fixed formatting. A complete UTF-8
output allocation occurs only after output/work admission. Byte chunking and
awaited writes preserve backpressure; emergency truncation preserves complete
codepoints rather than slicing a pre-encoded unrestricted string.

## Preserved history and remaining boundary

Original d168 MIME counts23/26 and22/26, SQLite-corrected24/26 and23/26, and the
same26 native rows/fixture hashes remain in NATIVE_PROFILE.md/native-baseline.ts.
No native cohort expansion, root/default/export change, FS contract modification,
signal-identity workaround, decompression or product native process was added.

Backend-produced strings and typed error constructors may already allocate
before admission. Host getters/callbacks and upstream buffer allocations are
not sandboxed or retroactively bounded. The correction is an admission/work
bound on command-owned preprocessing, not a whole-process heap or hard-latency
guarantee. Independent replay remains required before public/default integration.
