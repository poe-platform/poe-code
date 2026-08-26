# Independent split preparation checkpoint

August 26, 2026. This leaf assignment creates only `split.ts` and this new
directory. No existing structured files, integration fixtures, adapters, shared
README files, index entries, or commits are changed by this worker. The numeric/
quantifier author retains the shared parser/interpreter files. Integration is
intentionally pending; these helper passes are not tool interoperability passes.

## Frozen native evidence

`native.json` contains **69** cases captured before implementing the helper using
`/usr/bin/jq`, version **jq-1.7.1-apple**. It records the native executable SHA-256,
capture timestamp/platform, literal argv, exact stdin/stdout/stderr UTF-8 strings,
per-stream SHA-256, and exit status. UTF-8 round-trip assertions preserve exact
bytes, including raw NUL output. Corpus SHA-256, also enforced by `evidence.ts`:

```text
cdee2e3a38d929e66d8fdf3917bed62ea46ccff86091de0816128c38176bd8d3
```

The corpus has 51 direct argument cases (32 successes, 19 type errors), 15
generator/error-order cases, and three raw-input cases. A second independent
native invocation reproduced **69/69** exact stdout, stderr and status records.
Literal subprocess argv never invokes a host shell. Each invocation has a 2-second
SIGKILL deadline, a 64-KiB capture cap, sanitized environment, and a fresh
test-owned `.native-*` working directory removed in `finally`. Re-capture checks
the frozen file; `--freeze` refuses to overwrite it. All artifact writes use
`apply_patch`. No runtime product code imports host processes or filesystems.

Native observations relevant to integration:

- Empty input produces `[]`, including with a nonempty separator. JavaScript's
  direct string `split` is not a substitute for that behavior.
- Empty separator produces Unicode code points, not UTF-16 units or grapheme
  clusters. Combining marks and zero-width joiners remain separate elements.
- Nonempty separators match literally, non-overlapping, retaining leading,
  trailing and repeated empty fields. Regex-looking text is literal. NUL and
  multibyte separators are length-aware; no Unicode normalization is performed.
- Non-string input/separator rejects with status 5 and native message
  `split input and separator must be strings`.
- Evaluate the separator filter on the original input, lazily and in order.
  `null | split(empty)` emits nothing without a type error. An argument-filter
  error precedes the helper's type error. Earlier uncollected outputs survive a
  later error; `first`/`limit` may stop before it. Optional suppresses the current
  generator's error, not resumes its later alternatives. Array collection does
  not emit partial arrays. Native stderr location decoration is frozen but
  command tests retain the established virtual jq diagnostic format.

Supplementary primary reference reading: jq 1.7 manual, and upstream tag
`jq-1.7.1` files `src/jv.c`, `src/builtin.c`, `src/builtin.jq`. The installed Apple
binary, not an assumption that it equals upstream, is the frozen executable oracle.

## Helper and exact integration handoff

`src/commands/structured/split.ts` exports:

```ts
splitString(input: Json, separator: Json, budget: Budget): Promise<string[]>
```

It uses the existing exported `Budget`, `Json`, `JqError`, and `JqLimitError`
contracts. It validates operands, accounts exact encoded aggregate value bytes
and collection size before pushing, and charges scanning/preprocessing/fallback
steps. Literal KMP matching bounds the scan to linear work; its auxiliary prefix
table is bounded by the separator's validated value length. Empty-separator
iteration is by code point. Cooperative `budget.tick()` calls yield during long
scans, prefix preprocessing and expansion. Existing synchronous string validation
and individual allocations are not forcibly interruptible.

Do **not** debit `maxOutputBytes` or `maxResults` in this helper: a later filter
may reduce a large intermediate array to a tiny scalar. The existing `jq.ts`
writer owns those budgets; the command tests check both enforcement and shrinking.

After the other author closes, the root should assign exactly these shared-file
changes; no grammar productions, lexer changes, or new dependencies are needed:

1. In `parser.ts`, add `split: [1]` to the existing `functions` arity registry.
   Do not register zero-argument or regex/two-argument split.
2. In `interpreter.ts`, import `splitString` from `./split.js` and add this branch
   inside `Interpreter.call`, alongside other argument-evaluating builtins:

```ts
if (name === "split") {
  for await (const separator of this.run(args[0]!, input)) {
    yield await splitString(input, separator, budget);
  }
  return;
}
```

Do not prevalidate `input` outside the separator loop; do not collect separator
results eagerly; do not catch helper limit/cancellation errors here. Existing
outer optional/collection/writer behavior remains responsible for its policies.

## Actual interoperability baseline

The unchanged matrix at commit **6a259ff** invokes public `Shell` and only the
aggregate `agentCommands()` plugin. Its retained split case is:

```text
shell source: jq -R -s 'split("\n") | map(select(length > 0))'
stdin: alpha\nbeta\n
native stdout bytes: [\n  "alpha",\n  "beta"\n]\n
expected exit: 0
```

Its broader six-family coding flow currently uses
`find ... | xargs rg ... | sed ... | awk ... | jq -R '.' | jq -s '.'` and reopens
the report. Neither that flow nor any expectation was changed. The six additional
tests here invoke the exact frozen raw-lines filter through the aggregate plugin
on memory, real, S3 mock, WebDAV loopback, mount, and overlay fixtures; no fake
registration or command replacement is used.

`baseline.json` preserves all TAP/stdout, exit codes, failure names, byte hashes,
timing, limits, and working-tree HEAD. On Node v22.22.2, starting
2026-08-26T21:08:33.765Z, HEAD remained
`a5d68b970412248b67d48cf747ab0d86a2ae2ba7` across the run (other uncommitted worker
changes were present). The matrix README, fixtures and tests matched 6a259ff
byte-for-byte before/after. Baseline artifact SHA-256:

```text
b43ca4b84f8eadb40c09a52664ee08037e836a84ca0674e8bb28b1cb83f4be55
```

| Scope | Pass / total | Failure classification |
| --- | ---: | --- |
| Helper | 67 / 67 | 51 native direct cases plus 16 budget/cancellation/complexity tests |
| Command | 0 / 73 | All 69 native cases plus four budget cases blocked by missing `split/1` registration |
| Six-adapter aggregate split dispatch | 0 / 6 | All exit 3, unsupported `split/1`; not filesystem failures |
| Unchanged cross-adapter matrix | 70 / 79 | One missing split; eight shell filesystem-error diagnostic mismatches |

The matrix has six missing-path failures (one on each writable backend): actual
`shell: line 1: missing.txt: No such file or directory` lacks the expected
`ENOENT.*missing.txt`. Two readonly redirection failures produce
`shell: line 1: target.txt: Read-only file system` without the required `EROFS`.
These remain genuine matrix failures; do not weaken expectations or call them
passes. The matrix checks readonly namespace preservation before those diagnostic
assertions. The required four-backend subtotal is **40/44**, not full acceptance.

The README's older 58/79 snapshot had S3/WebDAV stream/access/timestamp/rename,
mount copy/traversal, and readonly-gzip issues. Those cases pass at this newer
checkpoint, following concurrent work outside this assignment; none was fixed
or edited by this worker. No current split prerequisite requires an adapter
change. Poincare/root should coordinate the remaining ENOENT/EROFS reporting
contract with the shell owner and rerun the unchanged matrix. Do not attribute
the eight diagnostic failures to missing split or reopen older FS failures
without a fresh reproduction.

## Reproduction and validation

All commands run from `/Users/kjopek/Workspace/safe-bash`:

```sh
node --import tsx tests/commands/structured-stress/split-increment/capture-native.ts
node --unhandled-rejections=strict --import tsx --test --test-reporter=tap tests/commands/structured-stress/split-increment/helper.test.ts
node --import tsx tests/commands/structured-stress/split-increment/verify.ts
node --unhandled-rejections=strict --import tsx --test --test-reporter=tap tests/integration/adapter-tools/matrix.test.ts
```

`verify.ts` executes the exact final matrix command as literal Node argv, plus
the three focused suites. Each subprocess has a 60-second SIGKILL deadline and
512-KiB output cap; no shell, external credentials, or broad test glob is used.
It exits nonzero while any suite is red. Normal reruns never overwrite baseline
or native expectations. Existing matrix fixtures have their own request, output,
test, and cancellation limits and use only isolated test directories/loopback.

The following scoped strict TypeScript check passed after implementation; no
whole-repository success is claimed:

```sh
node_modules/.bin/tsc --noEmit --target ES2023 --lib ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --forceConsistentCasingInFileNames --skipLibCheck --types node src/commands/structured/split.ts tests/commands/structured-stress/split-increment/capture-native.ts tests/commands/structured-stress/split-increment/evidence.ts tests/commands/structured-stress/split-increment/helper.test.ts tests/commands/structured-stress/split-increment/command.test.ts tests/commands/structured-stress/split-increment/interop.test.ts tests/commands/structured-stress/split-increment/verify.ts
```

## Exact new paths

- `src/commands/structured/split.ts`
- `tests/commands/structured-stress/split-increment/capture-native.ts`
- `tests/commands/structured-stress/split-increment/native.json`
- `tests/commands/structured-stress/split-increment/evidence.ts`
- `tests/commands/structured-stress/split-increment/helper.test.ts`
- `tests/commands/structured-stress/split-increment/command.test.ts`
- `tests/commands/structured-stress/split-increment/interop.test.ts`
- `tests/commands/structured-stress/split-increment/verify.ts`
- `tests/commands/structured-stress/split-increment/baseline.json`
- `tests/commands/structured-stress/split-increment/README.md`

## Delivered integration, appended August 26, 2026

The preparation account above is historical and unchanged. Integration began
only after reading `/tmp/safe-bash-jq-increment-fix-report.txt`, which released
the shared files after numeric author commit
`73ed8538b758a2501e4f5558ea2f63b531ae5a7d`. The parser now registers `split: [1]`;
the interpreter uses exactly the lazy loop in the handoff. The helper needed no
semantic correction. No numeric implementation, plugin API, runtime dependency,
grammar production, regex overload or public limit changed.

| Delivered scope | Pass / total | Notes |
| --- | ---: | --- |
| Pinned native replay | 69 / 69 | Exact native stdout/stderr/status; original capture unchanged |
| Helper | 67 / 67 | Original independent suite unchanged |
| Command | 81 / 81 | Original 73 plus eight integration safety/arity cases |
| Aggregate six-backend interop | 6 / 6 | Now also named-file, pipeline, persistence and reopen checks |
| Existing author suite | 684 / 684 | Stale split/1 rejection changed to unsupported split/2 |
| Numeric/quantifier focused suite | 202 / 202 | Existing tests unchanged |
| Original 6a259ff matrix assertions | 71 / 79 | One split failure fixed; eight diagnostics still fail |
| Revised live matrix | 79 / 79 | Concurrent diagnostic-expectation changes; not original acceptance |

All passing suites have zero cancelled/skipped/TODO cases. Split product
stdout/status match **69/69** frozen cases, but exact stdout/stderr/status match
is **44/69**, with **25 diagnostic-only** differences and no stdout/status
differences. Existing command tests deliberately check virtual jq decoration,
not exact native error-location decoration. Broader original/additive numeric
raw gates were rerun together: **238 tests, 196 pass, 42 fail**, as before.

Each backend test now exercises the same frozen raw-lines filter through
`agentCommands()` on direct stdin, named `old.txt`, and
`cat old.txt | jq ... > split-lines.json`, checks persisted bytes, then reopens
JSON via redirection. It also executes the real coding flow:

```sh
set -o pipefail; find src -type f -name '*.txt' | xargs rg --no-heading --no-filename '^TODO' | sed 's/^TODO //' | awk '{ print $1 ":" $2 }' | jq -R -s 'split("\n") | map(select(length > 0))' > split-report.json
jq -r '.[]' split-report.json
```

Expected reopened bytes are `alpha:2\nbeta:3\n` on all six existing fixtures.
The original matrix and its expectations were not edited by this worker.

### Matrix provenance and outstanding ownership

At initial inspection, the three matrix files matched 6a259ff. During this
assignment another worker committed
`d0fed8fb1b54ae7be4dadc1332750314d9bb108d`, changing six missing-file redirection
and two readonly redirection assertions from errno-token regexes to exact shell
wording. Its README records that separate diagnostic-contract decision. Thus
the later exact README command returns **79/79**, but cannot be reported as an
unchanged-original-matrix pass or as eight filesystem fixes by this worker.

| File | Initial / 6a259ff SHA-256 | Live delivery before and after SHA-256 |
| --- | --- | --- |
| Matrix README | `4d35075e85c2e20bcd419e8c93cf3f7c248dbcffcee1d06cea54fa4d9476ba5d` | `90e0f412964fd220ac51b7d9b5206bdbb68dd2f59ee74cf10cbdf90b09504676` |
| Fixtures | `955fc83173aea8297653a1015e40c41cf0bc471a9268fa159293167f6b0c9059` | same |
| Matrix test | `e959e6c77016674f438a2daa4fc76cac2a73b1daa8a91ae43052563bc53d99df` | `370b8cb16925cb5d571a69e1ac58a3e6cedbd6f8f1c6fad5690bbdc4047d36b4` |

`replay-original-matrix.ts` reads the original test directly from Git, checks its
pinned hash and the unchanged fixture hash, rebases only its two local import
locations, and asserts that reversing those replacements reproduces every
original source byte. The existing development TypeScript compiler removes
types; a bounded, strict-rejection, literal-argv Node subprocess executes all
79 original tests against current product code and unchanged adapter fixtures.
No matrix file is overwritten and no expectation is changed. This supplemental
replay is separate from the exact live README command; it preserves the original
denominator rather than accepting concurrent expectation changes silently.

Fresh original replay: **71 pass / 8 fail**, exit 1. Exact remaining repros:

- `cat < missing.txt` on memory, real, S3 mock, WebDAV, mount and overlay: actual
  `shell: line 1: missing.txt: No such file or directory\n`, whereas the six
  original assertions require `/ENOENT.*missing\.txt/`.
- `printf 'changed' > target.txt` and `printf 'changed' >> target.txt` on the
  readonly fixture: actual `shell: line 1: target.txt: Read-only file system\n`,
  whereas the two original assertions require `/EROFS/`. Original namespace and
  byte-preservation assertions still execute before each failing diagnostic.

These are shell diagnostic-contract / matrix-oracle decisions for root/Poincare
and the shell owner, not split defects. The original required four-backend
subtotal is **40/44**; the revised live subtotal is **44/44**. No remaining live
matrix failure requires a split fix. Earlier adapter gaps are not reopened or
claimed fixed here. Real remote-provider coverage remains outside this matrix.

### Delivery evidence and exact checking

`delivery.json` captures the four live suites' full TAP and hashes, structured
source hashes, original evidence hashes, and before/after HEAD
`9e905738e9b71a7a91a7f868a1716c618c9b7ec5`; capture ran
2026-08-26T21:18:48.975Z through 2026-08-26T21:18:50.839Z.
Its SHA-256 is `28c2a4a8fde3880ce86282c68adb8cd4ae2ccf8a9210fd30d411b31f66403a80`.
`original-matrix.json` captures the separate original-assertion replay at stable
HEAD `b4033fb96b353bf82025a28aafff6619066967dc`; its SHA-256 is
`682aa25d20006a597c8e70a6c75b12409fd3ca89bb82e362bd8802fbb1d64be0`.
These are working-tree checkpoints with concurrent foreign work, not clean
release claims. Both scripts refuse to overwrite existing evidence; ordinary
reruns are read-only apart from test-owned fixture temporaries.
The historical delivery row named `unchanged-matrix` means unchanged during
that captured run, not unchanged since 6a259ff. Subsequent verifier output names
this row `live-matrix` to avoid conflating the two acceptance denominators.

The original `native.json` and `baseline.json` retain their hashes printed above.
All original 155 numeric vectors, their observations and the four numeric
evidence hashes in the parent stress README remain untouched. The one existing
test edit is `../join-safety.test.ts`: its now-obsolete dead-branch rejection of
split/1 becomes rejection of the deliberately unsupported split/2, retaining
compile-before-input/error-precedence coverage. The first integration run was
683/684 due to that stale assertion; after correction it is **684/684**.

Run from the repository root; the original replay deliberately remains red:

```sh
node --import tsx tests/commands/structured-stress/split-increment/capture-native.ts
node --import tsx tests/commands/structured-stress/split-increment/verify.ts
node --unhandled-rejections=strict --import tsx --test --test-reporter=tap tests/integration/adapter-tools/matrix.test.ts
node --import tsx tests/commands/structured-stress/split-increment/replay-original-matrix.ts
node --unhandled-rejections=strict --import tsx --test tests/commands/structured/*.test.ts tests/commands/structured-stress/*.test.ts
node --unhandled-rejections=strict --import tsx --test tests/commands/structured-stress/independent-increment/numeric-fixes.test.ts tests/commands/structured-stress/independent-increment/numeric-safety.test.ts tests/commands/structured-stress/independent-increment/quantifier-fixes.test.ts tests/commands/structured-stress/independent-increment/safety.test.ts
node --unhandled-rejections=strict --import tsx --test tests/commands/structured-stress/independent-increment/native-regressions.test.ts tests/commands/structured-stress/independent-increment/additive-regressions.test.ts
node_modules/.bin/tsc --noEmit --target ES2023 --lib ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --forceConsistentCasingInFileNames --skipLibCheck --types node src/commands/structured/*.ts tests/commands/structured/*.ts tests/commands/structured-stress/*.ts tests/commands/structured-stress/independent-increment/*.ts tests/commands/structured-stress/split-increment/*.ts
```

Both that owned-scope TypeScript check and the matrix README's scoped check pass.
Native raw gates remain red for the previously recorded Unicode/recovery/
diagnostic/malformed-fixture categories. No broad repository test/build, numeric
policy change, full jq parity or superiority claim is part of this integration.
Root must assign a different final verifier after this committed checkpoint.

### Subsequent concurrent matrix changes

A final hash check found additional foreign, uncommitted matrix hardening:
direct filesystem ENOENT/EROFS assertions and stricter status/namespace checks.
The README hash stayed `90e0f412964fd220ac51b7d9b5206bdbb68dd2f59ee74cf10cbdf90b09504676`;
fixtures became `59ac2d1835ff329d0bbd08e3ae28bc8c656145e5bb568e6dbca0e851367cb3ab`;
matrix became `a4f79a93aae64a91fe764da7b9a2c096c8dd93a76fcdcc522828aea670a241f2`.
These files remain untouched by this worker. The live verifier again returned
67/67 helper, 81/81 command, 6/6 interop and 79/79 live matrix, at HEAD
`05dee320b4ae2feed6344bf8efce8ed533631d5b` with foreign working-tree changes.

To keep original-matrix reproduction independent of later fixture edits, its
runner now also reads and hash-checks the original fixture from Git. Both test
and fixture are compiled in memory; only explicit import locations and the
fixture's `import.meta.url` are relocated reversibly. Original behavior and all
assertions remain intact; no copied file or modified expectation is installed
in the integration tree. The original captured replay artifact remains unchanged.
That updated runner reproduced **71/79**, exit 1, with the same eight diagnostics;
HEAD advanced from `05dee320b4ae2feed6344bf8efce8ed533631d5b` to
`63f18424addb374b01e81fa2b543cf48e9747888` during the run, while both live matrix
and fixture hashes stayed stable. The full structured-scope TypeScript command
passed again after this runner update.
