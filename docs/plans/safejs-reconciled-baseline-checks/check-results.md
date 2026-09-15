# Reconciled SafeJS baseline checks

This receipt belongs to `establish-baseline`. It records fresh checks on reconciled source `7654048d6eb593530e126ddc51df58f26cb384cd`, after merging fetched remote `main` `16fd65559` with baseline `f314e261c`. This checkout contains only tracked SafeJS source/tests; the eleven exploratory test files in the original working directory were neither copied nor adopted. Source changes on remote included SafeJS replay/control behavior, so previous-candidate full-suite results are historical rather than this candidate's result.

After the terminal test result, the merge commit message was amended through the ordinary commit hook to `c9034625c70eaa0aeab8560cceb6b3df04aaa79d`. Both commits have exactly tree `11f8e6564f1c9d637ce6850108a417a86ad5048b`; this is metadata equivalence, not a new test invocation.

Runtime: Darwin arm64, Node **22.23.2**, ICU **78.2**, V8 **12.4.254.21-node.56**, CLDR **48.0**, Unicode **17.0**, timezone data **2026a**. The maintained package baseline began **2026-09-12 01:28:12 UTC** and finished **2026-09-12T01:48:29.862412+00:00**. Repository-local Git variables enumerated with `git rev-parse --local-env-vars` were removed from the child environment; none were set. Optional `SAFE_BASH_TEST_RG`, `SAFEJS_LOCAL_ROOT`, `S3_HTTP_EXPORTS_REVISION`, `FULL_GATE_ROOT`, `SAFEJS_PARSE_FUZZ`, `SAFEJS_ADVERSARIAL_SLOW` and `CI` were unset. No budgets, assertions, runtime support, timeout or worker settings were changed.

## Gate outcomes

| Check                              | Reproduction command from repository root                                                                                                                       | Outcome                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh dependency setup             | `npm ci`                                                                                                                                                        | Exit 0; 784 added / 1001 audited. Nonfatal postinstall skill-sync warning: `ERR_MODULE_NOT_FOUND` for fresh checkout `@poe-code/agent-defs/dist/index.js`, before workspace build. `prepare` ran Husky successfully. npm audit reported 2 moderate / 6 high advisories; no dependency changes made.                         |
| Maintained package baseline        | `npm test --workspace=@poe-code/safe-js -- --reporter=default --reporter=json --outputFile.json=docs/plans/safejs-reconciled-baseline-checks/package-test.json` | **Exit 0**; 1,301 files passed / 2 skipped (1,303 files); **28,932 assertions passed / 0 failed / 47 skipped** (28,979 assertions); 1,209.32 seconds. Pretest passes 25 FS contracts in all four NodeNext/Bundler × Node-only/DOM cells.                                                                                    |
| Maintained selected build closure  | `npm run build:workspaces -- --workspace=@poe-code/safe-js`                                                                                                     | Exit 0; declaration-derived closure 23 builds, 71 workspace inventory, 211 dependency edges, 11 layers. SafeJS postbuild 7 passed / 0 failed / 0 skipped.                                                                                                                                                                   |
| Initial maintained root lint       | `npm run lint`                                                                                                                                                  | Exit 2: ESLint passes; root type checking cannot resolve unbuilt workspace declarations outside the selected SafeJS build closure (including braintrust, acp-telemetry and worktree), with cascading implicit-any errors. Workflow lint was not reached. Setup/build prerequisite mismatch, not a validated product defect. |
| Full maintained build prerequisite | `npm run build`                                                                                                                                                 | Exit 0; 70 declared builds, root plan/harness schemas and bundles complete. `@poe-code/py-poe-spawn` is explicitly `NO_DECLARED_BUILD_NOT_A_PASS`. No tracked generated/source changes.                                                                                                                                     |
| Maintained root lint retry         | `npm run lint`                                                                                                                                                  | Exit 0 after full build: ESLint, root type checking, package contracts and workflow lint all pass. Initial missing-declaration failure resolved by maintained build prerequisites, with no product repair.                                                                                                                  |
| Selected pinned Test262            | Command below                                                                                                                                                   | Exit 1; 18 files / 35 variants: 32 pass, 0 fail, 3 unsupported. Zero metadata/execution errors.                                                                                                                                                                                                                             |
| Newer Temporal extremes            | Command below                                                                                                                                                   | Exit 1; 3 files / 6 variants: 0 pass, 6 fail (`unexpected-throw`), 0 unsupported. Zero metadata/execution errors.                                                                                                                                                                                                           |
| Native/built exploratory controls  | Procedure below, `node --input-type=module`                                                                                                                     | Exit 0 for assertions of observed behavior; this is not acceptance of missing month names or symbol admission.                                                                                                                                                                                                              |

Build and lint ran during the maintained serial package suite; elapsed measurements are not exclusive-CPU measurements. Whole-repository `npm test` is not claimed; root-only tests did not replace it. This documentation-only task selects the maintained SafeJS package route and declared build closure. No visual CLI changes exist; screenshot QA is inapplicable.

## Pinned conformance selections and exclusions

`git -C /private/tmp/safejs-baseline-test262-419d3e0 rev-parse HEAD` returned **419d3e0a2273ba01a3bfcbec423f2801425b8e93**. Both commands use default timeout **3000ms**, budget overrides `{}`.

```sh
npm run test:conformance --workspace=@poe-code/safe-js -- --corpus /private/tmp/safejs-baseline-test262-419d3e0 --report /Users/kjopek/Workspace/poe-code-baseline-delivery/docs/plans/safejs-reconciled-baseline-checks/conformance-selected.jsonl --include built-ins/Array/of --include language/module-code/early-dup-export-dflt.js --include built-ins/Atomics/wait/cannot-suspend-throws.js
npm run test:conformance --workspace=@poe-code/safe-js -- --corpus /private/tmp/safejs-baseline-test262-419d3e0 --report /Users/kjopek/Workspace/poe-code-baseline-delivery/docs/plans/safejs-reconciled-baseline-checks/conformance-temporal-extremes.jsonl --include intl402/DateTimeFormat/prototype/format/temporal-objects-no-time-clip.js --include intl402/DateTimeFormat/prototype/format/temporal-objects-no-time-clip-weekday.js --include intl402/DateTimeFormat/prototype/format/temporal-objects-no-time-clip-non-latin-numerals.js
```

All sixteen `built-ins/Array/of` files pass sloppy and strict variants. `language/module-code/early-dup-export-dflt.js` is unsupported with reason `module`; the two `built-ins/Atomics/wait/cannot-suspend-throws.js` variants are unsupported with reason `blocking-mode`. These are harness exclusions, not semantic passes or newly validated ECMAScript defects. Each selected newer Temporal file fails both variants; proposal coverage remains separate from the published-edition target. Full corpus and other runtime cells remain unverified by these selections.

## Current ISO locale and Promise-symbol reproduction

Run `node --input-type=module` from this checkout after the maintained build, importing `assert` from `node:assert/strict`, `run` from `./packages/safe-js/dist/index.js`, and `deepCopyToSandbox, getPromiseProperties` from `./packages/safe-js/dist/interp/values.js`.

For each locale `en-US`, `pl-PL`, `ru-RU`, each calendar `iso8601`, `gregory`, and each width `long`, `short`, compare native and built guest `new Intl.DateTimeFormat(locale,{calendar,month:width,timeZone:'UTC'}).formatToParts(Date.UTC(2000,1,29))` using `assert.deepEqual` and assert guest `ok`. All twelve native/built comparisons pass. ISO long yields `[]` in both native and guest for all three locales; short values are `Feb`, `lut`, `февр.`; Gregorian long values are `February`, `luty`, `февраль`. Native agreement reproduces the host ICU limitation, not standalone normative proof.

For each of those locales with `{calendar:'iso8601',month:'long',timeZone:'UTC'}`, evaluate guest `[formatter.formatToParts(Date.UTC(2000,1,29)),new Temporal.PlainMonthDay(2,29).toLocaleString(locale,options),new Temporal.PlainYearMonth(2000,2).toLocaleString(locale,options),formatter.formatRangeToParts(Date.UTC(2000,1,29),Date.UTC(2000,2,2)).filter(p=>p.type==='month')]`. All three return `[[],"","",[]]`. This reproduces both standalone and range missing-month expectations from the original untracked ISO fixture, on current built code, without representing that fixture as a shipped regression. The older seven-failure exploratory count is not a fresh tracked-suite count.

Evaluate guest `const p=Promise.resolve(1),k=Symbol("label");Object.defineProperty(p,k,{value:42,enumerable:true});return [p[k],Reflect.ownKeys(p).includes(k)]`; it succeeds with `[42,true]`. Separately create a native resolved Promise with enumerable string data property `label='answer'`, enumerable user-symbol data property value `42`, and a distinct enumerable private-symbol getter that increments a counter then throws. Inspect `getPromiseProperties(deepCopyToSandbox(p))`: own keys are exactly `['label']`; string descriptor is `{value:'answer',writable:false,enumerable:true,configurable:true}`; user-symbol value is `undefined`; private getter calls are **0**. Thus missing native Promise user-symbol admission is reproduced, while guest ECMAScript symbols work and host metadata is not read. This does not authorize automatic host-symbol admission or prove active/retired-context replay.

## Receipt limits

Local built probes are not installed-registry-artifact probes. This file does not claim remote delivery or publication; canonical ledger delivery receipts record those independently. Raw outputs remain local untracked evidence. The fresh terminal JSON was checked against `git ls-files`: all 1,303 discovered files are tracked, with no exploratory file included. The 2,106 internal Vitest suite count includes nested suites and is not the file count. No snapshots were added or updated.

## Complete skipped assertion inventory

These 47 maintained skips are exclusions, not passes. There are no failed assertions. Node-native Temporal and Math.f16round controls are unavailable in this runtime; parse fuzz is optional and was not enabled; memfs reference gaps retain their maintained skips.

`packages/safe-js/src/interp/globals/math-f16round.independent.test.ts`

- Math.f16round independent review matches native on 253,952 half values/tie neighbors

`packages/safe-js/src/interp/globals/math-f16round.test.ts`

- Math.f16round matches native f16round for 16,384 deterministic binary64 inputs

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

## Local receipt integrity

SHA-256 hashes identify exact terminal artifacts. Raw logs are not required to be committed.

| Artifact                              | SHA-256                                                            |
| ------------------------------------- | ------------------------------------------------------------------ |
| `build.exit`                          | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `build.log`                           | `9919665e5382bf32769b99f6f943519a2902145deef9f0ed743b61f4eb3b073b` |
| `conformance-selected.exit`           | `4355a46b19d348dc2f57c046f8ef63d4538ebb936000f3c9ee954a27460dd865` |
| `conformance-selected.jsonl`          | `9cca13ca6f40a6f4d43a7c81354fa0cb0e4917be07fe396ab2082c40f37ce36c` |
| `conformance-selected.log`            | `76dfd339591ac4946e52d3786eb8a750b3061a8d101f613caa8a17124d434f97` |
| `conformance-temporal-extremes.exit`  | `4355a46b19d348dc2f57c046f8ef63d4538ebb936000f3c9ee954a27460dd865` |
| `conformance-temporal-extremes.jsonl` | `a3e452212b709cbcedee39b83bededf03d35c606f6f7ac6a47cdef83e6ba8232` |
| `conformance-temporal-extremes.log`   | `bb17de60d3650b99539cd4a5eaca7b3874c9f522ace07feb5675d97f0ad1cbd7` |
| `environment.json`                    | `6d3d6897428df97d685a960e128bd18d3f4f2f94e15903deddc4ce1bbfb1e8c7` |
| `full-build.exit`                     | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `full-build.log`                      | `c0e08c425ee2e7e748c667d8d3e06faabf3b8244e3a15517d99942296bdddd2e` |
| `lint-retry.exit`                     | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `lint-retry.log`                      | `a810b2736962da59fb5127ff87f629e3c05ca40d4a70ad50b9bc4eb6ae39d30d` |
| `lint.exit`                           | `53c234e5e8472b6ac51c1ae1cab3fe06fad053beb8ebfd8977b010655bfdd3c3` |
| `lint.log`                            | `c0795dfdca1bb9dfa89085bacbd7922c0b1c3eca7c09ea54eb5cbf145cb9a23c` |
| `native-built-controls.exit`          | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `native-built-controls.jsonl`         | `fa037c02fdefa0e3ec4bd55c89faa4053972935b6ebf1cdffbc5c2cd1fc305c7` |
| `npm-ci.exit`                         | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `npm-ci.log`                          | `0a614b13b472b103c6ca783531886a909077af794c1faabbf5b3fe9376079463` |
| `package-test.exit`                   | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `package-test.finished`               | `73dd6c7bb9a11109bb8b94ec19da509aab5012337ea125674a17b4f1ae55df4e` |
| `package-test.json`                   | `dc4b5f2b027c3bf4ecebe2e93a71e79ee82c52e6b17e74864f2d7ad94f1e53cb` |
| `package-test.log`                    | `4b4c6e186b253e172eb40f386a8f45c5d2b96e6a7e402ee3cf7eef71011ecb1d` |
