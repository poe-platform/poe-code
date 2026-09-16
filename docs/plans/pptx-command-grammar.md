# pptx command admission and error envelopes

Status: Implemented and verified locally; no push or release.

## Scope and ownership

Baseline: `5396d881968433e925ae0f0f062826555a32788b` on main. Root coordinates
review, research accounting, screenshot QA and the local commit. The delegated
worker owns the command engine and its existing SDK and safe-bash tests. The
safe-bash scoped rules require this delegation; no adapter or root API change is
needed. Existing unrelated changes, including untracked specification/audit
inputs, remain outside staging. No README edits, push, release or whole pipeline.

This increment fixes the existing read-only inspection profile. Shared Office
CLI sections 3, 6–8 and format sections 6.1, 6.3 and 6.7 require literal argument
handling, nonempty paths, usage rejection before I/O and correctly identified
JSON errors. Editing, binary package publication, multi-consumer stdin admission,
typed operation execution and the full presentation model remain outstanding.
Current rejection of editing flags does not establish those future contracts.

## Findings and original regression procedure

1. Add original failing cases before changing production code. Exercise empty
   filenames, discovery usage errors and literal `--json` arguments after `--`
   or as scalar values. Assert exact operation/status, stdout/stderr separation,
   diagnostic fields and absence of input reads independently.
2. Implement the admission correction in `packages/pptx`. Preserve literal shape
   names, raw UTF-8 bounds and supplied I/O authority. Do not add host resources,
   native execution, networking or a parallel adapter parser.
3. Exercise both the exported SDK command engine and real Shell registration
   through existing memfs tests. Reuse only tiny original in-memory assets.
4. Run maintained pptx unit/lint routes, the selected workspace build closure and
   focused safe-bash command checks. Review the final diff and staged paths.
5. Capture actual Shell help and usage errors through the maintained terminal PNG
   renderer and visually inspect the result. The root screenshot-poe-code command
   cannot install this optional Shell plugin; direct transcript rendering follows
   the established selector QA procedure. Keep screenshots disposable and unstaged.
6. Commit the atomic fix and this evidence on main using a Conventional Commit.
   Report the local hash separately; no remote delivery or release is authorized.

## Accounting and language mappings

Read both upstream audits and parsed both inventories, the case ledger, target
API register and disposable corpus manifest. Verified all 3,673 unique case
pointers against exact source identity, file, line and commit: 2,700 unit variants
and 973 BDD cases. Verified all 2,407 API identities occur in the 2,424 target rows.
No inherited member, enum, collection, helper or public underscore-prefixed type
was excluded. Current ledger dispositions are 2,599 semantic reviews, 167 specified
designs, 894 provisional designs, 12 original TS passes and one deferred public
behavior. Those existing dispositions are unchanged by this supplemental CLI fix.

These regressions implement the shared command admission contract, not a copied
source test or new whole-model parity claim. J06/J08/J10 apply: explicit async
input capabilities, neutral error categories, usage exit 2, and one shared domain
engine behind the command adapter. Literal argument strings remain literal;
no object-model spelling or new JavaScript language mapping is introduced.
Historical research audit statements that implementation had not started describe
their audit time; current code implements only the narrower recorded profile.

All 14 corpus records were consulted as metadata. No publisher fixture was read,
downloaded, changed or shipped; argument-admission findings require no document
corpus. No implementation, wording or assets were copied from a reference project.
Required standalone notices remain untouched. Provenance stays in research.

Research input SHA-256 values:

| Input                        | SHA-256                                                            |
| ---------------------------- | ------------------------------------------------------------------ |
| upstream-test-inventory.json | `702a7b6aaa2009050583c4ef4c2b363ef5f52bea4a59cc60aa5861e30731fa6d` |
| test-case-map.json           | `dd82eee632504ebe965e60a7c4d231cf28e6554d5a3f22515b7d54129e4f487b` |
| upstream-api-inventory.json  | `cd6467079c8f93d5be57758646f3fcd3667a6a13a1782fb371320c378803b934` |
| public-api-map.json          | `705907588d468a7711a8451a74a578ca24dc247e3bcbe88ea894bc099d2e0340` |
| corpus-manifest.json         | `f4c740aa929eb714b4b83ec63cb7d3641f278d5dffbc4c81303e02aee237169f` |

## Execution receipt

Initial TDD run reproduced 11 SDK failures: empty path, four discovery operation
identities, a literal filename after the option terminator, and five scalar-value
variants. The initial fix passed the workspace tests. Independent review then
found a regression where malformed UTF-8 before a later valid `--json` lost JSON
error mode. Added red/green cases through SDK bytes and Shell ANSI-C quoting;
defer the UTF-8 diagnostic until bounded hint discovery finishes, while preserving
terminator/scalar semantics and stopping at the argument ceiling.

The independent reviewer then passed 17 asserted probes covering malformed
positionals/scalar values, option termination, exact 15/16-byte admission boundaries,
oversized arguments and an inaccessible later argument proving bounded traversal.
No input capability was invoked by these invalid requests.

Actual Shell screenshot QA passed for `pptx --help`, `pptx inspect ''`,
`pptx inspect --unknown -- --json`, and `pptx schema --unknown --json`.
Help and errors were readable with no clipping; statuses were 0, 2, 2 and 2.
The schema failure carried operation `schema`; the literal filename failure used
human stderr. The disposable artifact is `/tmp/pptx-command-grammar.png`, SHA-256
`d3ae92ab0a438c3ce20f5f9e27e8a124ec2538a7484fd90c11312c9289b27eb8`.
No screenshot tests or interactive styling dependencies were introduced.

Maintained and focused results:

| Command/check                                                                       | Result                                                                          |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `npm run test --workspace=pptx -- --reporter=dot`                                   | 498 passed; same route first reproduced 11 failures and later one UTF-8 failure |
| `npm run lint --workspace=pptx`                                                     | Passed, including source/test type checks                                       |
| `npm run build:workspaces -- --workspace=pptx`                                      | Passed; only formatting changed source afterward                                |
| `node --import tsx --test packages/safe-bash/tests/commands/pptx/selectors.test.ts` | 38 passed through the genuine exported SDK and Shell adapter                    |
| Guarded root `npm run lint:eslint`                                                  | Passed: 11,848 configured inputs, zero errors/warnings                          |
| Scoped maintained Prettier and `git diff --check`                                   | Passed                                                                          |

An attempted `npm test --workspace=virtual-bash --
tests/commands/pptx/selectors.test.ts` appended every discovered test instead of
filtering to that operand. It was stopped with exit 143, with no failures in
captured output. It is not a completed broad gate. The exact existing test file
was then executed with the package's node/tsx test runtime. No whole-workspace
safe-bash runtime or full repository test gate is claimed by this narrow fix.

Commit scope is exactly this plan, the command engine, its SDK tests and the
existing safe-bash selector test file. The local hash is reported separately.

The first guarded ESLint run completed all 11,848 configured inputs and found one
`require-yield` error in the new fail-on-read test stub. Replaced the unused async
generator with a synchronously throwing function, retaining the no-read assertion.
The 38 CLI tests passed again. Guarded ESLint passed after this test-only
correction; its disposable output is `/tmp/pptx-command-grammar-eslint.log`.
