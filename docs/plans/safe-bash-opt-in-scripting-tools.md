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
- Peer admission is locally committed as `dd0844c16`, and guarded lint twenty-four
  completes with exit zero for the verified snapshot. No push or release is
  performed. Work now advances to generic byte-preserving extension diagnostics
  and open-descriptor validation; the existing 44-case sidecar had 20 reproduced
  failures. Read/mapfile leaf completion and background execution remain pending,
  and the last maintained workspace typecheck is not a clean full gate. The clean
  lint result does not prospectively qualify the next uncommitted core changes.
- Generic extension diagnostics now retain canonical payload bytes through the
  existing prefixed, awaited and budgeted stderr path. Synchronous
  `input.validateOpen` distinguishes an open descriptor from a readable borrow,
  without acquiring or consuming a source. Independent red tests move from
  24/44 to 44/44; author red tests move from 12/24 to 24/24. The separate review
  adds 34 passing cases, including retained-capability cancellation, falsey sink
  failures, zero/one-byte budgets and non-atomic sink behavior. The unchanged
  78-case independent cohort includes twelve pinned Bash witnesses.
- Root repeats all 102 new core cases and 366 committed core regressions with
  zero skips. The rebuilt public runtime passes 97 selected tests, including ten
  new direct/command/builtin diagnostic and descriptor cases that all failed on
  the previous compiled runtime. Five actual-package-tsconfig roots report zero
  diagnostics, with watched source/test hashes unchanged before and after.
  Maintained discovery passes 98 tests. Actual compiled output is inspected in
  `diagnostic-descriptor-public-visual.png`; raw diagnostic bytes end in
  `fffe0a`, write-only validation leaves the output file empty, and execution
  exits zero. Extensions source SHA is
  `ea64957c8504f055bf6d32bf6fae796e96467b05c9ee9b0a45b24753b4ec1c58`;
  runtime source SHA is
  `3147b0abe23213a346a79467497c7e5ead0e2e1035def810be9403f9df74351b`.
  Both receive exact-source independent approval. This generic core change does
  not install read/mapfile or resolve their remaining leaf and callback-exit
  defects. New required input-method and diagnostic typing migrations in their
  uncommitted mocks are separate owner work; no full-workspace typecheck pass is
  claimed. Fresh dry-run packs contain 1,054 workspace and 4,645 root files, with
  no optional command, device, extension or optional-entry artifacts in either
  default package. Guarded lint twenty-five completes with exit zero; its clean
  result does not qualify subsequent read/mapfile edits.
- The resumed maintained typecheck exits two with 35 source/test diagnostics:
  the mapfile diagnostic-value type error is gone, eight new read/mapfile mock
  migration errors are visible, and 27 earlier diagnostics remain. This is not
  a clean gate. Reinspection attributes three of those earlier errors in the
  diff/patch namespace fixture to this goal's `FileType` character-device
  addition (`209190556`); they must not all be dismissed as unrelated history.
  The same fixture also has a separately missing oracle import. No compiler
  options, test membership or unavailable native profiles are relaxed.
- A bounded read-only native investigation records 160 authenticated Bash
  write-only-descriptor observations in `read-writeonly-native-np0hXM` under the
  temporary oracle directory. `read -t0` succeeds without consuming on write-only
  regular files and `/dev/null`, but reports not-ready on an empty write-only pipe
  with its reader held open. Positive pipe deadlines time out and then perform
  assignment; regular/device read errors and zero-count assignment have different
  ordering. Descriptor openness alone therefore cannot substitute for readiness.
  Root verifies both retained result-file hashes and completion records; regular
  file witnesses remain ad-hoc native QA, not disk-writing canonical unit tests.
  Read-only borrowing is deliberately unchanged. A separate descriptor-level
  readiness/deadline integration remains necessary for full read parity.
- The generic diagnostic/descriptor core is locally committed as `1be425706`.
  Root then reproduces eight failures in the unchanged 28-case evaluator-exit
  cohort and three additional compiled-public failures: callback exit runs owned
  cleanup before extension execution unwinds. The actual cyclic mapfile drain
  and independent lifecycle review remain part of the core repair, not a leaf
  workaround. No push or release is performed.
- The mapfile descriptor-stage adaptation now validates every `-u` before target
  binding and borrows only the selected descriptor after admission. Root repeats
  135/137 authenticated cases with zero skips. The remaining array-key expansion
  and callback-exit cases are preserved, and the tool is not committed or publicly
  exported yet. Separate read raw-diagnostic repairs and typed mock migrations
  are in progress; completing one core capability does not complete either tool.
- Evaluator exit now dispatches EXIT handlers before callback locals unwind but
  defers frame-wide cleanup until enclosing operations can retire. Cached exit
  status no longer suppresses final draining, and falsey handler failures remain
  available for cleanup-error aggregation. The original 28-case cohort now
  passes; 14 author and 23 independent cases also pass, including sixteen pinned
  native witnesses. Independent approval binds runtime SHA
  `ec1f113a923295f8771c182aecd6ede551440058610b128ec40940e14e97e4f7`.
  Two actual-mapfile review cases are mechanically separated into the mapfile
  test directory so the core commit does not depend on an uncommitted leaf.
- Root passes all 531 core tests and 101 selected public/default tests with zero
  skips. All four new public callback/EXIT tests previously failed cleanup order;
  after rebuilding they pass, including raw callback-local output and EXIT status
  replacement. Four actual-package-tsconfig roots have zero diagnostics and
  unchanged watched hashes. Discovery passes 98 cases. The actual public output
  image `evaluation-exit-public-visual.png` is inspected: stdout `ff`, no stderr,
  exit nine, and `unwind -> cleanup`. Fresh default-pack inspections again find
  1,054 workspace and 4,645 root files with zero optional artifact leaks.
  Guarded lint twenty-six completes with one `require-yield` finding in the
  separate uncommitted mapfile review fixture, not the frozen evaluator patch.
  That fixture is assigned a narrow iterator-shape repair; the full lint run is
  not clean and its finding is not waived by committing the reviewed core slice.
- The broader evaluator run exposes one legacy-stream fixture still leaving
  canonical open enabled. Its existing four-script iterator-return assertions
  are preserved with explicit legacy selection; four additional canonical cases
  check acquisition/read/close counts, no fallback and no repeated disposal close.
  Root repeats the maintained shell-language suite: 181/181 pass. Separately,
  the namespace fixture now explicitly refuses unsupported device/FIFO nodes
  instead of misclassifying them as files/directories. Root's isolated in-memory
  review moves from 2/5 to 5/5; supported traversal, bytes, symlinks and metadata
  remain unchanged. This does not execute the fixture's missing native oracle.
- The maintained typecheck now exits two with 24 remaining diagnostics, after
  the eight read/mapfile mock migrations and three namespace type errors are
  repaired. Historical, three source-consumer and all 25 current-consumer groups
  pass, and temporary cleanup completes. The full typecheck remains failed;
  source/test compilation and runtime/native acceptance are not interchangeable.
- Evaluator ownership repair is locally committed as `ae07b883f`. The separate
  redirected-input fixture repair is ready after independent root review and
  181 maintained language tests. Its SHA is
  `c3a1b1a5026637383ddc30f353b23b5204799046ab83ebf57d526cd1da648d50`;
  it changes no product behavior and retains the original legacy assertions.
  The mapfile review's no-yield guard is repaired without weakening its rejection
  on direct input pull. Guarded lint twenty-seven is running; no push or release
  is requested or performed.
- Redirected-input fixture coverage is locally committed as `05554dd9a`.
  The namespace fixture repair is independently checked against the actual
  TypeScript-parsed helper in memory: unsupported virtual/native character
  nodes and native FIFO nodes reject before payload reads or descent, while
  supported traversal, binary contents, symlink targets and metadata agree.
  The frozen fixture SHA is
  `a62e60c75c7fe51acfc4f830c95e2656ca0cbe93b60d66e6c4ce7e9fa6085fdf`.
  Only the three device-type errors are repaired; its separate missing oracle
  import and the 24 remaining maintained typecheck diagnostics are not hidden.
- Namespace fixture repair is locally committed as `47514de04`. Read's raw-byte
  diagnostic repair receives separate independent approval: 24 new cases and
  133 selected combined cases pass with strict types. New descriptor-order tests
  then preserve 54 virtual failures in a 59-case authenticated cohort; all native
  expected-result assertions pass. Root's complete current read directory has
  462/516 passing cases, zero skips. These are descriptor admission, readiness,
  timeout and zero-count ordering gaps, not a completed read implementation.
  The new test SHA is
  `5735c4ccd567d47e5c69403697aaae9e2dee53181ffdb63150165cd40d8c7489`.
- Independent mapfile review exposes twenty trailing-numeric-whitespace cases
  and signed callback-index mismatches. The first repair reaches 189/191 across
  the combined cohort, retaining array-key expansion and a native callback-buffer
  boundary mismatch. Root inspects pinned Bash 5.2.37 `run_callback`: its buffer
  reserves ten index characters although signed presentation can require eleven,
  truncating the final quoted-source byte. The compatibility decision is to
  reproduce the observed target's source construction, with boundary/byte tests,
  rather than silently repair native behavior or fabricate an expected diagnostic.
  This is a pinned-target behavior, not a claim about every Bash version/platform.
  Mapfile and read remain uncommitted leaves without public optional exports.
- Mapfile's callback-capacity repair passes all 24 new boundary cases and all
  52 unchanged reviewer cases; the complete cohort is 214/215, retaining only the
  known array-key expansion case. The frozen source SHA is
  `29d7e2a959612901041d090ab48e26ce2f2ea674fb12e5d7e9a0a5b643dafdb8`.
  Exact-source reapproval, including nested diagnostic-source behavior, remains
  pending. This is not tool delivery or a universal Bash compatibility claim.
- Guarded lint twenty-seven completes with exit zero. Watched evaluator, legacy
  input fixture, namespace fixture and repaired mapfile reviewer hashes remain
  unchanged before/after. The four local commits are verified separately from
  delivery; no push or release occurs. Work then advances to explicitly opt-in
  array-key expansion. Its new leaf path and default-package directory exclusion
  are predeclared in the maintained build/lint/pack configuration, but that
  uncommitted implementation and configuration are not qualified by the earlier
  gate. Broader arrays, read descriptor semantics and background/wait remain open.
- The first array-key candidate passes the root's 208 authored cases, 1,206
  previously committed core/array cases, and 77 compiled/public/default cases.
  Independent review nevertheless withholds approval: four legacy metadata
  validation-order regressions and three raw heredoc byte-loss cases remain.
  Its 24-case suite passes 17, with all seven candidate source hashes unchanged.
  Native key heredocs use spaces regardless of IFS; that suspected separator
  issue is disproved, not patched. The mixed payload failures instead retain
  the pre-existing document path's lossy conversion. Root public coverage grows
  from 13 to 17 cases and independently reproduces four failures. These are
  preserved red baselines, not a completed feature or an integrated green gate.
- Original array author evidence is 44/107 before implementation, after the
  approved duplicate-capability union correction. Subsequent fixture corrections
  fix a `readBytes` signal argument and an incorrect raw-IFS heredoc expectation;
  neither is counted as a product repair. Native-confirmed here-string and
  heredoc fixes precede the author's final 208/208 (81 native, 127 independent
  of the oracle). Root logs are retained under the existing temporary evidence
  directory; the author supplied terminal evidence, not named raw log files.
- Mapfile now directly declares the shared array-key syntax capability without
  importing the array factory. Its new seven-case syntax suite moves from 3/7
  to 7/7; the full current mapfile cohort moves from 229/241 to 234/241. Seven
  function diagnostic-origin failures remain. A separate core-only 20-case
  native suite isolates 15 failures, and five compiled public cases fail too:
  functions require definition-owned diagnostic names and effective line bases,
  rather than inherited evaluator caller offsets. No mapfile/read optional
  export or tool commit is implied by this progress.
- Retained-endpoint investigation authenticates 32 native observations using
  actual C-created FIFO descriptors, not Node sockets. Buffered bytes do not
  make a write endpoint read-ready while a reader survives; closing the last
  peer alias changes readiness. The evidence is in
  `/tmp/bash-read-endpoints.Vehn4u/EVIDENCE.md`. Existing transport abort signals
  conflate cancellation, failure and closure and cannot establish this lifetime.
  Runtime descriptor ownership and retained output acquisition remain required;
  no readiness API, pathname inference or stage-lifetime approximation is
  accepted as the implementation. Read's 54 descriptor-order failures stay open.
- The current optional build succeeds; root/workspace dry packs contain
  4,645/1,054 files with no optional artifacts, including the new arrays leaf.
  The actual compiled array output screenshot is inspected. The maintained
  typecheck still exits two with 24 earlier diagnostics; all 25 current consumer
  groups pass. These observations qualify their candidate snapshot, not future
  review repairs, a release, or complete scripting compatibility.
- The seven array review failures are repaired without changing the review
  assertions. Syntax-only preparse capture preserves legacy validation order;
  canonical heredoc fragments avoid decoding raw payloads. The author reaches
  221/221 and the reviewer file 24/24. A retained heredoc fixture still expects
  the old lossy bytes. Root reproduces that failure and authenticates the exact
  fixture's native payload, `ffc3a9800ac3a90a`, using equivalent byte-producing
  and byte-copy helpers. The expected bytes are corrected while preserving the
  script and adding an explicit assertion for the unchanged decoded string.
  The native helper adds a source line, so its warning line number is not claimed
  identical to the unprefixed virtual fixture. Independent re-review remains
  required before committing the feature.
- Independent re-review approves the seven repairs with unchanged assertions:
  245/245 authored/reviewer cases plus six separately recorded lifecycle and
  budget controls. Root's final 51-file scoped run passes 1,728 tests with zero
  skips; the six watched implementation hashes remain unchanged. Five strict
  roots have zero diagnostics, canonical discovery passes 98 cases, and the
  selected normal workspace build closure and subsequent optional build pass.
  Final workspace/root dry packs retain 1,054/4,645 files with no optional leaks.
  The repaired public output screenshot is inspected. Guarded lint twenty-eight
  completes with exit zero and unchanged hashes for all 15 watched inputs.
  Broader maintained type checking still has 24 diagnostics. This qualifies the
  opt-in indexed-key increment, not fuller arrays, mapfile/read delivery or jobs.
- The array increment is locally committed as `4a516d970`; no push or release
  occurs. The following function-diagnostic investigation exposes a target
  mismatch, not permission to downgrade established default behavior. Retained
  default diagnostic fixtures explicitly use GNU Bash 5.3, whereas the new
  modern-shell witnesses selected 5.2.37. Their differences must be adjudicated
  before treating every red comparison as a product defect.
- The original retained 5.3 executable is no longer present. An initial replay
  fails admission and leaves no preserved observations; its empty output is not
  a successful capture. Root builds a separate fresh GNU Bash 5.3.0 from the
  official release archive in `/tmp/safe-bash-gnu-5.3-adjudication.0zMRKT`.
  Archive SHA-256 is
  `0d5cd86965f869a26cf64f4b71be7b96f90a3ba8b3d74e27e8e9d9d5550f31ba`;
  executable SHA-256 is
  `a0cfc1af0ff50f6b6e67c638979e2604f1c276c90116937fbaafcabb62ee2b40`.
  This is a newly built oracle, not the missing historical executable or a
  latest-version claim. No new tarball-signature verification is claimed.
- Ten subsequently preserved, hash-bound native observations distinguish 5.2
  from 5.3 for ordinary function errors as well as NUL warnings and evaluated
  definition lines. The 5.2 `environment`/`main` prefixes are not the retained
  default's 5.3 program/argv-zero labels. Evidence is
  `function-origin-version-adjudication-v2.jsonl` under the existing temporary
  oracle directory. The author freezes the uncommitted 5.2-driven prototype;
  it is not approved for default integration. Independent 5.3 adjudication must
  separate genuine declaration-line defects from version-only differences.
  Existing 5.3 snapshots and original 5.2 observations remain unchanged.
- The author archives the rejected prototype and removes only its own three
  uncommitted product edits with `apply_patch`. Runtime, shell and parser match
  `4a516d970` byte-for-byte again; unrelated work and all exploratory tests/logs
  remain untouched. The patch and manifest are retained under
  `/tmp/safe-bash-rejected-5.2-prototype-6e041309-2c3d-4b84-8f68-50948ce241a9`.
  Root's restored-default diagnostics and compiled-array checks pass 80/80.
  Five separate source/native mapfile public-fixture comparisons match the new
  5.3 oracle, including NUL records, sparse uint32 cells and callback EXIT locals.
  These do not constitute compiled mapfile delivery or its complete acceptance.
- Primary-profile reconciliation preserves the original 5.2 fixtures and captures
  in the temporary `function-origin-primary-migration.wzHxto` directory. The
  31 independent origin cases now consume authenticated, program-bound 5.3
  observations without requiring a native executable during canonical tests.
  Against immutable `4a516d970`, they reproduce 16 line-number failures and 15
  passes; the original 5.2 run remains separately recorded as 8 passes/23 failures.
  The author's further 5.3 fixtures and the five compiled public fixtures use
  the same primary profile. This changes oracle expectations, not fixture
  programs or raw-output comparisons, and does not globally retarget the older
  trap/array oracle helper.
- The first definition-coordinate candidate passes 1,796 root-run tests across
  55 unique retained/current files, with unchanged watched source/test hashes,
  zero skips and successful sequential default/optional builds. Discovery passes
  98/98 and seven exact-package strict roots report no diagnostics. Independent
  native review nevertheless finds four remaining conditional/loop layout
  discrepancies among eight fresh controls. These are retained as a new
  eight-case canonical regression suite before further parser changes. The
  green retained cohort is not coordinate-completeness evidence. A separate pair
  of command-name quoting failures remains outside the line-coordinate repair.
- The mapfile public entry has a genuine missing-export red run (1/7 passes),
  followed by 7/7 compiled passes after the explicit optional export and rebuild.
  Its sparse uint32 output is visually inspected in
  `mapfile-public-entry-visual.png`; the adjacent JSON binds the compiled inputs.
  Independent full-profile replay of the frozen leaf gives 234/241 passes with
  Bash 5.2 and 218/241 with Bash 5.3: twenty numeric trailing-whitespace cases
  change dialect, four function-label differences disappear, and three actual
  source-callback coordinate failures remain. All 24 callback-buffer boundary
  cases agree with both versions. Primary-profile migration and the numeric
  repair are required before committing the tool; these replays are not release
  gates or complete mapfile acceptance.
- Read endpoint comparison against the fresh 5.3 oracle preserves all 32 native
  pipe/FIFO statuses, data and readiness observations plus 16 alias controls.
  Four complete records differ only in EBADF word order: 5.3 uses
  `read: 3: read error: Bad file descriptor`. Eighteen additional small controls
  preserve assignment and unread-input behavior, with six corresponding wording
  differences. Evidence is `/tmp/bash53-read-endpoints.LyAqXL/EVIDENCE.md`.
  This does not repair virtual endpoint ownership, prove Linux/TTY/socket
  semantics or qualify the still-incomplete extended-read leaf.
- The revised function-coordinate increment captures each definition's effective
  diagnostic base and carries reprinted command coordinates through substitution
  and function invocation. It preserves the established 5.3 source-name policy.
  The independent eight-case suite progresses from 4/8 to 8/8; all 31 earlier
  primary cases and 71 author cases pass. Independent live 5.3 replay verifies
  every one of the 63 author native goldens, including 39 new compound/heredoc
  controls; the 13 mapfile callback-diagnostic comparisons remain exact.
- Final root validation of this increment passes 1,847 tests across 56 unique
  files with zero skips and stable watched source/test/compiled hashes. The nine
  compiled public cases include the four reviewed compound-layout regressions,
  which first reproduced as 5 passes/4 failures against the earlier build.
  Sequential maintained default and optional builds succeed; exact-package strict
  checking of eight roots reports zero diagnostics, and discovery passes 98/98.
  The actual compiled diagnostic is visually inspected in
  `function-coordinate-final-public-exact-visual.png`, with exact input and
  byte-output evidence in the adjacent `function-coordinate-final-public-visual.json`.
- Guarded root lint 29 completes with exit 0, no supervisor stop and all 80
  watched input hashes unchanged. Its 5,309,404 child-output bytes are preserved.
  The supervisor merged stdout/stderr, interleaving the two JSON streams; later
  JSON-summary parsing fails and is not claimed as a parsed diagnostic inventory.
  The runner exit and source-hash observations remain valid. This scoped strict
  evidence does not clear the separately recorded maintained-typecheck failures.
- Independent coordinate review finds no introduced regressions among 12 fresh
  holdouts: eight match and four retain the exact earlier `4a516d970` failures.
  Compound/function-containing substitution arguments, a parameter-default
  compound substitution, and an unreached unsupported word still disable the
  outer function layout map. Their candidate/native line pairs are 2/7, 2/8,
  2/7 and 2/4. They remain required follow-up work, not accepted full parity;
  separate command-name quoting failures also remain open. Tested simple and
  multiline backticks match, without establishing universal backtick support.
  Full review evidence is in the temporary
  `function-compound-review.cgyUtQ/handoff.json` under the scripting-oracle root.
- Mapfile's primary migration is independently accepted as a bounded increment:
  all 170 observations cover 147 distinct requests with no contradictory
  duplicates. Reversing only the documented reference imports/calls, gating and
  version labels reproduces all seven archived fixture files; programs and raw
  assertions remain unchanged. Independent fresh native holdouts pass 134/134
  without overlap with the primary requests: ASCII/non-ASCII whitespace, signs,
  overflow, wrapped indexes and raw callback values. Full evidence is in
  `/tmp/safe-bash-mapfile-independent-review.IGpenD/review.json`.
- Root reruns the nine mapfile suites without native-oracle environment variables:
  241/241 pass with stable source/test/reference/core hashes. The rebuilt optional
  entry passes eight compiled public tests, including a separately authenticated
  5.3 trailing-CR numeric case that preserves the unread input tail. Actual output
  is visually inspected in `mapfile-final-public-visual.png`; eleven exact-package
  strict roots report zero diagnostics and discovery passes 98/98. All nine
  canonical suites and the public suite are registered by literal path.
- Current compiled inventories remain 79 default commands and 28 browser
  commands, with date retained and no optional-command or automatic-curl leaks.
  Final workspace/root dry packs contain 1,054/4,645 files with zero optional
  implementation leaks. Guarded lint 30 completes with zero errors/warnings,
  no stop and all 80 watched hashes unchanged; separate stdout/stderr preserve
  the clean receipt without the previous merged-stream ambiguity. The mapfile
  leaf and explicit optional export can now be committed separately. This is
  not full Bash, all-locale, all-provider or release acceptance.
- The extended-read profile audit preserves the complete 516-case cohorts:
  5.2 gives 462 passes/54 failures, while 5.3 gives 433 passes/83 failures.
  The original 54 descriptor failures remain. The 29 added failures partition
  into numeric whitespace, usage, readonly status, negative fractional timeout,
  negative-TMOUT expectation and two Unicode/locale fixture differences. The
  original negative-TMOUT run reaches its SIGKILL guard rather than proving
  status 142. Evidence and corrected bounded controls are retained in
  `/tmp/read-dialect-audit.xYm3hI/EVIDENCE.md`; none are acceptance passes.
- A separate read-only ownership audit confirms that descriptor-table copies,
  replacements and moves currently share streams without fd-alias reference
  counting. Cursor ownership and whole-pipe abort do not establish last-peer
  closure. The next descriptor repair needs directional endpoint ownership and
  explicit binding lifetimes, preserving cancellation separately. File output
  currently prefers streaming or the shell's incremental callback; canonical
  output-open preference would change routing/publication semantics and still
  requires an explicit reviewed decision, not an inferred unchanged path.
- Root reproduces the retained-output defect through the compiled public shell:
  after writing `a`, renaming an open output, and writing `b`, native Bash keeps
  `ab` in the renamed file and does not recreate the original pathname. The
  current shell leaves only `a` in the renamed file and recreates the old path.
  Native/effect evidence is in
  `/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safe-bash-retained-output-p00bwq/result.json`;
  `/bin/mv` is an explicitly bound fixture rename primitive, not a GNU-mv
  comparison. The new compiled public regression fails 0/1 before any routing fix.
- Root approves an explicit `FileOutputOpenOptions.descriptor` mode for canonical
  owned output, with no fallback after that request. Omission/false preserves
  the existing streaming and incremental selection. A returned descriptor must
  be the actual guarded object used for writes, not a reopened path or stat-based
  approximation; finish/abort retain its lifetime and draining obligations.
  Partial writes must not double-charge shared budgets. Runtime integration will
  deliberately select this mode for shell redirections only when path-specific
  `capabilities.open === true`; other providers retain the legacy route. This is
  an approved routing change awaiting implementation and review, not an assertion
  that the current default shell or the 54 descriptor-read failures are repaired.
- Command-name review preserves 26 C-locale native captures and 30 captures in
  each admitted UTF-8 locale. The original two cases and the new 86-case suite
  reproduce 60 failures among 88 tests, with matching statuses/stdout. The source
  loses raw argv-zero bytes and formats unknown-command names incorrectly;
  builtin rejection diagnostics require raw bytes rather than global quoting.
  Printable UTF-8 must remain intact even inside ANSI-quoted names. Full locale
  classification is being qualified separately; generic display width, `%q`,
  or blanket C-byte escaping is not an accepted substitute. Original captures,
  codepoint policy, and fixture hashes remain in the `command-name-review` and
  `command-name-utf8-review` temporary evidence directories.
- Full-scalar qualification now binds the command-name UTF-8 classifier to the
  admitted GNU Bash 5.3/macOS libc and locale-data profile. Both admitted UTF-8
  locales agree on all 1,112,064 scalars: 286,484 printable, represented by 713
  maximal ranges. The formatter preserves the existing C/POSIX versus virtual
  UTF-8 routing, rather than pretending unknown/default locales have native
  qualification. The source documentation records the binary, locale and table
  bindings. The author's 153 formatter tests pass; the independent review and
  root compiled-consumer gate remain pending. The separate `command -p` witness
  still fails and is not included among formatter passes.
- The root compiled-consumer regression confirms the original diagnostic defect:
  28 of 88 cases pass and 60 fail before rebuilding. A first source-only retained
  run gives 1,743 passes and 167 explicitly skipped native cases because the
  required native-oracle environment was not supplied correctly; output source
  also changed during that run. This is provisional evidence, not a frozen or
  complete gate. Original logs remain under `command-name-source-root-1`.
- Independent retained-output review finds six deterministic failures: once
  finish or registered cleanup starts, exposed descriptor operations can still
  reach the provider while admitted sink writes drain. Repair must close new
  descriptor admission without cancelling the already-admitted partial writes.
  The independent regression remains unchanged while the owner repairs it;
  default runtime routing and the compiled rename regression remain unresolved.
- The first admission repair passes those six witnesses, but independent review
  adds seven failures: a forwarded aborted operation signal loses its exact
  reason to EBADF after closure. The source owner must preserve the canonical
  descriptor cancellation ordering. Root explicitly refines the earlier literal
  same-object requirement: the public descriptor may be an admission-gated view
  of the same canonical open resource, while already-admitted sink work retains
  its operation access. Identity metadata, cursor position, operation signals
  and close ownership must remain shared; reopening or guessing metadata remains
  prohibited. This is a documented design change, not unchanged object identity.
- Root's rebuilt command-name public regression passes all 88 cases. The broader
  70-file check passes 2,337 tests with zero skips and no drift across 351 watched
  source, test and compiled files. Existing native 5.2 suites retain their
  explicit oracle; new primary diagnostics and mapfile cases retain their 5.3
  goldens. Seven actual-package strict roots have zero diagnostics, discovery
  passes 98 tests, and both sequential builds succeed. Four actual compiled
  diagnostic examples match their native records and their PNG was inspected.
  Dry-pack inventories have no optional implementation leaks (workspace 1,066,
  root 4,657 files). Despite the supplied `--ignore-scripts`, root npm logs an
  executed prepare hook; no no-lifecycle-execution claim is made. These results
  describe the recorded working-tree snapshot, including the separately pending
  output-helper changes, not a completed output or full-read qualification.
- Independent read review verifies the 336 primary expectations, 313 historical
  records, 12 preserved fixtures and failed-timeout witness. The 579-case suite
  remains 525 passes and the same 54 descriptor failures. Its 152 fresh checks
  give 149 passes and three witnesses of a separate core `readonly -a` gap.
  The optional nonterminal setting is accepted only as a captured truthful host
  assertion, not input detection or a readiness/deadline capability grant.
  The reviewer also catches a falsely relabeled historical regular-file witness;
  the owner restores its 5.2 label and reseals the migration manifest without
  changing assertions or captures. Focused rerun retains five passes and all 54
  known descriptor failures. Neither correction establishes full read support.
- Final independent command-name review blocks the initial formatter candidate:
  four direct missing-command prefix-assignment cases incorrectly use the
  temporary locale instead of the ambient locale. Persistent assignments and
  command/function/eval prefixes have separate native controls and must not be
  globally changed to ambient lookup. The new 52-case review gives 48 passes and
  four failures; its full non-NUL scalar audit is exact for 1,112,063 values.
  Root extends the compiled public matrix without removing the original 88:
  the resulting 100 cases give 96 passes and the same four failures. The owner
  is repairing the scope selection; the earlier 2,337-pass cohort is not approval
  of these newly exposed cases. No formatter commit precedes their repair.
- The maintained package typecheck exits 2 with 24 diagnostics outside the
  formatter files: four missing diff/patch oracle imports, ten jq-review typing
  errors, one invocation-cleanup keyset assertion, and nine timing-harness
  import/type errors. Its 25 consumer groups run, but that does not turn the
  overall result green. No exclusions or diagnostic suppressions are added.
- The repaired formatter receives independent scoped approval at runtime SHA
  `5c7da0bfa7153bccd857d7feacf8baf1af5f3bab27cd85cd02e1e0deea9090df`:
  224 source tests, 24 fresh native replays and 20 middleware/restoration/
  cancellation controls pass. Original and independent goldens remain intact.
  The rebuilt public matrix passes 100/100, including all four locale regressions.
  The source and compiled diagnostic examples retain their native byte matches.
  The first locale PNG exposes the renderer's missing CJK glyph; four additional
  acute-only native controls pass and their readable PNG is inspected without
  changing product bytes or discarding the original image.
- The second output repair also receives independent scoped approval, including
  the clarified same-resource contract. Root verifies 29 compiled API tests and
  persists a fresh 425/425 complete retained-output run after the reviewer's
  equivalent run and additional 28 inline controls. Those inline controls have
  tool-transcript evidence only, not a claimed standalone capture file. The
  actual default-redirection rename regression is rerun and still fails 0/1;
  helper/API qualification must not be presented as runtime migration.
- Combined root checks now pass 2,532 tests across 75 files, with zero skips and
  no drift across 361 watched files. Fifteen actual-package strict roots covering
  278 source files have zero diagnostics; discovery passes 98 tests, and default
  then optional builds succeed without watched source drift. The aggregate
  remains 79 commands, browser remains 28, date remains present and curl is not
  automatically installed. Guarded lint 31 completes with zero errors/warnings,
  9,902 configured/linted inputs and unchanged 363 watched files, under the
  unchanged 600-second/1-GiB/64-MiB supervision. These scoped results do not
  waive the full-typecheck failure, pending read/descriptor jobs, `command -p`,
  or the four previously recorded nested-word coordinate gaps.
- Local commit `743ca1797` records the qualified command-name diagnostic repair.
  It does not include the separate output API source, the read leaf, or the
  pending default-path witness. No push or release is requested or performed.
  The retained-output API foundation is prepared as a separate increment: its
  three source files, contract documentation, three source-level suites and
  compiled 29-case consumer are registered explicitly. The root 425-case retained
  rerun and compiled consumer pass against the independently approved source;
  default redirection routing remains the next implementation task.
- The output foundation's final discovery check passes 98 tests and guarded
  lint 32 completes cleanly with 9,902 linted inputs and unchanged 363 watched
  files. Fresh dry packs retain the 1,066/4,657 file inventories with no optional
  implementation leaks; root prepare-hook execution is recorded, not concealed.
  A fresh read-suite run after the formatter commit still gives 525 passes and
  54 failures among 579 tests, zero skips. These failures and the default output
  rename failure are retained for the next runtime integration, not counted as
  passing API-foundation acceptance.
- Local commit `cb68558db` records the retained-output API foundation separately
  from the formatter. The next source assignment is canonical runtime output
  selection for affirmative path-specific open capabilities, preserving legacy
  selection elsewhere and counted-budget/close ownership. The compiled default
  rename regression remains the concrete red test; no default-routing or
  extended-read completion is inferred from the committed helper.
- A bounded indexed-readonly audit captures 24 additional primary Bash 5.3 cases,
  all with exact mismatches and no native timeouts or skipped cases. Nineteen
  stop at readonly indexed declaration/assignment option dispatch; one direct
  compound declaration fails in the parser; one invalid grouped option has
  matching status/effects but wrong diagnostic/usage. Three plain-readonly
  controls preserve status, values and local restoration but differ in mutation
  diagnostics. Unsupported observation commands are not used to inflate these
  failures. The immutable manifest is
  `/tmp/readonly-indexed-primary53.w5xYlX/capture-manifest-v2.json`, SHA-256
  `adec1b5094ae0e82c5f4c4bedd2ec69f9a3e26bc6ecffda15f40190c4584ae6d`.
  The owner is preserving all 24 as native-backed regressions for later array
  implementation; no readonly runtime or parser repair is yet approved or claimed.
- Canonical runtime output selection now follows affirmative path-specific open
  capabilities. Retained output preserves rename/unlink identity, independent
  positions, shared duplicated positions, nested truncation and append behavior;
  counted writes share the existing invocation allowance without a second charge.
  Nonaffirmative open capabilities retain legacy streaming/random-update paths.
  A canonical open failure never selects a fallback writer.
- Independent review first exposed nine cleanup regressions: seven genuine close
  failures hidden by handled local cancellation (including falsey reasons), and
  two silently mapped close-EPIPE failures escaping registered cleanup again.
  The author repaired these against the unchanged review. Independent frozen
  re-review passes 57/57, plus legacy129 and gated-view13 (199/199), with zero
  skips and stable watched hashes. Its receipt is
  `/tmp/retained-output-runtime-independent-frozen-d3x0yn/validation.json`, SHA-256
  `75eae01eb19ad7e549a4dfe31f080eef7f176e138df7033cd275214b8b40b044`.
  Root verifies the legacy fixture diff contains only three `open: false`
  declarations: its original stream/fallback assertions and programs are intact.
  This explicitly corrects inherited memory-open capability in those fixture
  profiles, not a claim that their provider declarations were unchanged.
- Root sequential default and optional builds pass with stable source hashes.
  The subsequent frozen mixed source/compiled cohort passes 3007/3007 in 88 files,
  zero skips and no changes among 377 watched paths. Historical native suites
  retain their Bash 5.2.37 oracle; new primary Bash 5.3 observations remain separate
  authenticated goldens. An earlier wrong-profile run selected 5.3 for historical
  suites and overlapped build output (187 failures and three changed dist paths);
  preserve that incomplete run rather than claim it validated the candidate.
  Evidence is under `/tmp/safe-bash-scripting-oracles-20260904/` with stems
  `retained-routing-root-1`, `retained-routing-root-2`, and
  `retained-routing-build-root-1`.
- Root actual-package strict checking passes 19 roots / 436 source files with
  zero diagnostics and no hash drift; literal discovery passes 98/98. Guarded
  `scripting-lint-33` completes successfully: 9905 configured/linted files,
  zero errors/warnings, 25 receipts and no drift among 366 watched paths.
  The owner's complete package typecheck still reports 24 diagnostics outside
  these changes; scoped success does not constitute a full typecheck pass.
- Actual compiled public execution against an explicitly rooted real adapter
  replays seven authenticated primary5.3 namespace programs both inline and as
  `.sh` files: 14/14 exact statuses, stdout/stderr bytes, names and file contents.
  Root inspects `retained-routing-real-public-2.png`; the adjacent JSON records
  stable compiled hashes and the reference hash. Preserve the first QA capture,
  whose comparison mistakenly included native inode/provenance fields as
  content expectations. No native-host fallback enters product execution.
- Public inventory remains 79 default commands and 28 browser commands, with
  date still working and no automatic curl or new optional tools. Inventory and
  optional-public suites pass 66/66. Fresh dry-run pack manifests contain 1066
  workspace files / 4657 root files with no new optional runtime leakage;
  despite `--ignore-scripts`, root prepare/husky executes and is captured.
- This routing increment does not complete extended read or fuller arrays.
  Current frozen-source read checks remain 525 pass / 54 fail among 579, while
  all 24 preserved readonly-indexed primary5.3 regressions still fail. Their
  root receipts are `read-after-retained-routing-root-1.json` and
  `readonly-indexed-current-root-1.json`; no source drift or skipped cases occurs.
  These red suites remain separate from this increment's acceptance and commit.
- Local commit `e30aa91ef` records the independently approved retained-output
  routing increment. No push or release is performed. Follow-up source ownership
  is split into transport endpoint lifetime/observation, runtime FD-frame and
  observer enrollment, and the read leaf's argument/selection ordering. Runtime
  observation must capture the actual open binding without granting read access;
  readable borrowing remains separate. Observer/operation leases do not create
  peer aliases, and only final directional FD-reference closure changes peer
  readiness. Regular-output observations use the retained descriptor, never a
  pathname reopen or inferred identity. Unknown provider/device observations
  remain unknown pending a resource-bound capability, not a pathname exception.
- The read owner may normalize the six regular-file fixtures' Buffer-versus-
  Uint8Array comparison only after preserving their original bytes and reproducing
  that assertion mismatch. Programs, expected bytes, statuses and diagnostics
  remain unchanged; actual descriptor-order failures must still be exposed. The
  original 54-failure partition is 44 null/pipe cases, six regular-file cases and
  four hook-order cases. Static native endpoint/alias evidence does not by itself
  qualify in-flight last-peer-close wakeups. Fuller readonly-array implementation
  remains deferred while the runtime has a separate active owner.
- Read descriptor selection now validates every `-u` occurrence before borrowing
  only the selected final descriptor. The owner preserves the original native
  programs and normalizes only the six authorized Buffer/Uint8Array comparisons.
  Initial selection evidence improves the descriptor cohort from 5/59 to 37/59;
  the retained 579 suite reaches 555 passes before two mock-contract corrections.
  After root independently reproduces those two failures, the narrow mock
  migration verifies descriptor validation/order without premature acquisition,
  exact raw diagnostic bytes and falsey failure identity. A separate genuine
  post-acquisition diagnostic test retains the cleanup-drain assertion. The
  retained suite then reaches 557 pass / 22 fail, with 12 selection tests and one
  additional drain test passing separately, all without skips. The remaining
  partition is 20 observation gaps and two readonly-core failures, not read
  completion. Evidence is `/tmp/read-fd-selection.1C0bgN/freeze.json` and
  `/tmp/read-selection-mock-migration.pxT8UO/freeze-final.json`.
- The mandatory observer API requires explicit non-observing methods in two
  mapfile mock contexts. Root first reproduces their actual-package type errors,
  then adds exactly one fail-if-used method to each. The historical primary
  reference remains byte-unchanged. A separately bounded, hash-authenticated
  fixture-revision receipt authorizes only the review fixture's 88-byte insertion
  at offset 6884 and reconstructs the exact original sealed source in memory.
  All six other fixture seals, seven-fixture/170-record counts and exact native
  request lookup remain unchanged. Independent review verifies the deltas,
  original reconstruction, all 170 expected results, and negative gate controls.
  Root and independent runs each pass 102/102 (10 gate, 21 lifecycle, 71 review).
  Root strict checking of three actual-package roots / 192 sources is clean;
  independent three- and five-root checks also pass. This is fixture/API
  maintenance, not a fresh native capture or runtime-observer approval.
- Root adds ten compiled-public observer checks and preserves their 10/10 red
  baseline against the previous build. They cover inline/bash/sh invocation,
  retained aliased identity, untouched raw input, unknown opaque streams, and
  exact falsey operation cancellation. Independent observer review exposes a
  reentrant-release race: source work could begin before its drain promise was
  enrolled. The original 24-pass/one-fail result and immutable source snapshots
  are retained in `/tmp/descriptor-observer-independent.cwXtfF/`; author repair
  and frozen independent approval are required before integration acceptance.
- Root qualifies 12 additional Bash 5.3 descriptor-lifetime topologies using
  actual Bash-created subject pipes. Separate inherited control channels permit
  observation only after the peer reports its waiting state, and keep that peer
  alive until the observation arrives. Move-close and same-shell function moves
  expose readiness; saved aliases and child-shell/subshell moves retain the peer.
  All 12 captures exit zero without stderr or timeout, with the pinned Bash hash
  stable before/after. This is static readiness during a live peer stage, not an
  in-flight wakeup timing claim. Raw scripts, arguments and channel bytes are in
  `/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/bash53-descriptor-lifetimes-JWkxg3/`.
- Resource-bound device observation requires a retained provider capability,
  not a pathname or character-type readiness guess. Root authorizes a separate
  safe-fs slice adding optional descriptor `readObservation`/`probeRead` and
  separating optional `openTruncate` admission from later truncate capability.
  Omission must preserve existing providers; readonly/mount forwarding and
  observation cancellation/close-drain require tests. A public builder export,
  device implementation and safe-bash bridge integration remain separate root
  integration steps. No private cross-package implementation import is approved.
- Fresh Darwin native device evidence qualifies zero-timeout read readiness for
  null, zero, random and urandom across read/write/readwrite opens: all 12 probes
  return ready and preserve the assigned variable. Write opens also accept the
  truncate-on-open flag. Contrary to an unqualified truncate-refusal assumption,
  GNU truncate succeeds with size zero on all four; independent Node native
  ftruncate calls with sizes 0, 1 and 4096 also succeed while device sizes stay
  zero. This does not qualify Linux kernel behavior or random-device writes.
  Keep the generic open/ftruncate capability distinction separate from choosing
  actual device-profile behavior; do not label truncate refusal as Darwin parity.
  Captures are under
  `/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/bash53-device-observation-p3CvIp/`.
- The pipe transport author freezes a 422/422 related cohort with four clean
  strict roots. Independent endpoint review adds 18 passing tests with a clean
  strict root and no measured source drift. This qualifies the reviewed API
  cases, not runtime FD-frame integration or kernel wakeup timing.
  Before acceptance, root resolves an explicit-undefined failure-channel defect:
  three direct reproductions show that legacy output-failure hooks, endpoint
  output-failure hooks and legacy iterator throws replace a genuine undefined
  failure with EPIPE in subsequent reads/writes. Source hash remains
  `4e79d0eaa1e38087747d74d6d6f031247a366cafde38bebf000047cfb3759e48`
  throughout the root reproduction (`pipe-undefined-failure-red-root-1.json`).
  Preserve legacy `abort()` and `abort(undefined)` default-EPIPE behavior, but
  give explicit failure channels a separate exact-reason path. Endpoint borrow
  cancellation must remain local; it is not a new whole-pipe failure channel.
  Runtime forwarding and frozen independent re-review remain required.

- Root resumes the existing required scope after a read-only inventory response;
  that response did not advance implementation or authorize adding zip, unzip,
  flock or bc to this goal. The command and extension list above remains intact.
- Device providers need a public canonical descriptor builder rather than a
  private cross-package import or a second lifecycle implementation. Root adds
  six public-source entry-point tests: all six fail with missing builder exports
  before the change (`/tmp/safe-fs-provider-api-root-oBt8he/`). Both Node and core
  barrels now export `openFileDescriptor` and its backend/open-options types.
  The six tests and the author's 71 observation/open-truncation tests pass 77/77
  with selected source hashes unchanged during the run
  (`/tmp/safe-fs-provider-api-green-root-SWYgMQ/`). This is source integration,
  not compiled public delivery, independent acceptance, or device installation.
  A separate reviewer owns an independent safe-fs observation suite; root owns
  the lifecycle contract documentation and subsequent public/build integration.
- The runtime owner reports a frozen 166/166 descriptor cohort, including the
  unchanged 25 independent observer tests, with seven strict roots and no
  diagnostics. Root releases that API checkpoint to the read leaf for actual
  integration. Ten cancellation-fixture conflicts and one old WebStreams fixture
  remain subject to reproduction and adjudication; these narrow passing checks
  are not a full compatibility gate.
- The safe-fs independent reviewer adds 36 tests and passes all 113 cases across
  the four focused suites, with unchanged source and test inputs. Evidence is
  `/tmp/safe-fs-observation-independent-pM85YX/summary.json`. The maintained
  package typecheck passes. Its first scoped test check retains TS6059 rather
  than suppressing the package's source-only rootDir restriction. Root's scoped
  public-consumer check preserves package compiler settings, changes rootDir
  solely to admit the test root, and reports zero diagnostics across 54 local
  source inputs with no drift; six public-source tests also pass. Preserve the
  earlier two unknown-resource typing errors and their explicit generic argument
  correction (`/tmp/safe-fs-provider-types-root-NxaHGj/` and
  `/tmp/safe-fs-provider-strict-green-root-0NGOwU/`).
- Root independently reruns each of the eleven retained-output/streaming conflicts
  against the current frozen runtime. Ten isolated tests are cancelled with
  unresolved promises; the WebStreams spy fails 0 versus 1. These are eleven
  separate reproductions, not a cascade count. Exact names, selected source
  hashes, raw outputs and original three files are preserved under
  `/tmp/descriptor-fixture-current-root-EzIZ2S/`.
- Four new pinned Bash 5.3 observations distinguish peer retirement from a real
  later broken-pipe write. After a control-channel handshake and positive
  read-readiness confirmation of peer closure, a named-file write still writes
  `a`; without another pipe write the vector is `0 0`, with or without pipefail.
  Adding a later pipe write changes the vector to `141 0`, with aggregate status
  0 or 141 according to pipefail. All four exit normally with no stderr, no
  timeout and stable oracle hashes. Exact source/argv/events/effects are retained
  in `/tmp/bash53-peer-retirement-root-72JW4p/`. This proves the old fixtures must
  not require cancellation merely from peer retirement; it does not authorize
  dropping genuine close-failure, falsey-reason or broken-pipe vector coverage.
  A concrete fixture-migration proposal remains required before editing them.
- Root approves the owner's concrete three-file fixture migration: retain the
  ten original close/cancellation/vector assertions but trigger cancellation
  through an actual later pipe write while an owned invoked child is active.
  Add the four native-positive sequential controls separately. Replace only the
  obsolete WebStreams construction spy with observable managed-pipe listener
  retirement and consumer-close completion before admission release. Source
  runtime changes are not authorized by that fixture approval.
- The maintained safe-fs selection passes 1466/1466 across 65 files with no
  watched source/test drift (`/tmp/safe-fs-package-tests-root-v7RxCT/`). The
  selected virtual-bash dependency build also passes, but a new actual-public
  test correctly finds stale bundled SafeFS exports: two provider tests fail
  while two no-implicit-device controls pass. Preserve that red capture in
  `/tmp/descriptor-provider-public-red-root-9wltG3/`; workspace declarations alone
  are not public runtime delivery.
- A subsequent normal `npm run build` completes all maintained declared builds
  and root suffix stages, including public bundles, without drift in the watched
  SafeFS/SafeJS/safe-bash sources (`/tmp/descriptor-public-full-build-root-GDDg9F/`).
  The four actual-public provider tests and ten actual-public observer tests now
  pass 14/14, with 1634 compiled/test files unchanged during execution
  (`/tmp/descriptor-public-green-root-I3rUiC/`). This is local build integration,
  not a push or release, and does not close the remaining tool/extension gaps.
- Final scoped type checks use each package's actual compiler settings with
  noEmit and a rootDir adjustment solely to admit the explicit test roots. All
  four SafeFS test roots and the public-provider test root have zero diagnostics
  and no watched-input drift (`/tmp/descriptor-provider-types-final-root-sVwqMU/`).
  Literal discovery passes 98/98; aggregate/capability tests pass 55/55
  (`/tmp/descriptor-provider-discovery-root-bXK66g/`). Real compiled public checks
  retain 79 default commands, 28 browser commands, no automatic optional tools or
  devices, and the exact epoch date through a VFS `.sh` file. Root inspects the
  actual-output PNG in `/tmp/descriptor-provider-public-visual-root-xhWtxG/`;
  its explicit host-provider check is not native character-device qualification.
- Independent compiled integration review approves the four public-provider
  tests, literal registration and contract documentation, rerunning 4/4 without
  source aliases (`/tmp/descriptor-provider-integration-review-NnUeNy/`). The
  optional build then succeeds; workspace/root pack dry runs contain 1070/4661
  files and no optional tool, device or extension implementation leaks
  (`/tmp/descriptor-provider-packs-root-Xp9mMd/`). The root prepare/husky hook
  executes despite the ignore-scripts argument; its output is retained.
- Guarded lint completes with exactly three prefer-const findings in new
  reentrancy tests, not product source. Root merges their declarations and
  assignments without changing assertions. Preserve the first corrective run,
  which exposed an ambiguous edit in the observer test, and its repaired 68/68
  replay. The final observer and SafeFS review texts reconstruct their original
  reviewed hashes by reversing only those declaration merges
  (`/tmp/descriptor-style-corrected-root-cGBQdw/style-reconstruction.json`).
  The full SafeFS selection still passes 1466/1466; four SafeFS roots and three
  safe-bash roots have zero scoped type diagnostics and stable watched inputs
  (`/tmp/descriptor-style-types-root-O6CTad/`). A fresh guarded lint run is pending.
- The final guarded lint run succeeds with zero errors/warnings: 9922 configured
  and linted files, 25 receipts, and no drift among its fourteen watched inputs
  (`/tmp/descriptor-provider-lint-final-root-sNHqL7/`). The independently reviewed
  SafeFS observation/open-truncation contract, canonical provider exports,
  source/public tests and documentation are qualified as one separate foundation
  commit. Pipe runtime, legacy fixture migration and the read extension remain
  separate uncommitted work; this gate does not complete their acceptance.
- Further bounded Darwin Node API observations show successful sequential and
  positioned reads at offsets 0 and 7 on all four character devices, with null
  returning zero bytes and the others one byte. Caller-buffer sentinels remain
  intact. All four attempted writes through read-only descriptors reject EBADF;
  no writable device is opened. Exact inputs, outcomes and stable Node binary
  hashes are in `/tmp/darwin-device-read-position-root-AkfTw5/`. This is Node/libuv
  read API evidence, not lseek/getPosition, direct pread syscall or Linux proof.
- Local commit `92753aaede7f15071fa61f9584b5623ffc9b01e0` contains exactly the
  thirteen reviewed SafeFS foundation/public-integration/plan paths. Root verifies
  every committed blob against its pre-commit content hash. No push or release
  is requested or performed. The pipe observer/runtime work remains uncommitted.
- The runtime owner's three-file migration passes an unfiltered nineteen-file
  cohort, 666/666 with no skips or cancellations, and retains all eleven original
  regression names and status/reason/vector assertions. Four positive controls
  bind the permanent `pipe-peer-retirement-reference.json` record and disclose
  their control-channel adaptation. Production source hashes remain frozen;
  independent migration review and root's broader original-cohort replay are
  next, not inferred from those 666 cases. Evidence is retained in
  `/tmp/descriptor-fixture-receipt-unfiltered.log` and
  `/tmp/descriptor-fixture-receipt-final-hashes.txt`.
- Independent read-observer integration review passes seventeen new checks plus
  twelve author checks, with two strict roots and no diagnostics or measured
  input drift (`/tmp/read-observer-independent.Ppx8Rq/`). The read leaf remains
  at `66f2e8cfb8923357d2fb07a5e3db39bb774b1cbdf6e05452bdbc22eed9d1901c`.
  Its eleven device failures are specifically write-only `/dev/null`: seven
  zero-timeout readiness cases and four positive-timeout readiness-before-error
  cases. Canonical provider observation must reach both helper wrappers and the
  runtime; affirmative readiness must precede any demand for an unknown waiting
  policy. The other two read failures share readonly24's existing indexed-array
  declaration root cause, but their complete integration programs remain distinct.
- Root replays all eighty-eight prior retained-output qualification files plus
  nine current observer/transport/public/fixture/streaming files without filters:
  3234/3234 tests pass across 97 files, with zero skips or cancellations and no
  drift among 2211 watched files. The historical 5.2.37 oracle and immutable
  primary5.3 references remain separate; compiled optional consumers are enabled
  (`/tmp/descriptor-observer-broad-root-EJHeWL/`). Nineteen explicit core/test
  roots typecheck with zero diagnostics and 245 stable local inputs
  (`/tmp/descriptor-core-strict-root-i3fz2S/`); updated literal discovery passes
  98/98 (`/tmp/descriptor-core-discovery-root-aq7Uy6/`). Independent migration
  review, final documentation review and a fresh core-scope lint gate remain
  required before the separate pipe/observer commit.
- Root authorizes a separate TDD follow-up in the read leaf: an already-ready
  unreadable descriptor must report its immediate genuine read error without
  requiring a known waiting policy. This does not generalize to readable streams
  or manufacture timeout support. Existing native goldens and the eleven device
  failures remain unwaived until the provider/forwarding/runtime path exists.
- Independent final migration review approves all three fixture revisions and
  the managed-endpoint documentation, reauthenticating the eleven designated
  pins. It passes 137/137 cases with three strict roots, zero diagnostics and 320
  stable inputs (`/tmp/descriptor-migration-independent.1WYZRV/` and
  `/tmp/descriptor-contract-doc-review.ocEE4R/`). No original close-error,
  falsey-reason or pipeline-vector expectation is waived.
- The fresh core-scope guarded lint succeeds with zero errors/warnings: 9923
  configured/linted files, 25 receipts and no drift across its twenty-three
  watched candidates (`/tmp/descriptor-core-lint-root-ueVU2N/`). Production and
  fixture source hashes still match the reviewed frozen receipt.
- Actual compiled public execution with explicitly rooted real filesystems
  matches all four native peer-retirement observations inline and through both
  `bash` and `sh` VFS scripts: 12/12 status/stdout/stderr/file-effect comparisons.
  Root inspects the actual-output PNG; compiled inputs remain unchanged
  (`/tmp/descriptor-peer-public-corrected-root-QhXqps/`). Preserve the earlier QA
  capture where the harness omitted await on the asynchronous filesystem
  factory (`/tmp/descriptor-peer-public-root-T6bUWS/`); it is not a product defect.
  These observations qualify the stated native-control adaptation, not all
  kernel wakeup timing or the still-incomplete extended-read/device matrix.

- The pipe/observer foundation is locally committed as
  `9c7207c0e6ef795e67c109f943e0078c7b64c2aa`. Root verifies all twenty-four
  committed paths and their captured content hashes
  (`/tmp/descriptor-core-commit-root-COHKrb/verified.json`). This is a local
  commit, not a push or release. The earlier inventory-only response does not
  complete any remaining implementation requirement; the required scope above
  remains authoritative, without adding its later zip/bc/flock suggestions.
- The next helper bridge has a preserved red checkpoint: 48 command-descriptor
  tests yield 46 failures, and 45 retained-output tests yield 43 failures. Four
  controls pass, with zero skips/cancellations and zero diagnostics under the
  package's actual strict options with two explicit roots
  (`/tmp/safe-bash-descriptor-observation-31Lm4Y/receipt.json`). Missing forwarded
  `probeRead` methods prevent the deeper lifecycle assertions from establishing
  correctness yet. Root authorizes only the two existing filesystem helper
  owners to forward captured, affirmatively advertised observation through
  their existing admission/cleanup paths. This does not authorize devices,
  implicit timing support, or a new operation owner.
- Root adds a separate compiled-public boundary cohort covering retained
  provider observation through read/write aliases, inline and bash/sh VFS
  scripts, plus terminal-EOF descriptor lifetime. All 21 cases currently fail,
  with zero skips/cancellations and no measured compiled-input drift
  (`/tmp/provider-observation-public-red-corrected-root-XCBx1v/`). Preserve the
  first fixture capture, which omitted the backing namespace entry and did not
  reach provider admission for input redirects
  (`/tmp/provider-observation-public-red-root-8dLAd3/`). The corrected failures
  expose missing observation and premature close; a character stat alone is
  not evidence of a provider's timeout policy. Runtime/input changes remain at
  proposal-and-red-test authorization while the helper repair proceeds.
- The two helper changes turn their unchanged 93 observation tests green;
  the complete retained helper cohort passes 460/460, zero skips/cancellations.
  Thirteen explicit source/test roots typecheck with zero diagnostics and
  stable measured inputs (`/tmp/safe-bash-observation-green-ahAOMJ/receipt.json`).
  The author freezes both helper sources and the original tests for independent
  review; this does not establish end-to-end runtime observation.
- Independent review approves the read leaf's ready/unreadable/unknown-policy
  precedence change at source hash
  `5b80289193c3541196906841109c366d9da747ac8c6f6af33a2fef4bb5b943b6`:
  46/46 cases, three strict roots with zero diagnostics, 303 stable inputs and
  28 authenticated pins (`/tmp/read-ready-unknown-independent.q7zhnv/`). Four
  unchanged static native ordering analogues are audited separately, not
  counted as additional product passes. All thirteen read integration gaps
  remain unwaived, and this leaf is still not committed or publicly delivered.
- The source-runtime bridge checkpoint contains 31 cases: five controls pass
  and 26 fail, with zero skips/cancellations and one strict root free of
  diagnostics (`/tmp/provider-observation-runtime-final-red.log`). Both helper
  forwarding controls pass on the new snapshot. Remaining causes include
  ignored provider probes, character classification implying an unsupported
  timing policy, terminal EOF retiring a still-bound descriptor, and legacy
  fallback hiding malformed affirmative canonical observation. The proposed
  repair retains one borrowed descriptor identity and existing cleanup owners;
  it adds no device profile or timing capability.
- Root's helper snapshot passes all 97 prior foundation qualification files
  plus both new helper files: 3327/3327 across 99 files, zero skips/cancellations,
  stable watched inputs and authenticated historical Bash
  (`/tmp/provider-observation-helper-broad-root-5tHLgK/`). Maintained selected
  default and optional builds succeed separately
  (`/tmp/provider-observation-helper-build-root-Ocxfnu/` and
  `/tmp/provider-observation-helper-optional-root-TUNxos/`). These results do not
  override the subsequent independent defect below.
- Independent helper review adds six controls: four pass and two fail.
  Advertised method capture may synchronously revoke admission or cancel the
  root, yet command-descriptor acquisition returns before retained close drains
  (`/tmp/filesystem-observation-independent.7x8zcw/`). The complete retained
  helper cohort still passes 460/460 and fourteen strict roots have no
  diagnostics. Approval is withheld; the original independent test is frozen
  while its helper owner repairs publication admission. In parallel, root
  authorizes the disjoint input/runtime implementation against the existing
  31-case red checkpoint, without changing old fixtures or default registrations.
- Root corrects its new timeout-policy assumption before accepting the runtime
  change. The committed character-input stream policy already honors positive
  deadlines, independently of any new observation method. The GNU Bash Builtins
  manual's read-timeout contract and the two existing character-deadline tests
  support preserving that behavior, not replacing it with an unknown-policy
  refusal. Thus the earlier claim that character classification necessarily
  implies unsupported timing is withdrawn. New provider probes alone still
  supply no timing capability, and write-only character observations remain
  unknown. The new root public test's pre-correction bytes and explicit decision
  are retained in `/tmp/provider-observation-timeout-adjudication-root-oAd7JL/`;
  earlier red captures remain unchanged. The legacy identity, ignored-probe,
  premature-close and malformed-acquisition failures are separate valid issues.
- The independent post-repair helper review grants scoped approval: 99/99
  unchanged tests pass, three strict roots have zero diagnostics, and 241
  helper-graph inputs remain stable. Runtime/input are not dependencies of this
  focused replay (`/tmp/filesystem-observation-repair-independent.pQ8kZP/`).
  Both original capture-time reentrancy failures remain preserved. The accepted
  descriptor hash is
  `68810b5764653a0c50664396fe0a65c515baa0ebc2516de70e5fda418f9b62ee`;
  the output helper remains
  `8322b16a9e4259bf5a75facd0f482861214317321c227bcf53bc8c3abeaac019`.
- Device adjudication chooses one fixed, explicitly documented Darwin target
  for the unfinished opt-in device implementation, not automatic host detection
  or a second configuration profile preserving known mismatches. No device
  implementation is yet authorized. Read-only native C qualification records
  104 observations (`/tmp/device-canonical-profile.5twqzP/attempt2/result.json`):
  retained character identity, independent/shared cursors, successful positioned
  reads, select readiness and distinct poll behavior. Separate null/zero writable
  qualification records 149 observations
  (`/tmp/device-writable-profile.tTzWN8/result.json`), including successful
  positioned writes under append, unchanged positioned-write cursors, sync and
  no-op truncate. Neither count is a unit-test pass count or Linux evidence.
  The existing generic descriptor append mask conflicts with those measured
  positioned writes and needs explicit contract adjudication before capability
  publication. A final bounded four-byte-per-random-device write matrix is
  separately authorized; no implementation or complete native parity follows
  from source inspection alone.
- The final authorized random-node write matrix runs once: eight requests,
  55 observations (`/tmp/device-random-write-profile.aYgenT/result.json`). Random
  accepts four fixed bytes; urandom rejects every write with EPERM and consumes
  none. Sequential random writes advance the cursor; positioned writes retain
  it, including append handles. All four handles close. This does not qualify
  random-node synchronization or erase the positioned-append contract gap.
- The runtime bridge passes 42/42 new cases while preserving both original
  character-deadline tests. Its five legacy fixture files initially yield
  thirteen failures because their mock providers still advertise canonical open
  while intending legacy routing. Root explicitly authorizes those fixtures to
  declare unsupported canonical open before acquisition. Two internal counting
  changes are disclosed: the legacy branch now has one cleanup owner rather
  than a second unused failed-open owner, and performs zero canonical opens
  rather than one. Canonical two-owner checks, genuine close failures, byte
  effects, cancellation, unknown legacy deadlines and stream/stat counts remain.
  Original files, all thirteen failing names and the exact assertion mapping
  are preserved in `/tmp/provider-observation-legacy-migration-OxTYle/`.
  Unfiltered author reruns pass 42/42, 863/863 and 160/160; the five migrated
  files pass 193/193. Eight strict roots have no diagnostics. Independent
  migration and final runtime review remain required.
- Maintained selected and optional builds succeed on the frozen runtime source
  (`/tmp/provider-observation-runtime-build-root-Z7vrBI/` and
  `/tmp/provider-observation-runtime-optional-root-hjU3jj/`). Root's actual
  compiled public cohort passes 71/71: 21 new bridge cases, 14 prior descriptor
  cases and 36 aggregate cases, zero skips/cancellations and no measured input
  drift (`/tmp/provider-observation-public-green-root-WYRLlp/`). The corrected
  pre-build 21-case red capture remains at
  `/tmp/provider-observation-public-policy-red-root-OqXMTH/`.
- Root visually inspects actual compiled inline/bash/sh output from an
  explicitly injected memory-only character provider: readable alias readiness,
  retained EOF observation, write-only EBADF, independent timeout policies and
  exactly-once final resource closure
  (`/tmp/provider-observation-public-visual-root-1Xt2LY/`). This is public API
  integration, not a native-device replay or completed device implementation.
- Independent runtime review approves 58/58 cases with two strict roots, no
  diagnostics and 280 stable inputs; five-file migration review approves
  193/193 with five strict roots and 287 stable inputs. Public-test and final
  contract semantics are reviewed, and root's compiled receipt is authenticated
  rather than counted as a second execution
  (`/tmp/provider-observation-independent.W7nH27/` and
  `/tmp/provider-observation-migration-independent.NM7aNo/`).
- Root's wider 102-file replay exposes 24 more legacy fixture mismatches:
  3372/3396 pass, no skips/cancellations or input drift
  (`/tmp/provider-observation-final-broad-root-e15IEm/`). Twenty-three cases in
  prepared-input-cleanup-review and one runtime-regressions case remove open
  while retaining affirmative support. Their two explicit legacy capability
  declarations are corrected. One call to the now-nonexistent second legacy
  cleanup becomes optional; real resource-close/registered-cleanup concurrency
  and all original assertions remain. Preserve the intermediate single failure
  and nine cascading cancellations, not just the final 110/110 green result.
  The two-file AST assertion/name comparison, originals, exact 24-name mapping
  and strict two-root zero-diagnostic receipt remain in
  `/tmp/provider-observation-extra-legacy-AHCSs7/`. Source and the earlier five
  fixture files remain frozen; final broad replay and addendum review follow.
- Final independent addendum review passes 110/110, two strict roots with zero
  diagnostics and 283 stable inputs. It verifies the exact three approved
  changes and unchanged assertions, names and options
  (`/tmp/provider-observation-extra-independent.CrGV5n/`). No source repair or
  unresolved finding remains within this bridge's reviewed scope.
- Root's current complete bridge cohort passes 3412/3412 across 103 files,
  with zero skips/cancellations and no measured input or oracle drift
  (`/tmp/provider-observation-post-style-broad-root-ZBzehr/`). Seventeen explicit
  source/test roots typecheck with zero diagnostics and 212 stable local inputs
  (`/tmp/provider-observation-post-style-strict-root-1hE2I0/`). Final literal
  discovery passes 98/98
  (`/tmp/provider-observation-complete-strict-root-qNr1Xw/`). These are scoped
  bridge checks, not a full-package typecheck or completion of the read/device
  matrix, readonly arrays, remaining tools or jobs.
- Guarded lint first identifies exactly two prefer-const declarations in the
  new helper tests. Root merges only those declarations with their assignments;
  reversing those two changes reconstructs the exact independently reviewed
  original test hashes. All 99 focused cases pass again, as does the complete
  3412-case replay (`/tmp/provider-observation-style-root-C4TPwG/`). The fresh
  guarded lint then succeeds with zero errors/warnings and no drift across
  nineteen watched candidates (`/tmp/provider-observation-clean-lint-root-jVmOgN/`).
  The initial lint failure and original test bytes remain preserved. No
  production source, behavioral assertion or native reference changed for style.
- The descriptor-observation bridge is locally committed as
  `d6240959b6c6834cd5e3e40c02f2de58ee63a542`. Root verifies all twenty committed
  paths and content hashes (`/tmp/provider-observation-commit-root-TZB45P/`).
  This completed goal turn is progress, not a push, release or full-goal finish.
- The next generic descriptor increment adds optional
  `positionedAppendWrite: true` for providers that actually support positioned
  writes on append-open handles. It preserves the supplied offset and separate
  sequential cursor; it does not model Linux's append override. False/omitted
  retains existing EINVAL behavior and masks positionedWrite on append handles.
  The affirmative flag cannot promote missing base support or readonly access.
  Existing memory/real providers are not enabled automatically. This capability
  is required by the measured Darwin device behavior, not pathname inference.
- The filesystem author reproduces 55 failures and 18 controls before the
  implementation, then passes all 73 new tests and 395 retained descriptor
  cases, with actual package and test strict checks clean. Independent review
  follows. The command-helper author separately reproduces three capability
  masking failures among 77 controls. Root corrects that new suite's initial
  raw-flag expectation: effective flag metadata must also reflect base support
  and access mode, consistently with the filesystem constructor.
- The compiled public append-capability boundary starts at 6/16 passing with
  ten genuine missing-capability failures, zero skips/cancellations and no
  measured bundle drift (`/tmp/append-position-public-red-root-BjEYMI/`). This
  is before public bundle rebuilding and is distinct from source qualification.
- Readonly-indexed qualification independently reproduces all 24 pinned native
  mismatches and the two read integration cases, while six new default-isolation
  controls pass (`/tmp/readonly-indexed-checkpoint-4PNBaJ/`). Root authorizes
  captured `indexedDeclarations: ["readonly"]` syntax metadata explicitly
  declared by arraysExtension, not inferred from its name or arrayKeys.
  Default grammar and dispatch must remain unchanged. The read descriptor-order
  test host must explicitly compose arraysExtension for its readonly-array
  cases; its programs, assertions and native reference bytes remain unchanged.

- Independent append-capability review withholds approval after reproducing a
  selected capability getter that aborts with `false` during acquisition but
  still publishes a live descriptor. Its 31 new cases have 30 passes and one
  failure; the author's 73 remain green. Strict checks are clean, so this is a
  product defect, not a type or fixture failure. Preserve
  `/tmp/safe-fs-append-position-independent-KX9fwO/summary.json` and the original
  reviewer test. Root authorizes a post-materialization admission/cleanup repair
  and requires independent replay before accepting this shared prerequisite.
- The separately bounded Darwin device sync/empty-operation capture
  `/tmp/device-sync-zero-profile.LyFRyx/freeze.json` records 135 observations.
  Random/urandom synchronous opens and synchronization succeed. Empty reads
  succeed with readable access; wrong-access empty reads/writes return EBADF.
  Empty writable null/zero/random writes return zero, but an empty writable
  urandom write returns EPERM. All observed cursors remain unchanged and all
  twelve descriptors close. This exposes another canonical helper gap: its
  unconditional empty-write fast path masks the measured urandom error.
- Root approves the next optional capability design,
  `delegateZeroLengthWrite?: boolean`: true delegates an empty write after the
  existing access/position checks through the same serialized, drained backend
  operation; its accepted byte count must still be zero. False/omitted preserves
  the current fast path, omission remains omitted, and read-only access masks
  the flag false. Empty reads and nonempty writes are unchanged. No provider is
  automatically enabled. This is a TDD assignment, not implemented support or a
  completed device profile; the append repair is reviewed before source work
  starts on this separate prerequisite.

- The append helper's strengthened effective-mask suite reproduces nine failures
  among 77 cases before its repair, then passes all 77. Its retained thirteen-file
  cohort passes 543/543, with fifteen strict roots clean. The output wrapper is
  unchanged; these runs use structural public descriptors and do not certify the
  then-stale public filesystem JavaScript. Evidence is
  `/tmp/safe-bash-append-position-effective-4dAZD9/receipt-final.json`.
- The filesystem author retains the independent selected-getter red, adds two
  constructor-method getter cancellation regressions, and reproduces 103 passes
  plus three failures before repair. Checks after capability and method capture
  restore 106/106 focused and 428/428 retained cases; independent rereview is
  required. No empty-write capability has been implemented in this increment.
- Root's compiled readonly test preserves and replays all 24 primary5.3 records
  with their exact statuses and stdout/stderr bytes, plus three default/name-only/
  arrayKeys-only isolation controls. The existing public bundle passes three and
  fails 24 with no skips, cancellations or measured drift
  (`/tmp/readonly-public-red-root-9fkdVn/`). The initial outer capture
  `/tmp/readonly-public-red-root-in9nVY/` fails before launch because it guessed
  a nonexistent safe-js/safe-bash bundle path; it is a harness admission failure,
  not a product test result. Corrected admission uses the actual package export.

- Independent rereview approves the append repair: 352/352 across thirteen
  filesystem descriptor files, including the unchanged 31-case reviewer suite
  and 75 author cases; package and scoped strict checks are clean. The separate
  command-helper review passes 193/193, including seventeen independent cases,
  with strict checks clean. Both source freezes remain unchanged. Receipts:
  `/tmp/safe-fs-append-position-rereview-MOGgCw/summary.json` and
  `/tmp/safe-bash-append-helper-independent-Y20wG7/summary.json`.
- Maintained `npm run build` succeeds and refreshes the actual public filesystem
  bundles, unlike the earlier types-only selected build. Root's compiled
  append/provider/observer/default cohort passes 87/87 with 458 measured test and
  generated-JavaScript inputs unchanged (`/tmp/append-public-green-root-mjdOjk/`).
  The new public append suite therefore improves from 6/16 to 16/16. Its actual
  public declaration-consumer strict check has zero diagnostics. Literal
  discovery, including all three new append tests, passes 98/98.
- Compiled inventory checks retain 79 default and exactly 28 browser commands,
  working date, no automatic curl or new tools, and no optional factory exports
  (`/tmp/append-default-inventory-root-1Egpww/`). Root views the actual public
  descriptor/Shell output in `/tmp/append-public-visual-root-rcrMOp/append.png`:
  positioned writes preserve cursor 7, sequential writing advances to 8, cleanup
  runs once, memory append still refuses explicit offsets, and an unmounted
  urandom remains absent. This injected memory-only provider is not native
  device qualification. The ongoing readonly source was not frozen by this
  build; its public acceptance still needs a coherent later rebuild.
- The next empty-write prerequisite has a frozen 50-case source test with 15
  passes and 35 failures, no skips, and clean actual-options strict typing
  (`/tmp/descriptor-zero-write-red.T26B4R/freeze.json`). Preserve the original
  49-case capture and its disclosed Vitest empty-parameter-row correction. The
  device owner confirms counted budgets already delegate callbacks and that
  byte streams do not promise to preserve empty-write events. Root separately
  requests command-helper effective-metadata TDD before authorizing its change.
- The readonly author freezes four source files with 24 unchanged native cases
  and 55 author cases passing, plus the two explicitly composed readonly/read
  cases. Its unfiltered 1646-case run has 1634 passes and twelve failures: one
  intentional factory metadata shape addition and eleven device-null failures
  reproduced unchanged without arrays enabled. Root approves only the additive
  factory syntax assertion migration in keys.test.ts, preserving its original
  bytes/red and all behavior assertions. Independent readonly review is pending;
  none of those eleven device gaps is waived or counted as a pass.

- Guarded append lint finds two prefer-const declarations, one in each new
  independent review test. Root preserves the exact reviewed originals and
  proves the changes only merge each declaration into its later assignment
  (`/tmp/append-review-style-root-NgiRsJ/reconstruction.json`). No assertion,
  native reference or product source changes. The resulting filesystem 106 and
  command-helper 94 cases all pass again, with five actual-options strict roots
  clean and no measured drift (`/tmp/append-post-style-root-Ry0KKa/`). A fresh
  guarded lint is required; the original two-error result remains preserved.
- A coherent selected virtual-bash build and optional build both succeed with
  the four readonly source hashes unchanged. Compiled readonly27 now passes,
  and its combined optional/mapfile/default cohort passes 101/101 with 458
  measured generated/test inputs unchanged
  (`/tmp/readonly-public-green-root-TKEdo6/`). Independent review remains open;
  this is not full readonly/array or device acceptance.
- Empty-write command-helper TDD passes 89 of 90 cases, exposing one effective
  read-only metadata masking defect without requiring a budget/output-wrapper
  repair (`/tmp/safe-bash-zero-write-red-ZTCerj/receipt.json`). Root's compiled
  public18 starts at six passes and twelve failures, with zero skips/cancellations
  and 151 measured inputs stable (`/tmp/zero-write-public-red-root-LJ7LFw/`).
  Four cases directly expose swallowed empty-write EPERM; other failures expose
  missing capability metadata. These are preserved future-prerequisite reds,
  not part of the passing append increment.

- Fresh guarded append lint succeeds: zero errors/warnings, 9939 configured and
  linted files, 25 receipts, and no drift among the ten watched append candidates
  (`/tmp/append-clean-lint-root-20PFIL/`). The append prerequisite is ready for
  its separate local commit; this does not certify unfinished readonly, empty
  writes, device descriptors, remaining tools or jobs.
- Independent readonly review correctly withholds approval despite the passing
  original/source/public cohorts. Its 26 cases have 22 passes and four failures:
  direct readonly compound redeclaration and append wrongly continue execution;
  an already readonly scalar wrongly becomes indexed; and local-array shadow
  refusal loses the `local:` diagnostic prefix. Quoted compound operands must
  retain their distinct nonfatal behavior. Primary24 plus author55 still pass,
  for 101/105 overall, with strict diagnostics zero and unchanged source/reference
  hashes (`/tmp/readonly-indexed-independent-Ulcs6X/final-report.json`). Root
  assigns the evidence-backed repairs to the readonly source owner. The original
  four failures and separately recorded harness corrections remain preserved.

- The append prerequisite is locally committed as
  `a6aa9d63211af41d15ab9dd5b3ceab9bd64a91aa`. Root verifies all eleven committed
  paths and their captured content hashes
  (`/tmp/append-capability-commit-root-F8nQxB/verified.json`). No push or release
  occurs. The goal turn makes concrete progress but does not complete the scope.
- After that verified commit, root authorizes the narrowly specified empty-write
  capability implementation in the filesystem contract/helper and the separately
  reproduced read-only metadata mask in the command helper. The frozen 50-case
  filesystem, 90-case command-helper and 18-case public red suites remain
  unchanged. Budget and output-wrapper changes are not justified by the evidence.
  Independent review and coherent public rebuilding are still required before
  these changes or the device provider can be accepted.

- The filesystem empty-write implementation turns the unchanged 50-case red
  suite green and passes 478 retained descriptor cases. Package typecheck is
  clean, but the deliberate string-valued invalid-capability fixture produces
  one newly exposed TS2352 diagnostic. Root validates the exact fixture and
  authorizes replacing only its cast with equivalent Reflect.set construction,
  retaining the invalid string, every assertion and the original bytes/red.
  Independent review owns that disclosed fixture migration; it may not weaken
  the test or change the provider profile.
- The command helper now captures the declared empty-write capability directly,
  without reflection or casts, and masks read-only access. Its unchanged 90 cases
  pass, as do 633 retained cases and sixteen strict roots with 305 measured inputs
  unchanged (`/tmp/safe-bash-zero-write-mask-WcOnrY/receipt-final.json`). No budget
  or output-wrapper change is made. Independent filesystem/helper review is
  still pending, so these are author qualifications, not final acceptance.
- Root refreshes selected filesystem declarations, then runs the maintained
  normal build to refresh actual public JavaScript. Both succeed with their
  measured source hashes unchanged. Public empty-write18 improves from 6/18 to
  18/18; its combined append/provider/observer/default cohort passes 105/105,
  zero skips/cancellations, with 459 measured inputs stable
  (`/tmp/zero-write-public-green-root-9FEEHf/`). Both public filesystem entry
  points expose the flag in an actual-options in-memory declaration consumer
  with zero diagnostics (`/tmp/zero-write-public-types-root-XbePEg/`).
- Root views `/tmp/zero-write-public-visual-root-p2Gsww/zero-write.png`: the
  actual managed descriptor skips the default empty write, propagates EPERM
  under explicit delegation, refuses read-only writes with EBADF, and closes
  each backend once. This uses an injected memory-only backend, not the product
  device provider or a new native execution. Fresh lint, literal test enrollment,
  independent review and a separate local commit remain pending for empty-write
  support. Device production edits are not yet authorized; readonly repairs
  remain with their source owner following the four independent failures.

- The readonly owner reproduces the independent 101/105 result, preserves all
  26 reviewer cases, and repairs the four failures. Two additional expansion
  controls bring the focused cohort to 107/107: primary24, reviewer26 and
  author57. Its broad run passes 1663/1674, with only the eleven still-active
  device-observation failures; nine strict roots have zero diagnostics/drift.
  Evidence and complete frozen hashes are in
  `/tmp/readonly-indexed-independent-repair-rpAMIm/final.json`. The original
  reviewer is rechecking that repair. The prior public101 result belongs to the
  earlier candidate and does not qualify these new parser/runtime bytes; a
  fresh coherent public build/replay is required before readonly acceptance.

- Independent empty-write review approves the filesystem implementation: 69/69
  focused and 421/421 retained descriptor cases, with strict checks clean after
  the exact authorized invalid-fixture construction migration. The helper still
  has one failure among 101 cases: an enumerable getter returning undefined and
  then true is observed twice, reintroducing an affirmative empty-write flag on
  a read-only handle. Writes correctly remain EBADF; metadata is wrong. Root
  authorizes a single captured capability snapshot, deriving masks from that
  snapshot and omitting the undefined optional flag. Preserve the eleven-case
  independent test and its red (`/tmp/zero-write-independent.z8DTKd/freeze.json`).
- Readonly rereview passes the original107 but adds two valid newline-continuation
  failures, alongside four passing cancellation controls. Native Bash5.3 skips
  the remainder of the failed command list and can resume the next input unit;
  the implementation instead exits the entire input. The extended32-case review
  preserves its original26 prefix. Its focused result is 111/113, not acceptance
  (`/tmp/readonly-indexed-rereview-Ma3HCz/final-report.json`). The owner must repair
  the actual control-flow boundary, preserving quoted operands, diagnostics,
  cancellation and cleanup rather than splitting source text or weakening tests.

- The helper's single-snapshot repair turns the unchanged 100/101 red green and
  passes 644 retained author cases. Independent rereview approves 101/101 focused
  and 661/661 related cases, with eighteen strict roots clean and 338 measured
  inputs unchanged (`/tmp/zero-write-helper-rereview.l60o09/receipt.json`). The
  original double-getter failure is preserved; later live cursor validation,
  cancellation, admission and cleanup behavior remain unchanged.
- Root's selected virtual-bash build refreshes the final helper and succeeds.
  The final public zero-write/append/provider/observer/default cohort passes
  105/105. In the same separately labelled capture, the newly added readonly
  continuation cases reproduce 27/29 passing; that outer process exits 1 for
  those two retained readonly failures, not for zero-write acceptance. All 461
  measured test/generated inputs stay unchanged
  (`/tmp/zero-write-final-public-root-VFrIjm/`). Literal discovery passes 98/98
  with all three new zero-write test paths explicitly enrolled.
- Fresh guarded zero-write lint succeeds with zero errors/warnings and no drift
  among ten watched candidates (`/tmp/zero-write-final-lint-root-9Zkq0t/`). The
  independently approved empty-write prerequisite is ready for its separate
  local commit. This does not qualify the still-pending readonly continuation
  repair or the product device provider.
- With both generic descriptor prerequisites independently approved, root
  authorizes the device owner to implement the fixed Darwin canonical provider
  in its existing leaf. Its public-builder test must explicitly opt into the
  new empty-write capability; only that fixture setting may change before the
  new red run. All other original device expectations/native captures remain
  preserved pending explicit migration decisions. No additional native entropy
  writes are authorized; the old native test that writes random-device payloads
  must not be executed during this source implementation phase.

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

## September 5 continuation: canonical device public boundaries

The original 16-case compiled-device cohort is preserved at
`/tmp/device-canonical-public-red-root-siIvi7`: one pass and fifteen failures.
Twelve failures reached the missing canonical open capability; three workflow
failures instead used the unsupported `exec` builtin. Those three are fixture
errors, not evidence of a device-open defect. The original test bytes and hash
are preserved at `/tmp/device-public-fixture-root-A2JVj7`.

The workflow now scopes descriptor 3 to a brace group, retaining identical
device reads and exact output-byte assertions through inline, `bash`, and `sh`
entrypoints. Against the unchanged compiled provider, the corrected cohort is
four passes and twelve failures, with no skips or cancellation and no drift in
456 watched inputs: `/tmp/device-public-adjusted-root-3KJqMC`.

A separately authorized readonly native probe on Darwin 25.4.0 establishes full
reads of 65,536, 65,537 and 262,144 bytes for zero/random/urandom, and full
positioned reads of 65,537 bytes without changing the sequential cursor. Null
returns zero throughout. Its sixteen calls request 1,835,016 bytes in total;
four readonly opens and four closes complete, with no device writes, retries,
or random payload logging. Source/compiler/executable hashes and observations
are in `/private/tmp/device-large-read-boundary-pRZM7K/handoff.json`.

The expanded public cohort preserves all corrected cases and adds large
descriptor-read and actual compiled `dd` cases. Before rebuilding the optional
provider, it reports six passes and twenty-six failures:
`/tmp/device-public-large-red-root-GRSWHu`. Twenty failures reach missing open;
six `dd bs=65537/262144 count=1` cases copy only 65,536 bytes. This is concrete
public evidence that the crypto-call chunk limit must not become the device's
descriptor-read limit. No production fix or green public replay is claimed yet.

Both new public test files pass the actual strict package compiler options with
two explicit roots, 313 source files, 323 watched inputs and zero diagnostics or
drift: `/tmp/scripting-public-types-root-NcSJ46`. The selected virtual-bash build
also passes with the current readonly boundary repair and nine watched inputs
unchanged: `/tmp/readonly-selected-build-root-1ReWK7`. Independent readonly
re-review and a fresh coherent optional build remain pending. These scoped
results do not establish full-package type correctness or complete tool parity.

The subsequent coherent optional build passes with 385 source/configuration
inputs unchanged: `/tmp/scripting-optional-build-root-3ht2iz`. Public device
replay now passes all 32 cases, including the six formerly short large-block
copies. The combined 63-case replay has 61 passes and two failures, both newly
added readonly diagnostic regressions; it is not an all-green run. All 458
watched compiled/reference/test inputs remain unchanged:
`/tmp/scripting-public-boundary-root-zVsrS6`. Both public test roots again have
zero strict diagnostics: `/tmp/scripting-public-types-root-MpEiKp`.

Independent readonly review preserves the original 139 passing cases and adds
two failing cases: declarations created inside eval incorrectly acquire an
`eval:` diagnostic prefix, and a nested function marking its caller-local
binding readonly incorrectly acquires a function-name prefix. Pinned Bash 5.3
confirms that status, stdout, input-unit continuation and local restoration
already match; diagnostics do not. The independent report and original/new
hashes are preserved at `/tmp/readonly-input-unit-independent-tJVMxk`.
The corresponding public cases also fail on the built candidate. A narrow
runtime repair is assigned; exact diagnostic parity remains unapproved.

The actual compiled device transcript was rendered and visually inspected at
`/tmp/device-canonical-visual-root-v2HITM/devices.png`. It shows 65,537-byte zero
output, a 262,144-byte random pipeline count, descriptor-3 zero reads, and the
urandom write refusal. The refusal still displays an errno-oriented printf
diagnostic; exact native printf diagnostic qualification remains open. This
visual check performs no native device operations and logs no random payload.
Its outer capture watches 463 unchanged inputs:
`/tmp/device-canonical-visual-capture-root-njK7Y0`.

The actual compiled default inventory still matches the independently declared
79-name test list, the browser inventory has 28 commands, and epoch date output
remains unchanged. New tools/extensions/devices stay absent from both default
barrels/registries, with explicit optional packaging exclusions retained:
`/tmp/scripting-default-inventory-capture-root-XA88TM` (457 unchanged inputs;
the earlier PQA2r8 capture checked extension/device export absence, while this
expanded capture also explicitly checks each new tool factory/plugin export).
Literal integration membership passes 98/98 after enrolling the four readonly
tests: `/tmp/readonly-literal-root-VbvJwV`. Device test enrollment, final independent
review, final guarded lint, and separate local commits remain outstanding.

The readonly diagnostic repair now tracks the active command identity until
simple-command completion and copies that state for isolated children, instead
of inferring prefixes from eval or local-binding ownership. Author evidence at
`/tmp/read-independent-current-UrUD22/final.json` preserves the original 139/141
failure and reports 151/151 focused cases and 1828/1828 across 43 broader roots.
Runtime SHA-256 is
`619bb61b2bb5e3477d9f6fc4003f721075c86abbdc176be39dba8a6f3b2ce1c1`;
independent34 and primary24/reference remain unchanged. The paused read-leaf
audit separately reports 638/638 across 17 roots without any read-leaf edits;
it does not establish complete read-option parity.

Fresh selected and optional builds pass at
`/tmp/readonly-diagnostic-build-root-W1xNXo` and
`/tmp/readonly-diagnostic-optional-root-v5i4LQ`. The unchanged public tests now
pass 63/63: device32 plus readonly31, including both diagnostic regressions.
There are no skips/cancellations and no drift in 458 watched inputs:
`/tmp/scripting-public-diagnostic-green-root-eedqfe`. Independent review of this
new runtime snapshot and final guarded lint are still required before committing.

Further independent scrutiny leaves this increment unapproved: after a function's
conditional `[[` or arithmetic `((` command, native Bash reports that command's
identity in the subsequent readonly-assignment diagnostic. The candidate instead
retains the function name. The original 151 cases still pass, but three added
native-backed cases fail; status, stdout and continuation already match.
Evidence: `/tmp/readonly-diagnostic-independent-lw0UTr/final.json`. Its initial
oracle admission error launched no child; the corrected canonical pathname
authenticates the same pinned executable. No fallback was used.

Root preserves the prior green public63 and adds these exact three regressions.
The resulting public66 cohort is 63 passes and three failures, with no skips,
cancellations or drift in 458 watched inputs:
`/tmp/readonly-command-identity-public-red-root-lLW7aH`. A broader preceding
public/default/optional/mapfile cohort passed 137/137 with 1230 unchanged inputs
at `/tmp/scripting-public-broad-root-zA0AKq`; that earlier green is not evidence
that the new regressions pass. The diagnostic-transition repair is assigned
across supported command kinds rather than suppressing these prefixes globally.

The actual compiled readonly-array listing and direct/eval continuation outputs
were rendered and visually inspected at
`/tmp/readonly-canonical-visual-root-XB54aw/readonly.png`; the separate stdout and
stderr sections preserve channel attribution. All three displayed programs
exit zero; this ad-hoc visualization is not a screenshot test or proof of the
still-failing conditional/arithmetic cases.

## Native device reference migration decision

Independent device source review passes 108/108 and strict checking with four
roots, with 550 watched inputs unchanged:
`/tmp/device-canonical-independent-5b64zb/final.json`. The nine approved legacy
stream-fixture migrations also pass independent review: 34/34 native-free cases,
with eleven native invokers deliberately excluded, not counted as passes.
`/tmp/device-migration-independent-9zoEJY/final.json` verifies preservation of
original programs/assertions and the added positive iterator-admission checks.

The ambient native device test must not keep performing automatic entropy
writes or imply that this fixed Darwin provider has a Linux qualification.
Four older passing TAP captures were located, but none binds that execution to
a contemporaneous input-source hash and pinned executable. Preserve the TAP,
the original test, and their hashes; a later source snapshot does not repair
that missing provenance or yield exact malformed-path errno goldens.

Root authorizes replacing that ambient test with authenticated immutable native
references and actual virtual API replay. Existing C captures qualify exact
one-byte writes and the recorded empty/access/positioned/sync profiles. Preserve
five-byte virtual write and 256-byte virtual-stream regressions separately;
they must not be presented as exact five-byte native write witnesses. Historical
random-sample inequality is probabilistic sampling, not a proof of secure
freshness. Retain its history and replace the maintained assurance with the
existing deterministic crypto-provider mapping and fresh-call controls, without
claiming an authenticated native-versus-virtual payload comparison.

One additional bounded metadata/read probe is authorized to fill safe missing
evidence: four existing nodes, one verified-character
`O_RDWR|O_APPEND|O_NONBLOCK` open and one 256-byte read each, four closes, and the
five original malformed-path lstat requests. Total requested payload is at most
1024 bytes; record counts, errno, cursor and zero/nonzero booleans only. No retry,
native write/pwrite/writev, ioctl, reseed, or entropy payload/hash logging is
authorized. Authenticate canonical C/compiler/executable/platform inputs under
outer-owned startup/catch capture and bounded execution. This does not authorize
automatic host-device operations in maintained tests. The migration owner must
return exact mappings, preserved originals and frozen tests/reference data for
independent review before any device commit.

## Readonly increment: final scoped acceptance

The remaining conditional-operand probe is demonstrably outside this opt-in
increment: six controls behave identically with and without arrays and without
readonly state. `conditional.ts` is unchanged from HEAD. Standalone
`[[ 1 -eq 1/0 ]]` retains the existing unsupported-profile status2, whereas the
native arithmetic failure has status1. Implementing new default conditional
arithmetic is not authorized as a readonly-array fix.

Root therefore approves explicit test separation, not removal of the evidence:
the exact source and complete native record remain preserved; one named boundary
control checks complete virtual bytes, exact downstream readonly identity, and
the explicitly unmatched first diagnostic. Every other assertion is unchanged.
The original full217 red and all55 new native observations remain retained.
Final accounting is **216 readonly acceptance cases plus one boundary control**,
not217 native-parity passes. The new native whole-result comparisons remain
54/55 exact, with that default-profile mismatch disclosed separately.

Independent approval of source and this narrow test migration is recorded at
`/tmp/readonly-kind-independent-6IFFAr/final.json`: all217 maintained checks pass,
retained172 pass, actual-options strict has zero diagnostics, and 545 watched
inputs remain unchanged. Author broader checks pass1894/1894 across43 roots,
with the same explicit boundary classification:
`/tmp/readonly-boundary-separation-Vwy2aG/final.json`.

Final source/test hashes:
- Runtime: `865a333d5fdb552b01e423c92596b66afb55f70b0906847815f7ee6f8075c9f4`
- Author test: `9f1d6864e3b8c525f24ccf89d31099dc775c33154c561063cf72e7e29d571a21`
- Independent37: `3978dc6d7bdaad03041fb4269a62a19cb33bf81cd36df1749e51614fdc10b072`
- Primary24/reference hashes remain unchanged from their original captures.

Fresh selected/optional builds pass at `/tmp/readonly-kind-build-root-Qvw1eK`
and `/tmp/readonly-kind-optional-root-nHyCUy`. Public device32 plus readonly34
pass66/66 at `/tmp/readonly-kind-public-root-bwhjD0`; the broader public/default/
optional/mapfile cohort passes140/140 with1230 unchanged inputs at
`/tmp/readonly-kind-public-broad-root-MNkWNj`. Actual public strict checking again
has zero diagnostics at `/tmp/scripting-public-types-root-60PNQy`.
Default79/browser28, epoch date output, explicit opt-ins and packaging exclusions
remain checked at `/tmp/readonly-kind-inventory-root-oRaEQE`.

Guarded `npm run lint:eslint` completes successfully: 9946 configured/linted
files, zero errors/warnings,25 receipts and13 unchanged readonly candidate inputs.
Capture: `/tmp/readonly-final-lint-root-JrhzCw`. No autofix or guard bypass is used.
The final actual-output image includes corrected conditional/arithmetic prefixes
and is visually inspected at
`/tmp/readonly-canonical-visual-root-GwCKRZ/readonly.png`.

This qualifies a separate local readonly-array increment, not full arrays,
default conditional parity, the pending read leaf, jobs, or the whole requested
tool set. Device source/test changes remain outside this commit and still need
final native-reference review and their own local commit. No push or release is
requested or claimed.
