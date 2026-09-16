# PPTX public adapter contract receipt, 2026-09-13

This is bounded live-working-tree evidence. No product/test files, README,
fixtures, corpus bytes, downloads or upstream inventory dispositions changed.
The [agent procedure](../plans/pptx-adapter-contract-qa-20260913.md) identifies
ownership. No commit or push was performed by this worker.

## Maintained original command tests

Executed from repository root with Node v22.23.2:

```sh
node --import tsx --test --test-concurrency=1 packages/safe-bash/tests/commands/pptx/*.test.ts
```

Exit 0: 239 passed, zero failures/cancellations/skips/TODOs, 32,864.977 ms.
This run began before the coordinating worker's selected build completed; it
is useful baseline coverage, not proof that every process loaded the final build.
The tests use the public `pptx` package and actual safe-bash source adapter.
A direct focused run is not the full maintained workspace gate.

## Post-build common contract checks

After root reported successful `npm run build:workspaces -- --workspace=pptx`,
an ephemeral `node --import tsx --input-type=module` invocation created original
one-slide Harbor/Meadow decks through public `createPresentation`, placed bytes
in memfs, injected its reads into `MemoryFileSystem`, and registered the actual
`pptxCommands` plugin in `Shell`. There was no document host I/O, network or native
presentation runtime. All 25 commands below had `pptx` prefixed and `--json`
appended, including the intentional duplicate JSON case.

Every response asserted exact keys `version`, `operation`, `ok`, `data`,
`warnings`, `errors`, `affected`, `locations`, and version 1.

| Command arguments | Expected and observed status |
| --- | --- |
| `inspect left.pptx` | 0 |
| `inspect bad.pptx` (original invalid bytes) | 1, invalid-archive |
| `inspect absent.pptx` | 3, io-failure |
| `inspect left.pptx --slide 0` | 2, invalid-value |
| `inspect large.pptx` (65,537 bytes; 65,536 ceiling) | 4, resource-limit |
| `inspect left.pptx --limit maxBytes=512` | 2, inapplicable option |
| `diff left.pptx left.pptx` | 0 |
| `diff left.pptx right.pptx` | 1, successful comparison |
| `diff left.pptx absent.pptx` | 2, io-failure |
| `diff left.pptx right.pptx --limit maxBytes=8193` | 2, invalid-value; zero reads |
| `image list left.pptx` | 2 |
| `table list left.pptx` | 2 |
| `metadata list left.pptx` | 2 |
| `replace left.pptx --find Harbor --with Test --all --dry-run` | 2 |
| `inspect left.pptx --in-place` | 2 |
| `inspect left.pptx --unknown` | 2 |
| `inspect left.pptx --json` | 2, duplicate option |
| `images list left.pptx` | 0, images.list |
| `tables list left.pptx` | 0, tables.list |
| `properties list left.pptx` | 0, properties.list |
| `text left.pptx` | 0, text.get |
| `text get left.pptx` | 0, text.get |
| `text replace left.pptx --find Harbor --with Test --all --dry-run` | 0, text.replace |
| `schema inspect` | 0 |
| `capabilities` | 0 |

Trusted XML maxBytes was 8,192 and archive/input ceilings 65,536 for the fixed
diff check. A read counter remained unchanged when 8,193 was requested.

The first ephemeral invocation incorrectly expected `inspect --limit maxBytes=512`
to return 4. Actual behavior correctly rejects this inapplicable flag with 2.
The corrected run retained that assertion and separately used oversized bytes
to verify ordinary resource-limit status 4. This was a QA expectation correction,
not a product failure or changed test.

Public command-engine invocations for `inspect` and `diff` with already-aborted
signals each returned 130 without invoking the supplied read callback. The
Shell's caller-abort API has its separate host contract: existing original tests
assert rejection with the caller's exact reason and closed input stream. Neither
result is described as a DOCX paired cancellation pass.

## Counterpart declaration and pending runtime

No DOCX implementation package, safe-bash command export or executable command
schema was found. `docs/docx/command-coverage.json` is absent. DOCX §6 explicitly
adopts the shared Office CLI/SDK contract, plural images/tables/properties,
text replace, no singular/metadata aliases, ordinary 0/1/2/3/4/130 and comparison
0/1/2/130. That declared contract agrees with PPTX §6 and the shared specs.
Machine-schema comparison and every DOCX runtime half remain **pending**.
No paired success or whole-public-API coverage claim follows from this receipt.

Read the four required pinned API/test audit/inventory inputs. Their metadata
contains 2,409 API records and 2,700 unit plus 973 BDD identities. These counts
are research obligations, not passes or proof of inherited/public member parity.
No underscore-prefixed member was reclassified by this QA.

## Visual inspection

The maintained `npm run screenshot -- --no-header --output
/tmp/pptx-diff-limit-contract-20260913.png node --import tsx --input-type=module
-e ...` runner captured an actual registered Shell invocation, with the same
explicit context above, no document reads and command
`pptx diff left.pptx right.pptx --limit maxBytes=8193`.
The ellipsis represents ephemeral inline setup, not a QA script artifact.

Opened the PNG and inspected the full command, diagnostic and exit line:
`pptx: invalid-value: Limits must lower trusted ceilings; output requires at least 512 bytes.`
Status 2 was visible. Text was readable and uncropped; no document content,
reference-project identity or internal XML leaked. Screenshot is disposable,
not a unit test or tracked artifact.

Post-build focused command verification:

```sh
node --import tsx --test --test-concurrency=1 packages/safe-bash/tests/commands/pptx/diff.test.ts packages/safe-bash/tests/commands/pptx/selectors.test.ts
```

Exit 0: 46 passed, zero failures/cancellations/skips/TODOs, 5,323.587042 ms.
This refresh specifically covers public adapter comparison, selectors, grammar,
publication, discovery, streams and caller cancellation against the rebuilt SDK.
