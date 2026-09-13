# Presentation full-inventory documentation audit

Scope: documentation and evidence only, on main. No product implementation,
README edits, corpus acquisition, native runtime, whole pipeline, push or release.
Preserve unrelated work, including preexisting untracked research inputs.

## Procedure and results

1. Read root AGENTS.md; no scoped AGENTS.md exists under docs. Read the format,
   shared CLI/SDK contracts, pinned test/API audits and inventories, central
   ledgers, standards register, corpus manifest and later evidence receipts.
2. Resolve every unit/BDD inventory pointer, source file/line/identity/revision,
   unique target ID, TypeScript disposition, semantic rationale and behavior
   evidence. Resolve all unit test/fixture/helper contract pointers. Check expanded
   BDD steps and the test files/receipts on recorded passes. All 3,673 rows resolve;
   pending semantics stay pending. No architecture-only waiver is introduced.
3. Join all 2,409 API identities into 2,426 target rows. Retain inherited and
   underscore-prefixed members, enums, helpers, collections and untested APIs.
   Identify and record two missing command-register obligations for freeform
   offsets, with empty registered bindings and explicit proposed routes.
4. Reconcile all 60 standard/spec/command feature IDs. Distinguish normative
   requirements, source evidence, target execution and corpus observations.
   Correct stale baseline language without rewriting historical execution.
5. Run the maintained package unit route with V8 coverage limited to product
   TypeScript under packages/pptx/src, excluding test files. Run package lint
   (ESLint and both TypeScript configurations). Results: 259 files / 6,809 tests
   passed; lint passed. Coverage denominators are retained in the research receipt.
6. Parse owned JSON; check joins, unique identities, pending bindings, row partition,
   feature IDs and input hashes. Run the maintained Prettier route scoped to owned
   files and git diff --check. Commit explicitly named documentation only.

Commands executed:

```sh
npm run test:unit --workspace=pptx -- --coverage --coverage.include='packages/pptx/src/**/*.ts' --coverage.exclude='**/*.test.ts' --coverage.reporter=json-summary --coverage.reporter=text-summary --coverage.reportsDirectory=/tmp/pptx-doc-audit-coverage
npm run lint --workspace=pptx
```

The test run observes the existing working tree, including unrelated uncommitted
product changes. It does not make those changes part of this documentation commit.
The receipt fingerprints the tested source tree. Safe-bash tests and external
rendering did not run; retained CLI receipts are historical evidence.

The root format script adds `.` even when filenames are supplied. That read-only
invocation was interrupted after it scanned cache metadata; it is not a passing
check. Direct `npx prettier --check` on the six owned files passed, as did
`git diff --check`. Source hash references and recorded passing assertion names
also resolve. No cache file was changed by the formatting check.

## Remaining QA and regression obligations

Use only manifest-listed disposable inputs in a future explicitly bounded QA
campaign. Keep acquisition/output paths outside shipped files. Pair structural
and visual checks where rendering matters; do not infer playback from ZIP/XML.
Strict, signatures, SmartArt, modern comments, RTL, audio/captions, advanced charts
and hundreds-of-slides inputs remain corpus gaps in the cited acquisition receipt.

Keep the eight original designs in docs/pptx/corpus-gap-regressions.json open.
For each meaningful finding, validate current behavior, then author the smallest
original in-memory TypeScript regression with downloads absent. In particular,
distinguish chart roots from style parts and internal workbook relationships from
external links; distinguish CJK slide text from font metadata. This documentation
scope does not authorize implementing those tests or product fixes. Designs and
source-runtime passes do not count as target passes.

For each of the 3,630 unresolved ledger rows, inspect its exact parameter payload
or expanded BDD step/fixture semantics before promoting a family receipt. Replace
mock topology with observable returns, state, ownership or failures; justify any
many-to-one mapping with distinct assertions. Unsupported public behavior remains
visible and blocks parity. Two offset SDK properties still need typed command
registration and original command acceptance. No generic member evaluator.

## Delivery

One atomic documentation reconciliation commit; no push or release. Required
standalone legal notices remain intact. No ignored fixture is staged.
