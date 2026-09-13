# Lexical delivery candidate qualification

The delivery candidate contains seven atomic fixes: eval syntax diagnostics, statement-body semicolons, regexp lexical goals/line terminators, unlocated host-stack removal, Unicode excerpt/caret alignment, CLI unlocated origin display, and CLI structured excerpts/supplied diagnostic paths. Every fix was reproduced on the isolated fetched-source candidate before applying its repair. Earlier local module implementation, runtime changes and unrelated commits were not copied into delivery.

Target remains ECMA-262 edition 16, ECMA-402 edition 12, pinned Test262 `419d3e0a2273ba01a3bfcbec423f2801425b8e93`, plus the existing separately tracked newer APIs. Newer Unicode fixture names retain their corpus identity and do not redefine the edition. Standard Script, native module oracle, unsupported committed module execution, and public Agent Script embedding are separated in `final-grammar.json`.

## Maintained verification

- Combined parser/lint/error/eval/replay/CLI integration: 3,023 passed, one opt-in fuzz skip, 173 passing files and one skipped file, exit 0, 48.93 seconds.
- The last CLI-only repair was then verified by 53 passing CLI tests; no parser/runtime source changed after the combined gate.
- Exact final candidate bytes passed the existing repository ESLint configuration. The last CLI-only bytes were checked again. No rules or assertions changed.
- `npm run build:workspaces -- --workspace=@poe-code/safe-js` passed its maintained dependency closure and all eight SafeJS built-import tests. The route reported 23 builds; this number is an observed result, not a hard-coded task selection.
- The final conformance command is identical to the first audit command except for a fresh report path, `final-corpus.jsonl`. Deadlines remain 3,000 ms per variant and 10,000 ms startup, without any budget override. Completed category counts, all nonpasses, runtime, source hash, report hash and exact command are retained in `final-corpus-summary.json`.

These checks reuse installed dependencies. The source corpus is not a clean-installed artifact run; installed registry artifacts and publication provenance must be verified separately after publication.

## Manual runtime controls

`built-runtime-controls.json` records exact commands, versions and output for Node 18.18.0, 20.20.0, 22.23.2, 24.14.0 and Bun. `npm exec --yes --package=node@26 -- node /tmp/lexical-built-controls.mjs` resolved Node 26.8.2, ICU 78.3, and passed the same controls; the resolved version is pinned in its receipt.

To reproduce the controls against built `dist/run.js` and `dist/lint/index.js`:

1. For each LF, CR, CRLF, LS and PS, evaluate `// 😀` followed by that terminator and `const x=)`. Require SyntaxError, `<eval>`, line 2, column 9, UTF-16 offset `prefix.length + 8`, and excerpt `2 | const x=)`. Evaluate the neighboring source ending in `3` and require 3. Reject each literal `/<character-class containing that terminator>/`.
2. Run `let x=8;x/=2;return [x,/=/.test("=")]`; require `[4,true]`.
3. Run `var x;do break;while(0)x=42;return x`; require 42.
4. Check an invalid tagged escape whose raw text is backslash plus `xZ` and whose cooked value is undefined, astral-string UTF-16 length 2, lone surrogate code unit 55296, and hexadecimal separated literal `0xAB_CD` value 43981.
5. Run and lint 1,024 opening parentheses, `1`, and 1,024 closing parentheses, with explicit filename `guest.ajs`. Require bounded rejection with that filename and a header-only error stack. Require shallow `(((1+2)))` to return 3. Native capacity may choose RangeError or the positioned parser guard; neither host stack is permitted.

A real Workerd 2026-09-11 process (`workerd@1.20260911.1`) also passed eval source-coordinate controls for all five terminators and the ASI/regexp/division value controls. Its public Workerd entry was bundled with the maintained neutral/ESM/workerd conditions and `node:*` externals, then served briefly on an explicit loopback socket. No external service, filesystem or guest import binding was granted. The process was terminated after the request. `workerd-controls.json` retains the actual output and command. The compatibility flag notice is informational: nodejs_compat is already default at the pinned compatibility date.

These are focused controls on all listed runtimes, not full Test262 execution on each runtime. Workerd ICU identity was not exposed by the inspected public runtime and is not inferred from Node.

## Visual inspection

The initial Unicode screenshot exposed a real remaining CLI issue: it showed only the syntax message. That image is a failure record, not a visual pass. After the CLI repair, `unicode-verified.png` shows line 1, UTF-16 column 12, the original `const 𐐀 = );` line, and a caret under `)`. The font substitutes a one-column box for the Deseret glyph; the original source bytes and position remain intact. `host-final.png` shows the explicitly supplied fixture filename and error kind, without host frames or fabricated coordinates. `eval-invalid.png` shows the evaluated string's own line 2 and caret. All three successful outputs were visually inspected. The command line's explicitly supplied fixture pathname is distinct from an internal host-stack disclosure.

## Remaining source-origin and corpus work

`current-origins.json` freshly reproduces absent caller/source filenames for eval runtime ReferenceError and Function-created runtime errors. Function's span still includes generated wrapper lines (line 4 for the supplied second-line body). Dump/restored eval-owned executable source reproduces the original error but still lacks its filename. These are unresolved diagnostic requirements, not claimed fixes. Eval SyntaxError now has the correct inner span/excerpt and `<eval>` label; it does not yet identify nested eval callers.

The committed API/runner excludes standard module execution. Native module-oracle acceptance does not qualify imported-source runtime locations, and the mixed workspace's uncommitted resolver is not shipped as part of this task. Missing host/module capability by design is recorded as unsupported rather than an ECMAScript defect.

The large Unicode/comment/regexp fixtures must complete under the existing deadlines. Smaller native differential controls do not replace exhaustive failures. Next work requires profiling the unchanged failing files, preserving budgets and runtime support, then testing any repair before rerunning the pinned corpus. Dynamic origin repair requires an explicit original-source identity/coordinate record shared by compilation, error conversion and snapshot restoration, with separate Function parameter/body and Script/module/embedding tests.

## Delivery and recovery

The ledger and publication receipt distinguish local commits, remote-main ancestry, workflow conclusions and actual registry versions. None is inferred from another. No associated issue number was provided. No package is published locally.

If a required workflow fails, retain its URL/log and diagnose it before a separate tested repair commit. For partial scoped publication, query and smoke each of SafeJS, SafeFS and Safe Bash independently; verify each tarball integrity and provenance commit. A successor workflow must demonstrably contain the delivered source commits. Retry registry reads or use exact-version metadata when propagation lags; never infer publication from a green build. Recovery is a new GitHub release run at a verified descendant, after repairing the failure, with the workflow selecting fresh versions. Never unpublish, force-push or destructively roll back. Until all required publications have receipts, release remains incomplete.
