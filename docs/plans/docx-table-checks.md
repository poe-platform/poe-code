# DOCX construction check prerequisite

Scope: one lint-only correction found while validating the bounded table task.
No later document feature is implemented and original test names/data/assertions
are retained.

The maintained `npm run lint:eslint` completed its guarded scan of 12,505
configured files and reported one error: the existing dual-stdin XML rejection
fixture used an async generator whose body only called `assert.fail`, triggering
`require-yield`. Twelve warnings came from an unrelated disposable cached example.

Reproduce the fixture's lint failure, then yield the never-returning assertion.
The assertion still runs only when the iterator is consumed, and still throws;
no output is yielded and the original no-acquisition test remains unchanged.
Run scoped ESLint and the original XML command integration tests after the edit.
The construction package tests/lint, adapter tests, runner and build evidence is
recorded separately in [the construction plan](docx-table-construction.md).

This prerequisite has its own Conventional Commit, separate from construction.
No push or release. Verified on 2026-09-14:

- Scoped ESLint on `tests/commands/docx/xml-parts.test.ts` from packages/safe-bash
  failed with require-yield before the edit and passed afterward.
- `node --import tsx --test packages/safe-bash/tests/commands/docx/xml-parts.test.ts`:
  all seven original tests passed.
- `git diff --check` passed. No other test or product behavior changed.

The complete repository lint scan is recorded as its original failure followed
by a scoped recheck of its sole error, not mislabeled as a second global pass.
