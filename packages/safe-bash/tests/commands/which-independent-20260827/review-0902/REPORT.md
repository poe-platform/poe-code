# Independent WHICH review of 0902f3c5

Captured August 28, 2026 UTC; existing August27 cohort paths retain their frozen
names. Candidate `0902f3c541c8e9a79771f55cb5c9b78c6b6eb09b`; author evidence
`0a8a77b674e22cdac69778e0d4acddf626a297c9`; independent preimplementation freeze
`c5cf2abb49cf7fc0e7ac990ea913617a501cf3ba`. Production is read-only throughout.

## Verdict and exact counts

**No defect in the new WHICH module was demonstrated. Recommend scoped module
acceptance with the B18 fixture qualification below, not a fully passing original
freeze or whole-project release.** Root must decide any later fixture amendment.
The original runtime result remains **25/26 in each layout**, not26/26.

| Independent observation | Source layout | Moved internal layout |
| --- | ---: | ---: |
| Unchanged frozen runtime groups | 25pass, 1fail (B18) | 25pass, 1fail (B18) |
| Frozen strict type families T01–T04 | 4/4 | 4/4 |
| Separately added diagnostic controls P01–P06 | 6/6 | 6/6 |
| Authenticated product modules loaded by original runtime | 170 | 170 |

Runtime includes T02/T03 execution controls overlapping two type families: these
are the original **28 distinct families**, not30. Initial and diagnostic replays
give the same frozen result; do not sum repetitions into a bigger corpus. Both
complete original runtime replays have zero skips, cancellations and TODOs.
The scoped strict transitive build passes; 684 emitted JS/declaration/map entries
are bound to the capture. No broad project build/test/typecheck was performed.

Eight emitted-product mutations are rejected: permission-capability gate, omitted
X_OK, swallowed ENOTSUP, absent-PATH cwd fallback, doubled probe count, silent
probe bypass, UTF16 output accounting and stdin acquisition. Seven fail frozen
assertions; M08 triggers the frozen intentional `Forbidden which operation: stdin`
trap, **not** an ERR_ASSERTION. The stored runner's narrower `assertionRejection`
flag is therefore false for M08 and is preserved rather than rewritten. Its
semantic rejection is genuine and distinct from loader/syntax failures.
TM01 weakens maxProbes to any: T03 rejects with **TS2578 only**. Three separate
loader controls reject post-manifest tamper, a live-source import and an unlisted
scratch module before its body executes. These are not native comparisons.

## B18: exact original failure, not a WHICH dispatch defect

Original frozen script at `../cohort-v1.mjs:180`:

```sh
function-only() { true; }; which true registered-only function-only tool
```

Frozen expectation: status1, stdout `/a/tool\n`, empty stderr. Actual in both
layouts: **status2**, zero stdout, exact stderr
`shell: Invalid function name at offset 13\n`, **zero WHICH dispatches**.
The declaration alone gives the same failure. Candidate `src/shell/parser.ts:663`
requires `[a-zA-Z_][a-zA-Z_0-9]*` function names. Its SHA-256 is
`10d015eb62fd4e4f964666c04e5869ea78afdb76d930181760adecbcf16ab65e`, identical
at the preimplementation freeze. Thus the test assumed function syntax outside
this existing virtual parser profile; this is not a new WHICH regression or a
claim that hyphenated functions are universally invalid Bash syntax.

P02 is a **new, separate control**, not a replacement replay:

```sh
function_only() { true; }; which true registered-only function_only tool
```

It yields status1, `/a/tool\n`, empty stderr and one WHICH dispatch. After a real
VFS file named `registered-only` is created, discovery yields that pathname with
status0 without executing the registry handler. The frozen B18's earlier prefix,
literal invoke, redirect and head-pipeline assertions already pass before its
function-declaration failure; its later same-named-file assertion is not reached
there, and is independently exercised in P02.

**Minimal proposal, not applied:** root may authorize a versioned B18 overlay
changing only the declaration and queried function token from `function-only`
to `function_only`, retaining all expectations and the complete original failing
artifact. B10's literal hyphenated command-name input need not change. No parser,
module, original case JSON, frozen runner, root wiring or expectation is changed
by this review. Do not rescore B18 on the basis of P02.

## Source review and additional controls

- Exact approved policy is preserved: followed regular stat before delegated
  X_OK on the same literal lookup. No read-only/permission capability gate or
  execute-mode fallback; unsupported access diagnoses1, typed ordinary misses
  continue, and untyped errors do not become missing names.
- Input and output checks use UTF8 byte counting with surrogate handling,
  remaining-allowance subtraction, lazy PATH cursor traversal and preconstruction
  admission. Checkpoints occur per argument and during4096codeunit scans; these
  synchronous checks are not event-loop yields or a timeout guarantee. No hidden
  shared-work counter, executable launch, host UID or ambient PATH lookup exists.
- Each accepted probe performs at most two top-level provider calls. Source
  source/metadata/provider-internal work, TOCTOU and actual host execution remain
  outside that bound/claim. Output uses newly encoded bytes and awaited writeBytes;
  raw sink failures and observed cancellation retain identity.
- New P03/P04 verify abort after a **successful** stat/access prevents subsequent
  effects (including errno-shaped reasons); P05 rejects capability/mode fallback;
  P06 verifies single PATH/cwd capture and identical literal stat/access lookup.
  These were designed after candidate inspection and are not precode holdouts.
- Real Memory and ReadOnly(Memory) are exercised. The frozen S3-like/DAV-like
  error profiles are injected boundary controls, not deployed provider tests.
  No native FreeBSD/Darwin which, native host fallback or remote service is run.

## Isolation, evidence and reproducibility

`run.mjs` extracts only immutable candidate product TS and package/config inputs;
it never overlays live product source. The compressed captures retain the exact
source archive, all enumerated source/tool hashes, commands, stdout/stderr,
generated-layout paths, emitted hashes and actual per-process loaded-file hashes.
Node22.22.2 Darwinarm64, TS5.9.3, tsx4.23.12 and esbuild0.28.2 are copied from
local development tools into task-owned scratch; zero product dependencies added.

The unchanged driver requests dist URLs. Source mode uses an explicit **source-
only** loader binding from those URLs to the archived TS files; this is declared
source execution, not a fallback to live files. Moved mode has **no src directory**,
uses only authenticated emitted modules, and has no source-routing rule. Exact
module hashes are checked before execution. Shared source, emitted entry sets/
bytes and copied tool entry sets/bytes are checked after execution. These are
internal-module/declaration consumers, not root/package-subpath/default wiring.

`initial-01.json.gz.base64` preserves the first25/26 failures and all its raw
checks. `diagnostic-02.json.gz.base64` preserves the unchanged replay plus new
P01–P06. `initial-harness.json.gz.base64` retains recoverable exact initial harness
bytes, reconstructed through the recorded four-edit inverse and verified against
the initial hashes. The diagnostic harness is committed directly. All original
freeze/draft/observation files and Stage2/R08v3 artifacts remain unchanged.

Every owned scratch root was removed; a task-root-tagged process check found no
surviving owned child. Native/compiler children belong only to dev verification,
not virtual command execution. No service, external bucket, private data or
global configuration was touched. Captures are immutable; explicit replay needs
a new label:

```sh
node tests/commands/which-independent-20260827/review-0902/run.mjs unique-label
node tests/commands/which-independent-20260827/review-0902/verify.mjs
```

The replay intentionally retains failing original B18. The runner's own exit0
means capture completed, **not** that its recorded child test commands passed.
Use the sealed phase statuses/counts; a zero wrapper exit is not a green gate.
Logical caps are not RSS bounds; access is not an atomic identity/launch lease;
uncooperative provider work is not forcibly preempted. No universal native parity,
full default integration or full-product superiority claim follows from this work.
