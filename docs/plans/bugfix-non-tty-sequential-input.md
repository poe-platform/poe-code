# Sequential non-TTY prompt input bugfix

## Scope

- Decode one answer from native Node Readable streams without discarding subsequent answers or their partial encoding bytes when chunks contain multiple lines. Handle data synchronously so a complete line wins over a subsequent same-turn abort or destruction.
- Keep future input in the original stream buffer, not a long-lived plaintext answer cache. Handle object-mode `Readable.from` string/Buffer chunks by returning unconsumed data with the public `unshift` API.
- Use the built-in UTF-8 StringDecoder only for raw buffers; leave already-decoded strings and existing stream encoding, including UTF-16LE, unchanged.
- Preserve LF, bare CR, CRLF with the existing 100ms delay policy, empty lines, partial/consumed EOF, validation/default handling, cancellation, original-error rejection, and cleanup before validation.
- Store at most pending CR framing timestamps weakly across native prompts. Preserve the existing readline path for legacy event streams outside native Readable compatibility; no API narrowing or new compatibility error.
- No TTY changes, readline private internals, persistent owned reader, dependencies, README edits, inline comments, staging, commits, pushes, or unrelated changes.

## Execution

1. Inspect native/legacy transport behavior and existing lifecycle tests.
2. Add red memory-only sequential, byte-boundary, object-mode, encoding, framing, failed-validation, and listener controls.
3. Add bounded per-chunk decoding with one guarded cleanup/settlement path, pausing input and returning only the unconsumed suffix before resolving; retain legacy readline behavior.
4. Keep original synchronous race assertions unchanged. Adapt only interface-ownership coverage to explicitly exercise the retained legacy path.
5. Notify the parent when focused tests pass, then run package tests and scoped lint/types.

## QA And Evidence

- The parent captured and inspected `screenshots/ux-non-tty-sequential-before.png` using actual `createPromptRunner`, public text/password adapters, and a shared memory PassThrough: `first\nsecond\n` incorrectly returned an empty second answer.
- The baseline is a diagnostic actual-runner probe with entirely synthetic data, not an authentication run. No credentials, network, or provider execution are involved.
- Parent owns after-QA of the actual runner plus chunking/EOF cases, screenshots, review, and publication.
- Tests use in-memory streams, existing fixtures, immediate event-loop flushes, and a virtual Date clock for CRLF boundaries. No filesystem fixtures, subprocesses, LLM calls, network, or timeout assertions.
- Preserve unrelated manifest/security-plan/assets and all other workers' changes.

## Implementation And Compatibility

- Native `Readable` instances use a temporary data handler. Buffers are decoded one byte at a time only until the first terminator; strings are already decoded and are processed without changing their encoding. The unconsumed chunk suffix is returned with `unshift`, including object-mode multi-character strings/Buffers.
- Settlement is guarded before cleanup. Owned data/end/close/error/abort listeners are removed, input is paused, any suffix is restored with the existing readable encoding, and only then does the promise resolve or reject. No deferred pause, persistent reader, readable listener, or plaintext answer cache remains.
- Malformed UTF-8 retains StringDecoder replacement behavior. If decoding a terminator flushes replacement text plus LF/CR, the replacement stays in the answer and the terminator still frames the line.
- Same-chunk CRLF is consumed together. A trailing CR stores only a weak per-stream timestamp; a leading LF on the next nonempty chunk is skipped within 100ms. Empty object-mode chunks do not erase framing metadata.
- Native `Readable` is the explicit suffix-preservation boundary. Other legacy event streams retain the existing readline path and its previous sequential limitations; their public compatibility is not narrowed and no new capability error is introduced.
- The interim readable-event strategy was replaced because it changed synchronous line-before-abort/destroy ordering. Added ticks were removed, and `non-tty-abort.test.ts` and `non-tty-close.test.ts` are byte-for-byte unchanged from HEAD. Their original setup, race, partial-input cancellation, queued-EOF cancellation, and listener assertions pass.
- The existing interface-ownership cases in `non-tty-error.test.ts` now use a real legacy event stream and real readline interface, retaining all ownership assertions. Its native public-wrapper error/destruction tests remain in place.

## Validation Results

- Initial red before production edits: 28 failures and 15 passing controls across 43 sequential cases, reproducing lost tails, split-UTF-8 corruption, CRLF loss, and discarded input after rejected validation.
- Parent review's malformed-UTF-8 concern was reproduced with five additional red LF/CR/CRLF cases before fixing delimiter handling. Empty object-mode CRLF chunks and remaining-consumer buffering also received failing regressions before their fixes.
- Focused green: `node_modules/.bin/vitest run packages/toolcraft-design/src/prompts/interactive/non-tty-sequential.test.ts --reporter=dot` passes all 56 cases. Three cases additionally iterate every byte split for three-answer LF/CR/CRLF inputs using a virtual Date clock.
- Interactive green: `node_modules/.bin/vitest run packages/toolcraft-design/src/prompts/interactive --reporter=dot` passes 593 tests in 18 files, including the original unchanged same-turn races. The parent was notified before package checks.
- Package green: `npm run test --workspace=toolcraft-design -- --reporter=dot` passes 1,576 tests in 77 files.
- `npm run lint --workspace=toolcraft-design` passes ESLint and package TypeScript checking. Direct strict ES2022/NodeNext checking of both changed test files passes. `git diff --check` passes, and `git diff --exit-code` confirms no changes to the abort/close test files.
- Exact test delta: 56 new tests, with no existing tests removed. Interactive totals increase from 537 to 593; package totals increase from 1,520 to 1,576. The five existing legacy interface-ownership cases retain their assertions and count.
- Final parent after-QA passed 17 actual-public-runner cases against the synchronous data-mode implementation. The previous 11 valid-input cases were rerun: same LF, split second text, split UTF-8 emoji, same/split CRLF, bare CR, partial EOF, existing UTF-8/UTF-16LE encoding, and object-mode string/Buffer input. Two malformed-UTF-8 cases before LF/CRLF preserve replacement text and the second answer. All four text/password same-turn `write('value\n')` followed immediately by abort/destroy cases return `value`.
- Parent verified exact answers, silent output, unchanged encoding, and zero owned listeners, then captured and inspected `screenshots/ux-non-tty-sequential-after.png` against the before diagnostic. The parent approved the final transport direction; abort/close test files are now entirely unchanged from HEAD, including setup names.
- Source is stable with final parent QA complete. Parent owns the eventual coordinated commit. No provider/auth execution, screenshots, dependencies, inline comments, README edits, staging, commits, pushes, or unrelated edits were performed by this task.
- Parent rebuilt `toolcraft-design`, including its built-export smoke check, and piped `first\nsecond\n` through the real stdin of `createPromptRunner()` with its default built-package adapters. The text/password pair returned exactly `{ first: "first", second: "second" }` without adapter mocks or authentication.
- Parent independently reran all 593 interactive tests across 18 files: all passed in 1.32 seconds, including 432 ms of test execution. A final diff check confirms the original abort/close test files remain unchanged.
