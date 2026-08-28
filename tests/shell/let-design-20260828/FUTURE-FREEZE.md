# Author-facing future independent freeze contract

This is a design checklist, **not an executed independent LET cohort** and not
authority for runtime writes. Root must ratify PROFILE C1–C4 and release the
runtime owner first. Freeze exact candidate composition, scripts, inputs,
expected status/bytes/state, negative-control designated predicates and tool
bindings before executing a future candidate. Any literals chosen after source
inspection must be labeled honestly; these native scripts were pre-LET-code.

## Required independent families

| ID | Concrete invariant / distinguishing input |
| --- | --- |
| L01 | Ordinary builtin discovery, `type let`, function shadows it, `command let` bypasses function; registry/default inventory unchanged. |
| L02 | N01 zero/nonzero/negative and multiple-argument last-value status. No zero-short-circuit across argv. |
| L03 | N02–N05 noargs versus empty/whitespace, one optional leading `--`, `-name` and predecrement names; C3 exact help refusal or ratified alternative. |
| L04 | N07 separate arguments not joined, quoted spaces; literal invoke does not perform another expansion pass. |
| L05 | N08 prefix/postfix/compound writes, right-associative chained assignment; single checked store per completed assignment. |
| L06 | N09 earlier argv write survives later failure; no later argv work. C1 N10 malformed single argument leaves value=0 in proposed profile, contrasted with retained native value=7. |
| L07 | N11 runtime failure after `(value=7),1/0` leaves value=7; exact first failure, no tail write. |
| L08 | N12 lazy &&/||/ternary; skipped invalid runtime branch has no write/zero-divide error. Syntax still parsed throughout an argument. |
| L09 | N13/N14/N25 numeric bases, signed MAX/MIN/overflow, shift65, power/unary/assignment precedence; exact 64-bit strings, not JS-number rounding. |
| L10 | Bad octal/base, negative exponent and variable cycles, exact project diagnostics; parser nesting guard versus ordinary evaluator error remains distinguished (C4). |
| L11 | Native N15/N16-style readonly target, RHS side effect retained, locked value/attribute protected, first failure stops. No raw-state workaround. |
| L12 | N24 real getopts cursor reset from arithmetic OPTIND store, local/prefix cursor restoration; readonly OPTIND rejection must not fabricate a successful reset. |
| L13 | C2 N17 proposed outer value=2 and other=8 after success; also error/abort restoration with unrelated earlier assignments preserved. |
| L14 | N18 locals/shadowing and N19 subshell isolation; actual context.invoke child-state isolation, literal argument validation and no command reparse. |
| L15 | N20 errexit, conditional/AND-list suppression, zero status; sh-profile ordinary builtin must not become special/fatal merely by adding its name. |
| L16 | N22 forbidden arrays, floats, literal shell text N23 rejected without side effects; actual outer expansion remains the existing Shell behavior. |
| L17 | Shared maxCommands, maxSourceBytes, maxSubstitutionDepth and output limits retained across invokes; no new/reset Budget or one command tick per arithmetic node. |
| L18 | Inclusive maxExpansionFields (command included), per-word/per-operand UTF-8 bytes, forwarded argv admission, NUL; recursively read variable values bounded through existing-limit proxy. Counterexamples distinguish cumulative-argv cap from declared per-word cap. |
| L19 | Existing recursion/AST-visit guards and bounded fixture below/above chosen threshold. No claim to execute arbitrary maximum-byte BigInt work or exhaust host stack. |
| L20 | Pre-aborted root caller identical reason wins before arithmetic mutation. Abort at an admitted operand checkpoint stops future operands and preserves prior committed non-prefix writes. Prove checkpoint activation, not timer timing. |
| L21 | Caller/control reason collision, live handler versus raw invoke observation, and cleanup failure precedence inherit Stage2; never map a same-valued non-control error as cancellation. |
| L22 | LET no stdin reads; outer Shell iterator acquisition/return separately observed. Owned middleware cleanup and child invocation all settle before returned outcome; failure receipts before assertions. |

These are 22 design families, not 22 runs. Pack/moved source identity and public
existing Shell API types are supporting obligations, not new LET exports. Exact
execution count/layout selection belongs in the later independent recipe; do
not run the old metadata/native/default integration cohorts again.

## Meaningful negative controls

Prebind source or adapter mutants to their exact loaded paths and designated
predicate: (M1) raw variable writes bypass readonly/OPTIND; (M2) argv joining;
(M3) eager whole-argv parse or evaluation continuing after error; (M4) last-zero
status inversion; (M5) new Budget/reset counters; (M6) array/host-eval escape;
(M7) prefix restore exception; (M8) swallowed caller/limit/cleanup rejection or
early settlement. Select a bounded subset covering every modified mechanism;
the independent recipe must say which are executed, not equate hash checks with
actual mutant-load activation. Known source dialect differences remain qualified
positive expectations, never use a native mismatch as a reason to weaken them.

## Evidence and boundaries

Exact baseline + accepted CD/stack composition + declared LET delta only;
authenticate input/tool hashes before execution, source and installed/moved
module-load identity, no source fallback, strict bounded child/output ceilings,
per-case resource and integrity settlement before continuing ordinary failures.
Readonly/private provider work unnecessary. No AGENTS copying, new dependency,
whole-history archive, native live network or plugin-count increment. Native
observations in this packet stay native; implementation assertions are new
results, not a rescore of the 28 rows or historical comparison 13/54 vs47/54.
