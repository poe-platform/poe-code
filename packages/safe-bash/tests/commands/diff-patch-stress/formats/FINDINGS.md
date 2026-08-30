# Independent new-format findings

Owner: leaf format verifier, exclusively this directory. No source modifications.

## Immediate handoff, August 26, 2026

- Baseline author formatter tests: 221/221 passing at initial inspection.
- First independent corpus: 769 tests, 507 pass, 262 fail, no skips/todos.
  Of these, 256 parser tests encounter pending normal/context support (including
  empty input), three GNU native-native controls fail, and three corresponding
  cross-application checks are blocked by that same native failure. The later
  runner separates those controls and uses Apple cross-application only after
  both its forward and reverse native-native controls match original bytes.
- Confirmed GNU/Apple option dialect disagreement: with `old = a\nb\nc\n`,
  `new = a\nB\nc\n`, `diff -C0 -c --label target --label target old new`,
  GNU diffutils 3.12 resets context to three; Apple diff and the current virtual
  formatter retain zero. `regressions.test.ts` pins the GNU expectation and logs
  the Apple observation. This is a GNU-profile failure, not invalid context
  syntax or universal incompatibility. Root/source owner must choose a profile;
  this verifier has not altered source behavior or weakened the GNU gate.
- GNU diffutils 3.12 can emit `-C0` patches that GNU patch 2.8 rejects itself.
  Initial examples were `repeated-alignment-{2,6,10}` at zero context. The
  first example's virtual diff was byte-identical to GNU output. GNU patch
  fails forward and reverse with `replacement text or line numbers mangled`;
  Apple patch forward control succeeds. Do not attribute this native-native
  failure to the formatter or require reproducing native bugs in the parser.
- Whitespace comparison checks initially pass: ASCII whitespace, significant
  Unicode/BOM, EOF handling, mixed real edits and independently preserved old/new
  context bytes. Unified `patch -l` controls also pass; normal/context equivalents
  remain pending source support. No overbroad normalization defect confirmed.

## Oracle identity

Read-only executables supplied by the signed-official-source build worker:

- `/tmp/safe-bash-gnu-oracle.Yg2F0W/diffutils-3.12/src/diff`, version
  `diff (GNU diffutils) 3.12`, SHA-256
  `f13ef516c397b0281818ffe8685aa763100b56a6549295c91849c6af937a83c9`.
- `/tmp/safe-bash-gnu-oracle.Yg2F0W/patch-2.8/src/patch`, version `GNU patch 2.8`,
  SHA-256 `c060444da0e547de6f17594baf0b5015a04f5b3277131ca12b1da27c621aee00`.

This leaf verifies executable versions and hashes, not the build worker's
signature-verification procedure. Missing GNU executables fail setup rather than
silently switching the expectation source or skipping required cases.

## Baseline source SHA-256

The initial 769-test run recorded identical before/after hashes:

| File | SHA-256 |
| --- | --- |
| diff.ts | 769af5df58d829ed3733ad1a24d1fbcbb02af6397cd7f4ffbce5c0f08c517599 |
| diff-format.ts | 3d6e0dd8e3b588963b3487f5e42ab8d7ea673fe2404df1ff26cce47912352912 |
| patch.ts | 3960f24dcc22237fefda72f67ccdb7462a2a9152a48ad5a22fae1d13bf79b88c |
| unified.ts | d2d9db844bebb1a2f142854b050978b488d36552b2c496e52fbdf84cf6c0e9e8 |

The corpus is subsequently strengthened by rotating context counts across each
edit family, adding focused boundaries/whitespace/regressions, and distinguishing
native-native failures from virtual behavior. Baseline and final denominators
therefore differ; no source-improvement claim follows from their raw counts.

## Expanded verification

The expanded suite ran **1,069 tests: 1,055 pass, 14 fail, zero cancelled,
skipped or TODO** in 14.887 seconds. The active source author delivered
`patch-formats.ts` before this run; both Shell pipelines, all 256 normal/context
parser gates, all 24 `patch -l` gates and the empty-input regression now pass.
Scoped typechecking passed at this checkpoint. A later concurrent shell edit
caused an imported-source typecheck error, recorded below. No full-repository
test/build claim is made.

| Gate | Pass | Fail | Total |
| --- | ---: | ---: | ---: |
| GNU native-native editflow controls | 250 | 6 | 256 |
| Independent formatter cross-application | 251 | 5 | 256 |
| Independent normal/context parser | 256 | 0 | 256 |
| GNU static whitespace controls | 56 | 0 | 56 |
| Whitespace normal/context exact outputs | 112 | 0 | 112 |
| Mixed real changes and original bytes | 10 | 0 | 10 |
| Patch loose whitespace matching | 24 | 0 | 24 |
| Hunk merge boundaries | 36 | 0 | 36 |
| Flag/label interactions | 24 | 2 | 26 |
| Diff budget checks | 12 | 0 | 12 |
| Diff cancellation checks | 4 | 0 | 4 |
| Shell normal/context pipelines | 2 | 0 | 2 |
| Other focused gates, including patch budgets | 18 | 1 | 19 |
| **Total** | **1,055** | **14** | **1,069** |

All fourteen non-passes remain visible and keep the runner's exit status nonzero:

1. **Three GNU-profile failures** are the same `-C0 -c` selector disagreement:
   two label combinations and the minimal regression. Current source matches
   Apple. A project-wide choice of GNU or Apple semantics is outside this leaf's
   ownership; the GNU expectations remain unmodified.
2. **Six native-native failures** are context zero for `delete-{3,7,11}` and
   `repeated-alignment-{0,7,11}`. GNU patch rejects GNU diff output, in both
   directions when independently probed. These are not virtual parser failures;
   the virtual parser correctly applies the same diffs forward and backward.
3. **Five oracle-blocked cross-checks** are those same cases except
   `repeated-alignment-0`. Apple applies the forward controls but returns the
   wrong bytes in reverse. The tests fail explicitly at `ORACLE BLOCKED: Apple
   reverse bytes`; they do not require the product to reproduce that corruption.
   `repeated-alignment-0` passes both Apple controls and both virtual-output
   cross-applications; its failed GNU control still stays in the denominator.

For example, zero-context `delete-3` starts with original lines 0 through 9 and
deletes original lines 4 and 5. Apple reverse returns the order
`0,1,2,4,5,3,6,7,8,9`, not `0,1,2,3,4,5,6,7,8,9`. This independently confirms why
the Apple reverse result cannot be a product expectation.

No virtual formatting/body-byte/whitespace-normalization defect was confirmed
beyond the explicit GNU-profile selector disagreement. All unique-line exact
format comparisons pass before any oracle-blocked application step. This is a
bounded format/whitespace result, not full utility/shell compatibility or a
superiority claim.

### Expanded-run source change record

At the expanded run, `HEAD` observed nearby was
`f4eb0b327fd5a14f49dc6007f14f613b43cdaeea`; source changes can be uncommitted.
The runner's before/after source hashes matched during the run. All original
recorded hashes stayed unchanged except:

| File | SHA-256 |
| --- | --- |
| patch.ts | 18863f4a10e1a157877c6627bad4d0c46e7dcb9b6ae0ea1c4ebb032714264ce6 |
| patch-formats.ts (new) | ef67097df66662e6b0ed74d707e2c75332b434464e7aafb9bd0164be40c37c6c |

Additional final dependency hashes:

| File | SHA-256 |
| --- | --- |
| index.ts | 82465ab079aac196a8cf99231fc9d9e7f4f60135f862802e02d2e523d0bebf17 |
| shared.ts | 81ab0a3d1fbb29feb91761a7a60a535ca5768079ee0415e0788cbebfb1f3617e |
| patch-envelope.ts | 9cae8b9b8e51b133e933dc96b9c8cf8c0dcfbc620f861a330e6711828579aad1 |
| patch-path.ts | b45660d4d422933ae31db3839bc6af0678bfd6b1faa309b67f9187ad99423266 |

Apple identities: `Apple diff (based on FreeBSD diff)`, SHA-256
`214a0d91e39424b15e1e3540edf6b33ee3dd2bbccb0c6dd3a9571dae754edede`;
`patch 2.0-12u11-Apple`, SHA-256
`ca8aaa5fa4bd9dfaf4b3be251b18372f25f07483946e7d06b505e5a5fb0a6a84`.

## Last rerun and concurrent-source limits

The last complete runtime rerun again produced **1,055/1,069 passing, 14 failing,
zero skipped/TODO/cancelled**, in 19.631 seconds, with the same failure categories
above. Both before/after Git HEAD readings were
`e432c52147a4f355fbae9083cfe1d94a3f78f86d`. Source was not frozen at that commit:

- `patch.ts` SHA-256:
  `a4149cf2c27c4edaab9e79a8a703353a15853a0615983296a1ca26c260e1b7ee`.
- `patch-path.ts` SHA-256:
  `f4a115ab2dbd3bba8e6ac383ca6dcea46a6cc6fa6ed9a14fc206ab763a6bf35b`.
- All other diff/patch source hashes matched the expanded-run record.
- `shell/runtime.ts` changed during the run from
  `7bf6c95b1458575aa75b318ea7c252066b62622314e0f953f0718be2663284c9` to
  `af03c4fcce9f20a2f766de5516235f5b1c13a22921e0adabbd6945088d38aa3a`.
- `shell/shell.ts` remained
  `be5e2727b68396c346d7f374975edfdd2aa0048bd1cabea45c108a03007d86a1`;
  `shell/types.ts` remained
  `b4ffd34a796dc8d211b0355f11b704a2a7d44627623d3abbffcf3610154c4fc6`.

An intermediate scoped typecheck observed `src/shell/input.ts:117` TS2322:
`Uint8Array<ArrayBufferLike>` is not assignable to `Uint8Array<ArrayBuffer>`.
This imported source is read-only to the verifier. The final scoped typecheck
passed after the shell worker's subsequent edit; the observed `shell/input.ts`
SHA-256 was `35046a41c10689e8ffca9c825e485ad45679c7172a6316c443ddfb402cdaef82`.
Runtime Shell pipeline passes do not establish a consistent whole-repository
source snapshot, and this leaf made no shell changes.

An intervening unchanged-test run produced **780 pass / 289 fail / 1,069 total**
in 20.816 seconds, with transient `patch.ts` SHA-256
`3ef569a8473e9fea6b097f4cb8376d66f8da7214f06f7480c010b64093df4b32`.
That hash independently matches `git show e685231:src/commands/diff-patch/patch.ts`.
Normal/context parser entry wiring was absent in that source version, causing
254 parser, 16 loose-format matching, two pipeline, two output-budget and one
static normal regression failure in addition to the fourteen persistent gates.
The later source author restored `parsePatch` wiring before the last rerun.
The verifier did not alter any source file. The temporary regression was reported
immediately; it must not be confused with a change in test expectations.

No runtime behavior changes followed the last full rerun; a readonly tuple
annotation only removed a non-null assertion in the test's budget fixture loop.
This leaf stops at its focused coverage/ownership boundary rather than repeatedly
chasing unrelated concurrent source changes.
