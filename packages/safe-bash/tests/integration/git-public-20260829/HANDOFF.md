# Git80 public author handoff — independent acceptance pending

## Exact candidate and package

- Derived selected source tree: **c83f352f057c64917f219eb938f54aa42cdab829**.
- Base: accepted public79 **7fde32264d757ef856acf3ae92c8581b4a294341**,
  bounded acceptance **bd772916c26dc87c54bafdaa784d18f058efa275**. Its original
  author27/28×3,82/83 and reviewer79/83 worker-denied qualifications stay historical.
- Add only accepted Git14 files at **fca6f81d2d96db2bbceabf3247cd57ffe240bde6**,
  consolidation **db8b818db983f32c9522ebe4c9589ca8766a5454**; all14 unchanged.
- Root integration: **319c0ae2f5e3decb3fced2280c6db004d0e7eb9b**;
  selected README/priority acceptance update: **68a5a55bbf227c7d4895a4588510a319d4f2c4d8**.
- Maintained fixture migration: **75527b5949326d4c82cc027881e772345c4d6a51**,
  prospectively enumerated **8885617a192ed80c935e5d1f248e100faa3241a6**.
- Preseal recipe **fed8df602ab0aef49c70915f8853b41c65efc0d8**;
  execution binding **f23aecb8b10a92c99808038a8a4cd04238e99fc5**.
- SOURCE.json SHA256 **14a2a6a50d7748b677c4cc1261d6f69a411c1c21926c7acd884c86f2077e9450**;
  EXECUTOR.json SHA256 **6ba1f4faedbd70e76d563147bfe4e1685e71e567b7f0a4f401cb73d0fbb791a5**.
- Actual full **950-member**, **864000-byte** package SHA256:
  **4671ed60875c87f8cc32b735fde5d9b57301f427ecd5a376ad1123afb951e156**.
  Complete tar: results-v1/PACKAGE.tgz.base64. Not a declaration/runtime projection.

There are292 selected build inputs:278 from public79 plus14 Git files. Only
README.md/package.json/src/index.ts/src/plugins/index.ts replace prior build
inputs. The computed tree additionally binds five maintained fixture files and
docs/COMMAND_PRIORITIES.md. SOURCE includes82 authenticated canonical tree
witnesses; a derived tree need not be a stored Git object. Reconstruct exact
inputs from declared Git blobs, not rawHEAD or a sparse directory screenshot.
No arrays/runtime/apply753 implementation edits, package-lock changes, new deps,
YQ/XAN/Node/declare/mapfile additions or AGENTS plaintext materialization.

Compared with the authentic898-member public79 package643939eb, the whole tar
adds52 emitted Git files, changes10 root/plugin JS/declaration/map/package/README
members, retains888 common members byte/mode-identically and removes none.

## Public API and option routing

`virtual-bash` and explicit `virtual-bash/commands/git` expose:

```ts
createGitCommand(options?: GitCommandsOptions): CommandDefinition;
createGitCommands(options?: GitCommandsOptions): readonly CommandDefinition[];
gitCommands(options?: GitCommandsOptions): VirtualShellPlugin;
interface GitCommandsOptions {
  readonly replace?: boolean;
  readonly discoveryBoundary?: string;
}
```

- src/index.ts:30 exports the leaf; package.json:89 maps types/import to
  dist/commands/git/index.d.ts and dist/commands/git/index.js.
- src/plugins/index.ts:30 adds `git?: Omit<GitCommandsOptions, "replace">`.
  At99 definitions use `{ ...options.git, replace: false }`; host registration
  keeps the existing top-level replacement authority even for untyped nested
  replacement. Unknown options are still rejected by the leaf settings function.
- Literal independent names.mjs declares80 defaults; Git is appended after
  apply_patch in registration order. Curl/SafeJS remain opt-in, getopts is a
  builtin, and Node/npm/npx/YQ/XAN are absent. No numeric Git limit overrides;
  all24 limits and eager verification policy remain unchanged.

## One consumed author attempt

Command, executed once after committed bindings:

```sh
/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node tests/integration/git-public-20260829/run.mjs --run
```

Retained root:
`/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/git-public-author-DtcKNJ`.
One selected production build, offline scripts-disabled pack/install and physical
move. No native Git/oracle, private engine or external network execution.

| Actual cohort | Source-build | Installed | Moved |
| --- | ---: | ---: | ---: |
| New public Git/default80 |45/45|45/45|45/45|
| Versioned apply composition |28/28|28/28|28/28|
| M1A composition regression |139/140|139/140|139/140|
| Pack author cases |93/93|93/93|93/93|
| Unchanged arrays |12/12|12/12|12/12|
| Selected coherence C02–C18 +R15 |18/18|18/18|18/18|
| Strict positive types |pass|pass|pass|
| Removed-directive negative diagnostics |6 exact|6 exact|6 exact|

These are separate cohorts, not a whole-suite score. Each of the six type groups
authenticates90 candidate declarations;18 actual negative diagnostics total.
Expected codes: five TS2353 unknown-property errors and one TS2322 pathname type
error per negative group. Root/subpath imports resolve the actual package.

All four maintained TS fixture bodies: **83/83**,0skip/0cancel, exit0, with exact
source-import-only routing to the selected package. Moved stream consumer:
**21/21**. This new qualified RegexWorker profile does not rescore the baseline79
reviewer's worker-denied four rows. The two historical module runners each have
one explicit after-aggregate replace:true setup migration; m1a adds a30s watchdog.
Their old files are unchanged. FIXTURE-VERSIONS.json records exact deltas.

Six controls succeeded: one actually loaded aggregate Git omission mutant killed
by G02, exact artifact restore passes G02, three missing/changed/outside package
binding refusals and missing explicit Git subpath refusal. These are one mutant,
one positive restore and four binding controls, not six new product positives.
Mutant plugin JS SHA256040106b2721e1a9923dcde7acb8be7038b65e131579ed1100878ed723f16e6fa;
restored candidate9fbfa4fccc41a368771436c51ab76c98c2c00cfcf24909bb5eefc85ff272a230.
Normal runtime batches each authenticated233 unique main-thread product modules.

## Three retained failures and unexecuted fixture candidate

Terminal status is **AUTHOR_ASSERTION_FAILURES**, not all-pass acceptance.
Exact failures: source-m1a/PUBLIC-NEGATIVE, installed-m1a/PUBLIC-NEGATIVE,
moved-m1a/PUBLIC-NEGATIVE. Each module-only row expected root gitCommands absent
and observed present; its later absent-subpath assertion was unreached. This is
an obsolete boundary expectation under the new authorized public wiring, not a
demonstrated parser/query/pack defect. No product change was made to quiet it.

Fixture-only proposal **2764c0541ebe1a517965bdc73f33b1651cb15935** adds
m1a-public-v2.mjs: one row now expects the public export and exact subpath;
dependencies assertions and other139 rows unchanged. Its SHA256 is
**7b73d2e7df70a314fabfcea137ee1e25fec7e6dbca38f9f3981df19bf2f12962**.
AUDIT.json authenticates exact single-row replacement. **Zero reruns/rebuilds**
after this proposal; c83f source/package4671 remain unchanged. Different review
must approve and run it; do not relabel139/140 as140/140 or reuse old EXECUTOR
as if it covered the new fixture. Suggested independent weakening controls are
in FIXTURE-v2.md. Original raw capture commit693dfc79d4d67f76c7334f3c420e78babfeb646a.

## Resource and evidence scope

Actual39.556s;37 serial direct children closed,0 OS signals;4 product RegexWorker
construction/exit pairs, all library-retired with exit1 and live0;26 conservative
implicit loader-worker reservations. Total budget accounting67<=80, observed
product-worker peak1, no author rescue. This is not a kernel/native-allocation
census or a worker-internal import trace. Each admitted worker entry hash was
46479e6d87bd5d20371a2e523310b2275c74d32d15105fcc9678ec73410efe4f, original
execArgv:[]; unrelated workers were not permitted. Caller/Shell scopes were
disposed by case owners. No universal resource/lifecycle claim follows.

Captured child bytes3,083,451; actual scratch71,345,567. All source/dist/installed/
moved package checks passed before terminal capture, including added-entry
detection. RAW encoded SHA256
**7d7c98511f17525a756d09ef0eb1ed487d3cd095ecb3062ed3d43097831c348d**.
175 top-level descriptors:173 embedded payloads including20 empty ones, fulltar
separate, original development source-blob stdout retained/bound rather than
duplicated. No retained-root deletion or mutation. AUDIT is DATA-only, not a
second product run.

## Independent review and limits

ROOT-qualified M1B274 identities are208 stock/32 mechanical/10 types/24 loaded;
18 S01 mechanics and three reversion roles are separate. S02/H09/private-writer
SOURCE gaps, native6 UNRUN, nonexhaustive format/resource variant maps, original
bare-OID/deadline/observer failures and practical eager caps remain. No claim of
full Git/GNU/provider/readiness/RSS/opaque-preemption parity. All old apply L07,
legacy11/21 and arrays qualifications remain. Global HEAD/gate was not tested.

For the different public reviewer: authenticate SOURCE/EXECUTOR/fulltar, exact80
names and all unchanged module files; test option/collision/exports/declaration
routes, actual loose/pack/delta queries and existing crossfeatures. Review the
one-row fixture-v2 separately. Public integration acceptance remains pending.
