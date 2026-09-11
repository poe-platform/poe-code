# Issue 567: bounded cooperative cut range work

Date: 2026-09-04. Author of validated GitHub issue: kamilio.

## Ownership and scope

- Own only `packages/safe-bash/src/commands/text.ts`,
  `packages/safe-bash/tests/commands/text.test.ts`,
  `packages/safe-bash/tests/commands/cut-portable.test.ts`, and this plan.
- No shared internal/registry changes, new test files, README changes, Git
  mutations, full builds, or broad gates. Root owns delivery and release order.
- Parser/runtime changes for issue 565 belong to their concurrent owner.

## Validated defect and contract

The current per-position `ranges.some` performs exactly 65,536 comparisons for
32 nonmatching ranges and 2,048 positions in each byte/character/field mode.
Selection has no cooperative checkpoints inside a record. Existing preabort
checks preserve false/null reasons. Do not use timing/RSS/OOM extrapolations.

Preserve current adjacent custom-delimiter behavior (one contiguous selected
run), even though the installed GNU oracle differs. Preserve raw bytes, Unicode
code-point character selection, multibyte field delimiters, overlap/reordering,
duplicates, complement, NUL records, empty fields, and unterminated records.

## Implementation plan

1. Add bounded operation/cancellation/backpressure tests and capture RED before
   production changes. Extend existing portable cases without new test files.
2. Parse incrementally without regex or an arbitrary range cap. Reuse the local
   cooperative merge implementation for interval sorting; merge overlapping and
   adjacent intervals, then use a monotonic cursor per record.
3. Charge parsing, sorting, normalization, scanning, and output work through
   bounded cooperative checkpoints. Await bounded output writes rather than
   collecting all selected output pieces. Keep the existing record-buffered
   input and its 32 MiB limit; do not claim fully streaming input.
4. Run focused canonical/portable tests and correctly scoped no-emit types.
   Do not modify another owner's dependency errors. Record exact commands,
   RED/GREEN results, remaining limits, and final owned-file hashes for root.

## Validation record

Implementation and focused validation complete; owned files frozen for root.

### Environment and commands

Every exec used `require_escalated`. All test/type children used the following
environment setup; Git-local variables were cleared only inside the child
subshell, leaving the parent and private/global Git configuration unchanged.

```bash
unset NO_COLOR
export TSX_DISABLE_CACHE=1
export PATH="$(cat /tmp/kamilio-toolchain.path)/bin:$PATH"
export TMPDIR="$(cat /tmp/kamilio-561-562-tmp.path)"
(
  while IFS= read -r variable; do unset "$variable"; done < <(git rev-parse --local-env-vars)
  node --import tsx --test --test-name-pattern='^cut ' packages/safe-bash/tests/commands/text.test.ts
)
```

The RED command ran before any production edit. Final GREEN replaced the Node
command above with exactly:

```bash
node --import tsx --test --test-concurrency=1 packages/safe-bash/tests/commands/text.test.ts packages/safe-bash/tests/commands/cut-portable.test.ts
```

The portable suite bundles its browser fixtures with `write: false`; no package
build, dist output, or full validation gate ran.

### Exact logs and results

Log directory: `/var/tmp/poe-code-kamilio-561-562.dFKZCV/cut-567.GwQatc`.

- `red.tap`: initial harness attempt, retained. Node's mock tracker rejects an
  Array prototype as its object argument. Replaced only that instrumentation
  with a scoped override restored in `finally`, before production changes.
- `red-corrected.tap`: exit 1, 25 reported tests, 3 passes and 22 failures
  (18 failing leaf cases plus four failed parent tests). Each mode recorded
  65,536 range comparisons against an 8,320 upper bound; twelve queued abort
  cases missed rejection; each mode attempted a 71,680-byte write.
- `green-text-01.tap`: exit 0, all 33 canonical text tests passed after the
  first implementation, including the existing sort tests.
- `green-portable-01.tap`: exit 1, 8 passes and 21 failures. Preserved evidence
  of a local implementation error: the browser Buffer polyfill requires a
  Buffer-valued separator, not an arbitrary Uint8Array. Restored Buffer
  separators in the owned source before proceeding.
- `green-focused-02.tap`: exit 0, all 62 then-current focused tests passed.
- `green-focused-final.tap`: exit 0, all 74 final focused tests passed, including
  additional queued cancellation during output, large custom delimiter encoding,
  browser chunk boundaries, BOM/raw-byte behavior, and 10,001 duplicate ranges.
- `types-final.log`: TypeScript 5.9.3; three exact roots, 303 transitive source
  files, zero diagnostics, no emit. All transitive diagnostics were included;
  no concurrent-owner error was suppressed or modified.
- Exact-owned-file `git diff --check` passed. Repository-wide lint/full gates
  remain root-owned and were not run.

Scoped types used `node --input-type=module` with this stdin program, inside
the same clean-environment child subshell:

```js
import ts from 'typescript';
import path from 'node:path';
const root = path.resolve('packages/safe-bash');
const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
const converted = ts.convertCompilerOptionsFromJson(config.config.compilerOptions, root);
const roots = ['src/commands/text.ts', 'tests/commands/text.test.ts', 'tests/commands/cut-portable.test.ts'].map(name => path.join(root, name));
const options = { ...converted.options, noEmit: true, incremental: false, composite: false };
const program = ts.createProgram(roots, options);
const diagnostics = [...converted.errors, ...ts.getPreEmitDiagnostics(program)];
console.log(JSON.stringify({ typescript: ts.version, roots, noEmit: options.noEmit, sourceFiles: program.getSourceFiles().length, diagnostics: diagnostics.length }));
const host = { getCanonicalFileName: name => name, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n' };
console.log(ts.formatDiagnostics(diagnostics, host));
process.exitCode = diagnostics.length ? 1 : 0;
```

No tsconfig include-glob expansion or broad typecheck launcher was used.

### Frozen SHA-256 identities

| Owned TypeScript file | SHA-256 |
| --- | --- |
| `packages/safe-bash/src/commands/text.ts` | `2478cd1134ba1a290a5cff65b01fc6de2ca701a0b2ab8c2fe6dfdd6d2f50cb32` |
| `packages/safe-bash/tests/commands/text.test.ts` | `2ae7c863d0c219899480ab6a359d28c27d5fce1fb3f20c3883c9a7a5d9aa0a5a` |
| `packages/safe-bash/tests/commands/cut-portable.test.ts` | `35badddfc9a93e2be16a73e4e1f4187a87adcb8d32695e28e6a8655352416015` |

| Evidence file | SHA-256 |
| --- | --- |
| `red-corrected.tap` | `a9e34cb76c5e1188fc6d3063c86c8004269c64b9c33707abf550ccc3719bf0f1` |
| `green-focused-final.tap` | `1978719906d6a0240015644e9e5506d96a34829e4f7881966c3e75f7d29ed048` |
| `types-final.log` | `96eb2b29424e32df998bafe72576da962c3718267daa778356b35e8b3b3e84e3` |

The final plan's own hash is reported separately, avoiding a self-referential
hash entry.

## Delivered behavior and remaining limits

- Incremental range parsing, reused cooperative merge sorting, and cooperative
  interval normalization replace the per-position full range scan. The cursor
  resets for every record; overlapping, duplicate and adjacent ranges coalesce
  to preserve current contiguous-run custom-delimiter semantics.
- Work is charged in approximately 4,096-unit batches through the established
  `yieldTurn(signal)` mechanism. Parsing, merge moves/comparisons, normalization,
  bounded field searches, byte/character selection, and output copying are
  cooperative. Character decoding and delimiter encoding use bounded chunks.
- Output writes are at most 64 KiB, awaited, and use owned copies. Already
  published prefixes can remain visible on cancellation; no rollback is promised.
- Complexity is linear in parsed list length plus O(R log R) normalization and
  linear record scanning/output, rather than R times positions. Range storage
  remains O(R); no arbitrary range cap or OOM guarantee is introduced.
- Shared record-buffered input remains unchanged, including its 32 MiB record
  bound and synchronous record assembly. Existing shell budget route differences,
  shared option/diagnostic handling, and uncooperative host sinks are not newly
  bounded by this patch. This is not fully streaming input or hard preemption.
- Established Unicode character and multibyte field-delimiter behavior is
  preserved, not changed to this host's GNU cut dialect. The separate GNU
  adjacent-output-delimiter mismatch remains intentionally unfixed.
- No shared internal/registry/parser/runtime files, README, new test files, or
  private helper were changed/added. No Git mutation or delivery action occurred.
  Root owns full validation, commit/push, issue closure, and release, preserving
  its earlier 565/566 delivery ordering.
