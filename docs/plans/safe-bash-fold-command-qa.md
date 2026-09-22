# Fold command integration QA

Use the current working tree; preserve unrelated edits. This qualifies the private
`safe-bash-command-fold` owner and public opt-in `commands/fold` route, without
changing default registration or publishing the private workspace.

1. Run the command workspace's maintained lint and unit routes. Verify byte-mode
   CLI/SDK equivalence, literal paths after `--`, stdin, continued file errors,
   cross-file prior glyph width, producer reuse/property overrides, unavailable
   locales, invalid byte argv, NUL paths, cancellation, cooperative cleanup,
   output failures and combined invocation resource gates using memory VFS.
2. Run the maintained full build, repository lint constituents, package lint and
   `npm test -- --no-cache`. Serialize builds and unit prerequisite builds because
   they share guarded `dist` inputs. Report unavailable/skipped cases separately.
3. Stage the three public libraries with `scripts/package-safe.mjs`, pack them
   with scripts disabled, and install only their tarballs into a fresh consumer
   outside the checkout. Never install or publish the private fold workspace.
4. Execute `safe-packages-fold.mjs` in that consumer. Verify the engine, actual
   Shell byte argv, canonical runtime identity, opt-in registration in an empty shell,
   pipes, VFS scripts, ordered file errors, collision rejection and SDK parity.
   Typecheck `safe-packages-fold-types.mts` with strict NodeNext, exact optional
   properties and unchecked indexed access. Check the packed JS/declarations for
   bare private specifiers and verify private command/contracts are absent from
   the consumer installation. Run existing smoke/registration consumers too.
5. Capture and inspect an ad hoc screenshot of actual opt-in fold command output.
   Purge task-owned staging, screenshots, logs and external consumer after recording
   findings. `/out` is read-only on this host; use ignored `out/command-fold` for
   repository-local temporary evidence and an OS temporary installed consumer.

## Source qualification

Fetched the GNU coreutils 9.10 archive and independently verified SHA256
`16535a9adf0b10037364e2d612aad3d9f4eca3a344949ced74d12faf4bd51d25` in memory.
Read `src/fold.c`, the fold manual section and all five released fold tests;
compared source/manual with development snapshot
`b25722854370b8206d7f53f8934c36710cdd9974`. These are source-derived findings;
no host fold executable or native runtime oracle was invoked for this task.
Release `-s` uses `c32isblank && !c32isnbspace`, whereas the snapshot uses
`c32issep`. Previous glyph width is static across LF/files. UTF-8 byte mode
preserves decoded scalars while C decodes independently. Existing engine tests
qualify the explicitly pinned portable profile, not an ambient libc locale.
Checked arithmetic rejects unqualified native unsigned underflow.

Source SHA256 receipts:

| Released file | SHA256 |
| --- | --- |
| `src/fold.c` | `579245402394706b2e75909991bb6379d17c814611c7d24367c5c94df938d25d` |
| `tests/fold/fold.pl` | `7e2e2b7b6fcce043d2b358ce0c2a24b1785b58ccf50e7aa94832d9cc04a6f00f` |
| `tests/fold/fold-spaces.sh` | `aa8f0683c4bea68b157728e1b6d8265d2bde82dc39d9dd4a28de46276f0b1c27` |
| `tests/fold/fold-nbsp.sh` | `611bb243384ed34cba49d3f4ce960acf2fc990b2b4fb02aa03524424c0b5da9d` |
| `tests/fold/fold-characters.sh` | `372417e670bbf24e82357ddb392d178cd8444dd962c1cf6d4ea9135de46b7c1c` |
| `tests/fold/fold-zero-width.sh` | `0523b31484257aaa03be34fd0c8abe6ee4cfea31e1aae48052c1dbd078f2915d` |

Snapshot `src/fold.c` SHA256:
`0172cb5af864c0f75eacce93778c1b72510869a2d333c9c4b9a7d1458c77e3a9`.

## Verification receipt

- Command workspace lint/typecheck and all 42 unit tests passed. Command tests
  used memory streams/VFS and mocked capabilities; no unit-created files or LLMs.
- Full `npm run build` passed through workspace builds and all root suffix stages.
  Selected Safe Bash build closure also passed. The first overlapped full unit
  attempt stopped at the guarded compiler identity check; builds were serialized
  for subsequent verification. No guard or assertion was weakened.
- Repository-wide uncached ESLint completed with zero errors and four warnings.
  Focused lint of final command/package fixtures passed; `lint:types`,
  `lint:packages` (all 18 maintained rules) and `lint:workflows` passed.
- Full unit verification exposed missing root Fold workspace membership and
  missing declared asset owners in generic memory packer fixtures. Added the
  root dependency and fixtures, preserving exact output inventory assertions.
  All 155 packer tests and both workspace-membership tests then passed.
  The final complete `npm test -- --no-cache` rerun is pending.
- Staged version `0.0.0-fold-command-qa`; installed only the three public tarballs
  offline, with scripts disabled, in a fresh external consumer. Fold runtime and
  strict NodeNext declarations passed, as did existing smoke and registration
  consumers. AST inspection covered 1,256 packed JS/declaration files with no
  bare private command/contracts specifiers. Private Fold/contracts packages
  were absent from consumer `node_modules`.
- The empty Shell has no Fold registration. Existing `agentCommands()` contains
  the older Fold implementation; that registration was preserved. The new package
  requires explicit `foldCommands({ replace: true })` when composing that bundle.
  Initial installed harness assumptions about default commands and synchronous
  queued-plugin setup were corrected; no product behavior was changed for them.
- Actual installed Fold output screenshot captured with the maintained screenshot
  tool and visually inspected: separator-inclusive wrapping and explicit unknown
  option diagnostics rendered correctly. No screenshot test was added.
- Node ESM is qualified here. Bun and actual browser/workerd engines were not
  executed; no new export conditions or native-oracle availability are claimed.
- Temporary evidence uses ignored `out/command-fold` and an external consumer
  because `/out` is read-only on this host. Purge is pending final unit completion.
- Local commits: none. Verified remote-main delivery: none. Successful releases:
  none. No push or private workspace publication was requested or performed.

Tarball SHA256 receipts (runtime staged before README-only additions):

| Public artifact | SHA256 |
| --- | --- |
| Safe Bash | `fd46f2be42761e763e8a8ac93058b2b0f7d3e68725fe9f20461380ef654ea7d3` |
| SafeFS | `7dc88869ffd0150879fd5e401a47caecb2657d64172ab9df6d1773071f424fd5` |
| SafeJS | `8e44770c4fa98eebe8d1f761aa0861ad258332daafe42f8388f8c3f99bce32ae` |

The Fold command's runtime dependencies remain empty; its sole first-party
prerequisite is the private canonical contracts owner, bundled through the
qualified package-pattern path. This receipt makes no whole-Safe-Bash-artifact
zero-external-dependency claim for unrelated engines.

## Final-source verification follow-up, 2026-09-19

Three ownership/lifecycle repairs were reproduced with failing memory-only tests
before implementation:

- Mutating SDK operands immediately after `fold()` redirected the deferred
  invocation. SDK operands now receive synchronous, bounded admission and an
  owned snapshot before yielding to the caller.
- Intrinsic `subarray` still invoked producer-controlled `Symbol.species`, which
  replaced `abcdef` with `xxxxxx`. Bounded input views now use intrinsic storage
  and offset accessors, preserving original bytes without producer callbacks.
- Synchronous abort listeners could reenter cleanup before its completion was
  stored, producing two completion promises. Cleanup now publishes its shared
  completion before immediate cancellation and drains admitted work once.

The command workspace's 49 maintained unit tests and lint/typechecks passed.
Tests use memory streams/VFS and mocked capabilities. Final-source uncached
repository ESLint passed: zero errors, four warnings, 16,054 configured/linted
subjects and zero cache hits. Repository typechecks, all 18 package-lint rules,
workflow lint and focused fixture lint also passed. Normal `npm run build`
completed through workspace builds and every root suffix stage; absent build
declarations remain explicitly reported as not passes.

The complete `npm test -- --no-cache` attempt **failed**. Shared Vitest batches
passed with two reported skips; Safe Bash's 558 guarded runner checks passed.
Safe Bash then reported 41,881 passes, 829 skips and one failure in
`tests/integration/s3-http-exports/exports.test.ts`:
`private checkout refuses qualification through retired public exports`.
Its verifier rejected the uncommitted Fold package metadata before reaching
the expected retired-public-runtime refusal:
`Peer binding requires the selected committed package metadata`.
The selected committed HEAD manifest lacks the working tree's Fold export,
dependency and private profile. No guard was bypassed, assertion weakened,
timeout raised, or existing working-tree metadata committed to conceal this
failure. Later workspace unit stages and root posttest were not reached; this
receipt does not claim a successful complete unit gate.

After the final build, staged version `0.0.0-fold-final-verified` and installed
only the three public tarballs offline, with scripts disabled, into a fresh
consumer outside the checkout. Maintained Fold, smoke and registration fixtures
passed, including immediate SDK operand mutation and a throwing producer
constructor. Strict NodeNext Fold declarations passed. Neither private Fold nor
contracts was installed; AST inspection of 1,256 packed JS/declaration files found
no bare private command/contracts specifiers. A direct public-artifact lifecycle
control verified shared reentrant cleanup completion, canonical `FoldError`,
and cooperative VFS iterator drainage. Registration remains opt-in; the aggregate
bundle's existing older Fold registration remains unchanged.

Final public-artifact SHA256 receipts:

| Public artifact | SHA256 |
| --- | --- |
| Safe Bash | `6e8e8700a5a5e79cd3835346b06757eca01c37d3435d34c8ed3221f77afd4075` |
| SafeFS | `ac9da29150a827866bca3f2ae4d46441019dd4ae0c28f05a8f680eb1293adbd8` |
| SafeJS | `3a6be5eb35a1b2f2921b1cca757d8484b3bb20da7d8ac0ed29f239107e219957` |

Independently reverified the released archive hash and reread released source,
manual and all five Fold tests alongside snapshot `b2572285`; source-file hashes
match the receipts above. These remain source-derived findings; no native Fold
oracle was executed. Qualified profiles remain C and the pinned portable
UTF-8/Unicode-17.0.0 profile; actual browser/workerd/Bun and arbitrary libc locales
are not qualified. Final installed command output was captured and visually
inspected with the maintained ad hoc screenshot tool. Task-owned temporary
evidence and both newly created external consumers were purged after recording.

Local commits: none. Verified remote-main delivery: none. Successful releases:
none. No push or private package publication was performed.

## Command-fold diff review follow-up

Reviewed the command, SDK, engine, opt-in export and qualified private build
recipe for ownership, cancellation, resource gates and unnecessary indirection.
Two failure paths were reproduced with failing memory-only tests and repaired:

- Cancellation could settle the invocation while the producer's asynchronous
  `finally` was still running: `readBytes` schedules iterator return without
  awaiting it after cancellation. Fold now owns one producer-close promise and
  awaits it before completing invocation cleanup.
- A producer-close error could replace an escaping downstream error. Cleanup
  now drains both reader and producer closure while preserving the primary
  failure. Additional controls preserve null, false, zero and empty-string
  cancellation reasons, close once and emit no input-error diagnostic.

All 52 Fold unit tests and maintained workspace lint/typechecks passed. The
selected maintained build closure passed via
`npm run build:workspaces -- --workspace=@poe-platform/safe-bash`.
No visual wrapping behavior changed; the existing screenshot receipt above
remains historical, not a new screenshot execution.

Reverified the released archive digest and reread Fold source, manual and all
five released tests, plus the development Fold source. The separator predicate
remains release-specific. Corrected the acceptance table's long byte-mode
expectation: after 3999 lines of three combining marks, the final three marks
and `a` fill seven bytes, then `bc` follows the inserted LF. This is a
source-derived correction supported by the existing exact-byte test, not a
new native observation.

**Unresolved completion blocker:** the committed-archive integration check
`private checkout refuses qualification through retired public exports` still
fails. A focused rerun rejects the working-tree package manifest with
`Peer binding requires the selected committed package metadata`, before the
expected shared-runtime refusal. The archive guard and its assertion were
preserved; no other contributor's metadata was committed or reverted to make
the check pass. This review does not claim a passing full test gate.

The host refuses creation of `/out` with EROFS. Fresh installed-tarball and
screenshot validation were not performed by this review. Earlier installed
receipts describe their earlier source versions. No local commit, remote-main
delivery, release or private workspace publication occurred.
Fresh `packageSafeLibraries` staging did complete using memfs output storage
and the actual maintained bundler and built inputs. AST inspection of all
1777 staged JS/TypeScript/declaration files found no bare private command or
contracts imports. This verifies staged artifact contents; it does not replace
an installed-consumer runtime/declaration check. The memory-only staging was
discarded with its process and created no host output files.

## Command-fold final installed review — 2026-09-19

Preserved the existing package/export/bundling implementation and unrelated
working-tree edits. Four failures were reproduced with memory-only failing tests
before repair in the command package: foreign-realm byte chunks were rejected;
a borrowed encoder produced foreign diagnostic storage; oversized argument
strings were scanned before budget admission; and caller cancellation arriving
while producer cleanup drained lost its reason to local invocation cancellation.
The fixes retain producer storage through intrinsic local views, allocate owned
diagnostic storage, check string-length lower bounds before scanning, and check
caller cancellation after awaited cleanup. Invalid/detached/fake/proxy byte
containers reject, and producer close runs once.

Final maintained command tests: 58 pass, zero fail/skips. Workspace lint/types
and selected build closure passed. Publication/build integration checks: 227
pass. Repository package lint passed all 18 rules. Repository lint completed
successfully (zero traversal gaps, four warnings); the earlier failed lint
attempt remains an incomplete run, superseded by completed lint execution.

Fresh public tarballs were installed offline outside the checkout with scripts
disabled. Installed Fold, general smoke, registration and strict NodeNext typed
consumer checks passed. Six foreign-realm CLI/SDK input routes and cancellation
during producer cleanup passed in that installed artifact. All 45 fixed
released Fold test variants passed through actual Shell pipes, literal VFS
paths and VFS scripts. AST inspection of 1260 installed JS/TS files found no
bare private command/contracts imports; neither private Fold nor contracts
package was installed. The maintained CLI screenshot was generated and
visually inspected for separator-inclusive wrapping and explicit unknown-option
status 1. Earlier browser-condition Node VM qualification covered 66 modules;
it preceded the final budget/cleanup repairs and is not a final-revision receipt.
Actual browser/workerd/Bun remain unverified.

The fresh full `npm test -- --no-cache` **failed**, not passed. The Safe Bash
runner passed 558/558. Its subsequent unit stage completed with 42711 tests:
41881 pass, 1 fail, 829 skipped, zero cancelled/todo, about 1164 seconds.
Earlier shared Vitest batches also reported two skips. The failing case remains
`private checkout refuses qualification through retired public exports`:
`Peer binding requires the selected committed package metadata` occurs before
the expected shared-runtime refusal because live manifests differ from selected
committed metadata. The archive guard/assertion were preserved. Downstream
workspace routes and root posttest completion are not claimed; focused reruns
are not a completed broad gate.

Independently verified GNU coreutils 9.10 archive SHA256
`16535a9adf0b10037364e2d612aad3d9f4eca3a344949ced74d12faf4bd51d25`,
and read released Fold source, manual and all five upstream tests alongside
development source `b25722854370b8206d7f53f8934c36710cdd9974`.
Release blank handling excludes NBSP; development separator handling differs.
These are source-derived findings, not native-oracle observations. Qualified
profiles remain C and UTF-8/Unicode-17.0.0; arbitrary libc locales, native unsigned
underflow and widths beyond checked JavaScript arithmetic are unqualified.
No host Fold utility was invoked. Existing original/checkpoint/replay smoke
checks passed; no new exhaustive replay matrix is claimed.

The 13-member source inventory hashes sorted relative path + NUL + binary
SHA256(file), including Fold src/*.ts, its package.json and public wrapper:
`4a6591d4d65e12a1c73de340b518f12c7d4344b7f9bc6a604f391eb1b8440dfa`.
Installed fixture SHA256:
`03fdf23bf5b0a64a90b82d09f0cdf1c89b358d8e409b39dd9154f906fdd65411`.

| Final public tarball | SHA256 |
| --- | --- |
| Safe Bash | `9a6482074b56c4e616634c6f2215027cdebcdcf749c79dce4cd8d4f85c540acb` |
| SafeFS | `21ebb06f52ccfcf4e4274dcbc1aa3eaae8f74d44c4cf11faeda6be1e9ebe49b0` |
| SafeJS | `993849ff7de34bdfad312bc8886e934054116bdf22d7e77e6b44deb35cef2eb1` |

These qualify dirty live sources, not a committed archive or release. `/out`
is unavailable/read-only; task-owned ignored staging and external consumers
were used and purged after recording. Local commits: none. Verified remote-main
delivery: none. Successful releases: none. No push or package publication.

Final `npm run build` completed successfully through all declared workspace
builds and root suffix stages. The maintained report recorded 82 builds,
48 shared-cache hits and one workspace with no declared build (not counted as a
pass). Playground circular-chunk and chunk-size warnings remain warnings;
no build failure occurred.
