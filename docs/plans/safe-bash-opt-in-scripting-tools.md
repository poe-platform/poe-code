# Opt-in real-world scripting tools

## Request and delivery constraints

The September 4, 2026 request is to add all missing items identified in the
scripting inventory, subject them to native-tool scrutiny, keep them out of the
default package, and commit each tool separately. Work remains on main. There
is no request to push or release. Existing unrelated edits are not part of this
work.

New command families must remain explicit opt-ins: no registration in
`agentCommands`, `standardCommands`, or `browserCommands`, no root-barrel export,
and no accidental inclusion in the default bundled runtime. Shell extensions
must also require explicit opt-in rather than change default shell behavior.
Existing available commands, including date and the opt-in curl implementation,
are retained rather than duplicated. Browser-wide expansion is not authorized by
this request to keep additions out of the default package.

## Required scope

- Separate tools: cmp, shuf, dd, truncate, yes, install.
- Explicit virtual devices: /dev/null, /dev/zero, /dev/random, /dev/urandom.
- Qualify and expose the existing experimental yq implementation as an opt-in;
  presence of source code alone is not delivery.
- Shell extensions: trap (including EXIT cleanup), mapfile/readarray, fuller
  array support, read -a/-u/-t, background execution and wait.
- Preserve the existing date, sleep, timeout, mktemp, seq, byte tools, text tools,
  source/getopts/functions, heredoc, substitution and pipefail behavior.

## Acceptance and evidence

1. Establish a failing test or concrete missing-behavior reproduction before
   each implementation change. Unit fixtures use the VFS or memfs, not disk.
2. Define the real-tool dialect from primary documentation and executable
   native-oracle versions. GNU and BSD differences must be explicit, not mixed
   opportunistically. Match bytes, exit statuses, diagnostics, filesystem effects,
   argument grammar, and composition. Unknown or unsupported cases are not passes.
3. Validate retained binary arguments/chunks, cancellation, stream closure,
   backpressure and allocation/output limits. Infinite producers must stop when
   their consumers stop. No product native-process or implicit host-filesystem
   fallback is permitted.
4. An independent worker reviews and tests every implementation before root
   commits it. Root owns shared contracts, public/build wiring, test membership,
   this plan, integration and Git operations. Leaf owners have disjoint paths.
5. Keep exact default inventory assertions unchanged. Register every new canonical
   test literally in the maintained integration-input assertions. Use maintained
   scoped checks, then guarded build/typecheck and broader checks where shared
   interfaces change. Visually inspect output for user-visible command changes.
6. Commit each tool separately with relevant tests, semantics/evidence and plan
   updates. Never commit unrelated changes or bypass hooks. Report local commits
   separately from remote delivery and releases, neither of which is requested.
7. Do not declare the objective complete until every scope item has current
   source, behavioral, integration and delivery evidence. A partial wave remains
   partial even when its own tests pass.

## Initial evidence

- The source-loaded agent aggregate contains 79 commands; browser aggregate 28.
- `date -u -d @0 +%FT%TZ` succeeds with `1970-01-01T00:00:00Z`.
- cmp/shuf/dd/truncate/yes/install are absent from the aggregate and command source.
- All four device paths return ENOENT on the fresh memory filesystem.
- yq exists under src/commands/yq, is absent from default registries and exports,
  and is explicitly excluded in tsconfig.build.json.
- trap/mapfile/readarray/wait are absent from builtin registration; the parser
  rejects background `&`. read rejects -a/-u/-t; array subscripts are restricted.

## Work ledger

- Root reproduced mixed source/compiled runtime failures: binary argument
  ownership rejected and named output bypassed the public host's output budget.
  Runtime-bound command definitions now declare their contract-module identity.
  Independent review then reproduced mutable-identity and supplied-registry
  bypasses; regression tests failed before their fixes. Reviewed identity tests
  pass 9/9, and rebuilt public-host tests pass 6/6, including binary output,
  shared named-output accounting/cleanup, foreign empty/populated registries,
  replacement safety, and actual declaration compatibility. This guards accidental
  runtime mixing, not malicious host JavaScript or prototype tampering.
- An explicit local `build:optional` compiles a selected entry into the public
  host's own dist module tree. It does not add npm exports or default registrations.
  After successful compilation, workspace and root pack dry runs respectively
  contain 1,050 and 4,641 files with zero optional implementation leaks. Both
  manifests explicitly exclude optional artifacts even if locally compiled.
  These are live-worktree integration observations, not a frozen release gate.
- Current root reruns of the independently reviewed leaves: shuf 323/323 and
  truncate 348/348, zero skips, using the clean GNU 9.7 binaries and explicit
  digests. Their runtime-affinity tags are included in these reruns.
- The yq audit confirmed that the existing implementation is a restricted YAML
  plus jq subset, not qualified Mike Farah compatibility. New work begins with
  four reproduced correctness defects: flow comments, symlink-sensitive paths,
  raw-byte filename aliases, and cancellation starvation on empty input chunks.
  The pinned official v4.53.3 Darwin arm64 binary is authenticated by SHA-256
  `877de31753a4dd2401aa048937aa9a7fc4d5f6ce858cf31508c5802954297213`
  and its version was executed. CLI/default/operator parity remains open.

- Local commits: `d18b2e0ed` establishes build isolation; `27beeaf50` adds yes;
  `209190556` preserves character-device metadata through filesystem consumers;
  `75a013fd4` adds preferred-I/O metadata and corrects device-number forwarding;
  `71e3f5f74` isolates dd/install leaves; `633b73d50` adds opt-in virtual devices;
  `533c75ab1` adds the reviewed cmp command; `98a1cbb83` keeps explicit optional
  builds in the host runtime's module tree and rejects accidental runtime mixing;
  `e0ac05530` adds the reviewed shuf command; `005b812cb` adds the reviewed
  truncate command; `ce26db16e` exports optional configuration types.
  `5aa3f59fc` isolates the native yq dependency/implementation graph, and
  `bdd27a559` covers an actual composed opt-in script.
  None has been pushed or released, and neither action is requested.
- Shuf is ready for its separate local tool commit: 323 native/profile tests and
  eight compiled optional/public-host tests pass, source/test/consumer types pass,
  exact canonical test membership is declared, and the actual output screenshot
  was inspected. Public-host binary argv and named-file output budget failures
  were explicitly retested after coherent compilation. Default exports and
  registry membership remain unchanged.
- Truncate is ready for its separate local tool commit: 348 native/profile tests
  and ten compiled optional/public-host tests pass; source/test/consumer types
  pass. Canonical membership lists all four new tests. A real public-filesystem
  consumer verifies the 65,536-byte memory I/O-block policy for `-o`; raw argument
  diagnostics and invalid-byte filename non-aliasing also pass in the compiled
  host. The actual truncate output/help screenshot was inspected. Unsupported
  provider capabilities remain explicit rather than synthetic native behavior.
- Post-commit checks: the maintained selected virtual-bash build succeeds, all
  36 default inventory tests pass with the original 79 commands, and the maintained
  contract route passes 249 tests. A missing optional options-type export was
  reproduced by the actual declaration-consumer test (nine pass, one fail);
  exporting the yes/cmp options and device interface restores ten passes. These
  types remain part of the explicit local optional entry only.
- The compiled public-host suite now passes eleven tests, including an actual
  VFS `.sh` file under `set -e` combining existing date/byte tools with mounted
  urandom, shuf selection, copying/cmp, truncate zero-extension, and yes with a
  short consumer. It checks exact output, token alphabet/length, copied prefix,
  zero-filled extension, and sampled membership. Strict consumer types pass.
  The first manual probe supplied an array instead of the documented mount map;
  that harness argument error was corrected, not treated as a product defect.
- Guarded root ESLint's fifth run completes with exit 0. The prior fourth run
  reported three unsafe-finally findings in ongoing install/trap work; authors
  repaired them without suppression. Subsequent in-flight source work still
  requires its own final checks rather than inheriting this snapshot's result.
- Root confirms yq phase-1 old/new tests pass 111/111 with the authenticated
  reference; independent review is pending. Trap review instead reproduces two
  failures (144/146) in BASH_COMMAND reporting and independently identifies mixed
  source/compiled extension byte ownership. Those are open author fixes.
- Trap's three review findings are now repaired. Root's source run passes 184
  tests, compiled/public-consumer coverage passes fourteen, and strict consumer
  types pass. A broader trap/default-shell run passed 760 tests before the final
  class-receiver regression was added. That extra TDD case exposed changed factory
  `this`; binding the captured method to its original receiver fixes it while
  preserving immutable affinity snapshots. The original reviewer approved the
  reconciled getter-count assertion. The actual trap screenshot was inspected.
  The opt-in leaf is ready for a separate local commit; declaration tracing and
  debugger metadata remain explicit follow-up gaps, not claimed full completion.
  A final oracle-hygiene check reproduced fourteen failures from implicit system
  Bash 3.2 selection. Native fixtures now require explicit executable and SHA256
  bindings, validate Bash 5.2.37, and use a closed PATH with five explicit child
  shell overrides. Without either binding, 66 tests pass and 118 native-only tests
  skip; malformed or partial bindings fail. There is no native fallback.
- Trap is locally committed as `5f7c9b054`; no push or release occurred.
- Restricted yq input repairs now pass independent review and the final root
  run: 147 author/allocation/scripting tests, zero failures or skips, plus strict
  source/test types. Review reproduced producer teardown settling too early;
  registered, memoized producer cleanup repairs it and retains falsey cancellation
  behavior. Canonical discovery explicitly names all four new test files. This
  repairs the existing restricted dialect only; the separate native Mike profile
  is still under development and is not yet exported by the optional entry.
  Actual repaired flow-comment and element-selection output was rendered and
  inspected in `yq-phase1-final-visual.png` under the native-oracle directory.
- Restricted yq repairs are locally committed as `0c7531ade`. Guarded root
  ESLint's seventh run completed cleanly with exit 0. Post-trap source inventory
  checks pass all 36 tests, retaining 79 defaults. Workspace/root dry-pack
  inventories contain 1,050/4,641 files and no optional implementation artifacts;
  these checks do not claim a release or that normal builds delete optional files.
- Root captured fourteen native yq in-place fixtures from the exact authenticated
  current request in `yq-inplace-root-hhxk41/evidence.json` under the oracle
  directory. Captures retain raw output, metadata, inode/link relationships,
  target bytes and private temporary-directory contents. Successful symlink
  writes preserve the target inode; ordinary hardlink replacement breaks the
  link. Five native failure cases leave temporary files. These observations are
  input to implementation review, not a product parity pass or permission to
  intentionally leak product-owned temporary resources.
- Counted descriptor output passes independent review and the final root scoped
  run: 89 tests, zero failures/skips, including fourteen independent cases and
  29 actual Runtime cases. Review first reproduced late callback invocation and
  premature settlement of admitted writes; those defects are repaired without
  weakening assertions. One shared output ledger reserves requested bytes before
  writes, refunds only validated partial success, and retains unknown-failure
  charges. Descriptor ownership registers cleanup before acquisition and drains
  admitted operations and late handles. This is not broad DD command approval.
  The selected workspace closure and optional build pass. A new actual public
  consumer first failed because the descriptor module was not built; after the
  build, all fifteen optional/public tests and strict consumer types pass. That
  case verifies binary partial writes, shared stdout accounting, limit rejection
  and exactly-once retained-handle cleanup.
- Counted descriptor integration is locally committed as `32df09bdb`.
- Install timestamp investigation separates two issues. Metadata-only native
  controls show unexplained access-time changes even without content reads or
  subprocesses; the correct pre-read source snapshot is retained, and old raw
  mismatches are not relabeled as passes. Separately, the real adapter's Date
  conversion demonstrably discards fractional milliseconds. Its setter now
  forwards numeric seconds (numeric strings for pre-epoch values to avoid Node
  22.23.2's negative-number current-time convention), with an explicit inclusive
  Date-representable bound. Uniform rejection of out-of-range invalid Dates by
  the former native path was not established; the new validation is explicit.
  Root review passes 29 focused tests, all 1,299 filesystem tests, and strict
  source/new-test checking. Broad filesystem test-type checking instead reports
  the untouched `tests/quota.test.ts:46` contradictory-capability narrowing;
  that broader route is not claimed clean. The precision fix does not promise
  nanosecond-exact timestamps or prevent independent filesystem access-time changes.
- Fractional timestamp preservation is locally committed as `67eca8ad0`.
- Install's current source suite passes 110 tests and strict types; the maintained
  full workspace build and root public bundle also pass. The first actual public
  optional run is nevertheless **16 pass / 1 fail**: a four-byte install succeeds
  under a two-byte Shell output limit because direct filesystem writes bypass
  the shared budget. The command is not committed or accepted while this remains.
  Its repaired public test permits a missing or bounded partial destination after
  rejection, without assuming transactional creation. An exclusive `wx`/mode
  extension to the audited output helper is approved; exclusive creation must not
  degrade into pathname-based create-then-append. Buffered-only adapters retain
  single-call exclusive publication with counted admission and owned cleanup.
- Background job state is assigned as a separate opt-in foundation, not yet
  delivered `&`/`wait` syntax. Exact `jobs/state.ts` default-build/lint exclusions
  and workspace/root pack negations are prepared; the isolation test fails before
  those entries and passes afterward. Its API and native semantics still require
  review before implementation; no new default builtin or syntax is admitted.
- Background isolation is locally committed as `a82b5355b`; the maintained
  runner/config suite passes 243 tests afterward. Guarded root ESLint's eighth
  live-worktree run also completes with exit 0; later edits need fresh checks.
- After the full public bundle rebuild, three real-adapter fractional/pre-epoch
  modification-time pairs match direct Node calls. Raw access times are retained
  but not used as an isolation claim. Evidence is under
  `timestamp-public-root-oKil0m` in the oracle directory. The first manual attempt
  omitted `await` on the documented asynchronous factory; its untouched scratch
  directory remains as a harness error, not a product failure.
- Install's repaired streaming and buffered paths now pass the root replay:
  238 combined install/output/descriptor tests and all seventeen actual public
  optional tests, including the previously failing global-output limit case.
  Strict public-consumer types pass. The explicit build succeeds, and fresh
  workspace/root dry packs contain 1,054/4,645 files with zero optional leaks.
  Actual compiled install/stat/cmp output was rendered and inspected in
  `install-public-budget-final-visual.png`. Independent shared-helper/command
  review is still required before committing this implementation milestone.
- Native yq independent review separately reproduces five `-i` global-budget
  failures and four expression mismatches (205/214 pass, no skips). Staging
  must charge its bytes, rename adds no payload charge, and fallback copying
  requires a second charge. These are open author fixes, not qualified passes.
- Independent review approves the shared exclusive-output extension; the root
  replay passes all 113 contract/runtime cases, including four new independent
  tests. A separate install regression still fails (129/130): buffered Shell
  execution can settle cancellation before its admitted writer drains. Passing
  other public tests does not waive buffered-writer cleanup; this remains an open
  author fix. The shared helper is ready for its own commit without claiming
  install completion.
- Shared exclusive output is locally committed as `a7dc981ff`. Install's final
  writer-ownership fix now passes independent review and root replay: 132 source
  tests and nineteen actual compiled/public tests, zero failures/skips, plus
  strict source/consumer types. The new public direct-execution control passed
  before the repair; its buffered Shell counterpart reproduced the real failure
  and passes only after rebuilding the repair. Both profiles remain covered.
  The separate opt-in install milestone is ready for commit, with factory/options
  exports confined to the local optional entry and five literal canonical tests.
  This does not erase the six documented foreign-group backend differences.
  Guarded lint's ninth run completes with exit 0 and one unused-import warning in
  the in-flight jobs test; no install finding is reported.
- Install's separately validated opt-in implementation is locally committed as
  `f1a233f57`; no remote delivery or release is claimed.
- Native yq's nine independently reproduced expression/output-budget defects
  now pass unchanged reviewer assertions. Root replay passes 236 native-profile
  tests and 21 compiled public-host tests, including strict declaration consumers.
  Explicit optional compilation passes after annotating the public AbortSignal
  field. Two initial public readdir expectations incorrectly used strings rather
  than directory entries; correcting those fixtures required no product change.
  The compiled YAML edit/JSON conversion transcript was rendered and visually
  inspected in `yq-native-final-visual.png`. Four focused discovery/isolation
  checks pass. The normal optional aliases do not replace the restricted legacy
  dialect and remain absent from default registration and npm exports. This is
  an incremental implementation commit, not completion: multiline-quote parsing,
  malformed-JSON diagnostics, broader operators/CLI and filesystem metadata
  differences still require further native scrutiny and implementation.
- Resumed yq verification repeats 236 native-profile and 21 enabled public tests
  successfully. Workspace/root pack inventories contain 1,054/4,645 files and
  zero optional implementation leaks. The initial root pack ran its prepack full
  build; its mixed build/JSON stdout was not a parseable inventory, so the final
  root inventory was captured separately with scripts disabled after that build.
  An overlapping public test encountered the temporarily removed safe-fs bundle;
  after the build and explicit optional rebuild completed, all 21 tests passed.
  An earlier public invocation omitted the explicit profile variable and ran no
  tests; that capture is not counted as a pass.
- Local yq commit `3c9bcfe60` also captured the next native-backed regression
  cases added after root's staged snapshot: `git commit --only` takes the current
  worktree files. Postcommit verification therefore runs 254 tests, with 241
  passing and thirteen concrete parity failures. The preceding 236-test result
  describes the earlier cohort, not a green committed tree. Preserve these new
  regressions and repair them in the next yq commit; no history rewrite or test
  weakening is authorized. Root has released the author to fix the mismatches.
- Byte-array/read foundation independent review first found eight failures in
  five runtime behaviors: child arg0, locale-aware array lengths, C-locale joins,
  raw positional-star separators and isolated UTF-8 IFS components. The repaired
  runtime passes all 36 unchanged independent assertions. Independent and root
  arrays/read/value runs pass 416 tests; independent full trap coverage passes
  184. Root additionally verifies six compiled public-runtime cases and strict
  source/test types. The earlier approved corrections to two read expectations
  are backed by native C and UTF-8 observations, not relaxed failure assertions.
  These changes preserve immutable bytes through cells, owned input records,
  local restoration and child argv; they do not yet implement fuller array
  grammar, mapfile/readarray, descriptor/deadline options or background jobs.
  A separately reproduced parser gap rejects positional length `${#1}`.
  Actual raw array/child/IFS byte output is visually inspected in
  `arrays-public-final-visual.png`. The preceding image is preserved as a harness
  mistake: it assumed variables persist between separate exec invocations; the
  corrected capture initializes every independent invocation and asserts bytes.
- Guarded root lint's tenth run completes with exit 0 and no warnings. This
  precedes the final runtime byte repairs and subsequent dd/public additions;
  it is not a lint claim for those later edits.
- The byte-array/read foundation is locally committed as `79081333e`. Input
  readiness/deadline primitives and generic extension binding/descriptor adapters
  are now assigned separately; full grammar and optional builtins remain open.
- DD's repository-local optional entry now exposes factories and configuration
  types. Three missing-export public cases fail before wiring; binary named copy,
  mounted zero/random device composition, shared named-output budget and strict
  consumer declarations then pass (four selected tests). An initial mount test
  used the wrong factory argument shape; that fixture error is preserved in its
  earlier capture and is not a product failure. Actual compiled output is visually
  inspected in `dd-public-visual.png`. Root's full native/reviewer cohort currently
  passes 123/134: five sparse append/seek cases, four exact-help byte comparisons
  and two diagnosed-close recovery cases remain failures assigned to the author.
  The help failures concern output bytes, not an exit-status mismatch. DD is not
  approved or committed merely because the public smoke cases pass.
- Standalone optional jobs state passes independent and root 70-test runs with
  the pinned Bash oracle and zero skips, plus strict types. Independent review
  first reproduced late runner-getter acquisition after cancelled preparation
  in two tests; both pass unchanged after the repair. The reviewed source hash
  is `69ff1cfa3fd4ed809f0d78eeb6bebf8dd46d51e3d6ee1ec32fd2ac39b9dba4d9`.
  Admission reserves capacity before preparation, completed outcomes include
  cleanup, waiter cancellation does not cancel a job, and natural `finish()`
  drains without cancellation while `close(reason)` cancels and drains. Defaults
  bound retained jobs to 256, waiters to 64 and cleanup callbacks per job to 64;
  exhaustion refuses admission rather than evicting retained status. Falsey
  failure identities and preparation-failure precedence remain intact. This
  source is excluded from default build/package files, has no public export or
  shell registration, and does not yet deliver actual background `&` or `wait`.
- Jobs-state infrastructure is locally committed as `e99a78c30`. The next shared
  DD repair is explicitly scoped to the command-owned descriptor wrapper: an
  exact-reason `acknowledgeCloseFailure` operation may prevent registered cleanup
  from replaying a successfully diagnosed, settled close failure. Explicit close
  must still reject idempotently, all owned work must drain, and open/write errors,
  wrong or premature acknowledgements and cancellation must remain unmasked.
  The filesystem base interface is unchanged. A different worker independently
  reviews this helper while the DD author repairs help and sparse-append behavior.
  Generic extension bindings/descriptor borrowing and owned input deadlines are
  proceeding in disjoint files; no optional leaf is admitted into default core.
- The command-owned descriptor acknowledgement repair passes 153 shared
  descriptor/output/accounting tests, including nineteen independent review
  cases. The final reviewed helper hash is
  `8d522cc32b924151259222624d9f2e3f94cfa2152b7f96c45f06aea7f96c40c8`.
  Review additionally reproduced an unrelated listener-cleanup failure using the
  same reason object; the helper now requires completed draining before cleanup
  can suppress the acknowledged close failure. The original independent assertion
  remains unchanged. Root's actual compiled-host pair improves from one pass/one
  failure to two passes after rebuilding; it verifies required acknowledgement,
  `||` recovery, preserved file bytes, one underlying close, and still-rejecting
  explicit repeated close. The final optional build succeeds, strict source/test
  types pass in independent checks, and `descriptor-ack-public-visual.png` was
  inspected. This is a shared repair, not acceptance of DD's remaining sparse
  append cases or the unfinished optional shell extensions.
- The shared close-failure repair is locally committed as `210ba165f`.
- The next yq patch repairs all thirteen known regressions and passes the root
  replay of its 279-test native cohort. Five additional compiled public cases
  verify duplicate JSON members/key order, quoted YAML continuation, byte-based
  wildcards, hexadecimal spelling and partial output before a later JSON error.
  Its actual output is inspected in `yq-repair-public-visual.png`; independent
  review is assigned before a repair commit. Broader yq compatibility is open.
- Generic extension bindings, borrowed descriptor input and declaration metadata
  pass their author's 33-test cohort. Independent review then finds four native
  mismatches for zero-prefixed positional values and lengths. Root reproduces the
  same boundary through compiled execution: six public cases pass and two new
  cases fail. These unchanged regressions require a repair before core acceptance.
- Input deadline/readiness primitives are frozen for independent review after
  46 new cases, eleven authenticated native witnesses and 386 combined passes.
  Their integration into optional read/mapfile commands has not happened yet.
- DD's remaining sparse-append cases require the retained descriptor's actual
  cursor. Root authorizes optional `capabilities.position` and `getPosition()`
  on canonical descriptors, memory implementation, managed/forwarded validation,
  and safe-bash forwarding. Do not estimate position from EOF; the real backend
  must refuse a query without an actual supported primitive. Public safe-fs
  runtime must be rebuilt as the safe-js bundle before DD integration testing;
  refreshing only safe-fs declarations does not deliver the runtime change.
- The maintained full workspace/root build and subsequent optional build pass
  with the cursor implementation. DD then passes all 145 current native/reviewer
  tests, zero skips. The compiled aggregate passes 45 public checks; a subsequent
  28-test subset additionally covers actual cursor retention through unrelated
  growth, readonly mounts, and the two previously failing sparse-append patterns.
  The cursor implementation still requires independent review before its commit.
- Guarded lint's eleventh run completes with two core-runtime findings:
  `no-this-alias` and `prefer-const`. Narrow fixes are assigned; do not treat that
  run as clean or weaken lazy allocation and cleanup-before-acquisition semantics.
- Mapfile/readarray implementation is assigned in a separate optional leaf using
  the generic binding/input interfaces. A failing isolation assertion precedes
  explicit exclusion of its single planned source from both default-build lists
  and of its directory from workspace/root package files. Four focused discovery
  and isolation checks then pass. No default registration, optional export or
  implementation acceptance is implied by this build-boundary commit.
- Mapfile build isolation is locally committed as `533334246`. The repaired
  extension-core boundary passes the root's 186-case focused cohort with the
  authenticated Bash 5.2.37 oracle and zero skips, including unchanged review
  regressions for leading-zero positional aliases. The core remains generic;
  this does not implement mapfile, read flags, background syntax or full arrays.
- Core public execution also passes eight cases after the rebuilt optional
  runtime; eight discovery/isolation checks pass. The actual declaration and
  positional-alias output is inspected in `core-public-final-visual.png`.
  `src/contracts/shell-extensions.md` documents this one-shot boundary, including
  its deliberate lack of incremental publication and binary-record/deadline APIs.
- Independent core review approves the frozen runtime after 14 unchanged review,
  534 combined and eight compiled public checks, with zero skips and clean strict
  types. Root's eight selected source/public type roots have zero diagnostics.
  Guarded lint's twelfth run completes cleanly with exit zero. No full-tool or
  release acceptance is inferred from these scoped checks.
- The generic extension boundary is locally committed as `07a9d8566`. Input
  deadline review approves the unchanged frozen implementation after 21 new
  independent cases and 268 combined array/input checks, zero skips. Root
  repeats the 268-case cohort with the pinned Bash oracle successfully and
  typechecks both new deadline test files with zero diagnostics. This commit
  supplies shared-cursor readiness/deadline primitives, not shell `read -t`.
- Input deadlines are locally committed as `b36995ecc`. The optional extended
  read leaf is assigned separately; a failing isolation check precedes its exact
  source and package-artifact exclusions. No builtin replacement, timeout support
  at the public shell boundary, or leaf acceptance is implied by those exclusions.
- Read build isolation is locally committed as `4c9cf0180`. Independent cursor
  review approves the frozen three-source capability after 19 new and 133 combined
  tests, zero skips, with clean source and focused strict test typechecks. Root
  repeats the 54 author/reviewer cases successfully; the actual rebuilt public
  bundle passes both retained-cursor cases. Rooted-real query support remains
  unavailable and is refused, not inferred from file size. Native zero-length
  I/O observations remain a separate qualification task, not a newly changed
  implementation behavior or a claim of native cursor support.
- Canonical retained positions are locally committed as `5ceb930c9`. The
  safe-bash command-descriptor forwarding addition independently passes 93 cases,
  including capability gating, count validation, budget neutrality, serialized
  close drainage and falsey cancellation. Root repeats 79 helper/acknowledgement
  cases successfully. The reviewed forwarding source has SHA-256
  `76a51a171ea761c02634b6255e08d9314e50d132ad7a369a160f6817ed012a65`;
  its existing acknowledgement behavior is preserved.
- Command cursor forwarding is locally committed as `f14e57093`. DD's frozen
  source/test manifest is reauthenticated unchanged across all 16 entries before
  integration. Independent and root replays each pass 145 DD cases with the clean
  authenticated GNU 9.7 oracle and zero skips. Root additionally passes 64 current
  public/default-aggregate checks and eight discovery/isolation checks. Both pack
  dry runs, after explicit builds and with lifecycle scripts disabled, retain
  zero optional implementation leaks (1,054 workspace and 4,645 root files).
  `dd-precommit-final-visual.png` shows actual compiled sparse-append bytes and
  a mounted zero-device pipeline and is inspected. The optional source entry
  exports DD factories, plugin and configuration types; defaults remain unchanged.
  Native filesystem QA records memory 11/11 and rooted-real 9/11, with two
  explicitly unsupported sparse-append combinations. These and documented
  platform/flag/recovery gaps remain open; this is not universal GNU parity.
- DD is locally committed as `77b17a4ea`. The next yq independent review finds
  seven additional native mismatches (29/36 cases pass): JSON integer and exponent
  formatting, permissive missing-comma parsing, surrogate normalization, custom
  tagged exponent/hexadecimal arithmetic, and multiline-key diagnostics. Root
  captures the pinned native outputs and reproduces all seven through the old
  compiled public runtime: five prior cases pass and seven new ones fail. The
  author repairs them without altering reviewer assertions, preserving these reds.
- Root's repaired yq replay passes 322 native-profile cases, zero skips. The
  rebuilt optional runtime passes all twelve public cases, including the seven
  reproduced failures; four strict source/public test roots have zero diagnostics.
  Eight discovery/isolation checks pass, and actual numeric-output/diagnostic
  rendering is inspected in `yq-next-public-final-visual.png`. Independent final
  review and guarded lint remain required before this repair is committed.
- The previously delivered native zero-I/O capture is recovered after a truncated
  handoff: `/tmp/safe-fs-descriptor-position-native.xh7t4Q/`, Darwin 25.4 arm64,
  September 4, 2026. All 32 zero-length read/write/pread/pwrite observations return
  zero and preserve cursor, size and read buffers; an append cursor stays two
  after independent growth increases size to five. Compilation and execution
  stderr are empty, exit zero. Root verifies the saved output and source/binary
  hashes without rerunning it. Source SHA-256 is
  `557bef15c73c739ef3ff97723606660f32b452ce10d681d54efbf571eba945e3`;
  executable SHA-256 is
  `ac20fd5bcb87ed10af74ffd6d5198802e1c4eadb9757da6af46e8947e5d03b87`.
  Native positioned append writes succeeding remains distinct from the canonical
  descriptor's intentional refusal; this evidence does not erase that gap.
- Independent yq final review approves the unchanged seven-file repair after
  36 reviewer and 322 combined native cases, zero skips, with zero diagnostics
  across seven strict type roots. Root verifies all seven frozen source/test/doc
  hashes again. Guarded lint's thirteenth run completes with two findings in
  concurrently implemented read/incremental-writer files, not yq; narrow owner
  fixes precede a separate fourteenth run. The thirteenth run is not clean.
- Guarded lint's fourteenth run completes cleanly with exit zero. The reviewed
  yq repair is ready for its own scoped commit; optional packaging, explicit
  activation and the documented broader compatibility gaps remain unchanged.
- The reviewed yq repair is locally committed as `be49ee194`. The internal raw
  record primitive is frozen for independent review after 65 new cases, including
  fourteen pinned native mapfile-projection witnesses, and 400 combined passes.
  Root repeats 207 raw-record/deadline/byte-input cases successfully with zero
  skips. Raw records retain delimiter and NUL bytes without changing ordinary
  shell-read semantics; public borrowing and mapfile remain separate integration.
- Independent raw-record review approves the unchanged source after 29 new
  adversarial cases and 362 combined array/input passes, zero skips. Root repeats
  all 362 successfully and checks both new strict test roots with zero diagnostics.
  The frozen source SHA-256 is
  `2d8cd2a47f078a3b7d35f6dfec9166ed37186167d282f7055d740efb5104984c`;
  the independent review SHA-256 is
  `c6cacd3ce91a1f368e9ba905db45c5343609b3bcf17f84fbb5bf8aa3eb04e64f`.
  Eight discovery/isolation checks pass. A fifteenth guarded lint run is pending.
- The raw-record optional build succeeds, and a compiled internal-module smoke
  check retains `ff000a` before an ordinary line read consumes the shared cursor's
  following `tail` record. This is not a public extension-borrow acceptance.
  Guarded lint fifteen completes with one `prefer-const` finding in the unrelated
  uncommitted mapfile leaf; no raw-record source/test findings are reported. The
  mapfile owner is assigned that repair. The complete lint run is not clean; the
  reviewed raw-record slice can be committed independently of that future leaf.
- Raw input records are locally committed as `1e9ee0d17`. The incremental indexed
  writer is frozen for independent review after 31 author cases, including seven
  native witnesses, and 247 combined passes. Root separately passes 128 focused
  source cases and three compiled public cases for callback-visible publication,
  post-admission readonly, replacement and scalar-prefix restoration. Actual
  output is inspected in `incremental-public-visual.png`. Unset/recreate safety
  refusal, associative/control-name boundaries and indexed-prefix restrictions
  remain explicit; this is not a completed mapfile or fuller-array implementation.
- Independent writer review withholds approval: nine of fifteen cases pass, six
  fail. UInt32 records cannot round-trip through individual element expansion or
  generic binding reads, and an outer writer can mutate a newly shadowing local,
  even one declared readonly. Root reproduces all six through the compiled public
  boundary: three prior cases pass, six new cases fail. The unchanged reviewer
  and public regressions require source repair before commit; post-admission
  readonly on the originally admitted binding remains a separate allowed case.
  The broader review's missing `prepareBytesInput` import belongs to concurrent
  source-readiness TDD, not the frozen writer. Read's separate independent review
  also finds thirteen trailing-whitespace numeric parsing mismatches; its owner
  is assigned a fix without weakening the new reviewer assertions.
- The writer author repairs all six unchanged review failures: uint32 read
  access is extended without widening one-shot/assignment bounds, and admitted
  local identity is checked across shadowing/restoration. Root passes 146 focused
  source cases and, after a successful optional build, all 43 selected compiled
  cases—including the nine-case writer cohort that previously had six failures.
  Independent re-review and the sixteenth guarded lint run remain pending before
  commit. Read's whitespace repair separately passes its author's 201-case replay;
  independent re-review is assigned, with timed/public replacement still open.
- Independent writer re-review approves the unchanged repair after fifteen review,
  34 author and 509 combined cases, zero skips, with clean strict source/test
  types. All five frozen author hashes match. Root's three selected type roots
  also have zero diagnostics. Guarded lint sixteen completes cleanly with exit
  zero. The read leaf separately receives a 77-review/201-combined approval for
  its untimed slice; that does not approve replacement, timing or mapfile.
- The incremental writer is locally committed as `4b48afdf5`. A separate core
  bridge is assigned for explicit builtin replacement and borrowed record,
  readiness and deadline operations; owning-source construction is not included.
  Prepared finite/file sources and pipe-readiness helpers are separately frozen
  for review after 47 author cases and 674 retained passes. Root passes 208
  source-readiness/deadline/raw-record cases and 55 existing I/O tests. These
  helpers do not yet establish actual public-shell timeout behavior.
- The opt-in parser declaration slice is frozen after 46 author and 40
  independent cases, all 86 passing. Independent review verifies capture
  validation, immutable declarations, default rejection, whole AND/OR-list
  terminators, nested substitutions, heredocs and input-unit boundaries. This
  is parser metadata only: it neither installs background execution nor claims
  wait or trap-interruption semantics. The next runtime integration must thread
  captured declarations through every existing parse entrypoint.
  Root additionally passes 238 parser/heredoc/input-unit/byte/diagnostic cases,
  98 maintained integration-input checks and 36 unchanged aggregate checks.
  Source-inclusive strict checking uses the maintained ES2023 options with zero
  diagnostics. An initial root ES2022 invocation was a configuration error, not
  source evidence. Guarded lint seventeen completed with two unnecessary escapes
  in the new independent fixture; their removal preserves the fixture bytes and
  all 86 focused passes. The full guarded rerun remains pending at this boundary.
- Parser-only syntax is locally committed as `3f8283c0b`. The separate builtin
  replacement/borrowed-input bridge receives independent approval: 28 review
  cases and 69 combined author/reviewer cases pass without skips. Four frozen
  source/author hashes remain unchanged during review. Root initially observes
  six compiled-public failures against the old build; rebuilding the explicit
  optional tree makes all six pass, with 23 public bridge/binding/writer cases
  passing together. Root's first source regression cohort passes 149 cases.
  A public pipeline screenshot is inspected: the raw record preserves bytes
  `61 00 62 0a` and replacement discovery reports read as a shell builtin.
  Deadlines forward owned cursor capabilities; this still does not install
  extended read or supply the missing owning-source preparation.
  Final root bridge replay passes 83 author/reviewer/retained boundary cases;
  five strict type roots have zero diagnostics and eight focused maintained
  discovery checks pass. The pending guarded lint rerun is not counted as a pass.
- The generic builtin/input bridge is locally committed as `1c9f9abae`.
  Source-readiness review reproduced two defects: a detached cleanup receiver
  and queued empty-file reads incorrectly receiving EBADF after EOF closure.
  Both are repaired against unchanged independent assertions. Review passes
  26/26, combined source-helper tests pass 73/73, and the independent retained
  cohort passes 813/813 without skips; these counts overlap rather than add.
  Root passes 140 helper/deadline cases, five compiled byte-pipe readiness
  checks and three source-inclusive strict type roots with zero diagnostics.
  Helpers remain distinct from actual Shell source-construction wiring, which
  currently has concrete failing integration witnesses awaiting implementation.
  A fresh explicit optional build succeeds; 28 compiled public pipe/bridge/
  binding/writer cases pass together. Eight focused maintained discovery checks
  also pass. Guarded lint eighteen is still running, not a completed clean gate.
- Prepared input helpers are locally committed as `57a440057`. Guarded lint
  eighteen subsequently completes cleanly with exit zero. Explicit-build,
  ignore-scripts dry-run packs contain 1,054 workspace files and 4,645 root files,
  with no optional tool, device, trap/read/mapfile/jobs, or optional-entry leaks
  under the checked paths. These are local package checks, not remote delivery.
  The next owning-source slice remains red: 33 of 41 author cases and all five
  new compiled-public integration cases fail before implementation. Mapfile's
  current native cohort passes 117/121, retaining four blockers: byte diagnostics,
  write-only descriptor admission, indexed-key expansion and callback-exit cleanup
  ordering. Their concrete witnesses are retained; passing helper tests do not
  qualify those missing shell behaviors or complete the requested goal.
- The jobs native corpus now freezes 33 behavior cases plus six supervision
  checks against authenticated Bash 5.2.37. Seven independent supervision checks
  pass as well. Review checks exact output bytes/statuses, causal process-ID
  relationships, anchored process-group cleanup, split handshakes, falsey failures
  and late errors after successful close. Without the native prerequisite the
  34 native-dependent checks skip explicitly rather than count as passes.
  This corpus establishes expected asynchronous list scope, snapshots, wait
  option/operand precedence and EXIT ordering; it does not execute virtual jobs.
  Trapped-wait interruption, interactive/stopped jobs and several notification/
  destination cases remain separately unqualified.
  Root independently replays all 46 cases with zero skips, passes eight focused
  maintained discovery checks, and reports zero diagnostics for three selected
  strict type roots. Guarded lint nineteen is pending, not counted as a pass.
- Root's first compiled source-construction replay passes 15/16 cases. The sole
  failure is an overconstrained new fixture expecting `ready` after established
  regular-file EOF. The committed cursor contract reports `eof`, and timed read
  treats both states as successful zero-timeout polls. Correcting only that
  fixture gives 16/16 without a product edit; the original failure is retained.
  Separately, root validates a real retained-file defect: after reading EOF and
  appending data, the current virtual cursor remains at EOF while native Bash
  reads the appended line. The native command/source/output is retained at
  `/tmp/safe-bash-scripting-oracles-20260904/retained-read-eof-eSaPT4/evidence.json`.
  That defect requires a same-descriptor lifecycle correction, not a change to
  the readiness label or a pathname reopen. Input-owner tests/design are assigned.
- Native job semantics are locally committed as `bf95f587c`. Construction wiring
  receives conditional independent approval after 14 review cases and 111
  combined cases pass. Two older legacy-I/O fixtures now explicitly disable
  canonical open; all original assertions remain unchanged, and root replays
  both successfully. The remaining five-byte inline-input expansion regression
  is real and stays red; source wiring is not committed as complete acceptance.
  Guarded lint nineteen completes with one prefer-const source finding and
  seven warnings in a then-in-progress native-wait fixture. The source owner is
  assigned a cleanup-safe holder correction; a fresh guarded run is still needed.
  Retained-file EOF tests reproduce 12 failures of 18, and input-retention budget
  tests reproduce six failures of 11. Retryable regular-file EOF is approved for
  input-owner implementation. Repurposing the documented per-input maxInputBytes
  option as an aggregate limit is not approved; the budget repair must preserve
  existing per-input allowances and the original five-byte expansion boundary.
- The retryable-EOF candidate passes 24 helper tests; two unchanged actual-read
  integration cases are relocated into the read extension's test directory so
  the helper commit will not import an uncommitted leaf. The combined helper
  and existing readiness cohorts pass 97 cases. Root's original virtual/native
  append witness now agrees: `0:<one>`, `1:<>`, then `0:<two>`. A new compiled
  public witness remains red against the older build, as expected before rebuild.
  Independent EOF review remains pending. The revised budget policy is approved
  in principle: Budget-keyed ownership accounting preserves per-input allowances
  rather than silently introducing an aggregate cap; implementation waits until
  the EOF candidate is reviewed and committed.
- Independent EOF review approves 34 new cases; root replays 131 combined helper
  cases, eight maintained discovery checks and four strict type roots with zero
  diagnostics. A fresh explicit optional build passes 17 compiled public input
  checks, including the earlier appended-data failure; the actual output image
  is inspected. Those public checks include the still-uncommitted construction
  integration and are not substituted for the standalone helper proof. The
  helper commit excludes both the pending construction and the relocated read
  tests. Guarded lint twenty is running, not yet a completed clean gate.
- The EOF helper is locally committed as `a4dc567c8`; guarded lint twenty then
  completes cleanly with exit zero. Input-budget repair is now authorized under
  the preserved per-input policy. Independently, the negative-fraction read
  timeout repair passes the unchanged 139-case review cohort. Root confirms four
  further read diagnostic-byte mismatches against native Bash; these are not
  cleared by the timeout repair. The trapped-wait native harness also remains
  under repair after independent repeats exposed two supervisor failures.
- Root adds compiled public heredoc and here-string witnesses for the unchanged
  five-byte expansion boundary. Both fail against the prior build at the prepared
  input allocation; the other six public source cases pass. The default command
  inventory separately passes 36 cases. These are scoped observations, not a
  completed budget repair or a full feature gate.
- The frozen budget candidate builds successfully. Root's first wider source
  replay passes 275/278 cases; three retained independent checks still assume
  transport allocations use the expansion arena. Their policy migration is
  assigned to the independent reviewer, with allocation-before-copy and cleanup
  assertions retained rather than deleted. Seven strict type roots pass. A first
  public selection passes 13 cases but names a nonexistent third test path; the
  corrected selection explicitly includes the extension-input bridge and passes
  19/19. Both new five-byte witnesses pass after rebuilding, and their actual
  public-runtime output screenshot is inspected. Native trapped-wait repair is
  independently reviewing; root's native jobs aggregate passes 77/77 once.
- The repaired trapped-wait native harness receives independent approval at
  author SHA `a2b389400dc251d88f28d30bca764f5f5d0d503b17a049649b6612614ba6e1c5`
  and unchanged review SHA
  `dc2baed37d19f1f5510a437e3eddd802c9ea614736dcb91971dd67bf76677fc0`.
  The supervisor now acknowledges one outstanding signal and explicit retirement
  before its sole join rather than inferring completion from resettable trap
  state. Author and independent reviewers each repeat the 19-case suite 50 times
  without failures; the independent combined gate passes 31/31. Original two of
  eight failing runs and later traced failures remain recorded. The reviewer
  also checks 663 positive protocol captures and rejects bad supplied oracle
  prerequisites. This qualifies the native witness only, not virtual jobs.
  Both package dry-run inventories retain zero optional artifact leaks, with
  1,054 workspace and 4,645 root files after the explicit optional build.
- Native interrupted-wait qualification is locally committed as `d945d4f4f`.
  Input-budget review approves the three accounting-domain migrations but finds
  two new extent-integrity failures: a shadowed Uint8Array byteLength can bypass
  admission or turn nonempty input into EOF. The 32-case independent review
  passes 30 cases; the full arrays cohort passes 555/557. The input owner is
  assigned intrinsic-extent admission while review tests remain frozen. Root
  reproduces both defects through the compiled public API: eight other cases
  pass and the two new extent cases fail. The earlier public pass is not
  acceptance of this newly tested behavior.
- Guarded lint twenty-one completes with exit zero for its observed snapshot.
  The later extent-repair candidate and newly added public extent cases still
  require their own final validation; this is not a prospective clean claim.
- Input-budget repair receives independent approval at source SHA
  `8c4140f9f133644213964f819f67ec828c5791b4390b5091ca350da568d22475`.
  Captured intrinsic typed-array extent fixes both new admission failures without
  changing per-input allowances. Independent budget/readiness reviews pass
  32/32 and 26/26; the reviewer also passes all 557 array cases, four original
  inline-limit cases and 141 retained read cases. Root passes 310 combined source
  cases, nine strict type roots and eight discovery checks. A fresh optional
  build passes 21/21 compiled public input cases, including both repaired extent
  witnesses; the new actual-runtime screenshot is inspected. Public/source
  construction checks still include the separately pending runtime wiring.
  The helper commit includes no optional read/mapfile implementation or source
  construction files and does not claim complete command or shell parity.
- The input-budget helper is locally committed as `741484793`. The separately
  frozen source-construction candidate can now integrate without the original
  inline-limit regression. Runtime SHA remains
  `07da0b9073cef933f9b3614031d4e9b1e821e48a29655b2fba3138c5db850ea3`
  and shell SHA remains
  `2ed6fc10d2fc19c1b733760606e590f06580a58a0c94f5492699b2b60ec4e04d`.
  Its author 46 and independent 14 cases are included in root's 310-case passing
  source gate; ten new public construction cases are included in the passing
  21-case compiled gate. Legacy-read fixtures explicitly disable canonical open
  without changing assertions. Default commands remain unchanged; no optional
  builtin is installed by this integration. A fresh guarded lint run remains
  required after the final integration/discovery edits.
- Source construction is locally committed as `0ac181c73`. The subsequent
  retained public/default cohort passes 73/74, exposing an EPIPE escape in the
  existing optional script that combines date, random-byte filtering and bounded
  consumers. Three additional unchanged optional-suite runs each pass 25/26 and
  fail that same script; these failures are retained, not replaced by the earlier
  narrow public pass. The runtime owner is investigating cleanup/cancellation
  propagation before further feature work. Both post-rebuild pack inventories
  still contain zero optional artifact leaks. The generic diagnostic/descriptor
  sidecar is independently replayed at 24/44, with its 20 known failures still
  awaiting implementation. Guarded lint twenty-two is running; no completed
  clean result or full integration acceptance is claimed yet.
- Guarded lint twenty-two completes with exit zero for the integrated source
  snapshot. Read-only diagnosis identifies redirected-input cleanup rethrowing
  the exact handled pipeline-cancellation reason into shared cleanup failures.
  Deterministic `/dev/zero` pipelines reproduce the same escape directly and
  through a script; ordinary `yes | head` controls pass. The runtime owner is
  authorized to add regression tests and repair that cleanup boundary, preserving
  genuine close failures and root cancellation. Root adds four compiled direct/
  script and pipefail cases: the optional cohort now passes 25/30 against the
  old build, retaining the original composition failure plus four new failures.
- The runtime-only cleanup filter passes 11/18 new author cases; seven genuine
  close failures remain masked by helper cancellation checks. Independent review
  passes 27/33 and broadens the same blocker to legacy teardown and multiple
  owners, including identical falsey failures. Root approves a narrow captured
  internal `cleanupFailurePrioritySignal` context capability: omission/undefined
  preserves existing behavior, and an explicit signal controls only priority
  over an actual teardown failure. Ordinary cancellation, successful cleanup,
  acknowledgement and drain rules remain unchanged. The redirect caller supplies
  the execution-root budget signal. New helper policy tests initially pass 4/22;
  author and independent tests remain frozen while implementation proceeds.
- The first paired cleanup policy passes 258 root source cases and 99 compiled
  public/default cases, plus four descriptor-public controls. Independent helper
  review then finds two late-replay failures: cached direct close has rejected,
  the execution root subsequently aborts, and registered cleanup fails to recheck
  that priority. The repair changes registered failure replay only; direct-close
  identity, default behavior and successful cached cleanup stay unchanged.
  Earlier review corrections remain explicit: 23 overbroad expectations changed
  45/70 to 68/70; two drain expectations changed expanded 73/77 to 75/77, leaving
  the two genuine failures. A later fixture-only type repair preserves all 77
  assertions. Root's first type failure was observed while that review file was
  changing; a post-run hash did not authenticate the compiler's loaded bytes.
- Final cleanup approval binds input SHA
  `ad1f8cbb30651655813252469000261875c35937d294c168627e11c3cb272e04`,
  descriptor SHA
  `35f107d18d82d425d83816df984a0da4153080e9ce57f506791c702903968ea4`
  and runtime SHA
  `5d7d20d0e0ea183f82ff42ae4a2cc41db31579ccb1797883339875618889246b`.
  Independent helper review passes 77/77 and 393 relevant retained cases; paired
  pipeline review passes the unchanged 51 cases. Root passes 335 source cases,
  103 compiled public/default cases after a fresh optional build, eight discovery
  checks and six strict roots with unchanged before/after watched hashes. Actual
  workflow and pipefail output images are inspected; the long hex line is wrapped
  for readability without changing captured bytes. Guarded lint twenty-three is
  running, not yet a completed gate.
- A maintained workspace typecheck attempt exits two before TypeScript because
  peer-profile admission still requires the whole peer object to contain only
  poe-code, rejecting the authorized optional YAML 2.9.0 peer. The trailing shell
  tail masked that command's status; the actual failed report is retained. This
  is a separate metadata-admission mismatch, not a cleanup type diagnostic or a
  full-route pass. The peer-guard owner is assigned read-only diagnosis pending
  the active lint freeze; required-peer and archive authentication must remain
  strict when the optional metadata is admitted.
- Pipeline cleanup repair is locally committed as `c5cf629c0`. The final pack
  inventories again contain 1,054 workspace and 4,645 root files, with zero
  optional artifact leaks. Guarded lint twenty-three finishes with one test-only
  no-unsafe-finally finding in the independent legacy iterator fixture; its owner
  is replacing the fixture's teardown representation without weakening the
  failure assertion. The metadata-guard design is approved: preserve the required
  canonical peer and canonical-only profile; additionally admit only pinned YAML
  2.9.0 with exact optional metadata, with selected-lock consistency and existing
  archive/profile/declaration authentication retained. Implementation is limited
  to the peer guard and its memfs build tests, not installation or default exports.
- The independent iterator fixture now uses explicit next/return state instead
  of a throwing finally. All 33 assertions are unchanged, root replays 51 paired
  cases successfully, and the reviewer passes ten old/new in-memory lifecycle
  comparisons including unstarted return, natural exhaustion and queued calls.
  The new review SHA is
  `c757c0a4cb6d1206266fae8c9dac64fcd40eb82f3137622ae83806c8e58e0e0d`.
  This removes the source of the reported lint finding without suppressing its
  rule; a fresh guarded run is still required after the active peer-guard edits.
- The iterator fixture repair is locally committed as `617aa54f7`. Peer-guard
  author tests pass 236 cases, and maintained typecheck now passes admission and
  the historical/source/current consumer phases before reporting 31 compilation
  diagnostics in 12 files. That is progress, not a full-route pass. Independent
  review confirms 30 additional policy cases but reproduces premature peer/lock
  reads for invalid manifest metadata; early manifest rejection is being restored
  before accepting the patch. Two stat-fixture diagnostics caused by this goal's
  new metadata fields and the trap fixture's missing new capabilities are assigned
  narrowly for repair. Unrelated old stress-fixture and invocation type diagnostics
  are not being silently rewritten or counted as passes.
- The trap builtin fixture's missing-capability diagnostic is reproduced and
  repaired with two explicitly typed getters that reject unexpected access.
  All twelve native case bodies, operations, assertions and scope behavior are
  unchanged. Root passes all twelve authenticated Bash cases and one strict type
  root. This is a fixture compatibility repair, not a new trap runtime behavior.
- The trap fixture repair is locally committed as `4e7812da5`. The overlay and
  readonly full-stat fixtures now include this goal's ioBlockSize and device
  number fields, with getter/nonenumerable copying, mutation isolation and
  optional-absence checks retained and extended. Root passes 59 tests in roughly
  half a second and two strict type roots after the two recorded diagnostics.
  The readonly combinations cover all 1,024 masks for each method/representation;
  required-only fixtures remain unchanged. No filesystem production code changes
  or compiler relaxations are needed for this fixture migration.
- Stat-fixture migration is locally committed as `8fe28703e`. Peer admission
  receives independent approval after restoring early manifest-only rejection:
  30 policy and 12 independent ordering cases pass, as do the retained 115-case
  matrix and 16 new author ordering cases. Root passes the full 252-case build
  suite and eight discovery checks. Frozen peer helper SHA is
  `b71537ded9892304c29e8c8877bbdb96af550bf5a6c52a0fe2fd982ebd6f6a49`;
  its build-test SHA is
  `28b11b8a110106644c6f0043f147d94c17ac2aba9455a5b2eedcd65ac6824a09`.
  The maintained typecheck now reports 28 diagnostics after the three fixture
  repairs; consumer phases still pass, but source/test compilation does not.
  The original metadata refusal, 31-diagnostic report and admission-order failures
  remain recorded. Guarded lint twenty-four is running on the frozen candidates.

- First implementation wave: cmp, yes, shuf and virtual devices in disjoint leaf
  directories. Root is qualifying native oracles and the opt-in delivery boundary.
- The yes leaf is verified for its documented GNU 9.7 C-locale profile: 135 tests
  pass with zero skips, including independent Shell comparisons and VFS scripting.
  Its source/test project typechecks, and actual output passed visual inspection.
  The explicit version-identity and resource/host limits remain documented.
  Commit it separately; all other tool and shell-extension acceptance is pending.
- Default-build isolation now has a failing-then-passing test and matching literal
  exclusions in tsconfig.build.json and package-lint metadata. This preparatory
  boundary does not admit any implementation or change default command inventories.
- Build/input tests: 219 passed after correcting the required metadata mirror;
  the portable browser bundle baseline has five passing tests.
- Independent yes integration exposed an option-parsing mismatch in the first GNU
  reference binary. A clean reference rebuild resolved it without product parser
  changes. Preserve that failed reference evidence rather than hiding it.
- Shared character metadata support passed 21 focused command tests and 12 root-run
  bridge tests; the author also reports 73 nearby command and 56 bridge regression
  tests. Character nodes remain distinct from ordinary files, including across
  bridge Stats/Dirents. This introduces no default device mount and does not widen
  the real adapter's native special-file admission. The device implementation,
  concurrent output handling and independent copy review remain separate work.
- The maintained selected virtual-bash build completed both dependency tasks.
  A default virtual-bash npm pack dry run listed 1,046 files and no optional
  cmp/dd/install/shuf/truncate/yes/yq/device implementation files.
- Follow-up root device run: 79 tests pass with no skips, including independent
  descriptor and copy review. This is scoped behavior evidence, not a claim that
  Darwin urandom writes match the explicitly different portable device profile.
  The named independentWriteStreams contract is integrated, the device test
  project typechecks, and actual command output passed visual inspection. The
  selected default build passes; its pack dry run lists 1,046 files and zero
  optional implementation leaks. Final device rerun: 79 pass, zero skips.
- Preferred-I/O metadata has 40 passing focused tests and a successful selected
  safe-fs build. Independent root review then reproduced lost rdevMajor/rdevMinor
  fields through readonly, mount and overlay snapshots in three failing tests.
  The correction preserves known zero, partial metadata and absence through each
  wrapper. Root reran all four focused metadata/bridge files: 67 tests pass.
  The selected safe-fs build passes after the correction. Guarded lint completed
  with no metadata findings; its two remaining findings are unsafe-finally throws
  in the concurrently implemented dd leaf, which remain assigned for correction.
- Root cmp rerun: 78 of 79 tests pass; the remaining failure is a native-oracle
  helper signalling its process group after successful close (EPERM), not a
  permitted diagnostic normalization. Root shuf rerun during helper TDD: 292 of
  298 pass, with six new oracle-lifecycle cases still red. Both test projects
  typecheck. Neither tool is accepted or committed by these partial runs.
- Literal exclusions now cover the five dd and four install source files present
  in this wave. Three focused default-boundary/discovery assertions pass. New
  implementation filenames still require explicit exclusion and pack inspection.
- Later shuf review rerun: 316 of 319 pass with zero skips. The helper-lifecycle
  fixes pass; three independently reproduced product defects remain: cleanup
  masking the primary output failure, nonregular-input reservoir selection, and
  raw-byte count diagnostics. The independent reviewer owns their corrections.
- Truncate's current 200 tests and dedicated test-project typecheck pass;
  independent review is pending. Generic shell-extension infrastructure and the
  opt-in trap leaf are now in implementation. The trap implementation has a
  failing-then-passing literal default-build exclusion check; no shell feature
  acceptance or commit is implied by that packaging check.
- Cmp's follow-up independent review corrected exact help output and default
  block selection from canonical first-input metadata, preserving the pinned
  GNU 3.12 selection behavior. The native helper no longer signals an already
  closed process group. Root's final run passes 97 tests with zero skips, and
  the source/test project typechecks. Actual comparison, status and full-help
  output passed visual inspection. Unknown/stdin block metadata, dynamic FIFO
  profiles, non-C locales and truthful version identity remain explicit limits.
  The next complete guarded lint run has no cmp findings; its sole remaining
  finding is a prefer-const binding in the concurrently implemented trap leaf.

## Native yq implementation boundary

The restricted legacy yq entry and its explicitly restricted tests remain
separate from a new Mike Farah v4.53.3 profile. The new native-profile factories
live in `commands/yq/mike.ts`; root will expose them as the normal optional yq
factories only after qualification. No compatibility fallback to the restricted
jq evaluator is authorized. Existing query-core and sealed evidence stay intact.

Root approves the already-installed `yaml` 2.9.0 parser for this optional graph.
The root already depends on YAML; the workspace declares an exact optional peer,
with matching lock metadata, rather than adding a mandatory default dependency.
The library must be loaded only when the native yq operation requires it, not by
default commands, unrelated optional tools, or information-only invocations.
Document/CST nodes preserve metadata; a native-qualified evaluator and emitter
remain required because the library alone does not establish Mike parity.

Eight new source filenames are literally excluded from the normal build and
mirrored package-lint metadata. Their exclusion assertion failed first and now
passes. The proposed implementation includes common native CLI forms, node-based
assignment/tag operations, document-aware eval-all, and VFS in-place updates,
with bounded work and cleanup. It is not yet delivered, publicly exported, or
native-qualified; broader YAML/operator/platform limitations remain open.

## Coherent opt-in runtime boundary

The full maintained root build succeeded after the selected workspace build was
found insufficient to refresh `poe-code/safe-fs`'s bundled public import. The
public memory filesystem now reports its 65,536-byte I/O preference. Preserve
this distinction between a workspace build and the root suffix bundle stages.

Root then reproduced an actual mixed-runtime failure: the compiled public Shell
plus source-loaded shuf returned success and wrote four bytes for
`shuf -e abc -o /file` with `maxOutputBytes: 1`. The same mixture rejected retained
binary arguments as foreign-owned carriers. Source and compiled copies have
different private argument/output-budget bindings; normal ASCII stdout checks
had not exposed the mismatch. No ownership checks or global brands may be weakened
to hide it.

A root-owned guard is in progress: optional command definitions declare their
`commandRuntimeIdentity`; a registry rejects a foreign identity before install
or replacement. The initial three rejection tests failed, then five contract
tests passed; a factory-affinity test then failed before yes/cmp declarations
were added, and all six now pass. Shuf/truncate declarations are also added but
their commits remain pending. This is not yet a rebuilt-public-runtime or
coherent-consumer acceptance result. Independent guard review is assigned.

The intended follow-up is an explicit optional TypeScript build into the same
dist module tree as its host, preserving shared private bindings instead of
bundling another runtime copy. Optional implementation artifacts must remain
excluded from BOTH the root and virtual-bash npm packages even after that build;
the current files lists have not yet been extended for this route. Default build
exclusions/registries stay unchanged. Actual public-host tests must cover binary
arguments, named output limits and lifetime cleanup before this delivery boundary
is accepted. Do not recommend mixing source factories with a compiled host.

## Descriptor work required by dd

Phase 1 now has independent approval and root verification: all 1,270 maintained
filesystem tests pass, including 79 descriptor tests and thirteen independent
review cases. The complete maintained build succeeds, including root bundle
generation. Actual public runtime and declaration consumers verify retained
inode identity after unlink/rename, capacity retention/release, and mounted
readonly descriptors. The initial root attempt used node:test on Vitest files;
that runner error was corrected by the maintained selected Vitest route. A
separate manual check initially expected EROFS from a read-acquired descriptor;
its correct error is EBADF, while readonly write acquisition is EROFS. Those
harness corrections are not product fixes. Native QA retains 18 checks plus
three final-build checks in `descriptor-qa-vXYFk5` under the oracle directory.
The reviewer verified source hashes and retained evidence, but did not rerun
that native QA. DD's shared counted-output budget and owned acquisition remain
pending; phase-1 API acceptance does not complete DD or all provider support.

The default stream adapter's refusal of named notrunc, nocreat and output seek
does not complete the requested real-world dd scope. Root approved an optional
canonical descriptor API with retained-object identity, explicit access/creation
flags, positioned and sequential byte operations, truncate, synchronization and
noncancelable close. The first phase covers memory and rooted-real adapters,
faithful mount/readonly handling, and explicit refusal rather than descriptor
leakage through quota/overlay/unsupported providers. Unit fixtures remain memfs;
bounded native qualification may use a new controlled descriptor-qa directory
under the existing temporary oracle directory. This does not authorize native
special-file access or a hostile-tree containment claim.

DD integration remains a separate acceptance step. Direct descriptor output must
enroll in the existing shared shell file-output budget and lifetime before any
write. Partial writes must preserve dd's byte/record counts and must not bypass
the budget or silently charge retries as independently completed records. A
counted-write reservation/settlement design should retain conservative charges
when a failed operation's effects are unknown, and return unused admission only
for validated, known partial results. It must preserve existing stdout/stream
accounting, cancellation and cleanup precedence; no fresh per-file allowance or
read/replace pseudo-descriptor is permitted. This design requires failing tests
through actual Shell execution before implementation.

## Native oracle preparation

A separate GNU Bash 5.2.37 oracle is now built for modern shell extensions at
`/tmp/safe-bash-scripting-oracles-20260904/bash-5.2.37/bash`. Its official release
archive has observed SHA-256
`9599b22ecd1d5787ad7d3b7bf0c59f312b3396d1e281175dd1f8a4014da621ff`; the executable
has SHA-256 `f5b331844c67482075aea7883153127668cc67f83a60a7b4362cc8469a9dc77d`.
Clean configure and a full make succeeded. A bounded smoke check verifies indexed
and associative arrays, mapfile, read array/descriptor options, background wait,
and an EXIT handler. This is a deliberately pinned target, not a latest-version
claim. Existing `/bin/bash` 3.2.57 observations remain separate; they do not
qualify modern features absent from that version. Native-comparison suites should
select the new binary explicitly, never silently assume a temporary path exists.

GNU coreutils 9.7 and GNU diffutils 3.12 were built from their official GNU HTTPS
release archives under `/tmp/safe-bash-scripting-oracles-20260904`. They are native
Darwin oracles, not proof of GNU/Linux-specific kernel behavior. These temporary
build artifacts are not product dependencies and are not committed.

Archive SHA-256:

- coreutils-9.7.tar.xz:
  `e8bb26ad0293f9b5a1fc43fb42ba970e312c66ce92c1b0b16713d7500db251bf`
- diffutils-3.12.tar.xz:
  `7c8b7f9fc8609141fdea9cece85249d308624391ff61dedaf528fcb337727dfd`

Observed executable SHA-256:

- yes: `1623e59c022035db7ece95fb10f8c22ab288d21d60f6ad861561b98e10c2b074`
- shuf: `4a98165c9e0f900e4e35891844ee1e3f1d84b19816e1ab8424828e69548126b6`
- dd: `ea4bea9d30c61eb4e166b630ed9ec6eee4c8202a7001d532cfdec3d7338dcf1a`
- truncate: `8a4d0aba94e1826cfafd7c9fe007cf8758286714319d421edc9e8dadf8774f4d`
- install (build name ginstall):
  `2dd570b51e3fade930b1e702d9b2b4daab235a4b69661b4e42c4c8868e1fec38`
- cmp: `5b0ebf8ed3ef54ae96a1a473ec7f25d1b44cbbe9253edacf88f6350fbe5a233a`

The first targeted coreutils build failed because generated uchar.h was absent;
the subsequent full make completed successfully. Executable versions were checked
after compilation. Later independent yes checks exposed mixed GNU/native option
behavior. The suspected cause is objects compiled before generated headers,
retained by the later build with dependency tracking disabled. A fresh extraction
and configure/default-make sequence completed in coreutils-9.7-clean. Preserve
the first binaries and observations; version output alone did not qualify them.

The clean yes binary has SHA-256
`5326dd9df1374a85e4a2a0fddf27d7ae3315ba57a10866c2b27f71cb1878740f`.
It resolves the option-parser mismatches and passes the strict differential suite.
Run that suite with SAFE_BASH_YES_GNU_ORACLE set to the clean src/yes path, then
run `node_modules/.bin/tsc --project packages/safe-bash/tests/commands/yes/tsconfig.json`.
Both checks passed. The actual Shell output image
`/tmp/safe-bash-scripting-oracles-20260904/yes-visual-review.png` was inspected;
this is ad-hoc QA, not a screenshot test or committed artifact.

Baseline aggregate check: 36 tests passed using
`node --import tsx --test packages/safe-bash/tests/plugins/agent-commands.test.ts`.
The 79-command default remains unchanged at this baseline; repeat after integration.
