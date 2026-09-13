# Input-aware PPTX capabilities

Status: Implemented and verified locally; no push or release.

## Scope and ownership

Implement the shared Office CLI contract for `capabilities [INPUT]`, including
bounded input assessment, explicit unknown namespaces, generated discovery help
and a usable result schema. This is a bounded discovery improvement, not whole
format or public model conformance.

Root owns this plan, `docs/pptx/input-capabilities-evidence.md`, the capabilities
receipt in the command register, final review and staging. The discovery worker
owns new format-package discovery code/tests and necessary command-engine hunks.
The Shell worker owns only the new `capabilities-input.test.ts` adapter test.
Existing image, media, sanitization, other-format and infrastructure changes are
unrelated and must remain unstaged. The command engine already contains unrelated
edits: stage only this task's patch against the captured starting version.

Authority: root and safe-bash scoped AGENTS.md, `docs/specs/pptx.md`,
`docs/specs/office-cli.md`, `docs/specs/office-sdk.md`, both upstream audits and
both inventories. Product code remains original TypeScript with explicit input
capabilities, no ambient filesystem/network/native runtime. No README edits.

## TDD and agent QA procedure

1. Reproduce input rejection and incomplete static capability records with small
   original SDK tests before changing production code. Use memfs for VFS inputs.
2. Share the result contract with the Shell worker. Test stdin and quoted paths,
   invalid options before reads, ordinary error statuses and unchanged bytes.
3. Reuse bounded package/XML inspection. Report namespace recognition separately
   from semantic support; unsupported namespaces cannot disappear from reports.
   Every advertised static feature needs an explicit level and declared route.
4. Validate actual envelopes with the emitted JSON schema and exercise discovery
   without input to prove no I/O. Assert input/output ceilings and cancellation.
5. Run maintained PPTX tests/lint/build closure and the focused Shell regression.
   Review the owned patch independently, including no mutation/publication.
6. Capture actual help and input-assessment output with the maintained terminal
   screenshot renderer, then inspect the PNG. Use `npm run screenshot` with the
   injected engine/Shell because the root CLI cannot install this optional plugin.
   Keep disposable screenshots out of Git; do not add a QA runner script.
7. Record concrete passing cases and limitations in `docs/pptx`, attach the
   capabilities register receipt, and commit only owned files/hunks on main.

## Accounting boundary

Parsed all inventory documents: 2,409 API records have identities represented in
2,426 command-register SDK rows; 2,700 unit variants and 973 BDD examples remain
separate. All 60 format feature rows remain visible. These are accounting totals,
not verified implementation counts. This discovery increment does not convert
historical planned model/test entries to passing parity claims or hide inherited,
underscore-prefixed, enum, helper, collection or untested public obligations.

J06/J08/J10 apply: explicit asynchronous input admission, neutral stable errors,
and one format-package operation engine behind SDK and CLI. No model names or
collection semantics change. Publisher decks and reference-runtime binaries are
unnecessary for this gap; no download, execution or cleanup is planned.

## Execution receipt

Original SDK tests first reproduced four discovery failures; all three Shell
cases independently reproduced optional-input rejection. Review added security
marker, cumulative-limit and schema cases. Final focused SDK result: 12 passed.
The new tests use original in-memory ZIP/XML plus memfs and make no host writes.

| Maintained or focused check                                                                  | Result                                                                    |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `npm run test --workspace=pptx -- --reporter=dot`                                            | 261 files, 6,833 tests passed                                             |
| `npm run lint --workspace=pptx`                                                              | Passed source ESLint and source/test TypeScript checks                    |
| `npm run build:workspaces -- --workspace=pptx`                                               | Passed declared three-workspace dependency closure                        |
| `node --import tsx --test packages/safe-bash/tests/commands/pptx/capabilities-input.test.ts` | Three passed against built public exports                                 |
| Integration input registration test, exact maintained test-name filter                       | One passed; new literal path included among 1,111 discovered active files |
| `npm run lint:eslint`                                                                        | Passed all 12,290 configured inputs, zero errors/warnings                 |
| New format sources and docs Prettier; staged `git diff --check`                              | Passed                                                                    |

Root inspected `/tmp/pptx-capabilities-help.png` captured by the maintained
`npm run screenshot` renderer from actual built SDK help and selector-error
output. No clipping; statuses 0 and 2; scope, limits and support boundaries are
explicit. This is terminal QA only. The Shell cases separately validate actual
adapter execution. No screenshot tests or QA runner scripts were introduced.

The shared command engine and integration registration file already contained
unrelated edits. Only worker-owned patches were applied to the index; all other
changed and untracked files remain outside this commit. No README, downloaded
fixture, ignored file, reference binary, push or release is included.
