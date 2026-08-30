# Git M1A — author candidate for different review

Date: 2026-08-28. **AUTHOR SCOPED COMPLETION, NOT independent acceptance.**
No default/public registration, native Git oracle, M1B or whole-product gate.

## Source and package binding

- New module source commit: `9885390fb11454fa194a3e60fdbef198dbfdf633`.
- Exact accepted base: `8437e4eda904e1248c25eeef0d9d455b1d251495` coherent78.
- Selected product: base's authenticated268 build inputs plus ONLY the11 new
  `src/commands/git/` files. **Do not archive moving HEAD or the module commit as
  the product candidate**: its parent history contains other workers' later work.
- Full installed/moved package:898 regular files,796986-byte tarball SHA256
  `68541722217fb3f88f7317750c8f1a66042ea090f2c769564b9afc14372dfe68`.
  All858 accepted baseline members are byte/mode identical; only40 emitted Git
  JS/declaration/map members are added. Root README/package/index/plugins unchanged.
- `results-v1/CANDIDATE.json` binds every selected base blob and new module blob,
  their SHA256/length/mode, package additions and evidence hashes. Derived selected
  source manifest SHA256 is `27feea6a92ebf5f3e02429d17c2b9a7e4fbe59ff0f69cf63a82689071b1b63f3`.
  This is an input composition, not a claim of full Git-tree reconstruction.
- `results-v1/PACKAGE.tgz.base64` is the actual full tarball, not a runtime-only
  projection. `RAW.json.gz.base64` retains six attempt receipts, raw logs, case
  results, tool/package inventories and observed loads. Decoded JSON SHA256:
  `fc3619fe400c4ef8be3f7a4d09e8f2452a29516c34201c9ed7f19dfed1b713de`.

## Actual module API

`src/commands/git/index.ts`:

```ts
createGitCommand(options?: GitCommandsOptions): CommandDefinition
createGitCommands(options?: GitCommandsOptions): readonly CommandDefinition[]
gitCommands(options?: GitCommandsOptions): VirtualShellPlugin
```

`GitCommandsOptions` has ONLY `readonly replace?: boolean` and
`readonly discoveryBoundary?: string` (absolute VFS path; default `/`). Unknown
keys/accessors are rejected; all24 ratified numeric caps are fixed, no override.
Direct factories and plugin work without any separately registered host Git.
For this unintegrated package, the tested leaf is
`<installed-package>/dist/commands/git/index.js`. **`virtual-bash/commands/git` and
root Git exports intentionally do not exist.** No dependency/manifest changes.

Profile: real SHA1/zlib loose objects, packed-refs, DIRC2/3, short/porcelain status
with all seven conflict masks, working/cached/tree diff, first-parent log, raw
show, bounded REV resolution and index listing. The exact grammar/config table,
caps and refusal policy are CLOSURE.md and src/commands/git/README.md. Binary raw
show/names/quiet are supported; binary patches and selected-unmerged diff refuse.
ANY packed/idx/promisor storage refuses before success; no pack-readiness claim.

Pure stdout uses createOutputOperation before repository reads. Reader/codec
cleanup is registered before activation, awaited on completion. Caller and
escaping host/sink reasons retain identity (including falsy reasons). Required
diagnostic stderr uses the original caller. No stdin, invoke, mutator, ambient
process.env, subprocess, hooks, filters, network or private-engine route.

## Executed author evidence

Final unique root `git-m1a-author-Dq7gbv`:

| Boundary | Actual result |
| --- | --- |
| Full isolated coherent78+Git production build, pinned TS5.9.3/Node22.22.2 | exit0 |
| Authenticated source loader / compiled / installed / physically moved |140/140 each;560 case executions total |
| Strict installed-leaf TS consumer |exit0 with4negative type directives |
| Actual loaded mutants: SHA verification / pack gate / diff difference status |3 detected, each observed wrongful0 vs required128/128/1 |
| Missing/changed/outside package-member bindings |3 specific loader refusals |
| Observed product module paths |220 unique authenticated files per layout |
| Direct supervised processes |15 closed, no TERM/KILL; expected negative exits1 retained |
| Package/source/tool checks | pre/post inventories equal;858 common base package members exact |
| Native Git oracle workflows |0 executed; all6 remain UNRUN |

Actual literal end-to-end observations include four-row porcelain status;
working `src/app.txt` and cached README/obsolete names; raw `two\n`; two authentic
first-parent commit IDs/subjects; exact staged index listing; actual Shell pipe to
cat. Patch cases independently reconstruct replacement text from emitted hunks,
including BOM/CR/no-final-LF and repeat-line ties. Nine corrupt-zlib/framing forms
refuse with no raw blob publication. Counter-edge tests are injected accounting
controls, not huge-allocation/RSS proof. Memory and ReadOnly wrappers ran; no Real,
S3/WebDAV or real-provider Git workflow was executed.

The source loader uses the authenticated copied TypeScript compiler; compiled
layouts use complete dist-member guards. These prove the observed main-thread ESM
loads, not all dynamic OS library images or arbitrary child descendants. Normal
development compiler/offline npm tooling is trusted; this is not a new OS fence.

## Preserved author failures and repairs

| Attempt suffix | Outcome retained |
| --- | --- |
| Y7xesb |3 new-module TS diagnostics; no product cases reached |
| OkThoJ | corrupt-codec unsettled top-level await/exit13 in source and compiled; no aggregate pass claimed |
| aXLolh |130/130 source+compiled; npm tool symlink admission refused before npm |
| BBy2Bv |130/130 in all4 layouts; harness `%20` filesystem import caused strict-consumer failure; mutants unreached |
| QeOTUt |139/140 source+compiled; author erroneously expected synchronous Shell.use duplicate rejection |
| Dq7gbv |versioned140/140 all4 layouts plus strict types/loaded-mutant/binding controls above |

Codec repair observes close while awaiting write callbacks so corruption cannot
leave a pending writer after stream destruction. TS fixes remove unsupported
typed zlib option and narrow ignore-token discrimination. Other source fixes
preserve staged deletion when an untracked path is recreated, handle file ancestor
obstruction, and avoid repeated tracked-path array scans in untracked walking.
Fixture-v4 corrects only the author registry boundary (actual setup, then awaited
Shell execution); original139/140 remains. No native output expectation changed.

## Different-review priorities / limitations

1. Authenticate source11 against9885390f and base268 against CANDIDATE before
   constructing a review package. Compare baseline858 unchanged members. Do not
   assume `git rev-parse` for a derived composition or import repository-source fallback.
2. `CROSSWALK.md` maps the independent60 families honestly; author case `id` tags
   are rough grouping labels, **not** an exact A01–A60 acceptance denominator.
3. Stress cumulative buffers/work/codec cancellation and long/empty producers;
   no hard RSS, opaque-provider preemption or atomic metadata/ABA guarantee.
4. Check config/attributes, index/tree ordering, abbreviation collisions, Git
   ignore edge grammar, mode/type changes and multi-file patch applicability.
5. Nested repositories encountered by untracked scanning currently explicitly
   refuse (documented), rather than emulate nested-repository summarization.
   This is a conservative additional profile edge for reviewer/root disposition.
6. No independently calibrated native Git hunk/diagnostic/ignore matrix exists
   yet. Six frozen native recipes remain unauthorized/unrun; do not score them as
   native matches from the synthetic standard-object fixtures.

All author children have settled; retained OS scratch roots are evidence, not
active watchers. No private checkout, root export/default/config or foreign stage
was modified. No M1B, public integration or unrelated Git write feature is proposed
as accepted by this packet.
