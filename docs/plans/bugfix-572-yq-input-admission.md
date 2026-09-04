# Issue #572: yq input admission

## Authorized scope

Use the cap alternative requested by kamilio in issue #572: 16,000,000 bytes
(decimal 16 MB), not incremental YAML framing. Change only the yq accounting cap
and yq-specific query-session input default. Preserve jq defaults, document/value/
scalar/work limits, retained ownership copies, and YAML/error/cleanup behavior.

The current collector retains owned chunks and concatenates a whole source before
decoding/evaluation. Byte and raw-document admission already precede retained
copies; later parser work accounting does not prevent initial collection. This
change lowers permitted input, not a measured RSS bound or a streaming guarantee.

## TDD and validation

1. Add numeric default, exact-cap, cap-plus-one and cumulative admission tests.
2. Exercise real command multi-source paths with two-byte buffers whose reported
   byteLength is synthetic accounting input; these are not large-input proofs.
   Observe owned-copy construction, rejection, unread operands and cleanup.
3. Retain tiny Buffer reuse/EOF, split UTF-8/CRLF, directives, aliases, empty
   documents, scalar markers, malformed UTF-8 and falsy cancellation controls.
4. Run red tests before changing the two defaults; rerun focused tests and strict
   no-emit types after. Record exact commands, outcomes and file/log hashes.

New literal test path for root registration:
`packages/safe-bash/tests/commands/yq-author-20260828/input-admission.test.ts`.
Root owns registry updates, Git, broad gates and release delivery.

## Profile and nonclaims

`tsconfig.build.json` still excludes the five yq implementation files and the
query adapter. No build/export admission, published-yq claim, README/seal/manifest
change, streaming rewrite, large allocation, stress run, or CPU/RSS claim is in
scope. Tests import current source using existing dependency bindings; they do
not establish a package build, public-consumer gate or release.

## Results

Validated September 4, 2026 with Node v22.22.0. Product diff is exactly the two
input-default literals; all other product code remains untouched by this change.

- Initial and confirmed red runs: 14 tests, 7 failed and 7 passed, exit 1.
  Failures cover the old default, numeric boundaries, cumulative source admission,
  fallback readFile maxBytes and oversized stdin. The confirmed run replaces an
  incidental invalid-chunk error on the unread operand with an explicit assertion.
- Green run after the two-literal fix: 14/14 passed, exit 0.
- Initial strict types found two implicit-any mock parameters; explicit test-only
  parameter annotations corrected these. Final strict no-emit types: exit 0.
- Final focused run, including the typed test: 24/24 passed, exit 0 (14 new tests
  and 10 selected existing admission, scalar, document, alias and sink controls).
- Nine selected source/test fingerprints matched before/after the focused run.
  This is a selected-input stability check, not a full dependency/tree seal.
- Scoped tracked diff whitespace check passed. No build, full suite, root lint,
  Git mutation, commit, push or release was performed.

### Reproduction commands

Every execution used escalated mode. From the checkout root, child setup was:

```bash
toolchain=$(cat /tmp/kamilio-toolchain.path)
private_tmp=$(cat /tmp/kamilio-561-562-tmp.path)
export PATH="$toolchain/bin:$PATH" TMPDIR="$private_tmp" TSX_DISABLE_CACHE=1
unset NO_COLOR
while IFS= read -r variable; do unset "$variable"; done < <(git rev-parse --local-env-vars)
```

Red and first green command:

```bash
node --import tsx --test --test-concurrency=1 packages/safe-bash/tests/commands/yq-author-20260828/input-admission.test.ts
```

Final focused command:

```bash
node --import tsx --test --test-concurrency=1 --test-name-pattern='^(yq .*|quoted and block scalar families|directives and documents remain independent|query compiles once and each document yields independently|document-prefix BOM, markers, and exact NUL encoding|stream end markers permit empty and subsequent bare documents|anchor reuse uses active records and deep copies|anchor copies retain earlier values and namespaces reset per document|sink failures escape by identity even when shaped like a query limit|WRK-06 raw document admission precedes retained copy and decode|fixed public caps remain literal and are not replaced by proof thresholds)$' packages/safe-bash/tests/commands/yq-author-20260828/input-admission.test.ts packages/safe-bash/tests/commands/yq-author-20260828/yq.test.ts packages/safe-bash/tests/commands/yq-author-20260828/repair-allocation-v1/repair.test.ts
```

Focused strict type command (explicit roots and import closure, not the maintained
whole-package type/build gate):

```bash
node node_modules/typescript/bin/tsc --noEmit --target ES2023 --lib ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --forceConsistentCasingInFileNames --skipLibCheck --types node packages/safe-bash/tests/commands/yq-author-20260828/input-admission.test.ts packages/safe-bash/src/commands/yq/accounting.ts packages/safe-bash/src/commands/structured/query-core.ts
```

### Exact fingerprints and private logs

Evidence directory:
`/var/tmp/poe-code-kamilio-561-562.dFKZCV/issue-572.CF91kf4x`.
Logs are private local evidence, not committed fixtures or historical seals.

SHA-256 for final changed code/test inputs:

| Path | SHA-256 |
| --- | --- |
| `packages/safe-bash/src/commands/yq/accounting.ts` | `1afd83778601d27db0bb316fbf1f8ad409aadc70cbecfad4f3fb5f60fc81fd69` |
| `packages/safe-bash/src/commands/structured/query-core.ts` | `cad4a815e7f39fbef5e442236df27db6832a6bededa8079db5816e5b1fd6fafc` |
| `packages/safe-bash/tests/commands/yq-author-20260828/input-admission.test.ts` | `e36b5c5daa1c2ae23f2179b89cbd3d497fef16a521a08dd02a27e1d56ed2e218` |

SHA-256 for logs in that directory:

| Log | SHA-256 |
| --- | --- |
| `red.log` | `f5ddf1d8f42a14de3f2f8fb0855ca81c9af98a5a241080bb1004634fdeacaf4b` |
| `red-confirmed.log` | `c07228b0f3df16b6fa6cff5fe57293bc5bd993a367f957d94fa771e901dccb28` |
| `green.log` | `4974187af461504a8863282f5728b772224273296b6b793f16414895c73edb0a` |
| `types-initial.log` | `c59ddf08a0bbc124c5fea83416daaa9345f791d2276b3ab18543a14a26e0941d` |
| `types.log` | `27defb71d02103d5ef7d007f4ba2a563e69e45834e417adda7c7cdf26435123f` |
| `focused.log` | `033a2a8ccef55ad24a7de46386e3310184a18e2feaaaf57065d0b6c600018b24` |
| `input-stability.log` | `53d07de180f5a63e4fc4fda90259d0f72e7da8a44c06da708aff54fd1411f41b` |

`before-focused.sha256` records the nine selected inputs. `file-hashes.log`
records final hashes including this plan; it avoids a self-referential plan hash.
