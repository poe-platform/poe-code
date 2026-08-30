# Independent LET pre-code contract — 2026-08-28

**Sealed expectations, not product acceptance.** Different reviewer from Raman.
Author packet `0bd65cdd8c07dea83ca1c1b1a20c876c59ee4001` ratifies C1–C4.
Poincare released the idle runtime window in `232c2f357a1049cbf096dbef3051445c8f7c476b`;
**root must still authorize Raman's runtime.ts-only implementation**. This freeze
contains no implementation or runtime write. The inspected accepted runtime has
no LET builtin. Stack remains separate docs/pre-code work.

## Author-facing contract

- Ordinary builtin, not registry command or sh special builtin. Function
  shadowing and command bypass work; no plugin-count/API/export change.
- One optional leading `--`; only first preamble `--help` is status2 with the
  ratified exact diagnostic. `--version`, later `--help`, and `-- --help` are
  arithmetic decrement operands. Noargs/lone`--` differs from empty/whitespace.
- **Prepare one complete AST, evaluate it, then advance to the next argument.**
  Invalid `(value=7),1+` performs no write, despite native N10's value7. Earlier
  completed arguments survive subsequent failure; runtime errors retain writes
  already evaluated within the failing argument. Final zero means1, otherwise0.
- Existing arithmetic engine only: checked writes, readonly/OPTIND behavior,
  lazy operators, signed64 wrapping, diagnostic routing and recursive bounds.
  Prefix restoration remains project behavior (N17 outer2, not native8).
- Existing shared command/source/depth/output/per-word/field budgets and
  cooperative operand/admission checkpoints; no new Budget or arithmetic-node
  charging. Caller/control/structural/cleanup outcomes are not ordinary LET1.
  Synchronous parse/BigInt/stack limitations remain explicit, not preemption.
- No arrays, floats, namerefs, host eval, private providers, new dependencies,
  public API or engine rewrite. Ordinary outer expansion happens before LET;
  literal invoke arguments are not shell-reparsed. No hostile host-JS sandbox.

## Frozen coverage

**58 literal executable rows +26 synthetic procedures across all22 families.**
Synthetic procedures include parameter variants and require a versioned executor
sealed before candidate execution; they are not yet executed tests. Worker
syntax and data integrity checks are not behavioral passes.

| Family | Frozen discriminators |
| --- | --- |
| L01 discovery/collision | P01–02, S01 |
| L02 status/last operand | P03–06, P58 |
| L03 arity/options | P07–15, P57 |
| L04 argv/expansion snapshot | P16–18, S02 |
| L05 checked assignment order | P19–20, S03 |
| L06 per-argument AST/no rollback | P21–22 |
| L07 runtime-error partial writes | P23–24 |
| L08 lazy runtime/full syntax | P25–26 |
| L09 bases/overflow/precedence | P27–30 |
| L10 error/cycles | P31–34 |
| L11 readonly | P35–36 |
| L12 actual getopts/OPTIND | P37–39, S04 |
| L13 prefix restoration | P40–41, S20 |
| L14 locals/subshell/invoke | P42–43, S05–06 |
| L15 errexit/ordinary sh | P44–46 |
| L16 rejected syntax/outer expansion | P47–51 |
| L17 shared budgets/output | P52–53, S07–10 |
| L18 forwarded UTF8/fields/recursive reads | P54–56, S11–14 |
| L19 bounded parser/evaluator recursion | S15–17 |
| L20 abort before/during checkpoint | S18–20 |
| L21 caller/control/error identity | S21–23 |
| L22 stdin/owned cleanup/invocation drain | S24–26 |

`CONTROLS.md` freezes source and moved-package admission, existing API positive
typing/two exact negative diagnostics, seven real absent/reversion/mechanism
controls, and bounded cleanup. No guard-only kill may be called a mutant kill.

## Composition and provenance

`BINDINGS.json` independently hashes selected baseline5137 source/build/docs,
accepted **ca1d WebDAV webdav.ts + README.md**, and **accepted464 runtime.ts only**.
No other CD commit contents or moving HEAD are admitted. The author's static
13-shell-file recipe did not include those provider overlays; our complete
selected composition states them explicitly. Arithmetic tests use Memory, not
WebDAV; provider inclusion is package/source provenance, not provider acceptance.
No source contents or Git history are copied into this freeze, only blob/hash
bindings. The future source closure is selected, not a whole repository archive.

The existing GNU5.3 capture contains **28 observations**, not28 product passes.
Its exact pinned binary is
`8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c`, Darwin arm64.
Bindings retain its scripts, raw rows, provenance and original supervisor syntax
failure. Native N10/N17/help/arrays and project wording differences remain
separate; new neighboring scripts are **not** mislabeled native-observed.
No native rerun, build, product import/execution, private access or full gate
occurs here. Any later failure is retained before fixture corrections.

`node tests/shell/let-independent-20260828/verify.mjs` checks this pre-code seal
and external historical bindings without executing Bash or product modules.
