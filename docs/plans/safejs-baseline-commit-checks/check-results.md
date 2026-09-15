# SafeJS baseline check receipts

Evidence report only; no source/test/config repairs. Candidate `d126d355c150a076e6c5d5f110162289c57ed1c9`; Darwin arm64, Node **22.23.2**, ICU **78.2**, V8 **12.4.254.21-node.56**, CLDR **48.0**, timezone data **2026a**, LANG `en_US.UTF-8`, TZ unset. Optional test profiles remained unset; budgets, assertions, runtime support and timeouts were unchanged. This report does not establish remote delivery or publication.

## Same-candidate baseline receipt verification

The maintained baseline began 2026-09-12 00:50:46 UTC and its complete check sequence ended **2026-09-12 01:20:37 UTC**. At 01:22 UTC, this audit independently verified all **24** SHA-256 entries in that run's completion manifest, including terminal logs, exit sidecars and full package JSON, and all **11** exploratory source hashes in its environment manifest. Both runs have the identical source SHA above. `git diff --name-only HEAD -- packages/safe-js package.json package-lock.json scripts vitest.config.ts tsconfig.json` reports only the preexisting SafeJS README modification; the earlier initial-status receipt also reports only that documentation change in this scope. No tracked SafeJS implementation, maintained tests, manifest, lockfile or checked build/test configuration differs from the pinned source. The eleven exploratory files remain untracked and byte-identical. Runtime versions are identical. This is reuse of inspected same-candidate terminal receipts, not a new full gate invocation or an assumption that old release results still apply.

A redundant package invocation started at **01:22:06 UTC** was deliberately terminated with SIGTERM after the above equivalence checks; its terminal status is **143 (cancelled, not passed)**. It contributes no suite totals. No other process was stopped. The full original gate observed an independent preexisting Vitest process in another checkout, so its elapsed timings are not exclusive-CPU measurements. No repository-local Git hook variables from `git rev-parse --local-env-vars` were set in this shell.

## Maintained gates and fresh focused checks

| Check                                               | Command                                                                                                                                                                   | Terminal result                                                                                                                                                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Inspected full maintained package baseline          | `npm test --workspace=@poe-code/safe-js -- --reporter=default --reporter=json --outputFile.json=docs/plans/safejs-baseline-final-audit/checks/package-test.json`          | **Exit 1**; 29,013 passed, 7 failed, 47 skipped; 1,309 passed / 2 failed / 2 skipped files; 1366.26 seconds                                                                                            |
| Inspected selected maintained build closure         | `npm run build:workspaces -- --workspace=@poe-code/safe-js`                                                                                                               | **Exit 0**; SafeJS postbuild 7 passed, 0 failed/skipped                                                                                                                                                |
| Inspected maintained root lint                      | `npm run lint`                                                                                                                                                            | **Exit 0**; ESLint, type contracts, workflow lint; 11,462 configured/linted files, zero errors/warnings; 2,041 ignored files, 38,948 unconfigured files, 195 ignored directories, five held boundaries |
| Fresh exploratory reproduction, 01:22:54 UTC        | `npx vitest run packages/safe-js/src/interp/globals/iso-month-name-completeness.test.ts packages/safe-js/src/interp/promise-import-properties.test.ts --reporter=verbose` | **Exit 1**; 7 failed / 13 passed, 2 failed files, no skips; 2.08 seconds                                                                                                                               |
| Fresh selected Test262, command below               | Maintained conformance command                                                                                                                                            | **Exit 1**; 18 files / 35 variants; 32 passed, 0 failed, 3 unsupported                                                                                                                                 |
| Fresh newer Temporal extreme Test262, command below | Maintained conformance command                                                                                                                                            | **Exit 1**; 3 files / 6 variants; 0 passed, 6 failed, 0 unsupported                                                                                                                                    |
| Fresh native/built ISO and Promise controls         | `node --input-type=module` with procedure below                                                                                                                           | **Exit 0**, all 12 native/built ISO/Gregorian comparisons and guest-symbol/boundary assertions passed                                                                                                  |

Lint exclusions are not conformance passes. Whole-repository `npm test` was not run or replaced by root-only tests; this documentation baseline selected the maintained SafeJS package route and its declared build closure. No visual CLI change exists; screenshot QA is inapplicable. Final document-only checks belong to the canonical ledger commit receipt.

## Tracked versus exploratory partition

| Discovered partition of the complete maintained invocation | Files passed / failed / skipped | Assertions passed / failed / skipped |
| ---------------------------------------------------------- | ------------------------------- | ------------------------------------ |
| Tracked                                                    | 1,300 / 0 / 2                   | 28,904 / 0 / 47                      |
| Untracked exploratory                                      | 9 / 2 / 0                       | 109 / 7 / 0                          |

This is a partition of the inspected completed invocation, not an independent tracked-only test run. Exploratory fixtures are neither shipped regressions nor new task-owned code. All seven fresh narrow failures are identical to the complete baseline failures:

- `packages/safe-js/src/interp/promise-import-properties.test.ts` — imports user symbol properties without exposing host promise metadata
- `packages/safe-js/src/interp/globals/iso-month-name-completeness.test.ts` — retains the standalone ISO month for en-US with long width
- `packages/safe-js/src/interp/globals/iso-month-name-completeness.test.ts` — retains the standalone ISO month for pl-PL with long width
- `packages/safe-js/src/interp/globals/iso-month-name-completeness.test.ts` — retains the standalone ISO month for ru-RU with long width
- `packages/safe-js/src/interp/globals/iso-month-name-completeness.test.ts` — preserves both ISO month names and sources in a en-US range
- `packages/safe-js/src/interp/globals/iso-month-name-completeness.test.ts` — preserves both ISO month names and sources in a pl-PL range
- `packages/safe-js/src/interp/globals/iso-month-name-completeness.test.ts` — preserves both ISO month names and sources in a ru-RU range

The six ISO failures demand standalone/range `long` month names for en-US/pl-PL/ru-RU. Native ICU and built SafeJS both yield empty standalone long ISO month parts for these locales; neighboring ISO short and Gregorian long/short controls include month parts. This is a reproduced backend limitation requiring ECMA-402 locale-data qualification, not a blanket ECMA-262 language defect. The Promise failure expects a user symbol on an imported native Promise; current string-descriptor-only admission deliberately omits that symbol. Guest-created Promise symbol access and reflection work. Native authority admission must be reviewed explicitly before any broadening.

The prior tracked public-input qualification timeout (`C-INPUT-PROJECTION`) did not recur in the complete same-candidate gate: raw public-input case passed in 386ms with the existing 5000ms timeout; original/completed-replay neighbors passed. Historical failure stays visible; no timing root cause or repair is claimed.

## Every skipped assertion

These are exclusions, not passes: 33 filesystem reference gaps, 7 native Temporal structured-clone controls, 4 native Temporal Instant controls, 2 native Math.f16round controls and 1 opt-in parser fuzz. Exact skipped names follow, grouped by maintained file.

`packages/safe-js/src/modules/fs.conformance.test.ts`

- fs module conformance against real node's recorded truth reference gap — memfs blames the open rather than the read and names the path node omits: readFile on a directory is blamed on read, which names no path
- fs module conformance against real node's recorded truth reference gap — memfs blames rm, the fs function, where node blames the unlink it refused: rm of a file in a write-denied directory is blamed on unlink
- fs module conformance against real node's recorded truth reference gap — memfs blames copyFile, the fs function, where node blames the lower-cased syscall: copyFile with COPYFILE_EXCL onto an existing path is blamed on copyfile
- fs module conformance against real node's recorded truth reference gap — memfs blames utimes, the fs function, where node blames the utime syscall: utimes on a missing path is blamed on utime
- fs module conformance against real node's recorded truth reference gap — memfs returns the requested path rather than the first directory created: mkdir recursive returns the first directory it created
- fs module conformance against real node's recorded truth reference gap — memfs returns the requested path rather than the first directory created: mkdir recursive returns the first directory created below an existing parent
- fs module conformance against real node's recorded truth reference gap — memfs returns the requested path rather than the first directory created: mkdir recursive returns the first directory it created as the path was spelled
- fs module conformance against real node's recorded truth reference gap — memfs blames the missing parent rather than the path mkdir was given: mkdir non-recursive with a missing parent rejects with ENOENT
- fs module conformance against real node's recorded truth reference gap — memfs blames the file segment rather than the path mkdir was given: mkdir non-recursive through a file segment rejects with ENOTDIR
- fs module conformance against real node's recorded truth reference gap — memfs forgives an existing file when mkdir is recursive and resolves: mkdir recursive on an existing file rejects with EEXIST
- fs module conformance against real node's recorded truth reference gap — memfs blames stat where node's rm lstats the path first: rm on a missing path without force rejects with ENOENT
- fs module conformance against real node's recorded truth reference gap — memfs blames stat where node's rm lstats the path first: rm force through a file segment still rejects with ENOTDIR
- fs module conformance against real node's recorded truth reference gap — memfs raises a plain Error and prefixes the code to node's message: rm on a directory without recursive rejects with ERR_FS_EISDIR
- fs module conformance against real node's recorded truth reference gap — memfs raises a plain Error and prefixes the code to node's message: rm force on a directory without recursive still rejects with ERR_FS_EISDIR
- fs module conformance against real node's recorded truth reference gap — memfs follows the link and refuses it as a directory instead of unlinking it: rm on a symlink to a directory unlinks the link
- fs module conformance against real node's recorded truth reference gap — memfs stats through the link and reports the missing target as ENOENT: rm on a dangling symlink without force unlinks the link
- fs module conformance against real node's recorded truth reference gap — memfs ignores the read-only flag and appends where node refuses the write: appendFile with flag r rejects with EBADF
- fs module conformance against real node's recorded truth reference gap — memfs blames open with the directory the link resolved to where node blames a pathless read: readFile through a symlink to a directory rejects with EISDIR
- fs module conformance against real node's recorded truth reference gap — memfs recurses through the cycle instead of answering ELOOP: readFile through a symlink loop rejects with ELOOP
- fs module conformance against real node's recorded truth reference gap — memfs recurses through the cycle instead of answering ELOOP: stat through a symlink loop rejects with ELOOP
- fs module conformance against real node's recorded truth reference gap — memfs recurses through the cycle instead of answering ELOOP: realpath through a symlink loop rejects with ELOOP
- fs module conformance against real node's recorded truth reference gap — memfs names the copyFile function where node names the copyfile syscall: copyFile with COPYFILE_EXCL onto an existing destination rejects with EEXIST
- fs module conformance against real node's recorded truth reference gap — memfs names the copyFile function where node names the copyfile syscall: copyFile onto itself with COPYFILE_EXCL rejects with EEXIST
- fs module conformance against real node's recorded truth reference gap — memfs opens the source and refuses it as EISDIR where darwin's copyfile answers ENOTSUP: copyFile where the source is a directory rejects with darwin's own code
- fs module conformance against real node's recorded truth reference gap — memfs blames the destination it opened where node blames the source and reports the destination as dest: copyFile where the destination is a directory rejects with EISDIR
- fs module conformance against real node's recorded truth reference gap — memfs raises a plain EISDIR where node raises its own ERR_FS_EISDIR: cp non-recursive on a directory rejects with ERR_FS_EISDIR
- fs module conformance against real node's recorded truth reference gap — memfs raises a plain EEXIST where node raises its own ERR_FS_CP_EEXIST: cp with errorOnExist and force off onto an existing file rejects with ERR_FS_CP_EEXIST
- fs module conformance against real node's recorded truth reference gap — memfs raises a plain EINVAL blaming the source where node raises ERR_FS_CP_EINVAL blaming the destination: cp of a directory into itself rejects with ERR_FS_CP_EINVAL
- fs module conformance against real node's recorded truth reference gap — memfs replaces the directory with the file instead of refusing it as EISDIR: rename of a file onto an existing directory rejects with EISDIR
- fs module conformance against real node's recorded truth reference gap — memfs replaces the file with the directory instead of refusing it as ENOTDIR: rename of a directory onto an existing file rejects with ENOTDIR
- fs module conformance against real node's recorded truth reference gap — memfs overwrites the non-empty directory instead of refusing it as ENOTEMPTY: rename of a directory onto a non-empty directory rejects with ENOTEMPTY
- fs module conformance against real node's recorded truth reference gap — memfs hard-links the directory instead of refusing it as EPERM: link where the source is a directory rejects with EPERM
- fs module conformance against real node's recorded truth reference gap — memfs blames the missing parent rather than the path it was given, and names no syscall in the message at all: writeFile into a missing directory rejects with ENOENT

`packages/safe-js/src/parse/fuzz.test.ts`

- parse fuzz handles deterministic random sources without parser crashes

`packages/safe-js/src/interp/structured-clone-host-instant.test.ts`

- rejects native host Instant in structured cloning: direct
- rejects native host Instant in structured cloning: record
- rejects native host Instant in structured cloning: array
- rejects native host Instant in structured cloning: map
- rejects native host Instant in structured cloning: set
- preserves ordinary native Instant imports and aliases
- rejects native Instant without reading own accessors

`packages/safe-js/src/interp/temporal-instant-native.test.ts`

- imports native host Instants with exact epochs and aliases
- exports into the native host Instant class when available
- accepts a native Instant as an injected binding
- rejects a forged native Instant without reading its own epoch accessor

`packages/safe-js/src/interp/globals/math-f16round.independent.test.ts`

- Math.f16round independent review matches native on 253,952 half values/tie neighbors

`packages/safe-js/src/interp/globals/math-f16round.test.ts`

- Math.f16round matches native f16round for 16,384 deterministic binary64 inputs

## Pinned conformance reproduction

Corpus `git -C /private/tmp/safejs-baseline-test262-419d3e0 rev-parse HEAD` returned exactly **419d3e0a2273ba01a3bfcbec423f2801425b8e93**. Both fresh commands retained default **3000ms** timeout and empty budget overrides; zero metadata/execution errors. Commands are from repository root:

```sh
npm run test:conformance --workspace=@poe-code/safe-js -- --corpus /private/tmp/safejs-baseline-test262-419d3e0 --report /Users/kjopek/Workspace/poe-code/docs/plans/safejs-baseline-commit-checks/conformance-selected.jsonl --include built-ins/Array/of --include language/module-code/early-dup-export-dflt.js --include built-ins/Atomics/wait/cannot-suspend-throws.js
npm run test:conformance --workspace=@poe-code/safe-js -- --corpus /private/tmp/safejs-baseline-test262-419d3e0 --report /Users/kjopek/Workspace/poe-code/docs/plans/safejs-baseline-commit-checks/conformance-temporal-extremes.jsonl --include intl402/DateTimeFormat/prototype/format/temporal-objects-no-time-clip.js --include intl402/DateTimeFormat/prototype/format/temporal-objects-no-time-clip-weekday.js --include intl402/DateTimeFormat/prototype/format/temporal-objects-no-time-clip-non-latin-numerals.js
```

`built-ins/Array/of`: all 16 selected files pass sloppy and strict variants. `built-ins/Atomics/wait/cannot-suspend-throws.js`: sloppy and strict both **unsupported: blocking-mode**. `language/module-code/early-dup-export-dflt.js`: **unsupported: module**. Unsupported variants establish harness exclusions, not ECMAScript failures.

The three Temporal DateTimeFormat files above each fail sloppy and strict with **unexpected-throw** (six failures). This newer API coverage remains separately owned from the published-edition target. The inspected independent edge controls return `RangeError: Invalid time value` for valid minimum `new Temporal.PlainDate(-271821,4,19)`; ordinary `(2000,2,29)` and maximum `(275760,9,13)` format; one day below minimum `(-271821,4,18)` rejects `Out-of-bounds date`. Recording completion is not semantic success. Full corpus and all runtime cells remain unverified by this selection.

## Independent native/built procedure and observed values

Run `node --input-type=module` from repository root, importing `assert` from `node:assert/strict`, `run` from `./packages/safe-js/dist/index.js`, and `deepCopyToSandbox, getPromiseProperties` from `./packages/safe-js/dist/interp/values.js`. For every locale en-US/pl-PL/ru-RU, calendar iso8601/gregory, and width long/short, compare native and built `new Intl.DateTimeFormat(locale,{calendar,month:width,timeZone:'UTC'}).formatToParts(Date.UTC(2000,1,29))` using `assert.deepEqual`. Assert built `ok` is true for each. The 12 comparisons pass. ISO long is `[]` for all three; ISO short month values are `Feb`, `lut`, `февр.`; Gregorian long values are `February`, `luty`, `февраль`, with the same short neighbors.

Execute guest source `const p=Promise.resolve(1),k=Symbol("label");Object.defineProperty(p,k,{value:42,enumerable:true});return [p[k],Reflect.ownKeys(p).includes(k)]`; assert built success and `[42,true]`. Then create native `Promise.resolve(1)` with enumerable string data `label='answer'`, enumerable user symbol data value 42, and separate enumerable private-symbol getter that increments a counter then throws. Inspect `getPromiseProperties(deepCopyToSandbox(p))`: assert own keys exactly `['label']`, string value `answer`, and getter count **0**. Both user/private symbols are omitted. These checks pass current boundary behavior; they do not accept a new admission policy or establish active/retired-context replay coverage.

## Receipt integrity and limits

Raw logs remain local, untracked and uncommitted; their hashes below identify inspected evidence. This report carries the outcomes without requiring raw artifacts to be shipped. Local built checks are not installed-registry-artifact checks, and source baseline results do not constitute a release receipt. Other Node/runtime cells, complete replay qualification, and publication are maintained in the canonical category ledger.

| Receipt                                        | SHA-256                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| Inspected baseline `environment.json`          | `718998d39d9e9e727269a89c3886aef195e692d8d6eb415f4bfb43c6bf015e40` |
| Inspected baseline `package-test.json`         | `7efbc35f433c78ebab76c099d1ac8cc69a8d06a820da29da971e50667d6256c4` |
| Inspected baseline `package-test.log`          | `7022fdfc3d84968e4b50476ec75e053d4575449ff3f7c95d1c61a8c14e7dd22e` |
| Inspected baseline `package-test-summary.json` | `82501449eb359e66c19899a5bd3beb4a72e676fd819bf72f43a98cac202aa9f5` |
| Inspected baseline `build.log`                 | `29718225474f1793c4b151e38b08bea486e2ab7afe0e350b77ec16a6844efa41` |
| Inspected baseline `lint.log`                  | `4bbb787476f37b19fb1d609e5312cf615325efba9356825028e2cff9bd3bb3f3` |
| Fresh `exploratory-iso-promise.log`            | `2c0a70799e5a9a5a65694067fc160a7a363d8ed781a85643daea4ddaf8baf439` |
| Fresh `conformance-selected.jsonl`             | `9cca13ca6f40a6f4d43a7c81354fa0cb0e4917be07fe396ab2082c40f37ce36c` |
| Fresh `conformance-temporal-extremes.jsonl`    | `a3e452212b709cbcedee39b83bededf03d35c606f6f7ac6a47cdef83e6ba8232` |
| Fresh `native-built-controls.jsonl`            | `022cc2465d59cb4b65327752fc7432fa23101be64369ba8aad0a2af1d1db88c6` |
