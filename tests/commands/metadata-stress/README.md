# Independent metadata checkpoint

Independent of Curie's author cohort. Production writes are closed at
`f06f288`; only `src/commands/metadata/stat.ts` changed. Exact source hashes,
commands, counts, calibrations and limitations are in `VALIDATION.json`.
The original seven metadata author artifacts and both plugin test files are
unchanged. No filesystem, contracts, root exports/manifests/docs, diff/patch,
archive or other command source was modified.

## Results and fixes

| Cohort | Result |
| --- | --- |
| Original author metadata + aggregate/plugin tests | 71/71 |
| New independent tests | 48/48 |
| Additional strict-unhandled-rejection repeats | 3 × 48/48 |
| Frozen built-package checks | 5/5 |
| Scoped types / current source-build types | both pass, `--noEmit` |
| Frozen source snapshot build at `3246f82` | pass, snapshot-only `dist` |
| Current global typecheck | fails on four unowned diagnostics recorded in JSON |

The independent tests contain **567 native GNU case rows**, not 567 extra
Node tests. Repetitions are not additional unique coverage. No skipped,
cancelled or TODO tests in these passing cohorts. No full global suite was run.

1. `680079a`: unsigned stat fields incorrectly honored plus/space sign flags.
   Thirteen native field controls now distinguish unsigned metadata from signed
   epoch fields.
2. `9982b9c`: stat rejected common string/integer precision and counted character
   width instead of UTF-8 bytes. Added bounded precision, zero/alternate-format
   handling, and independent formatting of symlink name/target. Forty-five
   valid native format rows pass; two modified-percent error controls reject
   invalid input while explicitly retaining the native/virtual buffering gap.
3. `f06f288`: divide-then-multiply floating arithmetic lost one millisecond in
   ten of eleven exact timestamp controls. Divide by the exact decimal scale
   instead. Native measured timestamps, not requested-but-rounded host times,
   establish this regression.

No chmod or mktemp production defect was reproduced in this bounded checkpoint.
Their new tests cover symbolic/numeric/special bits, recursive symlink policy,
hardlink effects, reference/verbose/quiet behavior, template/options/umasks,
64 simultaneous exclusive reservations, file/directory/symlink collision
competition, limits, cancellation and crypto-call provenance. This is not
exhaustive mode fuzzing, proof of cryptographic quality, or full GNU parity.

## Native provenance and reproduction

GNU coreutils **9.7**, not Apple aliases. `oracle-evidence.json` pins the official
archive, relevant C source hashes, exact Darwin arm64 binary hashes, and the
original calibrated red result (24/25 Node tests; five of ten stat formats
different). Native commands run only under this suite's bounded `.native-*`
fixtures, with fixture-owned sentinels. Tests never chmod or create host source
files. Product code never runs native commands.

No GNU binaries were found in PATH, standard Homebrew locations, or the inspected
cache/temp locations. The official archive was downloaded into ignored `.oracle`
and built without installation or project dependency changes. Build procedure:

```sh
mkdir -p tests/commands/metadata-stress/.oracle
curl --fail --location https://ftp.gnu.org/gnu/coreutils/coreutils-9.7.tar.xz \
  -o tests/commands/metadata-stress/.oracle/coreutils-9.7.tar.xz
shasum -a 256 tests/commands/metadata-stress/.oracle/coreutils-9.7.tar.xz
tar -xf tests/commands/metadata-stress/.oracle/coreutils-9.7.tar.xz \
  -C tests/commands/metadata-stress/.oracle
cd tests/commands/metadata-stress/.oracle/coreutils-9.7
./configure --disable-nls --without-gmp --disable-acl --disable-xattr
make -j4 all
```

`--without-gmp` was unrecognized; this is recorded, not hidden. Initial partial
make targets failed on an ungenerated `uchar.h`; unmodified `make all` generated
the prerequisite headers and succeeded. HTTPS archive provenance and checksum
are recorded; detached-signature verification is not claimed. Binary hashes are
machine/build-specific: a different rebuild requires separately reviewed oracle
calibration, not silently replacing frozen evidence. Missing or mismatched
binaries fail the provenance test; no Apple fallback or capability skip exists.

From the repository root, using the existing development dependencies:

```sh
node --unhandled-rejections=strict --import tsx --test 'tests/commands/metadata-stress/*.test.ts'
node --unhandled-rejections=strict --import tsx --test 'tests/commands/metadata/*.test.ts' 'tests/plugins/*.test.ts'
node_modules/.bin/tsc --noEmit -p tests/commands/metadata-stress/tsconfig.json
node_modules/.bin/tsc --noEmit -p tsconfig.build.json
node --test tests/commands/metadata-stress/built-package.check.mjs
```

The last command needs the recorded `.oracle/build-snapshot` artifact. It is a
`git archive 3246f82` of `src`, package/lock and the two tsconfigs with existing
`node_modules` linked, followed by `npm run build` **inside that snapshot only**.
No dirty or untracked source overlay, no emitted JS siblings in source, and no
claim that the moving worktree equals the snapshot. Raw local logs remain ignored
beside these tests; their checksums are recorded in `VALIDATION.json`.

## Supported profile and boundaries

Factories remain `metadataCommands` / `createMetadataCommands`, with
`{ replace?, umask?, limits? }`. Limits remain 100000 entries, depth 128,
1048576 output bytes, 65536 argument bytes, 128 attempts; default virtual umask
022. There are no new runtime dependencies or public options.

- **chmod:** numeric/operator-octal; symbolic u/g/o/a, +/-/=, rwxXst, permission
  copying and sequential clauses; R/v/c/f and long recursive/verbose/changes/
  silent/quiet/reference. Leading-minus modes require `--`; the parser's short
  `-r FILE` reference alias is not GNU's leading-minus mode syntax. H/L/P and
  root overrides are rejected. Restrictive recursive updates may have partial
  effects, and identity rechecks are not an ABA/path-race defense.
- **stat:** L/dereference, c/format, printf. Directives n,N,s,a,A,f,F,i,h,u,g,d,D,
  x,y,z,w,X,Y,Z,W and percent. Bounded integer/string precision now works; width
  is byte-based. Epoch precision remains 0–3; human timestamps remain UTC
  milliseconds, not GNU nanosecond/default-report parity. Missing optional
  fields still fail explicitly. Quoting remains the delivered limited profile.
  GNU can emit an earlier format prefix before an error; virtual stat buffers
  the current operand. The invalid-format controls preserve this difference.
- **mktemp:** d/directory, p/tmpdir, u/dry-run, q/quiet, suffix and `--`; final
  run of at least three X characters, inferred suffixes, virtual TMPDIR only.
  Deprecated t remains rejected. Node crypto `randomInt` supplies alphabet
  choices; AST provenance is not a cryptographic audit. Exclusive VFS create,
  bounded EEXIST-only retries, 0600/0700 minus virtual umask. Dry-run is not a
  reservation; output/abort after creation may leave one entry safely.

Actual Memory, Real, mount, overlay, readonly, S3 and WebDAV adapters were tested.
Memory enforces owner bits but has no host identity model. Real retains host
namespace races and provider/OS-specific mode restrictions. Overlay uses an
immutable readonly lower and exclusive upper with atomic rename support; these
tests do not certify mutable/shared backing configurations. Mount alias identity
and data-loss remediation stays with FS/Curie, not this patch.

S3/MockS3 and WebDAV/MockDav support observed stat/type/size/mode reads and dry-run
names; metadata chmod/private mktemp fail without pretending to enforce private
permissions. Remote cancellation reaches the actual adapters' injected read
transports. These are not live-provider or network-confinement certifications.
S3's advisory creation-mode metadata and `permissions:false` contract dispute
remain unresolved with Curie/Poincare; no legacy expectation is waived here and
advisory mode readback never proves IAM/ACL protection. Rmdir support was not
used to infer any other capability.

Curie/root should update public documentation for the new stat formatting
semantics and retain these limitations. Another independent reviewer is still
required for release acceptance. Historical Dirac and diff/patch checkpoints,
full-shell scope, superiority evidence and the requested 72 hours are unchanged.
