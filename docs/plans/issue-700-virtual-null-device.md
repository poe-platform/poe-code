# Issue 700: virtual null device for injected filesystems

## Validated problem

Issue 700 is authored by kamilio. Its current requirements cover direct command
filesystem access as well as redirects. The installed public-artifact probe in
`/tmp/kamilio-700-null-device-red.json` reproduced persisted diagnostics, stale
reads, canonical-path writes, deletion of historical rows, and absent-device
ENOENT. The subsequent SHA-2 changes did not add a device boundary. This evidence
does not establish persistent-service or workerd acceptance.

## Required behavior

- Install a public SafeFS device view at the Shell execution filesystem boundary,
  including execution overrides, before invocation operation accounting. Nested
  execution must preserve the same view and existing cleanup/budget semantics.
- Reserve `/dev/null`: EOF reads, discarded normal/append writes, EEXIST exclusive
  creation, ENOTDIR traversal through the device, and protected replacement,
  removal and ancestor mutations. Canonical paths and supported symlink aliases
  must not bypass the device. Ordinary backing files retain their behavior.
- Expose the device as an explicit character-device FileType with zero size and
  allocation, fixed readable/writable permissions and stable view-owned identity.
  Extend supported metadata/bridge consumers rather than claiming a regular file
  is a character device. `/dev` is a visible directory; listings merge siblings,
  mask duplicate historical null entries and honor entry admission limits.
- Do not write, delete or allocate quota for a backing null row. Existing rows
  remain untouched and are masked only through the view. Listings that bypass
  the view remain the application's responsibility until explicit cleanup.
- Streaming must drain in bounded space, yield cooperatively, observe aborts,
  and await producer cleanup while preserving the primary error, including falsey
  abort reasons. Copying to the device must not delegate storage publication or
  collect the whole source; unsupported streaming backends fail explicitly.
- Keep normal-file capability and entry-identity behavior. Reject unsupported
  device mutations explicitly instead of silently forwarding them to storage.

## Implementation boundaries

The public entrypoint is `createDeviceFileSystem(filesystem)` returning an
idempotent device view; `DeviceFileSystem` is its named implementation. SafeFS
owns path routing, metadata, capabilities, bounded streams and backing protection.
SafeBash installs it once at the root execution boundary, and recognizes the new
character-device metadata in relevant commands. No provider-specific branch,
ambient host device, native fallback or new runtime dependency is required.

## Validation and delivery

Use TDD for SafeFS and actual Shell workflows with in-memory backing mutation
spies. Cover fresh and historical rows, aliases, retained reads, write modes,
copy, tee, metadata, directory limits, reserved ancestors, falsey cancellation,
producer finalization, overrides and nested invocation. Preserve existing
ordinary-file capability, identity and cleanup regression cohorts.

Then run maintained workspace/full tests and lint, normal build, packed installed
public consumers, and actual workerd with no Node compatibility flags. Exercise
an injected persistent adapter, a large canceled stream, and a backing-store spy;
memory-only tests are not acceptance for those requirements. Verify public
metadata output visually when command rendering changes. Push only validated
changes after pulling/rebasing; close the issue after verified remote delivery,
and monitor both releases until successful publication. No fix is claimed yet.

## Development evidence

- The six installed public Shell smoke workflows fail against the untouched
  SHA-2 candidate, recorded through `/tmp/kamilio-700-public-red.path`. This is
  pre-fix candidate evidence, not a freshly fetched npm-version claim.
- Actual workerd reproduction uses three fresh containers with the same owned
  persisted R2 storage. A 32-byte historical row survives recreation, is replaced
  by a 45-byte diagnostic by the unfixed Shell, and remains corrupted after a
  further recreation. Ordinary persistence is a separate positive control.
  The report at
  `/tmp/kamilio-700-workerd-qa.vtgWif/candidate-aDRgZj/continuity-DsNK0C/baseline-report.json`
  explicitly records feature acceptance as false. Its isolated-runtime graph,
  pinned tools, storage continuity, artifact hashes and cleanup were inspected.
- A selected workspace build does not restore the root shared runtime bundles.
  The subsequent normal `npm run build` completed and its canonical
  `poe-code/safe-fs/core` device-factory import was verified. Browser bundle and
  package checks then passed 11 tests; the playground workspace passed 166 tests.
  These are intermediate build results, not final-candidate acceptance.
- Post-installation Shell regressions exposed force-copy admission, append
  admission over read-only backing, raw traversal normalization, host-method
  assignment, and zero-consumption stream cleanup. Preserve those failures and
  their negative tests while correcting the implementation. Newly visible
  `/dev` entries require explicit current-listing expectations, not hiding the
  device or dropping ordinary-file assertions.
- Device views intentionally add bounded stream methods and mixed path-specific
  capabilities. Keep the original transparent-scoping assertions against
  `scopeFileSystem` itself, and separately assert the effective Shell device view;
  raw optional-method absence cannot describe the newly provided device methods.
- An intermediate real-playground visual check shows discarded writes, EOF,
  `crw-rw-rw-`, character-device metadata, zero size and a ready prompt. The image
  `/tmp/kamilio-700-playground-visual.K6tnmg/device-output.png` was inspected;
  its browser session was closed afterward. This validates rendering, not the
  final packed candidate or publication.
- The mixed view exposed ordinary-file regressions where callers used global
  permission flags or optional-method presence instead of actual-path
  capabilities. Reproduced failures cover capped stream fallbacks, strict
  permission refusal, and cross-device move timestamps. The fixes preserve
  existing bounds and refusal semantics; they do not add unbounded fallbacks.
- Final source-focused SafeFS checks pass 53 device tests and 249 related tests.
  SafeBash's device cohort passes 37 tests and its main affected cohort passes
  802 tests. A separate 26-case family regression suite covers absent methods,
  explicitly disabled streams, bounded fallbacks, cancellation, read-only
  backing files, and masked historical rows.
- The third normal build succeeds. Its rebuilt public bundle, packaging, and
  playground checks pass 177 tests. Installed local tarballs bound to commit
  `765f74fb9affc8fc522421fa30e385f083b5fdc8` pass Node, Bun, public declaration,
  browser bundle/runtime, legacy coexistence, and standalone SafeFS checks.
  The initial standalone check exposed ambient `/tmp/node_modules` resolution;
  rerunning in an isolated temporary root passes without product changes.
- The full lint route passes with zero diagnostics. A subsequent source/test
  typecheck identifies a frozen historical raw-memory snapshot type that cannot
  represent the new general FileType. Its exact import edge gets a compile-only
  declaration of raw MemoryFileSystem's actual three node kinds; general device
  types remain unchanged and historical evidence is not rewritten.
- A full test attempt passes 20,298 shared tests, with one existing skipped
  test, but reaches the type-model worker's new test before its implementation
  is finished. Preserve that failure and rerun the full route after the worker
  freezes. Full repository tests, persistent workerd acceptance, and publication
  remain pending; focused results do not substitute for those gates.
- Candidate `765f74fb9affc8fc522421fa30e385f083b5fdc8` passes 37 actual
  workerd groups using three recreated instances sharing persisted local R2.
  Historical bytes, ETag and metadata are unchanged; device mutations remain
  zero. A 256 MiB finite drain yields cooperatively, and six logically 1 TiB
  canceled streams produce only 64 KiB each and await producer cleanup once.
  The report is
  `/tmp/kamilio-700-workerd-qa.vtgWif/candidate-XE8woS/continuity-5avclZ/final-report.json`.
  This is local Miniflare persistence, not a remote Cloudflare deployment or a
  publication claim. Later runtime changes require fresh candidate validation.
- The next full test run catches eager buffered-input acquisition that can
  block cancellation before the caller receives its source. An initial lazy
  correction passes 49 input tests but conflicts with required eager snapshots
  for originally buffered backends. The final correction retains the original
  filesystem's private input-selection profile through nested Runtime instances;
  all actual reads still use the scoped device view. This preserves both eager
  buffered acquisition and lazy mounted fallback, including execution overrides
  and host-method changes.
  Other current comparisons need explicit ordinary-fixture namespaces or
  metadata-only probe expectations because the Shell root now contains `/dev`.
  Preserve frozen native captures, original output bounds, and mutation checks.
  The final affected input/path cohort passes 679 tests and both complete GNU
  differential drivers pass 187 tests. Tree/current-shell/substring checks pass
  302 tests, DU/rmdir checks pass 63 tests, and the full cd-budget file passes
  59 tests. Frozen references and original bounds remain unchanged. A fresh
  build, packed candidate, full gate, and workerd revalidation are still required;
  no push is claimed.
- An independent installed-consumer probe against `5de688d3a` exposes an alias
  bypass on a mixed mount: an unrelated read-only mount makes the global
  symlink-creation capability unknown, causing an existing `/alias` to reveal
  and overwrite the historical null row. The evidence is
  `/tmp/kamilio-700-mixed-mount-alias-red.json`. Alias inspection must use entry
  metadata rather than creation capability; unresolved discovered links must
  fail closed. New mixed-mount/read-only controls and persistent workerd cases
  are required before the next candidate is accepted. Earlier 37-case workerd
  passes do not certify these newly reproduced compositions.
- Candidate `a6d2a7aa5fd99612af08b941de8a27c60cd36d81`, packaged as
  `0.0.0-issue700-local3`, passes all 43 expanded actual-workerd groups with
  no failures or skips. Mixed-mount and read-only-root aliases pass through
  the public factory and Shell; no backing-device calls occur. Historical
  bytes, ETag, and metadata remain unchanged across three recreated local
  Miniflare instances. The report is
  `/tmp/kamilio-700-workerd-alias.gf3bQt/candidate-jzpi0M/continuity-GOn15f/final-report.json`.
  It verifies 59 unchanged input hashes, three tarball SRI bindings, and
  40 installed-file bindings. All owned instances and containers are disposed.
  Installed Node, Bun, browser, type, legacy-compatibility, and isolated
  SafeFS-only checks also pass. This remains candidate evidence, not a
  published-release claim.
- The final alias-admission cohort passes 1,383 of 1,384 tests; the remaining
  WebDAV assertion expects the old metadata-probe sequence. Its additional
  ancestor and final-entry probes are all depth-zero `PROPFIND`, with no
  content reads or mutations. Updating that exact ordered trace preserves
  status/output and metadata-only assertions; the complete focused file then
  passes all 59 tests. Commit `ed01103b3` changes only that test expectation,
  not the validated candidate's product code. The fresh full repository gate
  and final lint are running; delivery and publication remain unclaimed.
- The complete serial shell run then reports 22,512 passes, four failures,
  no cancellations, and 63 skips. Two failures are the same metadata-only
  WebDAV admission change in other current tests; their complete files pass
  66 tests after exact request-trace updates. The remaining two expose a test
  importing raw sibling-source MemoryFileSystem alongside canonical packaged
  FsError, creating incompatible error identities. Using the existing public
  adapter import fixes all 37 tests in that file without changing any assertion
  or product code. The original EOF-probe, streaming, and byte-bound checks
  remain intact. Preserve the failed run at
  `/tmp/kamilio-700-full-gate-v5.1kgJYn/log` and rerun the complete maintained
  uncached route with its supported workspace concurrency and reviewed shell
  parallelism; do not substitute focused passes for the full gate.
- The cross-workspace parallel attempt exits 134 when the native terminal
  test process aborts. Its isolated maintained suite passes all 288 tests;
  no product change or test exclusion is made. The subsequent complete
  `npm test` run uses serial workspace scheduling and the supported reviewed
  shell scheduler. It exits zero, including native lifecycle scripts and root
  posttest lint-stress checks:
  `/tmp/kamilio-700-full-gate-v7.mEJhzb/log` and its `exit` receipt.
  The orchestrator reports 71 workspaces, 40 declared unit tasks, uncached
  execution, and no exclusions. Shared tests pass 20,317 cases, shell tests
  pass 22,516 cases, SafeJS passes 21,651 cases, and native terminal tests pass
  288 cases. Existing skips remain explicitly reported, not counted as passes.
  Final repository lint also exits zero at `/tmp/kamilio-700-lint-v6.log`.
  Product code is unchanged from the 43-case workerd candidate; subsequent
  commits contain only validated test corrections and this evidence record.
- The final normal `npm run build` and packed CLI `npm run smoke -- --prebuilt`
  both exit zero. The latter verifies CLI commands, SDK imports, canonical
  SafeFS public identity, and portable declarations from an installed tarball.
  Receipts are `/tmp/kamilio-700-build-final.exit` and
  `/tmp/kamilio-700-smoke-final.exit`. These complete local release validation;
  remote-main delivery and GitHub publication must still be verified separately.
