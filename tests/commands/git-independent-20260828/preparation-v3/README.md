# Independent Git preparation v3 — 2026-08-28

**PREPARED / HOLD. Not a candidate acceptance packet or execution GO.**
Owned scope: only this new directory. Prepared after immutable proposal/review/
ratification, before inspecting any candidate implementation. Author work may
continue independently. No new Git implementation, M1B implementation, current
root API, live dist, package configuration, private engine or gate was inspected.
Development Git metadata and owned commits are not native oracle permission.

## Immutable inputs and exact scope

- Author: `589d1d93e2cd87296949ff32d8bf4d9bbef6cbcc`; author BINDING SHA256
  `b046c0dd2765eb86d7fc9ec1b77092d61a2f987568138465bb77bbf0790f1aff`.
- Original matrix: `12e943bd3664a2f8286fc3063542877ae7f56a8e`, 60 M1A + 12 M1B;
  ratification `70ba55eaaa705307eec5b985fc3d8963f6764159`. Neither is edited/rescored.
- Neutral fixture raw JSON SHA256
  `fcb7bae1505a86b2b676396742d7bf362ad779c77192770ed94085646f8d0074`.
  `records.json` retains exact inert bytes, source Git references, lengths/hashes,
  all 18 file records and inferred directory modes. No AGENTS files were copied.
- Eleven compressed loose objects, two commits, index v2 with two entries/184
  bytes; index SHA256
  `ba0d03f2d774c396f9c15502384c0ee1fdbe15069120a12a08e0a463d3cbf872`.
- Sorted relative path/type/mode/length/content-SHA256 tree JSON SHA256
  `bfad76409733d39efafe57e0a9f955f22c45531446146a54413b4478d58d602e`.
  This is a computed data identity, not a claim of a stored Git tree object.

## Exactly six future native observations

All six are **UNRUN**. `records.json.workflows` is the machine-readable byte
authority. Each has empty stdin, status **0**, stderr **zero bytes**, and exact
unchanged fixture namespace, modes, index, objects, refs and working-file bytes.
Original semantic argv below excludes the separately declared security wrapper.
Future physical cwd is `<exclusive-root>/repo`; product VFS cwd is `/repo`.

| ID | Exact original argv | Exact stdout (escaped) | What it observes |
| --- | --- | --- | --- |
| A01 | `["status","--porcelain=v1","--no-renames","-uall"]` | `M  README.md\nD  obsolete.txt\n M src/app.txt\n?? notes.txt\n` | staged modification/deletion, unstaged modification, untracked path; no hidden index refresh |
| A02 | `["diff","--name-only"]` | `src/app.txt\n` | working file versus staged blob; staged-only paths absent |
| A03 | `["diff","--cached","--name-only"]` | `README.md\nobsolete.txt\n` | index versus HEAD; unstaged-only path absent |
| A04 | `["show","HEAD:src/app.txt"]` | `two\n` | exact HEAD blob bytes, not `working\n` or earlier `base\n` |
| A05 | `["log","--first-parent","--format=%H %s","-n","2"]` | `1cec77171d8321d533b3aa50b7a1a9df02b10816 Second\ndde68226091aa6adddca45e02370c5127430e55a Initial\n` | exact commit IDs, subjects, first-parent order, LF framing |
| A06 | `["ls-files","-z"]` | `README.md\0src/app.txt\0` | actual staged paths and exact NUL delimiters, no obsolete/untracked path |

These are inherited PROJECT-profile predictions, not outputs learned from the
implementation or captured native behavior. Any later oracle disagreement must
retain these original predictions and append a separate correction/qualification.
There is no seventh workflow, including no version-probe workflow in this runner.
Native version and fresh identity evidence must arrive through separate ROOT GO.

## Executable preparation surfaces

| Surface | Concrete action | Dependency readiness |
| --- | --- | --- |
| `module-adapter.mjs:runCandidate` | Authorize exact archive/package/source/emitted bytes; enumerate VM dependencies against declared relative import edges before linking/evaluation; run A01–A06 in independent read-only VFS | Candidate commit, emitted JS/build provenance, API, Node, closure and fresh candidate GO missing |
| `package-adapter.mjs:preparePackageConsumer` | Independently check virtual-bash ESM manifest/direct import export target; emit a hash-bound real Node consumer checking `import.meta.resolve` before candidate import and exercising six workflows | Installed package files/export key, exact root/resolver URL/helper closure and consumer source hash missing; no pack/install now |
| same, moved route | Require different root, same entry hash, inaccessible old root and separately bound resolution; emit same six-observation consumer | Moved archive/census/fence proof missing; not a live-dist alias |
| `type-adapter.mjs:prepareType` | Bind inert `.ts.txt` consumer, declarations and exact strict NodeNext/noEmit compiler argv; reject missing authorization before producing a recipe | Exact compiler/Node/types closures and candidate declarations missing; no compiler/build now |
| `native-adapter.mjs:runNative` | After separate native authorization and qualified H11 bridge revalidation, allocate six exclusive roots, stage neutral regular files, execute exact recipes, compare captures/full tree and stop on first failure | New network/read/exec fence, role/collector qualification, tools/version and native GO missing |
| `synthetic.mjs` | Two data/mock positives and eighteen finite negative binding/observation controls; no candidate VM evaluation or native bridge dispatch | Opt-in only, after PRESEAL; receipt separate from real workflow denominators |

The module harness is a direct CommandContext host, not Shell/registry acceptance.
Its mock family/plugin shape checks do not prove collision/replacement integration.
Installed/moved consumer preparation is not installed-package execution. The type
file is inert data outside loose TypeScript discovery; no exclusions/config edits.
Source-emitted admission binds original source and its separately authenticated
compiler result; it does not compile, infer source equivalence or certify a build.

## Finite original-ID mapping, no new 72-case framework

- A01–A06: exact actions/table above; independently runnable per source, installed,
  moved and native route only when that route's prerequisites and GO arrive.
- A58 (partial future obligation): the six direct-host runs use a concrete memory
  VFS implementing contracted byte reads/stat/lstat/readdir/access/realpath/streams.
  Real/S3/WebDAV and wrapper/alias permutations remain UNPREPARED/UNRUN.
- A60 (partial future obligation): traps reject all mutation methods, stdin reads
  and nested invocation; snapshots compare bytes/modes and appended entries.
  This is not ambient-host security, partial-output, shared-budget or whole-A60 proof.
- A52 (type-only partial preparation): consumer has a limits-override rejection,
  native-spawn-option rejection and wrong-boundary-type rejection. No numeric
  boundary execution or complete A52 credit follows from this artifact.
- A07–A57 other obligations, A59 and all B01–B12 remain unchanged, UNRUN and not
  implemented by this bounded preparation. No M1B source was read or authored.

## Candidate admission contract

No valid candidate/GO example is supplied. Synthetic packet values exist only in
memory with INERT labels and an injected non-importing loader. They confer no
authority. A trusted ROOT caller must independently authenticate and consume the
fresh GO; possession of a JavaScript object or a matching checksum is not authority.

Supply exact packet **raw bytes** plus its SHA256, this PRESEAL SHA256, fresh
authorization/run record, candidate commit and immutable archive SHA256. Include
`kind`, exact runtime API (`createGitCommand`, `createGitCommands`, `gitCommands`),
module entry, all regular source/package/emitted files with mode/length/SHA256,
exact full entry census, static relative import edges and finite builtin list,
Node and compiler absolute paths/hash/version, source-to-output build receipt and
argv, finite tool-role closure hash, package specifier and resolution receipt.
Include exact `/repo`/empty-env/empty-default-stdin context. No process.env spread.
Installed/moved/type routes require their additional fields in the respective
adapter. Complex package condition maps are HOLD pending a separately reviewed
finite resolution binding, not approximated Node resolution.

No source emit, build, pack, resolver lookup, candidate import or helper execution
may precede that external admission. Inputs are authenticated bytes, never a live
checkout fallback. VM linking rejects undeclared edges and dynamic imports; it
does not sandbox hostile JS or bound all asynchronous work. Its finite builtin
allowlist deliberately excludes fs/child_process/module. A future public Node
consumer must run only inside an independently qualified read/exec/network fence
over its authenticated installation and helper closure; parent admission must be
repeated immediately before dispatch and audited after, including new entries.

## Seal and permitted checks

`capture-metadata.mjs` was used only for fixed immutable `git show` reads and
inert data serialization through apply_patch. It is not a runtime/oracle helper.
All preparation source, data and recipes are sealed before syntax/synthetic work.
`seal.mjs` emits an apply_patch addition for PRESEAL; it does not run assertions,
Git, a compiler or product. It refuses overwriting an existing seal.

The allowed validation is nine individual `node --check <owned-new-file.mjs>`
invocations and one `node <owned>/synthetic.mjs`, with separate captured status/
stdout/stderr. All attempts, including failures, must remain beside this seal;
never overwrite or retry away a failure. Runtime results are appended later and
are not members of the self-referential pre-execution seal. No canonical test,
build, pack, product module, native Git/version, H11 child or current gate runs.

An initial shell metadata command could not resolve `cat`; `/bin/cat` then read
the applicable instructions. This was not a review harness or oracle execution.
The development index/status was inspected; concurrent foreign untracked paths
were not opened or changed. Owned commits use explicit paths and hooks disabled.
