# #561: incremental yq inline balancing

## Scope and validation

- Baseline: current main `86dc63e08`, including `fc6fe8bca` (#592 parse-depth
  admission). Inspected root and safe-bash AGENTS before changes.
- Own only `packages/safe-bash/src/commands/yq/parser.ts`, the existing
  `packages/safe-bash/tests/commands/yq-author-20260828/yq.test.ts`, and this plan.
  No README, registry, shared accounting, #562 files, or build changes.
- Reconfirmed `BlockParser.#inlineOrBlock` rescanned accumulated source through
  `#quotesBalanced` and `#inlineBalanced` before/between/after continuations,
  without balancing work charges or cancellation checkpoints.
- Prior `3dee` evidence reported 8,452 / 33,284 / 132,100 / 526,340 visits at
  64 / 128 / 256 / 512 lines. These are historical measurements, not a fresh
  current-tree benchmark. Current-tree RED tests independently demonstrate the
  missing balancing work, shared-budget exhaustion, and cancellation checks.
- The exact million-line runtime allegation is not validated: preliminary
  scanning reaches the existing one-million-step budget first. No timing or RSS
  claim is made here, nor a whole-parser linearity guarantee.

## Implementation

1. Preserve quote, escape, bracket-depth, and previously-negative-depth state
   throughout one inline value. Visit each new fragment once rather than
   rescanning the accumulated prefix.
2. Keep inserted newlines in the scanned continuation fragments, including their
   consumption of a pending double-quoted escape. Adjacent single quotes toggle
   out of and back into single-quote state with no intervening delimiter work,
   preserving doubled-quote behavior across charge boundaries.
3. Remember negative depth but keep the original whole-source quote gate: an
   earlier negative depth only completes balancing once all quotes close.
4. Precharge at most 256 UTF-16 code units through existing owned work per scan
   batch, then assert openness. Each continuation gets its own charged fragment;
   long lines have bounded batches. Existing shared work supplies actual yields.
5. Collect fragments and join once before FlowParser. Leave comment handling,
   syntax positions, scalar projections/admission, collection depth admission,
   preliminary validation, and all cap constants unchanged. Newly accounted
   balancing work intentionally consumes the existing shared step allowance.

## TDD and focused verification — September 4, 2026

- Initial RED: `/tmp/kamilio-561-red.log`, 60 tests, 51 pass / 9 fail.
  Four linear-accounting cases observed zero balancing charges instead of
  129 / 257 / 513 / 1,025 units; shared-budget and four false/null cancellation
  cases reached syntax failure instead of the required limit/caller reason.
  Existing semantic and #592 depth controls passed.
- Initial GREEN: `/tmp/kamilio-561-green.log`, 60/60 pass.
- Strengthened GREEN: `/tmp/kamilio-561-adjacent-green.log`, 81/81 pass, no skips.
  Source routes (package-local `node --import tsx --test --test-concurrency=1`):
  - `tests/commands/yq-author-20260828/yq.test.ts` (66 tests).
  - `tests/commands/yq-author-20260828/repair-allocation-v1/repair.test.ts`.
  - `tests/commands/structured/resources.test.ts`.
- Instrumentation uses the existing owned-work method and yield-checkpoint hook:
  exact linear unit sums, positive batches no larger than 256, per-continuation
  checkpoints, real work yields both between lines and within long lines, original
  false/null abort identity, and no node admission for incomplete balancing.
  Controls retain quoted delimiters, doubled quotes at batch boundaries,
  newline escapes, existing comment behavior, negative-depth quote gating,
  malformed positions, allocation ordering, and #592 exact-depth limits.
- `/tmp/kamilio-561-scoped-types.log`: zero diagnostics from a no-emit TypeScript
  program rooted only at the two owned TS files, using safe-bash compiler options
  and cwd. Node 22.22.0, npm 11.19.1, TypeScript 5.9.3; compiler program resolves
  `packages/safe-bash/node_modules/@types/node/index.d.ts` (22.20.1).
  This is a scoped source check, not the maintained typecheck or consumer gate.
- Commands use the supplied isolated toolchain and private TMPDIR, unset NO_COLOR,
  set TSX_DISABLE_CACHE=1, and clear `git rev-parse --local-env-vars` only within
  the unit child subshell. All exec requests use require_escalated.

## Handoff and limits

- Implementation and focused verification complete; writes frozen after this
  handoff document and final whitespace/hash inspection. Root receives an explicit
  freeze notice before its gates; no additional edits without coordination.
- No full build, repository gate, maintained package typecheck, stage, commit,
  push, or release performed by this leaf. Root owns release monitoring and
  integrated gates; successful focused source checks are not release evidence.
