# Released surface cohort: bounded result

August 27, 2026. **No owned-output/cleanup authority was observed on the exact
supported surfaces probed. This is not a universal non-leak or security claim.**
There is one retained frozen-assertion failure, not an 8/8 acceptance.

Inputs remain at `5645b4f516438b66e4fad32a585ab27cda8f7cdc`, with commit-check
`c0d3cb8b21987ca5ac3d63e110825ecea7748f8a`. Runner
`5d2c2f93d794b2a52d56ee503119052a5fefe1fd` was committed before the first guest.
The independent receipt authority is `07a7dae5` plus report-only `db139ae9`.
Eight unconditional guests ran **once each**; case 09 did not run because its
exact host-authority premise was absent. No source, guest, expectation, budget,
or original failure was changed; no case was retried.

## Counts and exact results

- Executed: **8**. Unchanged runner assertions: **7 PASS, 1 FAIL, 0 BLOCKED,
  0 parser-invalid classifications**. All children entered the actual engine.
- Supported-surface validity: **6 valid cases, 6 pass, 0 fail** (01–06).
- Case 07 is **one matching dialect profile**, not membrane acceptance.
- Case 08 is **one unsupported-operation probe, invalid as capability-denial
  evidence**, with the original runner failure retained. This semantic label
  does not rewrite its raw FAIL or claim an actual parse failure.
- Thus seven fixtures yield their complete intended observations (six surface
  plus one profile); the eighth has the observer limitation described below.
  Conditional authority proof: **0 executed / not a pass**.

| Case | Observed public status/output | Interpretation |
| --- | --- | --- |
| 01 | 7; stdout `stdio:surface-input\|vfs\n`; empty stderr | Actual stdin, stdio, VFS and command positives; `/work/out` contains `surface-input\|vfs` |
| 02 | 0; empty stdout/stderr | Direct namespace, data and callable rows exactly match the frozen fields |
| 03 | 0; stdout `namespace-ok\n`; empty stderr | Actual namespace spread/assign and nested aliases work; all three callable-identity checks true |
| 04 | 0; stdout `shell-positive`; empty stderr | Supported explicit shell module, its spread copy and whitelisted result work; same exec identity true |
| 05 | 0; no output/effects | `memberType="undefined"`, `callbackCalls=0`, exact caught non-function diagnostic |
| 06 | 0; no output/effects | `memberType="undefined"`, `startCalls=0`, `releaseCalls=0`, exact caught non-function diagnostic |
| 07 | 0; no output/effects | Supported reflection positives match; unavailable helpers remain unavailable |
| 08 | 1; empty stdout; `safejs: Cannot spread function into object literal.\n` | Unsupported function spread, not namespace spread; raw FAIL retained |

The exact strings, UTF-8/base64 output, return values, effects and errors are in
each `raw/<case>/actual.json`; the table uses escaped LF notation. All cases
preserve the initial VFS bytes/namespace except the single intended case-01
file. Cases 05/06 return `Attempted to call a non-function value.` and measured
local zero callback counters; successful command status alone was not accepted.

### Case 08: retained observer/result-premise failure

The command settles without rejection with the exact frozen exit code, stdout,
stderr and cleanup markers. The observer logs `actual-engine-run-start`, but
does not log `actual-engine-run-settled` or an `engine` result. Its code records
only a resolved `run` result, not a rejection. Therefore the frozen assertions
for `engine.ok === false` and `engine.error.message` fail as **missing actual
fields**, not as observed false/mismatched messages. The original raw assessment
contains those two failures. There is no fabricated engine error object or stack.

Source review of the authenticated copied interpreter finds an explicit
TypeError throw for spreading a sandbox closure; the public SafeJS definition
catches errors and emits that diagnostic. Together with the observer events and
public output, this supports the inference that this run rejected rather than
returning the assumed error-result shape. The engine rejection itself was not
separately captured by this observer. This is a frozen fixture/observer-premise
limitation and an unsupported operation, not a newly established product leak.
No correction or fresh guest execution was performed to turn the result green.

## Exact surface and host premise

The 25 shape rows are the frozen 12 direct rows, nine nested/copy/callable rows,
and four shell/result rows. Every row reports keys, entry types, and individual
`typeof`/`Object.hasOwn` observations for `ownedOutput`, `consumerClosed`,
`write`, `acquire`, `child`, `close`, `registerCleanup`, `output`, `signal`,
`context`, `__proto__`, `prototype`, and `constructor`.

Direct rows cover command/stdio/fs namespaces; command args/env; fs constants;
command.setExitCode; stdio.readText/write/writeBytes; fs.readFile/writeFile.
The alias rows cover nested real command/stdio/fs namespaces; spread command
and stdio copies; an Object.assign fs copy; the stdio write alias; and command
setExitCode.call/apply. Shell rows cover its real namespace, spread copy, exec
callable and returned stdout/stderr/exitCode object. They do not stand for every
FS method, arbitrary guest object, or arbitrary host injection.

All 300 non-write sensitive-field type observations are `undefined`; `write`
is the expected real function on the three stdio namespace rows and undefined
on the other 22 rows. The matching own-property rows retain those three true
stdio-write positives, not an all-false shortcut. Function `call`/`apply` are
supported methods, not raw host authority. Keys and allowed entry types match
the frozen tables. `OBSERVATIONS.json` retains this count derivation.

Each invocation receives actual metadata from public `createBytePipe` through
the real Shell capture/budget sink. The consumer signal identity matches that
public pipe; metadata keys are `consumerClosed,write`. The real TEMP operation
has exactly `acquire,child,close,output,registerCleanup,signal`, its signal is an
AbortSignal, and its output has only `write`. Real host acquisition, release,
cleanup and child-cleanup counters each equal one. The unchanged actual SafeJS
definition receives only the documented host adapter's replacement stdout;
no raw context, operation, metadata or host control callback is granted to guests.
These finite witnesses are not the companion worker's lifecycle acceptance.

Host descriptor/prototype inspection finds no facade property identical to the
known privileged context/metadata/operation functions or objects. This host-only
inspection is distinct from guest reflection. The copied host bridge can copy
own function-valued data properties of injected callables; empty function-key
enumeration alone would therefore be insufficient. Direct named-member probes
and the unchanged facade construction matter here. This result does not cover
future properties or different injected host bindings.

Guest Reflect, Object.getOwnPropertyDescriptor(s), getOwnPropertyNames/Symbols,
and getPrototypeOf are unavailable in case 07. They were not called and are
not reported as successful descriptor/prototype membrane tests. Guest namespace
spread is positively exercised in 03/04; forbidden function spread in 08 is a
different operation and supplies no non-leak proof.

## Identity, guards, and closure

The prototype remains Q1 evidence `e57b5aa1`, archive SHA256
`a3b9aa6fcb4596e8281de2c30943b98baa01449941c8368401d1172bce95d420`,
with 213 source files at manifest SHA256
`6de9b96c7286cc320379d8f7f720f3d1a5ecffdc24b7268b198859550362feea`.
All 940 candidate and 709 actual public-copy package files match. The 708 emitted
artifacts retain manifest SHA256
`2578b6ea39cfdeb5b942b9aff20ec9bfff1fcf907cd2af751d8e73f5c24e632f`.
There was no build/install here. The base's three accepted historical dirty
files remain qualified; live product changes are recorded separately, not used.

Actual private source is freshly copied from HEAD
`bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e`, not an old upstream patch. Every child
loads 223 audited file modules: 63 exact copied private TS sources, 158 copied
public JS files, one copied TypeScript compiler and the owned child. Node
builtins are outside that file-module count. The frozen loader itself is
separately hashed. This is actual source-hook injection through supported public
product hooks, **not** private installed-package/barrel acceptance. Source bytes
are unchanged; transpilation is in memory using authenticated copied TS 5.9.3.

Fresh private HEAD/tree/index/status/staging, six metadata files and all 264
eligible regular engine files are equal before/after, including mode/mtime/ctime.
Index SHA256 remains `2dc2ac516c19864f952c493eb39374db1a2946f359d31dfb6fd02a5fccfb6bc2`.
Complete copied-input and selected shared-tree walks also match before/after and
detect added entries. Private engine walks exclude the five documented cache/
build/tool directory names; no append-proof claim extends into those exclusions
or to the entire private checkout. No private source bytes are committed.

All eight owned Node 22.22.2 children close naturally with native status 0;
guest command status 1 in case 08 is separate. Each had a fixed 10-second
deadline within the fixed 100-second cohort deadline. No timeout, output-limit
kill, worker or esbuild service was needed. Parent-alive records follow every
child, including case 08; every known child is reaped. Final child resource
observations contain only the output pipe/socket, followed by natural exit.
Operation, pipe, collector and Shell disposal settle with no cleanup failures.
Caller/operation/consumer signals remain unaborted; the SafeJS runtime signal
has its ordinary terminal native AbortError. No forced-cancellation case or
synthetic abort-reason override was added. Scratch removal is recorded separately
in `CLOSEOUT.json` after exact evidence-copy verification.

Production gate 8670, env-S/Faraday work, prior audit scores, original first-read
1/5 versus 0/5, API-opt-in 5/5, and native parity claims remain separate. No
companion lifecycle expectations were read. This bounded review stops here.
