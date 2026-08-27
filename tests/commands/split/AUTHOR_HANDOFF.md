# Split author handoff — August 27, 2026

## Scope and freeze

Only `src/commands/split/**` and `tests/commands/split/**` were edited/committed.
Root approved the separate module through the requested ready gate before source
writes. No delegates, default registry/root/package exports, FS source, contracts,
shared helpers, existing stream inspection tools, grep/regex, root README or ledger
were edited. Other workers' changes/staging/native artifacts were preserved.

Tool commit: `7a4ee0c`.
Separate regression causes: `466264a` (GNU size spelling), `bbfbeed`
(empty-input output-directory preflight), `1836795` (late output-source pulls after
cancellation). The complete source freeze commit is
`1836795aed012ad734fedbd0ed56c2c98ab57f56`; later author changes are tests/evidence
only. The final manifest records the exact six TypeScript source hashes and their
aggregate digest, plus observed dependency hashes in a concurrently dirty shared
tree. It is not a frozen full-repository replay claim.

## API and limits

Source module `index.ts` exports `createSplitCommands(options?)`,
`splitCommands(options?)`, `SplitCommandsOptions`, and `SplitLimits`.
Options: `replace?` and `limits?: Partial<SplitLimits>`. A one-command factory
list follows existing family conventions. Actual default aggregate stays 60,
without split; explicit opt-in adds one to that Shell only. There is no newly
published package subpath. `evidence/api-declarations.txt` captures built types.

Default bounds: input/output payload 256 MiB each, files4096, buffer8 MiB,
output slice64 KiB, argv64 KiB, total generated counter length128, work512 Mi.
All are positive safe integers. Streaming adapters avoid per-file collection;
fallback reads and writes and `-C` lookahead have explicit buffer caps. The
existing Shell output/pipe budget remains distinct and active.

Implemented GNU common scope: default1000 lines, `-l`/`--lines`, `-b`/`--bytes`,
`-C`/`--line-bytes`, input/stdin/`-`, prefix, `--`, attached/grouped shorts,
`-a`/`--suffix-length`, `-d`/`--numeric-suffixes[=FROM]`, auto-extension,
additional suffix, common binary/decimal units within safe-integer bounds.
Unimplemented flags and numeric limitations are enumerated in the subtree README:
no chunk-count modes, filter processes, custom separators, hex counters, verbose,
help/version, obsolete numeric flags, long abbreviations, or BSD pattern/chunk modes.

## Author validation

- Scoped node:test run: **43 passed, 0 failed, 0 skipped**; final TAP retained.
- GNU9.7-Darwin positive fixtures: **43/43 strict** status/stdout/stderr/file bytes.
- Apple/BSD shared positive fixtures: **20/20 strict**, overlapping common inputs,
  not 20 independent new GNU coverage claims.
- GNU error fixtures: **9/9 exact status/file/namespace effects**, **4/9 strict**;
  5 separately asserted diagnostic-profile differences: two-modes, missing-input,
  missing-parent, same-input, directory-output.
- Numeric/empty-input edge controls: **18/18**, final exact status/stderr and empty
  effects checks. Initial **7/18 failures** remain in `edge-initial.json`; the
  intermediate size-only correction is also retained.
- Boundary stress: **8 native scenarios**, each replayed with **2 producer chunk
  sizes**; 16/16 exact variants, not 16 distinct native inputs. Inputs/expected
  bytes and output hashes retained.
- Four native-only GNU/Apple profile differences explicitly retain exact statuses,
  naming exhaustion counts and diagnostics; they are not virtual failures waived.
- Scoped noEmit and owned-output declaration build pass. A **coherent compiled
  host/plugin** consumer writes/reassembles binary files and passes under plain
  Node. Initial mixed source/compiled-class fixture failure is retained/disclosed;
  it was corrected in the harness, not hidden by changing product errno handling.
- Positive MemoryFS, explicitly rooted RealFS, Shell pipelines/registry collision
  policy, 4 MiB+ RealFS streaming, and configured S3 mock overwrite workflows pass.
  Mock evidence is not deployed S3/WebDAV/provider interoperability evidence.

Commands:

```sh
node --import tsx --test tests/commands/split/*.test.ts
node_modules/.bin/tsc -p tests/commands/split/tsconfig.json
node_modules/.bin/tsc -p tests/commands/split/tsconfig.build.json
node tests/commands/split/compiled-consumer.mjs
git diff --check -- src/commands/split tests/commands/split
```

The build includes an owned consumer entry and its imported source dependencies,
emitting only into the owned ignored `.build` directory, never root `dist`.
Native fixtures use owned temporary directories; successful ones are removed by
the harness. No external credentials, remote writes, native build/install or
provider edits occurred. There are no lingering worker/watch processes.

## Oracle pins and qualifications

Host: macOS26.4.1 build25E253, Darwin25.4.0 arm64; Nodev22.22.2. GNU9.7 is a
Darwin build, **not GNU/Linux evidence**. `LC_ALL=C` controls are explicit.

- GNU binary: `cf5851c4e6566983ce69940b766c0b5eb0cd26ebf2bb45eefe215b2d5c62f958`.
- GNU `split.c`: `db197761b614672fa7d05fbca75394ea1dcaecf9d6c8bc44129ae2ed6ad00087`.
- Apple `/usr/bin/split`: `7c2d5f3c73e849d664bad3a2f4c67c5154b0f03f59f2fa779d49e33dc7983f91`.

GNU first oracle location is the existing metadata-stress `.oracle/coreutils-9.7`
tree. Binary pin mismatch fails tests; unavailable binaries skip explicitly.
Official GNU and Apple primary references were consulted via `web.run`; local
pins govern tested profile, not the current live manual version.

## Safety boundaries and remaining integration

Known aliases are rejected; ordinary proven-distinct outputs truncate faithfully.
Opaque existing identities without authority fail closed (`ENOTSUP`), while actual
MemoryFS/RealFS/scoped or truthful comparison paths support positive overwrites.
stdin has no pathname identity; no promise to detect redirected-input aliasing.
Missing names use `wx`: raced files remain intact with `EEXIST`. The original
author characterized dangling symlink rejection as acceptable; this was a product
defect. The follow-up resolves stable dangling links and exclusively creates their
missing targets. Original handoff/test/result and raw initial native failures are
preserved in `evidence/dangling`; the original 43 count above is historical, not
the follow-up test count. Prior output aliases are conservatively rejected; GNU can overwrite them.
Observation is not a lease/ABA guard or a guarantee against hostile external races.

No rollback/delete cleanup exists. Completed outputs and adapter-written current
partial files remain on error/cancel; preexisting current files may be truncated.
Fallback buffering and `-C` lookahead can delay publication versus native output;
that is not transactional safety. Exact abort reasons and late failure observation
are tested; uncooperative host work cannot be forcibly stopped.

Root owns all future export/default integration. Independent verifier corpus was
not inspected. These are author checks only: **no independent acceptance, full
project gate, broad GNU parity, superiority, deployed-provider or work-duration
completion claim** is made.
