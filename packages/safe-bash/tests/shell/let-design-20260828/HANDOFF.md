# LET design-only handoff

**Ready for root profile decisions; implementation remains HELD.** Ownership is
only `tests/shell/let-design-20260828/**`; Poincare owns the runtime window.

- Pre-native seal: `cd1926ba`; active manifest SHA256
  `f47b59eee0c8072334788bed76bb969969a4a2e4ca5d1e21c6686c9df9483d10`.
- Selected source: exact `5137a74e` plus only CD `4641075d` runtime blob.
  All13 shell files bound; other12 identical. Whole464 tree contains unrelated
  changes and is deliberately NOT adopted. Root's qualified CD acceptance via
  `192ab78b` is acknowledged, not treated as still under review.
- **One native run, 28/28 observations captured, all28 children/groups closed
  naturally, 0 unexecuted, 3,558 raw bytes, PRE/POST guards passed.** Exact Bash
  SHA256 `8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c`;
  actual5.3.0(1)-release/aarch64-apple-darwin25.4.0. Startup disabled, C locale,
  empty PATH, owned empty HOME/TMPDIR, no external commands/network. Script
  exits27zero/1one reflect deliberate errexit, not a product pass score.
- Reuse `prepareArithmetic`/`evaluateArithmetic` and checked variable Proxy;
  ordinary builtin, one expression per argv, last-zero=>1, left-to-right,
  first failure stops. Only proposed production path: `src/shell/runtime.ts`.
  No parser/arithmetic-engine/type/plugin/default-count change or new Budget.
- **Two material root choices:** native malformed single-argument expression
  preserves an early write, while existing AST-first parser would not; native
  prefix `value=7 let 'value+=1'` leaves8, while current runtime restores2.
  Recommend retaining both existing project behaviors, explicitly qualified.
- Also ratify precise `--help` exclusion (proposed status2, command diagnostic)
  versus fixed project help; keep `--version` an arithmetic predecrement, not
  a version option. Preserve structural syntax/limit/control error routing.
- Existing64-bit arithmetic/64 nesting/64 variable recursion/10,000 AST visits
  per evaluator call reused. Shell field/byte/source caps are not a new hard
  CPU/stack/preemption bound. Recommend existing-limit recursive-value read
  guard and per128-operand cooperative checkpoints, runtime-only.
- Checked readonly policy stays; direct native LET rows protect readonly values
  but retain RHS effects. Stronger getopts/CD differences remain qualified.
  Arrays/floats/namerefs/hosteval/new grammar excluded. Native cannot establish
  asynchronous caller cancellation or cleanup semantics.

See `PROFILE.md` for exact source locations/C1–C4 and `FUTURE-FREEZE.md` for22
future independent families and bounded mutant obligations. Preparation-only
supervisor syntax failure and obsolete unexecuted manifest are preserved;
corrected scripts were sealed before Bash. No product/runtime edits or loads,
no private writes, no native/full-gate acceptance or historical rescoring.

**Next blocker:** root ratifies profile choices and releases the runtime owner;
then a DIFFERENT independent literal freeze can precede implementation.
