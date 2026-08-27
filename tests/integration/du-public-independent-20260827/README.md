# PUBLIC DU pre-candidate fixture freeze — August 27, 2026

## Authority, chronology and limits

Owned scope is only this new directory. No product/config/AGENTS/ledger edits,
delegation, historical fixture edits, native execution or candidate execution.
This is a freeze **before a root-declared public candidate**, informed by the
existing module and previous-failure history; it is not a blind holdout.
Mutable inspection HEADs are not candidate declarations or HTML74 acceptance.
No product/integration-author work is authorized here before that checkpoint.

Accepted history stays separate and untouched: module candidate
`9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d`, V9 freeze
`1b2ddea9e38b25cc91134a2f35a318e27f4d7c29`, original rejection
`b3f45fa796282ef644729af36f9d41fc37693bd8` (40 raw markers, exit1, never rescored),
module/purity proof `d53b003b9e7a20a3a593378a9b7a9ed8e896c493` (original native
13/16 unchanged; original success-only tail unrun), and separate native-only
qualification `290e175d19f065758b8586c79660fc927db65c9d` (16/16 plus exact14
focused controls). No composite footer, old cohort rerun, or replacement proof.
O060 duplicate operands is deferred/profile-gap coverage; deterministic child
ordering is disclosed, not native traversal parity. V2–V3 exact delta remains
permanently unproved. Gate7 remains separate/pending.

## Frozen inventory and execution status

`cases.json` freezes **29 cases**: package6, types5, registration7, examples3,
lifecycle8. Eight have callable assertion bodies (`P01`, `R01`, `R02`, `R04`,
`R05`, `E01`–`E03`); four are exact staged strict consumers (`T01`–`T04`);
seventeen are concrete blocked specifications. **All 29 remain admission-blocked;
zero semantic cases ran.** Blocked cases are neither skips nor passes. The
static verifier is the only runnable verification entry in this freeze.

`public-cases.mjs` has no product imports or top-level execution. An eventual
authenticated supervisor must load real installed modules and supply them;
an injected object or assertion record alone is not public-package evidence.
`load-proof-hook.mjs` is a frozen, syntax-checked loader-hook ingredient, not an
executed/validated supervisor. No complete build/install/replay driver is claimed.
It records bytes returned by the actual ESM load hook, not a disk-hash surrogate.
`consumers/*.ts.data` are data, never loose TS in global discovery. Their compiler
settings and exact positive/negative acceptance are in `type-controls.json`.

## Read-only API findings

`inspection.json` records first inspection commit, capture HEADs, per-file live
SHA-256/Git blobs versus that immutable commit, dirty comparisons and static-tool
versions. These are provenance only, not a root-selected candidate inventory.

- `src/commands/du/index.ts:4` exports `createDuCommand`, `createDuCommands`,
  `duCommands`, `DuCommandsOptions`, `DuLimits`; command `du`, plugin `du-commands`.
- `src/commands/du/options.ts:1` declares nine required numeric `DuLimits` fields:
  `maxArguments`, `maxArgumentBytes`, `maxEntries`, `maxDirectoryEntries`,
  `maxDepth`, `maxPathBytes`, `maxMetadataBytes`, `maxOutputBytes`, `maxSteps`.
  `DuCommandsOptions` is `replace?: boolean`, `limits?: Partial<DuLimits>`.
  Settings reject non-safe-integer or less-than-one supplied limit values.
- At inspection, `src/index.ts:1` does not re-export DU and `package.json:12`
  has no explicit `./commands/du`. `src/plugins/index.ts:23` has HTML but no DU
  aggregate property/factory. This is not a public candidate rejection.
  Existing families use `Omit<FamilyOptions, "replace">`; global replacement and
  collision preflight exist. We do not invent the future DU property name.
- `src/contracts/output.ts:4` declares `OutputOperation` with `signal`, `output`,
  `child(destination)`, `registerCleanup(cleanup)`, `acquire(start, release)`,
  `close()`. `src/contracts/output.ts:13` declares
  `createOutputOperation(context: Pick<CommandContext, "signal" | "registerCleanup">,
  destination: ByteSink)`. It registers close before admission, scopes output
  cancellation and awaits admitted acquisition release. This signature is
  observed, not newly designed or yet bound to a public DU candidate.
- `src/commands/du/du.ts:130` currently constructs/registers its Budget and
  closes it in finally; the inspected DU has no output-operation adoption.
  `src/commands/du/budget.ts:108` accounts and awaits writes. Required future
  mapping of original caller versus operation context remains root-owned.
- `src/contracts/filesystem.ts:6` distinguishes optional allocated bytes from
  logical size. `src/commands/du/README.md:11` specifies unknown/zero/apparent
  semantics. Examples use public Memory VFS and explicit synthetic metadata
  wrappers, not native allocation, RSS, exclusive storage or provider claims.

## Required root answers / fail-closed binding

Every `required` field in `bindings.template.json` is intentionally null. The
binding validator rejects this freeze, absent fields and a premature state flip.
It checks binding shape, **not authenticity**; a supervisor must verify every
referenced identity and approval before execution. Root must supply:

1. `candidateCommit`, exact `sourceInventory` (`path`, SHA-256, Git blob),
   `sourcePathsAndPolicy` identity, and the approved admission mode. Include
   actual committed source/tests, build configs, package/lock, public contracts,
   exports, aggregate and DU integration paths; inspection hashes cannot substitute.
2. Accepted `html74Checkpoint` commit, evidence identity and **exact74 names**;
   `approved75Inventory` with exact75 names and root approval identity. Freeze
   requires HTML74 plus DU, not an invented list: getopts remains builtin;
   HTML present; curl/SafeJS optional; expr excluded. A root scope change needs an
   explicit disclosed follow-up freeze, never silent count/list rewriting.
3. `aggregateDuOptions` property path and declaration/policy identity: authoritative
   DU limits nesting, top-level-only replace, and the other-family independence
   control for R07. T05/R06/R07 cannot yet be authored against a guessed property.
4. `diagnostics` policy identity and exact unknown-allocation output for
   `du -B1 /payload` on the seven-byte Memory fixture (status1, empty stdout,
   exact stderr). Also bind aggregate-limit, output-budget and invalid-option
   with closed-stdout status/bytes/precedence. No errno-text normalization or
   relaxed diagnostic predicate is approved here.
5. `outputOperationIntegration` identity plus all eight mapping identities named
   in `lifecycle.json`: exact source paths and public observation/activation APIs,
   metadata admission timing, head-zero and first-consumer-read close behavior,
   original-caller validation/required stderr, accounted awaited writes,
   exec/dispose/finally close settlement and isolation. DU has no content reads;
   clarify which downstream first-read cancellation interface is intended.
   Do not invent an operation API, error mapping or lifecycle priority.
6. `freezeCommit`/manifest digest, `supervisorIdentity`, exact `toolIdentities`
   (path/hash/version), `admissionPolicy` identity/mode with new-entry postchecks,
   and explicit `replayAuthorization` identity tied to candidate and freeze.
   Identity objects use `{path, sha256}`; source entries also require Git blob;
   lifecycle entries identify root-approved mapping documents. Source, mapping,
   fixture and tool identities must be authenticated before using them.

## Future replay protocol — not executed or authorized now

1. Validate all bindings and authenticate candidate commit/tree, freeze commit/
   manifest, root policies, checkpoint/inventory, every selected input and every
   supervisor/helper/tool. Check inventory completeness against root inventory,
   not merely that listed files exist. Reject missing exports before import.
2. Use the approved immutable committed archive, with no live overlays; unrelated
   live edits neither enter nor veto it. Strict-live mode, if selected, instead
   retains dirty-input rejection. Record full pre-run tree including names/modes/
   symlinks and hashes. Authenticate tools and dependencies before running scripts.
3. Build, pack, and install the actual tarball into a real isolated consumer.
   Preserve raw commands/status/output and hashes at each phase. Do not use source
   imports or symlink installation. Inspect the tarball manifest and both explicit
   runtime/type export targets. Physically rename the entire consumer; assert old
   location absent, installed package realpath inside new consumer and no workspace
   fallback. Stage TS data only there; never amend root config/type exclusions.
4. An authenticated, separately bound bootstrap uses Node's loader registration
   with `load-proof-hook.mjs` before bare package imports. Bind expected bytes for
   every selected moved consumer/helper and installed ESM module; reject unknown
   paths, non-file/non-builtin modules, CJS, symlink escape or wrong public targets.
   No later source-transforming hook may replace the attested bytes. Record actual
   root and `virtual-bash/commands/du` resolutions and every evaluated module's
   source digest. Supervisor requires both resolutions **and load events for their
   targets**, validates the complete trace and artifacts, and observes child exit.
   Type declarations need separate compiler resolution evidence, not ESM records.
5. Run frozen callable assertions and staged positive/negative compiler controls
   only after admission. Implement blocked cases only after root mapping review;
   additional fixture bytes need a separately authenticated pre-replay supplement.
   Preserve this freeze unchanged and disclose that timing. No silent TODO pass.
6. Run P03–P06/R03 guard controls on isolated copies: missing explicit export,
   source fallback, absent/tampered load proof, pre-run identity mismatch,
   changed/removed/new input, count74/count76/duplicate75/substituted75. Expected
   guard failure is not candidate semantic success. Do not alter the real candidate.
7. Reconcile all29 IDs without omissions; retain raw failures and blocked states.
   Postcheck original paths **and enumerate new entries** in protected archives/
   installed trees. Keep unique evidence output separate from protected inputs.
   Report only this bounded public suite, never full75 success without execution,
   Gate7, superiority, native parity or composite historical acceptance.

## Static verification and integrity

Run only `node tests/integration/du-public-independent-20260827/verify-static.mjs`.
It syntax-checks `.mjs` without evaluation, checks JSON/case/binding/type-fixture
structure and fail-closed admission, rejects loose TS/AGENTS/symlinks/generated
artifacts, and checks manifest SHA-256/byte counts/Git blob IDs. It enumerates all
owned files, so changed, missing and extra entries fail. It never imports a
product module, invokes a compiler/build/package manager/native du, or writes data.
`MANIFEST.json` excludes only itself; its own digest and immutable freeze commit
are returned to root separately. Frozen hashes are not actual-load evidence.

Stop after the owned-only freeze commit and await candidate/clarifications.
