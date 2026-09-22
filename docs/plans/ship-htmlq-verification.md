# ship-htmlq verification

Executed 2026-09-21 against the current working tree, preserving unrelated edits.
The requested package pattern is at its existing
[archived location](archive/safe-bash-command-package-pattern.md).
Only documentation changed; no runtime repair or new TDD cycle was necessary.

## Markdown QA and observed results

1. Inspect package ownership and manifest: `safe-bash-command-htmlq` remains
   private, TypeScript ESM, with empty runtime dependencies. Safe Bash only
   composes/exports it. No host executable, ambient I/O, implicit network,
   native/WASM fallback or downloaded runtime was introduced.
2. Run `npm test --workspace=safe-bash-command-htmlq`: 150 passed, zero failures,
   cancellations or skips. `npm run lint --workspace=safe-bash-command-htmlq`
   passed ESLint and production/test TypeScript checks.
3. Run `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`:
   maintained shared-cache build closure and postbuild passed. Existing
   htmlq-boundaries integration through Node/tsx: nine passed, zero failures,
   cancellations or skips, including CLI/SDK parity, VFS publication,
   scripts/pipelines, quotas, host isolation and disposal cleanup.
4. Stage using `scripts/package-safe.mjs`, version `0.0.0-ship-htmlq`;
   npm-pack only the public Safe Bash, SafeFS and SafeJS artifacts. Install
   offline outside the checkout with scripts/workspaces disabled. Confirm
   private htmlq/contracts packages are absent.
5. Execute maintained `safe-packages-htmlq.mjs` normally and with browser and
   workerd conditions: all passed. Engine bytes/recovery, canonical registration,
   live mutation, typed SDK parity and atomic same-path output were exercised.
6. Compile maintained `safe-packages-htmlq-types.mts` with strict NodeNext,
   exact optional properties and unchecked indexed access, normally and with
   browser/workerd custom conditions: all passed without skipping declarations.
   Packed targets are `./dist/safe-bash/commands/htmlq/index.js` and its
   `index.d.ts`. AST inspection of all 1,338 packed JS/declaration files found
   no bare private command/contracts specifiers.
7. Bundle an independent installed source-only text/script control under
   browser/workerd conditions; both passed in Node VM realms without Buffer,
   process or require. These qualify conditional graphs, not actual engines.
8. Document Node.js 22+, exact plural `--attributes`, VFS examples, limits,
   outputs and runtime qualification. Update the existing Safe Bash support
   paragraph with no unrelated sections. `git diff --check` passed.

No visible CLI or document renderer changed; new screenshots are inapplicable.
Prior command screenshots are recorded in [wiring QA](safe-bash-htmlq-wiring-qa.md).
No shared code changed, so full repository routes were not run or claimed.

## Candidate receipt and qualification limits

| Public artifact | SHA256 |
| --- | --- |
| Safe Bash | `1d8a2d293cc54357592b8d3914e5bbe2ecb597699956fec5992c81cc78dc62d7` |
| SafeFS | `72ce8f504b91b958a8459b4e474ff73cefc169c310f7bd06bcb394e2a471e3df` |
| SafeJS | `51561cc8decab7e606b77f2d4eb288ee4d027461918399a4778aa3073067b740` |

Tarballs include the command README changes; Safe Bash's final paragraph edit
followed staging. These are local candidate hashes, not release evidence.
Full HTML5 recovery, complete legacy selectors, Rust URL normalization, every
pretty writer state and actual browser/workerd engines remain unqualified.
`fullHtml5Parity` remains false. The README retains the intentional chunk-invariant
BOM correction, inert scripts/styles, separate template omission and live lazy
removal semantics. Supplied native research remains development-only; no native
research build was rerun or adopted into product runtime.

Absolute `/out` is unavailable. Task-generated temporary evidence used ignored
`out/ship-htmlq-current` and `/tmp/ship-htmlq-isolated-consumer`.
Automatic review initially rejected recursive cleanup pending ownership evidence;
after inspecting both task-generated trees, removal was approved and completed.
Local commits: none. Verified remote-main delivery: none. Successful releases:
none. No private package publication, push or public publication occurred.

## Current-tree recheck, 2026-09-21

This follow-up changed documentation only: an exact supported-flag table,
explicit rejection of help/version/abbreviations, the research pin and runtime
restrictions, and the existing Safe Bash support paragraph's inert-content and
chunk-invariant BOM guarantees. The detected-base wording now consistently
describes the first base, rather than searching for a later valid base.
No code repair was justified by this review; no TDD cycle was bypassed.

Markdown QA executed on the current tree:

1. Run the maintained htmlq workspace test and lint commands: all 150 tests
   passed without skips, and ESLint plus source/test TypeScript checks passed.
2. Run the maintained explicit Safe Bash workspace build closure: all 25
   selected builds and native postbuild passed with the shared cache enabled.
   Run the existing memory-VFS htmlq boundary controls: all nine passed.
3. Stage with the maintained packer as `0.0.0-ship-htmlq-recheck`; pack only
   public Safe Bash, SafeFS and SafeJS. Include the final README edits. Install
   the tarballs offline outside the checkout, with scripts/workspaces disabled.
4. Run the maintained htmlq runtime fixture normally and under browser/workerd
   conditions: all passed. Compile the maintained declaration fixture with
   strict NodeNext, exact optional properties and unchecked indexed access,
   normally and under both custom conditions: all passed, without skipLibCheck.
5. Inspect the dependency inventory and AST-scan all 1,338 installed Safe Bash
   JS/declaration files: no installed private commands/contracts or bare private
   command/contracts specifiers. The htmlq export points to the bundled
   `dist/safe-bash/commands/htmlq/index.js` and `index.d.ts`.
6. Bundle installed source-only htmlq under browser/workerd conditions and
   execute inert script/text controls in Node VM realms without Buffer, process
   or require: both passed. Actual browser/workerd engines remain unqualified.
7. Review command/engine ownership, live traversal, budgets, cancellation,
   awaited producer/output cleanup, falsey failures and SDK argument snapshots.
   Existing controls passed; no additional validated defect, unsafe host access,
   proxy-only abstraction or snapshot/version regression warranted a code change.
   Run `git diff --check`: passed. No visual CLI or document renderer changed,
   so new screenshots are inapplicable.

Final local candidate SHA256 values:

| Public artifact | SHA256 |
| --- | --- |
| Safe Bash | `c64b24be8ae49af365d0b22edf7eb3bed594c7a2d883ca4c9736652b79f1cb7e` |
| SafeFS | `db060378299f57419f61f41ee8e05ef7da9862ef7c44aadcd767b8f6fc3e0110` |
| SafeJS | `237f59872c51db66ecc646b5dc46854af4e15b2e560ef91f6f47ddd9ee748012` |

These checks close the local packed-export/documentation verification only.
The existing full HTML5, complete legacy selector grammar, Rust URL and pretty
writer qualification findings remain unresolved and block complete upstream
compatibility qualification; `fullHtml5Parity` remains false. No native research
source/runtime was adopted or rerun. No shared production code changed, so full
repository routes were not run or claimed. Local commits: none. Verified
remote-main delivery: none. Successful releases: none. No publication occurred.

Absolute `/out` is read-only; temporary evidence used task-owned ignored
`out/ship-htmlq-recheck-20260921` and an outside-checkout temporary consumer,
removed after verification.

## Final packed candidate recheck

Executed against HEAD `ab1fa8d34101e1e7f61272973f3bc28a842043d8` plus
the preserved working tree. This task shortened the package README's opening
and parser qualification paragraph only; no production code changed. The
existing Safe Bash usage/support paragraph already covers the public subpath,
plural `--attributes`, outputs, inert content and runtime qualification.

Markdown QA executed:

1. Inspect the private ESM manifest and composition-only public export. Runtime
   dependencies remain empty; only first-party contracts are development inputs.
   Review command ceilings, invocation ledger, cancellation, awaited cleanup,
   atomic output and live traversal. No additional defect was validated.
2. Run `npm test --workspace=safe-bash-command-htmlq` and
   `npm run lint --workspace=safe-bash-command-htmlq`: 150 tests passed with
   zero failures, skips or cancellations; ESLint and both TypeScript checks
   passed. Run the memory-VFS htmlq boundary controls with Node/tsx: nine passed,
   including CLI/SDK parity, denied host/network authority, rollback,
   concurrent destination changes and disposal cleanup.
3. Run `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`:
   all 25 maintained build tasks and native postbuild passed with shared-cache
   mode. This is a selected build closure, not a full repository gate.
4. Stage the final README with `scripts/package-safe.mjs` as
   `0.0.0-ship-htmlq-final`; pack only the three public artifacts. Install
   offline outside the checkout with scripts/workspaces disabled. `npm ls --all`
   passed and lock inventory contained no private command/contracts packages.
5. Run the maintained installed runtime fixture and strict NodeNext declaration
   fixture under default, browser and workerd conditions: all six cells passed.
   Types used exact optional properties and unchecked-index checks, without
   `skipLibCheck`. Export targets resolve inside the public artifact at
   `dist/safe-bash/commands/htmlq/index.js` and `index.d.ts`.
6. Run additional independent installed controls under all three conditions.
   For each N in `0,1,2,4092,4093,4094,4095,4096,4097,8191,8192`, reconstruct
   `A^N + bytes[239,187,191] + B`, project `-t`, and feed widths
   `1,2,3,4096,totalLength`. All 55 cells per condition preserved interior BOM
   and stripped only the initial BOM. No random generator or seed was used.
   Separate controls distinguished literal NUL omission from `&#0;` replacement
   and malformed UTF-8 replacement; verified template omission alongside inert
   script/style preservation, always-false state selectors, detached-node lazy
   removal, unsupported/nested selector rejection, pre-aborted cancellation,
   zero-output quota failure and original BOM/CRLF source preservation.
7. AST-scan all 1,337 installed Safe Bash JS/declaration files: no bare private
   command/contracts imports. Bundle the installed htmlq subpath for browser
   and workerd conditions; each graph had 55 inputs, all outside the checkout.
   Execute independent script/text controls in Node VM realms with no Buffer,
   process or require: both passed.
8. Run `git diff --check`: passed. No visible CLI or renderer changed, so new
   CLI/document screenshots are inapplicable; existing inspected screenshots
   remain linked in the wiring QA. Checkpoint/replay behavior was unaffected;
   original-source preservation was explicitly checked.

| Final public artifact | SHA256 |
| --- | --- |
| Safe Bash | `f327e2833adebeeb86841954b17a58f2d7eb8e51e0c1db70e1bc10ed022b46f9` |
| SafeFS | `ca2373b6ac82c711be155c190b1b0479005d73ce502bd70a83d6b9ab6ed7adb8` |
| SafeJS | `16e72317d487ae34e6fe211babde5242600fdd889f1374f5efe486332d4080d5` |

Failures: none in executed gates. Skips: none within executed tests.
Unverified: actual browser/workerd engines and complete HTML5/legacy-selector,
Rust URL and pretty-writer parity. Native research was not rerun. Full repository
test/lint/build routes were not run because this task changed documentation only;
unrelated shared edits are not qualified by these focused checks. No bounded
performance measurement was claimed.

Absolute `/out` creation failed because the filesystem is read-only. Temporary
evidence used ignored `out/ship-htmlq-final-20260921` and task-owned
`/tmp/ship-htmlq-final-consumer.XJj2YA`, purged after verification.
Local commits: none. Verified remote-main delivery: none. Successful releases:
none. No command package publication, push or release occurred.
