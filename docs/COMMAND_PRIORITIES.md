# User-priority commands — source audit, 2026-08-28

Repository: `/Users/kjopek/Workspace/safe-bash`; package: `virtual-bash`.
The original source/data audit and later dated status records are distinguished
below. This documentation update performs no new product, native-oracle, compiler,
build, private-engine or gate execution. Product source, exports, dependencies
and historical expectations are unchanged.

## Authoritative request

The following counts and shares are **USER-PROVIDED**, not independently verified
statistics. Shares are transcribed, not recalculated or normalized. The exact
unseparated input is retained in `COMMAND_PRIORITIES.json`.

| Command | User count | User share | Product priority |
| --- | ---: | ---: | --- |
| sed | 332184 | 24.60% | Retained |
| rg | 147000 | 10.89% | Retained |
| git | 117897 | 8.73% | Retained |
| printf | 107073 | 7.93% | Retained |
| npm | 72000 | 5.33% | Excluded by “without the npm stuff” |
| nl | 59262 | 4.39% | Retained |
| cat | 57331 | 4.25% | Retained |
| node | 42460 | 3.15% | Retained, **not excluded with npm** |
| head | 39558 | 2.93% | Retained |
| apply_patch | 34447 | 2.55% | Retained |
| echo | 30812 | 2.28% | Retained |
| find | 26085 | 1.93% | Retained |
| tail | 25540 | 1.89% | Retained |
| ls | 21585 | 1.60% | Retained |
| npx | 20514 | 1.52% | Excluded by “without the npm stuff” |

The earlier exact request **“i also need curl”** remains. No curl count/share was
provided. Excluding npm/npx **product commands** does not authorize removing npm,
Node, TypeScript, `tsx`, development types or isolated oracle tooling. TypeScript,
zero runtime dependencies, no virtual-command host subprocess/eval/native fallback
and explicit host capabilities remain requirements. This table does not supply a
subcommand/flag distribution; recommendations below are engineering judgment.

## Apply-patch public integration candidate

ROOT-qualified module acceptance is now bound to
`753f33d2fa1a2ccd86089c563d4ad66b9a1ae26d`, full882 package
`f04afbf9230fd9e3275f83c7dab26837aeb618bd6178f4ac0b794b93302d6d95`, and
adjudication `c1fc3ee8a010289145959a05e8b088e51f21780a`. L07's original7/9,
two cleanup-count assertion failures, legacy11 failures and21 uncredited
observations remain unchanged. Two separate cleanup owners fulfilled in the
successful L07 cases; this is not a rescore or universal backend/resource proof.

Current root wiring adds `apply_patch` as default79 onto the accepted coherent78
plus arrays composition, with independent public review still required. Root and
`virtual-bash/commands/apply-patch` provide the three factories/plugin and typed
limits; aggregate `applyPatch` forwards limits with top-level replacement authority.
This is bounded literal UTF-8 VFS patching, not a host subprocess or generic native
patch compatibility. Git remains module-only (M1B correction under review); Node
provider/contract remains unqualified. No YQ/XAN/npm/npx commands are added, and
curl remains optional. The original user table and historical audit below are
unchanged. Evidence: `tests/integration/apply-patch-public-20260829/`.

## Historical ROOT-qualified priority workflows and status — 2026-08-28

ROOT accepts scoped evidence `0a942ed29897a1993ab45e0b374c5d9edd829682` and
finalization `4cb1745d381a98f83c030f3e7cad0072179e43ad` on exact selected
composition `8437e4eda904e1248c25eeef0d9d455b1d251495` and full858 package SHA256
`6b5863d51ecd6484b79b7141a2004c04b775f9894d5b80bb016a02ffbefed40e`.
The original 15 source passes plus RUN02's 78 passes complete the finite
31-case × three-layout membership: source31, installed31 and moved31.
RUN02 contributes source16/installed31/moved31, not a fresh same-packet93-call
run. The original P16 STOP, historical77 unrun, four withheld and aggregate
UNKNOWN remain preserved; the later versioned P16 pass does not rescore them.

The cases exercise the ten existing requested defaults, emphasizing sed/rg,
plus explicitly configured mock curl workflows. RUN02's three setup and four
admission children are separate from its78 public calls. All85 children plus
the supervisor and63 product Workers actually retired. The82 loader requests
are not independent loader-exit observations. Charged capture6124037 and retained
scratch200067167 bytes are logical accounting, not RSS or global OS guarantees.

RUN02 is CLOSED TO FUTURE CONSUMPTION: retain0 children,249 Worker starts,
0 loader roles,350391803 capture bytes and336803745 scratch bytes; no release or
reuse. RUN01 remains closed with its original balances/UNKNOWN unchanged. See
the [exact ROOT acceptance and closure record](../tests/integration/priority-command-workflows-20260828/npm-pin-rebinding-v2/p16-trace-repair-v4/actual-run02-v1/ROOT-ACCEPTANCE-AND-CLOSURE.md)
for both balance tables, immutable bindings and remaining observation limits.

Current status, as supplied by ROOT: Git M1A module
`9885390fb11454fa194a3e60fdbef198dbfdf633` has qualified acceptance but is not
public/default-integrated. Git M1B `fca6f81d2d96db2bbceabf3247cd57ffe240bde6`
and ROOT-reported apply_patch candidate `753` await independent review; the
Node scaffold/provider remain pending. Candidate `753` is ROOT's supplied label,
not a newly authenticated full commit identifier. These statuses supersede the
older checkpoint below without rewriting its observations. No arrays, Git,
apply_patch, Node, YQ or XAN support is added by this workflow proof. The existing
78-default, TypeScript, zero-runtime-dependency and opt-in-curl status is unchanged;
no fresh type gate, overall just-bash victory or global-release claim follows.

## Historical module-candidate checkpoint — 2026-08-28

This docs-only update supersedes the original audit's implementation-absence
statements, not its historical observations or user-provided statistics.
The accepted aggregate remains78; no root/default integration occurred here.

| Priority | Current qualification | Evidence / implementation location |
| --- | --- | --- |
| git | M1A module candidate9885390f under Dirac independent review; NOT accepted/default/public-wired. Genuine loose-object/index reader; any packed storage still refuses. | `src/commands/git/index.ts:19`; `tests/commands/git-author-20260828/HANDOFF.md:1`. Author full898-member pack SHA25668541722217fb3f88f7317750c8f1a66042ea090f2c769564b9afc14372dfe68; no fresh execution in this update. |
| apply_patch | ROOT-reported module candidate58be882 under independent review; NOT accepted/default/public-wired. This identifier is recorded as supplied, not a new stored-commit/package authentication. | `src/commands/apply-patch/index.ts:7` defines createApplyPatchCommand; factories/plugin at13/17. Distinct from diff/patch and the agent's native editing tool. |
| node | CommonJS contract/provider remain unqualified; no accepted product Node runtime/default integration. | SafeJS and development Node remain separate capabilities, not Node compatibility evidence. |
| Git M1B | Design/data63d811bf under Sagan independent review; NO implementation GO or packed-readiness acceptance. | `tests/commands/git-pack-design-20260828/HANDOFF.md:1`; bounded pack/index/delta DATA and pending D1–D3 decisions, no product/native executions. |

Curl remains explicit opt-in. The ARRAY acceptance recorded in PROJECT_LEDGER
is on selected DOTGLOB77, not coherent78-plus-arrays or a current HEAD gate.

## Original registration snapshot: 10 defaults, 3 missing, curl opt-in

The following table and source-line references preserve the original
HEAD00bb4765459176dafc4b5c77fc97d2630c46a689 audit, before these module candidates.

“Default” means installed by `.use(agentCommands())`, **not** that every name is
a shell builtin or automatically present in a bare `Shell`. Registry composition
is `src/plugins/index.ts:61`; installation is `src/plugins/index.ts:97`.
Core factories are `src/commands/index.ts:19` and `src/commands/index.ts:31`.

| Requested name | Status | Implementation entry / actual API |
| --- | --- | --- |
| sed | Default | `src/commands/text-programs/sed.ts:347`; `createTextProgramCommands` / `textProgramCommands` at `src/commands/text-programs/index.ts:8` |
| rg | Default | `src/commands/search/rg.ts:120`; `createSearchCommands` / `searchCommands` at `src/commands/search/index.ts:7` |
| git | **Missing** | No bundled registry command, builtin or product factory found. Host Git and repository evidence tooling are not a product implementation. |
| printf | Default | `src/commands/basic.ts:52`, through `standardCommands` / `agentCommands` |
| nl | Default | `src/commands/stream-format/nl.ts:29`; `createStreamFormatCommands` / `streamFormatCommands` at `src/commands/stream-format/index.ts:9` |
| cat | Default | `src/commands/streams.ts:191`, through core/aggregate |
| node | **Missing** | No product Node command/factory. `src/commands/safejs/index.ts:31` exports **`createSafeJsCommands`**, not a Node runtime. |
| head | Default | `src/commands/streams.ts:110`, registered at `src/commands/streams.ts:243` |
| apply_patch | **Missing** | `src/commands/diff-patch/index.ts:8` installs **diff/patch**, not an apply_patch marker-protocol command. The agent's editing tool is not product dispatch. |
| echo | Default | `src/commands/basic.ts:8`, through core/aggregate |
| find | Default | `src/commands/find.ts:25`, through core/aggregate |
| tail | Default | `src/commands/streams.ts:110`, registered at `src/commands/streams.ts:243` |
| ls | Default | `src/commands/filesystem.ts:309`, through core/aggregate |
| curl | **Opt-in** | `src/commands/network/curl.ts:73`; `networkCommands` / `curlCommands`, `createNetworkCommands` / `createCurlCommands`, `createCurlCommand` at `src/commands/network/index.ts:9` |

Public imports use `virtual-bash` or the existing `virtual-bash/commands/...`
family subpaths. There is no invented `virtual-bash/commands/git`, `/node` or
`/apply_patch` implementation. The root barrel is `src/index.ts:1`; metadata is
`package.json:1`. Runtime/optional/peer dependencies are absent. The existing
development dependencies are `@types/node`, `tsx` and TypeScript; Node >=22 is
the package engine requirement, not proof of a virtual Node command.

## Implemented workflows and bounded gaps

These are source-supported subsets, **not fresh passing test results**. Unsupported
options are not credited as passes. Existing utility/dialect limitations remain.

| Command | Useful implemented subset | Concrete gaps / qualifications |
| --- | --- | --- |
| sed | `-n`, ordered repeated `-e`/`-f` VFS programs, `-E`/`-r`, `-s`, `-i[SUFFIX]`; numeric/$/regex/range/negated addresses, substitutions/captures, hold space, branches, multiline commands, translation and VFS `r`/`w` | Byte/C regex profile, finite steps/buffers; no full Unicode/locale/BRE equivalence, `-z`, broad GNU long options or shell-executing substitutions. In-place output is buffered per file, rejects nonregular/symlink operands and is not a multi-file transaction. Two GNU4.9/BSD choices are explicit, not universal dialect parity. |
| rg | Repeated `-e`/`-f`, fixed/insensitive/smart/word/line/invert search; numbers/columns/offsets/only-matches, counts/list/quiet, context, globs/ignore files, hidden/depth/follow controls, JSON/NUL records; explicit empty-stdin provenance | JS Unicode regex semantics, not Rust regex or PCRE2. No multiline/replacement/compressed search, type database (`-t`/`-T`) or alternative encodings. Content and current glob requests use bounded worker protocol; that is not universal regex/CPU/RSS safety or native dialect parity. |
| printf | Format reuse; `%s`, `%b`, `%q`, `%c`, integer bases and floating forms; flags, numeric width/precision, `%%`, byte escapes, binary pipeline output | No dynamic `*` width/precision, `-v`, `%a`, `%n` or Bash date formatting. JS numeric conversions and quoting are a subset, not full overflow/locale/format compatibility; finite formatting bounds apply. |
| nl | Header/body/footer styles `a/t/n/pBRE`, `-v/-i/-l/-w/-s/-n/-d/-p` and long names; page sections, resets, signed numbering, multiple VFS inputs and stdin | C-byte bounded BRE, finite per-record/work/output budgets; no general locale/multibyte equivalence. Native/frozen author fixtures exist, but this audit does not establish a separate exhaustive independent nl acceptance. |
| cat | VFS operands and `-`/stdin, byte concatenation, `-n/-b/-s/-v/-E/-T/-A/-u/-t/-e`, missing-final-newline handling | Borrowed-byte ownership and bounded output matter. Explicit owned-output enrollment currently applies to file-only operands, not all opaque stdin. Do not promise arbitrary producer preemption or constant memory for every transformed record. |
| head | `-n`/`-c`, legacy count spelling, quiet/verbose headers, multiple files, negative “all but last” counts and zero-output case | Exclusion requires bounded suffix state; no promise of every GNU count suffix. `head -n0` is not proof that arbitrary unenrolled/opaque upstream work is forcibly terminated. |
| echo | Combined `-n/-e/-E`, literal arguments, escapes/newline control | Shell dialects disagree on option-looking operands and escape behavior. Argument strings are assembled before output; not a general binary-input transform or full POSIX/GNU/Bash portability claim. |
| find | `-P/-L`, roots/depth controls, name/path/type/size/empty predicates, boolean groups, prune/print/print0, literal `-exec ... ;` / batched `+` via invocation | No `-delete`, `-execdir`, ownership/permission/time predicates or full GNU grammar. Traversal and provider capabilities are bounded. Name/path matching still builds host RegExp (`src/commands/find.ts:7`); no worker-isolation guarantee is inferred from rg's separate implementation. |
| tail | `-n`/`-c`, `+N`, quiet/verbose file headers, finite suffix buffering and bytes without final LF | No `-f`/`-F` live following or complete count-suffix syntax; bounded suffix state is not arbitrary-size constant-memory parity. |
| ls | `-a/-A/-l/-1/-d/-F/-p/-r/-R/-L`, hidden entries, symlinks, recursion, literal VFS paths | No `-h`, `-t`, `-S`, color or terminal-column layout. Long output uses numeric metadata/UTC rendering and fallback uid/gid0/nlink1 if absent, not host ownership lookup or verified remote metadata. Thus common `ls -lh` is a real gap. |
| curl | HTTP(S), methods/headers/auth, `-d`/raw/binary/JSON, stdin and `@VFS` uploads, `-G`/encoding, headers/head, VFS `-o/-O/-D`, status policies, redirects, writeout, bounded retries/timeouts and multipart | Requires explicit registration/authorizer; no proxy/netrc/config, TLS bypass, connect-only timeout, HTTP2/3, resumable/range/cookie-jar or non-HTTP parity. Credential stripping is deliberately stricter than native. URL policy is not DNS/socket confinement; closure is operation-scoped/cooperative, not arbitrary host preemption. |

Detailed source profiles: `src/commands/text-programs/README.md:48`,
`src/commands/search/README.md:192`, `src/commands/network/README.md:1`.
One stale source-document statement needs a future owner correction: the search
README's host-glob limitation does not describe current `src/commands/search/glob.ts:12`,
which calls `RegexSession.run` with `kind: "glob"`. This audit reads the current
source rather than repeating that historical limitation; it does not certify all
regex paths or edit another owner's module documentation.

### Curl and Node are distinct capabilities

The runnable TypeScript mock-transport/explicit-authorizer example remains in
README's **Optional curl** section. Root and `virtual-bash/commands/network`
exports are real; `NetworkCommandsOptions` is `src/commands/network/types.ts:46`.
`authorize` is required; an injected `HttpTransport` can avoid actual networking,
or omission selects the bundled Node transport. Each hop is authorized and bytes
flow through VFS/streams. This audit did not execute that example again.

SafeJS instead requires explicitly injected `run`, budget, FS-module and host-call
hooks. Missing runtime returns a diagnostic/status127; it does not fall back to
Node. Its evaluated language, modules and bridges do not establish `node -e`,
CommonJS/ESM loading, Node builtins, npm packages, `process`, or host filesystem/
network compatibility. **Product node stays requested and unimplemented.**

## Evidence binding and independent acceptance limits

Audit observed live HEAD `00bb4765459176dafc4b5c77fc97d2630c46a689`; the selected
hashes are in `COMMAND_PRIORITIES.json`. No foreign artifact contents were read,
staged or removed for this audit. The selected entrypoints/registration
files are not a complete dependency closure.

The ROOT-accepted coherent78 composition is
`8437e4eda904e1248c25eeef0d9d455b1d251495`, independent evidence `633f6c82`:
`tests/integration/coherent78-shell-independent-20260828/REPORT.md:1`.
Its full858-file package SHA256 is
`6b5863d51ecd6484b79b7141a2004c04b775f9894d5b80bb016a02ffbefed40e`;
installed manifest SHA256 is
`484c1dd76c63f126376cff810b445c8185e791825ec83fd94e996691b2b1eb5d`.
The composition object is not stored in this repository's object database; its
authenticated reconstruction is retained in evidence, not substituted with HEAD.

This audit authenticated the encoded `RAW-v2.json.gz.base64` against EVIDENCE.json,
read its268-input source table and compared14 selected current source/registration
files: **14 match**. **Current `src/shell/runtime.ts` differs.** No new reconstruction,
build, package installation, flag replay or whole-runtime acceptance follows from
those metadata comparisons. Independent coherent78 tests established exact78
registration and selected composition workflows, not all options of these tools.

| Scope | Existing evidence | What it does not establish |
| --- | --- | --- |
| sed/text programs | `tests/commands/text-programs-stress/README.md:165`: selected GNU4.9 acceptance beside unchanged BSD disagreements and earlier failure history | Every sed expression/flag, live GNU execution in this audit, or universal POSIX/GNU/BSD parity |
| rg | `tests/commands/search-stress/README.md:1`; `tests/commands/search-stress/direct-stdin-close-review/CANDIDATE.md:1`: independent18-case closure review of c27249c8 beside original13/18 | All regex/ignore/native features or a current broad gate |
| head/tail and retained bytes | `tests/stress/byte-ownership-20260827/independent/candidate-review/FINAL_REPORT.md:1`: separate30 correctness and53 allocation/retention controls on7d7dce7c | Every core flag, absolute RSS or universal cancellation |
| printf/echo/find/ls/core composition | `tests/commands/independent-arguments.test.ts:1`, `tests/commands/independent-filesystem.test.ts:1`, `tests/commands/pipelines.test.ts:1` and coherent78 public acceptance | A fresh passing run, per-command exhaustive independent parity, or arbitrary remote-provider behavior |
| nl | `tests/commands/stream-format/nl.test.ts:1` frozen/native and bounded-work cases; coherent78 registry evidence | A separately located exhaustive independent nl suite or fresh native availability |
| curl | `tests/commands/network-stress/README.md:3`, linked handoff/retry/lifecycle reports and PROJECT_LEDGER scoped214 plus built5 checkpoint; subsequent byte/retry/zero-host-cap fixes have separate proofs | Original57/60 rescored, all curl flags, arbitrary services, DNS confinement or all host cleanup |
| git/node/apply_patch | No product dispatch implementation found in command factories, root aggregation or shell builtin dispatch | Development Git/Node/apply_patch usage is not a product test or compatibility substitute |

The old R3 fixed76 result **19425 passes /132 failures /7 skips,6/14 phases,
integrity/cleanup false** remains unchanged. This audit neither deducts failures
nor certifies current HEAD. No new just-bash release/version/comparison claim.

## Original next-work recommendations — historical audit

These were recommendations at the original snapshot. The later checkpoint above
records subsequent module/design scopes; it does not authorize further implementation.

1. **Highest-frequency absent command: genuine read-only VFS `git`.** Start with
   a declared repository-reader profile: `rev-parse --show-toplevel/--git-dir/
   --is-inside-work-tree` and `ls-files [-z]` backed by actual repository/index
   data, not canned output. A bounded first author scope is
   `src/commands/git/**` and `tests/commands/git/**`; root registration stays
   separate until different-agent review. Parse/validate real index/object/ref
   formats, bytes, checksums and limits; explicitly reject unsupported formats,
   extensions or external gitdir bindings. Do not report an unsupported repository
   as clean/empty. `status --porcelain=v1 -z` and working-tree/index `diff` are
   high-value follow-ups only with the necessary index/object support, including
   an honest packed-object decision. No native Git, hooks, config execution,
   credential helper, shell, remote network or implicit host filesystem. Existing
   VFS read/stat/readdir/realpath/identity and command byte/signal/budget APIs are
   prerequisites; development Git may later be an explicitly admitted oracle,
   never the implementation. No full Git/write/clone/submodule parity is promised.
2. **Highest-frequency existing tools: focused sed/rg workflow audit and gaps.**
   Separately freeze realistic address/backreference/in-place/byte fixtures for
   sed and empty-pipe/ignore/JSON/type-filter workflows for rg. Consider sed `-z`
   and selected long flags, and rg type filters, only under an explicit dialect
   and bounded algorithm design. Do not replace existing hard failures with
   easier recipes or claim these are measured subcommand frequencies.
3. **Small next missing editing surface: VFS `apply_patch`.** Define its actual
   add/update/delete/move marker grammar, exact context matching, newline/byte
   policy, traversal/alias refusal and failure publication contract before writing
   `src/commands/apply-patch/**`. Reuse FS contracts, not a call to host patch or an
   alias that pretends existing `patch` accepts this different protocol. Multi-file
   atomicity cannot be assumed across every backend.
4. **Keep Node explicit, with a separate compatibility decision.** A constrained
   guest script interpreter could be useful, but is not full Node. Specify intended
   `node -e`/script/module APIs and trusted capabilities before choosing an execution
   design consistent with no eval/native fallback and zero runtime dependencies.
   Do not rename `safejs` to `node` or silently drop this user priority.

These are bounded recommendations, not an approved implementation, fresh benchmark
or assertion that a small subset fulfills the requested product or superiority goal.
