# CMD-22 successor review preseal — August 28, 2026

**PREPARATION ONLY. NO HARNESS/PRODUCT IMPORTS, CONTROL REPLAY OR PRODUCT EXECUTION.**
The old candidate authorization is consumed. Nothing here permits rerunning
35da, supplies a fresh candidate GO, or changes the recorded actual failure.

## Ready API for the schedule author

Source import path, for use only after separately permitted authentication/import:

`tests/commands/yq-independent-20260828/executor-preparation-v1/runtime-v3-cmd22/adapter.mjs`

Export: `prepareCmd22AssertionAdapter({ assertCaptureSource, contextSource,
integritySource })`, with three explicit authenticated Uint8Array source values.
The required base hashes are in `ADAPTATION.json`. This function has **not run**.
It returns a Map named `files` containing exactly:

- `assert-capture.mjs`: two imports plus one targeted conditional replacing
  only CMD-22's literal-versus-VFS read-path comparison.
- `cmd22-read-paths.mjs`: sealed predicate from `read-path-binding.mjs`.
- `cmd22-binding.json`: exact data bytes from `CMD22-BINDING.json`.

It does not produce a runnable full recipe, write files, import old helpers or
change authorization. All ten other v2 recipe files retain their bound hashes
at this adaptation step. Any later fresh-candidate pin belongs to the separately
authorized integration owner, not to this path-domain correction.

`CMD22-DELTA.diff` specifies the exact three-file future composition delta.
`ADAPTATION.json` binds its input/output hashes. `SOURCE-PRESEAL.json` binds all
source, data, protocol, fixture and static-check bytes; the exact source commit
and diff/predicate/fixture hashes are routed in `/tmp/yq-cmd22-preseal-ready.txt`.
No self-referential commit identity is fabricated inside this preseal.

## What changes, and what does not

The sole affected ID is **CMD-22**. Its argv, file `-name` = `false\n`, frozen
expected tuple and context `/v` are unchanged. The predicate resolves only the
expected literal operand using the exact baseline POSIX resolver profile, then
compares all observed read paths to `['/v/-name']`. Observed paths are not
normalized. Wrong cwd, a matching basename elsewhere and extra reads cannot
match. `job.cwd` is host launch metadata and never a source of virtual cwd.

The fixture context and baseline `src/contracts/path.ts` are authenticated data;
neither was imported. Dot/dotdot/trailing examples are lexical resolver-only
fixtures, not relaxed CMD-22 inputs or real-filesystem behavior claims. Mutating
the command's argv or literal file path still refuses the exact job binding.

V2 raw-before-assert and obligation checks are untouched. Bytes/status/stderr,
read-only effects, rejection/cleanup, signals and unexpected operations remain
under the existing assertions. The ordered read list is still exact. All other
guards, budgets, import policies and assertions remain unchanged. Unknown
obligations remain INCOMPLETE; this is not a general binding implementation.

Static inspection of 194 original records and 149 declared actual jobs found:
- CMD-22: the only affected literal read expectation.
- FS-05: the other explicit read list is already absolute; its unknown prose
  remains unfulfilled and the old FAIL is not waived.
- QUE-07 and FS-01: file-bearing roles/prose remain unchanged, without new proof.
- Literal diagnostic source matching, normalized namespace snapshots and
  pre-input zero-operation predicates retain their distinct domains.

The exact audit is `PATH-ASSERTION-AUDIT.json`. No inventory denominator changes.

## Deferred fixtures and preserved history

`DEFERRED-CONTROLS.json` freezes 31 **unexecuted** controls. `CONTROL-BASES.json`
contains explicitly historical data, not new execution or authorization.
`deferred-fixtures.mjs` exports `prepareDeferredCase(definition, bases, binding)`
and `runDeferredCase({ fixture, originalAssertCapture, successorAssertCapture,
predicate, catalogue, evidence })`. Neither function has been called. A future
driver must first receive replay permission, authenticate the real predecessor
and successor callbacks, and save raw inputs before assertion invocation.

The controls cover old/new literal/resolved contrast, wrong cwd/sibling/extra or
missing read, mutated input paths, absent bindings, preserved bytes/status/
effects/signal/operation assertions and unknown obligations. Resolver-only cases
use only the inspected profile. Every invocation checks that input/receipt/
binding and event order were not mutated by its assertions.

`HISTORICAL-BINDINGS.json` records exact commits, Git blobs/modes and raw SHA-256
for predecessor source `7add5d2c0a3acb27483ba0bb5dd52385812d8ed7`, evidence
`70fa3df66f9c8dc3f972cfa8c0c5862d77d7514e`, runtime-v2 recipe seal
`fc273904cf20f4a717bb7350bb46046bbee16617aee371bcfd03e38d98920f15`, CARRY/baseline
and actual review `4b219eae180fcd2fd15ea864c9bc5226c54cda04`. The original
F-ACTUAL-02 review and CMD-22 input/expected/raw/verdict tuple remain immutable.
The correct `/v/-name` product read is not labeled a product filesystem defect.

## Required next bindings

Independent static review comes next. Any later runtime activity needs separate
permission; fresh candidate GO requires a new candidate commit, selected source
map/tree, package map/tree/entry and source-to-output evidence, a complete new
recipe seal, and a new root execution envelope. Old source/package receipts or
the consumed execution authorization do not confer that authority. This adapter
does not modify or relax the old authorization module to make a candidate run.

`STATIC-CHECKS.json` distinguishes data/hash/syntax/specification inspection
from execution. **Harness controls run: 0. Product runs: 0. Pass claims: 0. GO: no.**
