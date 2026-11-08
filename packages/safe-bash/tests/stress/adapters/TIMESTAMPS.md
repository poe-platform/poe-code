# Exact Real metadata fixture regression

## Scope and observed failure

On 2026-08-26, inspected Curie's `/tmp/virtual-bash-foundation-global.JSuKor`:
**1,377 passed, 29 failed, 6 skipped**. Its Real optional-metadata failure was
`core.test.ts:44`: actual atime `1787770992916.333`, expected `10000`.
This matches the historical-atime mutation already observed natively, not a
precision or rounding failure. Initial inspection HEAD was
`805a70bb77dcab0c41f1db34dfd715cce40dd489`.

`RealFileSystem.utimes` directly passes `new Date(atimeMs)` and
`new Date(mtimeMs)` to Node. No production code changed. The unidentified reader
or mechanism remains unidentified; intentional reads establish a control, not
the identity or cause of the original unsolicited mutation.

## Fixture correction

- Only Real's shared exact-atime input changes from historical `10000` to
  `(Math.floor(Date.now() / 1000) + 86400) * 1000`: a whole second approximately
  one day ahead, greater than both now and the unchanged historical mtime
  `20000`. Both assertions remain strict equality. Memory keeps `10000/20000`.
- Real's separate millisecond conformance fixture uses the same future second
  plus `125` milliseconds. Historical mtime `1650000000250`, all metadata
  assertions, and both existing `< 2` millisecond tolerances remain unchanged.
  Millisecond-component coverage is therefore not replaced by a
  whole-second-only check.
- `tests/fs/real/timestamps.test.ts` retains exact forwarding assertions for
  historical pairs `10000/20000` and `1600000000125/1650000000250`. A call-through
  spy checks actual native path, Date values, and exactly one call per request,
  then calls the real native implementation. Native mtime is asserted exactly;
  historical atime observations are explicitly diagnostic, not persistence
  assertions. The spy and builtin exports are restored in `finally`.
- `atime-probe.ts` retains historical native and concrete-Real observations as
  a standalone diagnostic, and adds bounded future controls. It never resets
  timestamps between observation phases. Historical mutations are counted and
  printed, not represented as passing persistence tests. Future control
  mismatches cause a nonzero exit after results are printed.

Changing the input is **not a precision tolerance**. There is no timestamp
cache, fake metadata, retry, sleep, skip, or host-security change. This corrects
the test's assumption that an access-sensitive historical atime must persist
until assertion; it does not change Real's host metadata semantics.

## Independent controls

Command: `node --import tsx tests/stress/adapters/atime-probe.ts`.
Host: Darwin arm64, Node `v22.22.2`. Exit **0**. Each row uses **500 fresh files**
and three observations: immediately after utimes, after an intentional native
read, and after an intentional Real read. Both reads verify exact binary bytes.
The run used whole-second future atime `1787857794000`; its millisecond variant
was `1787857794125`. No timestamp is reapplied after either read.

| Fixture | Backend | Immediate atime mismatches | After native read | After Real read | Mtime mismatches, all phases |
| --- | --- | --- | --- | --- | --- |
| Historical `10000/20000` diagnostic | Native | 9/500 | 500/500 | 500/500 | 0/1500 |
| Historical `10000/20000` diagnostic | Real | 4/500 | 500/500 | 500/500 | 0/1500 |
| Future whole-second / historical `20000` | Native | 0/500 | 0/500 | 0/500 | 0/1500 |
| Future whole-second / historical `20000` | Real | 0/500 | 0/500 | 0/500 | 0/1500 |
| Future plus `125` ms / historical `1650000000250` | Native | 0/500 | 0/500 | 0/500 | 0/1500 |
| Future plus `125` ms / historical `1650000000250` | Real | 0/500 | 0/500 | 0/500 | 0/1500 |

Thus future controls observed **0 mismatches across 2,000 fresh files and 6,000
paired timestamp observations**, including deliberate reads. The three samples
per file are not independent files. Raw JSON and before/after source hashes:
`/tmp/virtual-bash-timestamp-controls.json`.

## Regression validation

- Before changing assertion inputs, the two focused metadata tests passed
  **2/2** once; this did not negate the recorded intermittent failure.
- Patched focused tests, including historical forwarding: **3/3 passed**.
- `node --import tsx --test tests/fs/real/*.test.ts tests/fs/memory/*.test.ts`:
  **153/153 passed**, exit 0.
- `node --import tsx --test --test-name-pattern='^(memory|real):' tests/fs/conformance/shared.test.ts tests/stress/adapters/core.test.ts tests/stress/adapters/policy.test.ts`:
  **119/119 passed**, exit 0. This is deliberately local scope, not an all-FS run;
  no selected metadata assertion is skipped or removed.
- Scoped TypeScript over `tests/fs/real/*.ts`, `core.test.ts`, and `atime-probe.ts`
  with the root strict NodeNext compiler settings: **exit 0**.
- Fresh-process metadata repetition: **200/200 processes, 600/600 tests passed**,
  exit 0, with no retry on failure. Each process runs the Real exact metadata
  case, Real millisecond conformance case, and historical forwarding case:
  `NODE_OPTIONS=--unhandled-rejections=strict node --import tsx --test --test-reporter=tap --test-name-pattern='real: optional metadata|stat metadata exposes|utimes forwards' tests/stress/adapters/core.test.ts tests/fs/real/conformance.test.ts tests/fs/real/timestamps.test.ts`.
  Recorded interval: **2026-08-26 19:11:24.327–19:12:07.242 UTC**. Results:
  `/tmp/virtual-bash-timestamp-repeat.json`.

All completed test runs above report zero failures, skipped, cancelled, and
todo tests. Logs are `/tmp/virtual-bash-timestamp-{baseline,patched,owned,local-shared}.tap`
and `/tmp/virtual-bash-timestamp-types.log`.

## Tested sources and boundaries

Contracts were snapshotted before tests, including committed cancellation I/O
`6794a05483af3176afff40d27aa4401125a101e9` and errno alias normalization
`ca6211bec468641fe8e5e19ec6664afcfe0c88ef`. Validation started at HEAD
`2448f5ddb5711369ce8315c0cddcc561b564d1ad` with this owned test patch applied.
The 24-file manifest covers contracts, Real/Memory source and tests, shared
fixtures/tests, and local stress/probe files, not concurrently owned remote or
shell sources. Before/after manifests are
`/tmp/virtual-bash-timestamp-validation-{before,after}.sha256`.
All **24/24 file hashes matched** across the owned/local suites and repetition;
HEAD remained `2448f5ddb5711369ce8315c0cddcc561b564d1ad` at both boundaries.
SHA-256 of the manifest's file lines, excluding the HEAD line:
`52603618f9aa0fc673bb492f45c27cfef603b7bcfa4d009def8b9574aaf9317b`.

SHA-256 values for the relevant source and changed test files:

```text
381ce34841cfd6dfc45b97a1eb549c7ac3b289b35ca34d4b6ae407aeff905335  src/contracts/command.ts
66455381fe9d9e5357d08942e73de6ea1d613a03b09acaab77a5ccccde0f2840  src/contracts/errors.ts
7c63db5052a28014ac185f86e6b97d2c3ef00ce61b80638baa850a6933f57457  src/contracts/filesystem.ts
fb9a434deb34dbad631166a689b02641c0e1acdbac691f6956a7c76e20729f50  src/contracts/index.ts
e925ab08a5ad41862d3f5c031164cc7310bc28397455b11b37b75b55a9dbacdb  src/contracts/io.ts
948a1ceb19fd87fa4931974282ec4d68217dbd2353fac6ce6eabd48d3b5a2f34  src/contracts/path.ts
b45e85e0d89f88308caf0b68f0b14f78341c4bba246d02e81103646f5a4c54ae  src/contracts/plugin.ts
4977b7780b067cdd16bd8c128982758cd3401d2f72864f786981d2c315b74f82  src/fs/real/index.ts
21d4a366e3840d0d3c9e67b8a433cc0be341f7350b075fd6668aa4ad9a32d3fd  src/fs/memory/index.ts
eb3453d5377d625597e471bde50c1a98840fba882fc9e7361a6c7a2c3c908b24  tests/stress/adapters/core.test.ts
7602969e459fe22baad973d8a49c09e53e44f8c19459654c31eec084487cef21  tests/stress/adapters/atime-probe.ts
48a9587cc2483c0924b176ca1ec3fedd5fdf417a96f898f5ab9e4200316a468c  tests/fs/real/conformance.test.ts
1805d914017e8a26e91ddd5ac809feaf0ec92a9c78ab8f180453e7a9eb960fdc  tests/fs/real/timestamps.test.ts
```

## Residual limits

These are bounded observations on this host, not proof that atime is immutable
or that every filesystem/mount access policy preserves future atime. Explicit
timestamp writers, different host policies, or substantial clock movement can
still change it. Historical persistence remains explicitly diagnostic. Equal
boundary hashes do not rule out transient edits between boundaries. The final
verifier must run coherent all-FS validation; this assignment makes no global
pass, superiority, full-shell-completion, or 72-hour-work claim.
