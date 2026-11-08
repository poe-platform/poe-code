# R21/N04 reconciliation: targeted qualification only

Authorization August 28, 2026. Recipe 0efeb43ece20f2dd55ae1cd5328c6dd3abc5ca08.
Recipe manifest f7fa8110f3141acf6c99cabae2414c449035289de043a5d23023b66cdaa44d51.

Original v5 remains100/104 runtime and32/40 types; R21 is NOT rescored.
P01 accepted v4 proof is BOUND, not rebuilt or repacked. Reader16/repair28/trace38 are reused, not replayed.

## Actual counts

{
  "observations": 16,
  "targetExecuted": 8,
  "targetPass": 8,
  "targetFail": 0,
  "controlsPass": 72,
  "controlsFail": 0,
  "children": 48,
  "naturalChildren": 48,
  "forcedChildren": 0,
  "workers": 0,
  "checks": 98,
  "targetUnrun": 0,
  "observationsUnrun": 0,
  "controlsUnrun": 0
}

## Independent R21 observations

| Layout | Boundary | Original variant | Calls | Wrapper calls | Status | Diagnostic |
|---|---|---|---:|---:|---:|---|
| installed-node22 | public | bad\0arg | 0 | 1 | 1 | "shell: line 1: invoke requires a command and literal string arguments without NUL\n" |
| installed-node22 | direct | bad\0arg | 1 | 0 | 2 | "expr: NUL is not supported in argv\n" |
| installed-node22 | public | lone high surrogate D800 | 1 | 1 | 2 | "expr: argv must contain well-formed Unicode\n" |
| installed-node22 | direct | lone high surrogate D800 | 1 | 0 | 2 | "expr: argv must contain well-formed Unicode\n" |
| installed-node24 | public | bad\0arg | 0 | 1 | 1 | "shell: line 1: invoke requires a command and literal string arguments without NUL\n" |
| installed-node24 | direct | bad\0arg | 1 | 0 | 2 | "expr: NUL is not supported in argv\n" |
| installed-node24 | public | lone high surrogate D800 | 1 | 1 | 2 | "expr: argv must contain well-formed Unicode\n" |
| installed-node24 | direct | lone high surrogate D800 | 1 | 0 | 2 | "expr: argv must contain well-formed Unicode\n" |
| moved-node22 | public | bad\0arg | 0 | 1 | 1 | "shell: line 1: invoke requires a command and literal string arguments without NUL\n" |
| moved-node22 | direct | bad\0arg | 1 | 0 | 2 | "expr: NUL is not supported in argv\n" |
| moved-node22 | public | lone high surrogate D800 | 1 | 1 | 2 | "expr: argv must contain well-formed Unicode\n" |
| moved-node22 | direct | lone high surrogate D800 | 1 | 0 | 2 | "expr: argv must contain well-formed Unicode\n" |
| moved-node24 | public | bad\0arg | 0 | 1 | 1 | "shell: line 1: invoke requires a command and literal string arguments without NUL\n" |
| moved-node24 | direct | bad\0arg | 1 | 0 | 2 | "expr: NUL is not supported in argv\n" |
| moved-node24 | public | lone high surrogate D800 | 1 | 1 | 2 | "expr: argv must contain well-formed Unicode\n" |
| moved-node24 | direct | lone high surrogate D800 | 1 | 0 | 2 | "expr: argv must contain well-formed Unicode\n" |

No native OS argv/NUL parity claim. Observation status is not the old fixture predicate.

## N04 versioned amendment

Only N04 line11,column32 and its combined occurrence use TS2561 rather than TS2353. Exact field maxRegexSteps, type Partial<ExprLimits>, suggestion maxRegexStates and complete diagnostic bytes are mandatory. Other five combined diagnostics are unchanged. Sources, inputs, flags and original evidence are unchanged. New positive TRACE binding controls are separate from8 target outcomes. Forty wrong-receipt mutations are harness negatives, not synthetic product type passes.

## Closure and integrity

Outer natural=true; childStatus=0; finalization=pass; audit=pass. Actual duration 2026-08-28T02:54:58.577Z to 2026-08-28T02:55:47.241Z. No72-hour claim. Full raw receipts precede assertions and exit; package834/input/tool/hash/mode/new-entry guards and actual module-load receipts are retained.

## Remaining holds

Original R21 change requires a further root authorization; any public/direct amendment is a proposal only. Original v5 HOLD, accepted-DU gate HOLD, whole76/fullgate HOLD remain. No engine/TEMP/HTML/DU29/native/full104 replay.


