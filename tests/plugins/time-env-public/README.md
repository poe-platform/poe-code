# Time/environment public integration handoff — August 27, 2026

This is the integration author's scoped evidence, awaiting a **different public
integration verifier**. Root relayed Sagan's c9b9626/61c66bc source acceptance;
f534134 seals the two canonical test migrations, independently reviewed14d42e2.
No time-env production implementation was changed by this integration.

## Exact candidate and results

- Production root wiring:41298e6. Current count fixtures:ba58068 and2a8be2e.
- Final frozen candidate:6ffe4f4f17637e44b55cc0455394513e8d6b94de.
- Source-tree SHA256:011f274582c14ba014704dda019bd01ba55c740bd0caf1ff964338c64fd26898.
- Packed tarball SHA256:1a757856aff57daa1fd3e5c40f4e011b1bb1ec43877f2fd5c8b6fae7f8e3ff5e.
- Frozen scoped source tests:306/306, zero failures/skips/TODOs. This is the
  explicit selected source-test list, **not** the full author/native/product suite.
- Moved packed public tests:18/18 twice, zero failures/skips/TODOs.
- Two maintained adjacent strict public consumers compile and execute unchanged
  apart from the documented count/tail migration: stream options and inspection.
- Production build/noEmit and strict moved-consumer declarations pass. Six
  deliberately invalid type uses fail with three TS2322, one TS2353, one TS2739,
  one TS2741. These are negative controls, not six valid consumer passes.
- Three execution denials pass: withholding the real packed time-env runtime
  breaks both root/subpath imports with ERR_MODULE_NOT_FOUND; access to the
  withdrawn source is denied with ERR_ACCESS_DENIED. No source fallback succeeds.

The exact commands, timestamps, Node22.22.2/TypeScript tool hashes, full source
manifest, published file list, compiler input list and raw results are in
`evidence/final.json`. TypeScript5.9.3 uses Node-only ES2023 libraries and
skipLibCheck:false for public declarations. There are no runtime dependencies;
manifest/lock development dependency metadata agrees. No lock/config changes.

## What is exercised

Root and `virtual-bash/commands/time-env` expose the same runtime functions and
types. The aggregate has an independent literal68-name expected set, adding only
date/sleep/printenv; optional curl/SafeJS stay absent. The aggregate's replace
policy remains authoritative even for a JavaScript caller injecting nested
replace:true. Collision rejection is checked through direct plugin setup and
actual async Shell setup; unrelated registered definitions retain identity.

Public dispatch covers default real Date.now/UTC, clock-once injection, timezone
precedence, qualified N/ISO-year formats, date-r VFS access, VFS/pipeline bytes,
printenv special own keys/empty/missing/NUL and unordered enumeration, and
unchanged host environment. A large Unicode pipeline checks awaited sinks,
multi-chunk delivery and lifetime. No protocol/native utility is invoked by
product commands. Test host permissions prohibit child processes and filesystem
access outside the isolated consumer; no native fallback is allowed. Network is
unused here; no network-denial control or network-confinement claim is made.

Sleep checks exact decimal sums/timer chunking, pre-abort/during-abort/dispose,
caller reason identity, cooperative fake timer ownership and listener cleanup.
The default actual Node timer is observed active, then absent before public
abort settlement; no universal preemption/global-worker-zero claim is implied.
Output limits assert both typed direct-command EFBIG and the existing Shell
status1/human diagnostic boundary, with zero stdout publication.

## Preserved attempts and fixture discipline

`evidence/attempts.json` retains exact failed-step output, commit, source hashes,
test counts and hashes of original reports, including successful intermediate
run05. Original full reports remain regular captures at
`/tmp/safe-bash-time-env-public-run01-20260827` through run07. All runtime/source/
tool-copy scratch directories were removed by each attempt's finally path.

- Run01: Node's --test launcher needs child-process permission. The harness now
  executes emitted node:test code directly, retaining the child-process denial.
- Run02:10/16; two registry reads preceded async setup, three expected synchronous
  Shell.use errors, one confused direct typed errors with Shell status mapping.
  Corrections await setup/exec and separately assert both public boundaries.
- Run03: strict TS2769 in the new direct negative test; CommandHandler permits
  sync results. An async assertion callback covers both modes, with no cast.
- Run04:15/18; three new tests compared constructor input object identity rather
  than the registry's defensive registered copies. Capture registered identities
  before replacement and preserve those identities across unrelated operations.
- Run05:259/259 plus18/18 twice; the package now includes the actual candidate
  README (early attempts omitted it from the archive). Payload/source are frozen.
- Run06:287 passes and one module-load failure: a newly selected adjacent test's
  helper was absent from the source archive. Adding its exact tracked helper,
  not changing tests or allowing source fallback, yields final306/306.

No production bug was fixed by these harness corrections. Count-only deltas
have separate commits and raw before/after captures in `migration/`:37/37 before
registration,29/37 unmigrated,40/40 revised with three extra collision probes;
adjacent43/47→47/47. Historical60/65-name source/evidence and the different
stream-five verifier's65-name holdout are untouched. New `.ts.fixture` inputs
are explicitly current templates compiled only by this runner; they do not
silently enter canonical TS or change the tracked .mts release inventory.

## Reproduction and next reviewer

With existing Node22/dev tooling, from the repository root:

```sh
node tests/plugins/time-env-public/verify.mjs \
  6ffe4f4f17637e44b55cc0455394513e8d6b94de \
  /tmp/safe-bash-time-env-public-new-review
node tests/plugins/time-env-public/seal.mjs
```

Use a new output path; prior evidence is never overwritten. The runner archives
the exact commit, builds in owned scratch, packs without lifecycle scripts,
extracts regular files, moves the consumer, withdraws source, strictly compiles,
and executes emitted JS with Node filesystem/child-process restrictions. Only
compiler standard-library files may resolve outside the consumer; public package
JS/declarations must resolve inside its regular-file installed dist. Runtime
dependency copies are not installed; copied Node/undici declarations are types
only. Borrowed development tooling stays outside private repositories.

The different verifier should challenge public options/types, shell setup and
collision behavior, family/shared limits, true clock/timezone defaults, own-key
environment semantics, lifecycle cleanup and denial controls. This author
report is not that independent acceptance. The broader native semantics harness
retains11 expectation failures/terminal-env assertion and five ICU differences;
bare %-N is a virtual-clock profile, not strict GNU/Darwin resolution parity.
The `%g` rationale is corrected only for rendered calendar0000–9999, with
negative-century counterexamples preserved in the root integration note.

## Qualified release handoff (not run here)

```sh
npm run verify:release:qualified -- \
  --source-commit 6ffe4f4f17637e44b55cc0455394513e8d6b94de \
  --native-assets-from "$PWD/tests/commands/metadata-stress/.oracle/coreutils-9.7" \
  --archive-tar-from "$PWD/tests/commands/archive/.oracle/gnu-tar/1.35/bin/gtar"
```

Existing scripts/native prerequisites/data exclusions/consumer inventory remain
intact. Read-only tracked-path preflight finds **20 unclassified .mts files**
(176 tracked versus156 inventoried), both before this integration atf534134
and at the final candidate. Exact paths/hashes are in `evidence/release-inventory.json`:
seven time-env historical/reviewer consumers, four WebDAV atomic-extension
consumer/example/HTTPS files, and nine captured WebDAV provider inputs. They
require evidence-backed classification/coverage by the release owner; no blanket
frozen label, exclusion or guard relaxation was added here. The unchanged
qualified runner will currently stop at this inventory assertion before service
tests. This pre-existing setup defect is distinct from product behavior.

Missing prerequisites are not passes. The known qualified WebDAV12/13
checkpoint belongs to its owner; these packed time-env results do not close it,
certify services, provide current global typecheck/full-suite evidence, or prove
overall superiority/72-hour goal completion.
