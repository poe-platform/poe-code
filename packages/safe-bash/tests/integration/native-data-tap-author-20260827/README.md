# Native-data canonical TAP fixture repair — 2026-08-27

Author evidence, ready for different-agent review. **No product/root configuration
change, full gate, private checkout access or expr wiring.**

## Frozen exact delta

- Fixture candidate `e422ad06b3470477b7f9323c89289d2963a00407`.
- Baseline parent `647f42b9abf9f5abc4de3e36c74410b3bb63df3c`.
- Sole changed path: `tests/plugins/qualified-current-release-native-data/controls.test.ts`.
- Old SHA-256: `8ef246ff8e6411bb35680d713bb808eccd371143122a026e745971e96a43c562`.
- New SHA-256: `f1a94e3a45750bd66ce3118a27664922599124abca0a303279b5143fa8b9dc92`.

Exactly two lines change. The current forwarding npm script receives
`npm test -- --test-reporter=tap`. The synthetic historical direct-node script
gets `--test-reporter=tap` immediately after `--test`, **before** its positional
`"tests/**/*.test.ts"` glob. The committed historical `before-02.json` is unchanged.
All argv fixtures, seven discovered paths, five filtered positives, two deliberate
unfiltered data failures, exact counts, named-neighbor/marker assertions and
compiler-policy/source-error controls remain unchanged. No expectation derives
its value from current output. The replay authenticates the exact two replacements
and rejects any additional candidate path delta.

## Actual bounded results

| Frozen input / installed runtime | Tests | Pass | Fail | Status |
| --- | ---: | ---: | ---: | ---: |
| Unchanged baseline / Node22.22.2 | 8 | 8 | 0 | 0 |
| Unchanged baseline / Node24.11.1 | 8 | 7 | 1 | 1 |
| Repaired candidate / Node22.22.2 | 8 | 8 | 0 | 0 |
| Repaired candidate / Node24.11.1 | 8 | 8 | 0 | 0 |
| Remove only current-child TAP flag / Node24 | 1 focused | 0 | 1 | 1 |
| Remove only historical-child TAP flag / Node24 | 1 focused | 0 | 1 | 1 |

All rows have zero skipped/TODO/cancelled tests. The two mutants fail the intended
TAP count assertion, not setup/import failure. Both flags matter: the current
positive must execute5 tests, and the historical unfiltered negative must execute7
with exactly2 deliberate failures. Passing the repaired outer test proves those
unchanged assertions are reached. No weakening of the discovery exclusion or
compiler policy was needed. A separate strict frozen test/helper TS check exits0
with empty diagnostics; this is not `typecheck:all` or product compilation.

The supervisor has19 successful checks covering expected natural outcomes,
observed child runtime identity, protected-input inventories and tool hashes.
These are not19 new product features or a replacement for independent review.
Original independent397894e0's Node24 **7/8 remains historical nonpass**; this
new repaired-input result does not rescore it.

## Isolation and runtime qualification

Each row materializes13 exact Git-bound fixture/config/manifest/current-consumer
input files in a new OS-temp directory; no live product inputs or full repository
copy is needed. The four current consumer sources are presence-route assertions,
not runtime/public DU acceptance in this test. Type-error neighbors and raw-data
test files are synthesized by the unchanged fixture in its own disposable copies.
Before/after inventories include directories and reject changed, missing or added
entries in the13-input trees. The explicitly staged `node_modules` tooling link
is outside that protected inventory; no universal tooling-tree immutability claim.

Both Node binaries and the npm CLI/TS compiler/tsx metadata entry identities are
captured before/after. Node24's installed npm symlink is broken, so a task-owned
wrapper explicitly runs the existing **npm10.9.7 Node22 installation under the
selected Node binary**. Child PATH resolves that same selected Node, not Node22
silently for the Node24 row. Startup records identify actual npm/compiler/test
children' execPath/version/argv; all observed runtimes match their selected row.
Records are startup observations, not claimed unique PID counts or a module-load
authentication hook. No installs, global npm config changes or product minimum
version changes occurred. These are installed Darwin arm64 profiles.

Node22 SHA `5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`;
Node24 SHA `4255a388254ca4319e2f95f1da375d5deaddf25baf9c7c85070b67f9543b15d0`.
Compiler/CLI hashes, input blobs, argv and complete stdout/stderr are in the raw
receipts. Fixture-created scratch roots were disposed and post-inventories match;
all synchronous children returned naturally, without watchdog termination.

## Preserved first supervisor failure

The first author supervisor assigned both isolated npm user/global configuration
to `/dev/null`; npm rejected double-loading the same config before nested test
bodies. Raw7/8 outcomes in that attempt are **not** the reporter reproduction or
successful negative controls. That supervisor's status is fail. Its original code,
all command outputs and traces remain in `setup-failed/*`. The second supervisor
uses distinct empty task-local config files and strengthens failure-cause checks;
the committed fixture candidate is identical. No timeout, product or expected
canonical output changes were made to fix the supervisor.

## Reproduce and review

```sh
node tests/integration/native-data-tap-author-20260827/replay.mjs
node tests/integration/native-data-tap-author-20260827/verify.mjs
```

The first executes only the bounded rows against the hard-bound commits using
cached tools; it creates new unique output. The second checks the sealed31 raw
captures and original/current mapping, not a fresh behavioral run. The compressed
bundle is about72KB, retaining full JSON, trace logs and both supervisor versions.
`MANIFEST.json` supplies SHA-256/length for every losslessly decoded capture;
`capture.mjs` refuses to overwrite its output directory. Root should route the
fixture commit and this evidence to Meitner. Independent acceptance is pending;
no native49-asset gate, DU package rebuild, global typing or whole-product test
claim is made here.
