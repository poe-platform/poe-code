# Frozen expr gap matrix — 2026-08-27

## Result and scope

This independent leaf extracted the **existing** observations; it did not execute
a new corpus, change a product file, or implement named locales. `CASES.md` is the
readable exact-case report. `CASE_MATRIX.json` preserves literal argv/patterns,
argument UTF-8 hex, both invocation environments, selected locale categories,
native executable/argv0, provenance, and expected/actual stdout/stderr as base64,
hex, byte counts and lossless UTF-8 when valid. Original capture rows are embedded
unchanged. Invalid UTF-8 is represented by exact bytes and `utf8:null`, never by
replacement characters. No stderr, pathname, newline or Unicode normalization
is performed.

| Requested group | Observations | Classification |
| --- | ---: | --- |
| Nullable, separate cohort | 8 | **5 semantic failures, 3 strict controls** |
| Named `en_US.UTF-8` gaps | 10 | **7 original + 3 extension semantic failures** |
| GNU/C diagnostic gaps | 9 | **8 original + 1 extension**, semantic match but exact stderr mismatch |

Those are **27 requested observations, not 27 failures**. The 24 failures/differences
must not be described as one feature denominator. The original GNU cohort remains
97/104 semantic and 89/104 strict; the original extension remains 20/23 semantic
and 19/23 strict. The quoted-parenthesis correction remains a **separate GNU 1/1**.
The matrix additionally preserves the two original named-locale matching controls,
the correction's separate Apple observation, and 19 Apple counterparts in separate
arrays. They are not added to the requested 27 or substituted for GNU expectations.

The comparator's historical definition of semantic match is equal stdout bytes,
status and diagnostic presence, without actual failure/signal. It does **not**
mean equal diagnostic category or wording. Strict match additionally requires
identical stderr. `coverage.json` classifies the fixed-source native acceptance as
still failing; bounded controls, cancellation fixes and overlapping worker cohorts
do not close these gaps.

## Authority and authentication

- Product: `27a7793526830768484885afba5832bf8bb248b5` only.
- Independent execution evidence: `50b1e560b11adfcd1d1726896832c3c524e28c4d`,
  `tests/commands/expr-stress/extension-review/after-abort-fix/replay/`.
- Original freeze: `35aa8054ac0ebc1eacefc7cde63e4706f4c72137` (8 files).
- Extension freeze: `92fe8a6335366b93cbc9a80d61fede69af711444` (16 files), including
  original grammar-error evidence and the later quoted correction, without replacement.
- Matrix SHA256: `ae334dcecc459d59e89d0183067b828ae4848ef48db300391dbe0971ec6046d2`.
- Archived product `src` tree Git ID: `a68ba3a650473e23a96511535cec0d4833688da8`.
- Source inventory SHA256: `3f9f08d5a284954c9cc7e977225f6b85cd7d20c8e812c4163f5573ed94a08aae`.
- Historical archive SHA256: `5a232b6ea331c3d2d74f012b77622d1e2273e61c4cb29f5899d12f7e586ba81c`.
- Historical installed artifact inventory SHA256:
  `3c7035e2917fab3b95eede6908065f544890ad60bc984a29941b559a34082ea5`.

`extract.mjs` authenticates all 73 files listed by the replay execution manifest,
the manifest's inventory hash and complete 74-entry committed replay inventory;
all 237 source-file hashes and the complete candidate `src` inventory; four build
inputs; both original capture manifests; and both complete frozen subtrees across
their original commits, the candidate and evidence commit. It joins every archived
comparison to its original oracle, literal input and case hash, fixed-source
actual report, and the independent native replay. No source or expected value is
read from the live product tree. Later diagnostic-author changes cannot enter
this frozen baseline. The matrix was frozen before this review's proposals and
will not be regenerated to represent a later implementation.

This is independent authentication of **committed evidence and Git inputs**, not
a new build, rerun or current-host prerequisite check. The archived distribution
and installed-artifact hashes remain the historical staging receipt's claims;
this review does not recreate the tarball or installed package. The source and
build-input hashes are independently checked directly against the fixed commit.
The historical standalone installed command invocation is not a root-export or
package-subpath publication claim. Neither this audit nor the original coverage
is an append-proof whole-live-worktree/full-archived-test gate.

## Native identity — GNU on Darwin, not GNU/Linux

The authenticated native replay was captured from `2026-08-27T18:08:15.827Z` to
`2026-08-27T18:08:17.730Z`. Its prerequisite qualification checks the pinned
binary, version tuple, archive, source member, linked-library output, host and
locale charmaps, without missing-prerequisite skips or fallback. The nullable
supplement uses the same pinned binary and records its own literal invocations.

| Identity | Exact value |
| --- | --- |
| Executable | `/Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr` |
| Native `argv0` | `expr` (not the absolute executable pathname) |
| Version first line | `expr (GNU coreutils) 9.7` |
| Executable SHA256 | `e8a4e2b58a33d2ad6bfa9eb8a4ed5f62775ab9ceac4b9421680c98973fd9109c` |
| Archive | `/Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7.tar.xz` |
| Archive SHA256 | `e8bb26ad0293f9b5a1fc43fb42ba970e312c66ce92c1b0b16713d7500db251bf` |
| Source | `/Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr.c` |
| Source/archive-member SHA256 | `c9dc5e04039505ab48a350e9407b1d83b2574fd7e2c31c9d23f4bf942d1b8af0` |
| Host | Darwin `25.4.0`, `arm64`, macOS `26.4.1`, build `25E253` |
| Runtime | Node `v22.22.2` |
| Library | `/usr/lib/libSystem.B.dylib`, compatibility `1.0.0`, current `1356.0.0` |
| C charmap bytes | `US-ASCII\n` |
| Named charmap bytes | `UTF-8\n` |

Full version stdout/stderr/status, library receipt, macOS output, original identity
objects and capture times are retained in the matrix. The native fixture pathname
is retained for the original/extension/correction replay. The nullable supplement
recorded only the `expr-nullable-final-native-*` creation template, not the resulting
pathname; the matrix explicitly leaves that cwd unknown rather than manufacturing
it. Both native drivers used literal argv without a shell and ignored stdin.
The main native replay used 2-second/64-KiB combined-output bounds; the nullable
driver used `spawnSync`, 2 seconds, `maxBuffer:65536`, and `SIGKILL`.

Apple `/bin/expr` has separate SHA256
`584ea6af503bdb3cc647c128a16a1aa9d22d3eeab136671f746a209bfef7db9f`.
Its `--version` probe prints `--version\n`, not a GNU version identity. Its
observations are host-specific comparisons, not GNU replacements or POSIX rules.

## Actual virtual environments and locale selection

The direct installed driver constructs `Object.freeze({LC_ALL:'C',
...payload.environment})`, command `expr`, cwd `/`. It does **not** spread
`process.env`. Original/extension/correction acceptance passes the full profile
environment explicitly; the nullable supplement passes **no environment**.

| Cases | Exact virtual environment | Exact native environment |
| --- | --- | --- |
| Nullable 8 | `{"LC_ALL":"C"}` | `{"PATH":"/usr/bin:/bin","LC_ALL":"C","LANG":"C","LANGUAGE":"C","TZ":"UTC"}` |
| GNU/C diagnostic 9 | `{"LC_ALL":"C","PATH":"/usr/bin:/bin","LANG":"C","LANGUAGE":"C","TZ":"UTC"}` | `{"PATH":"/usr/bin:/bin","LC_ALL":"C","LANG":"C","LANGUAGE":"C","TZ":"UTC"}` |
| Named mismatch 10 | `{"LC_ALL":"en_US.UTF-8","PATH":"/usr/bin:/bin","LANG":"en_US.UTF-8","LANGUAGE":"C","TZ":"UTC"}` | `{"PATH":"/usr/bin:/bin","LC_ALL":"en_US.UTF-8","LANG":"en_US.UTF-8","LANGUAGE":"C","TZ":"UTC"}` |

Neither `LC_CTYPE` nor `LC_COLLATE` is present in these actual environments.
`LC_ALL` therefore selects C or `en_US.UTF-8` for both categories. The matrix's
`localeSelection` is a static explanation of the supplied environment, not a
claim that a parser-error case reached the locale checks.

At the fixed commit, `src/commands/expr/internal.ts:99` chooses character behavior
as `LC_ALL || LC_CTYPE || LANG || "C"`; line 106 chooses comparison behavior as
`LC_ALL || LC_COLLATE || LANG || "C"`. Empty strings fall through. Only exact
`C`, `POSIX`, `C.UTF-8` and `C.utf8` are accepted. The first two select byte
characters, the last two Unicode scalar characters; **all four use byte
collation**. Unsupported nonempty values are refused, not silently defaulted.
These precedence expressions agree with the nonempty-category ordering in P1;
the explicit virtual default here is C. Locale names and supported capabilities
must not be inferred from the agent's host environment.

The following are **source-derived scenarios, not captured observations**:

| Explicit env scenario | Character selection | Collation selection |
| --- | --- | --- |
| `LC_ALL=en_US.UTF-8`, both category vars C | named/refused | named/refused |
| `LC_ALL=""`, `LC_CTYPE=C.UTF-8`, `LC_COLLATE=C`, `LANG=en_US.UTF-8` | scalar | byte |
| `LC_CTYPE=en_US.UTF-8`, `LC_COLLATE=C`, `LANG=C`, no `LC_ALL` | named/refused | byte |
| `LC_CTYPE=C`, `LC_COLLATE=en_US.UTF-8`, `LANG=C`, no `LC_ALL` | byte | named/refused |
| only `LANG=en_US.UTF-8` | named/refused | named/refused |
| empty map | byte C default | byte C default |

## Named-locale feasibility — proposal only

Nine mismatches concern scalar length, substring/index positions, regex dot spans
or captured text; one (`unicode-collation`) concerns ordering. Their captured
inputs do not establish named-locale character-class, range, equivalence-class
or collating-element support. P2 assigns character interpretation/classes to
`LC_CTYPE` and ranges/collation/equivalence to `LC_COLLATE`; these are different
requirements. G1 explains the count-versus-first-capture return distinction and
G2 the collation category for nonnumeric relations.

**Bounded scalar option:** reuse existing byte-boundary/scalar machinery only
under an explicitly declared, independently qualified named UTF-8 character
profile. Archived `evaluate.ts:87` and `evaluate.ts:95` implement count/index/substr;
`bre-worker.ts:252` decodes scalars and retains byte boundaries. This is a plausible
route for the nine scalar cases, **not an observed fix or permission to alias all
UTF-8-suffixed names**. Preserve decomposed `e` + combining acute without NFC,
grapheme segmentation or UTF-16-code-unit counting; the recorded outputs include
length 2 for that sequence and first-capture bytes `65cc810a`. Requalify explicit
priority conflicts, empty/unset variables, unknown names, byte/scalar boundaries,
work/allocation limits, cancellation and worker cleanup before claiming support.

**Collation is independent:** archived `evaluate.ts:73` compares numeric-shaped
operands numerically, otherwise calls `requireByteCollation` and compares bytes.
Aliasing `en_US.UTF-8` to C.UTF-8 leaves `é < z` as byte order, incompatible with
the frozen GNU/Darwin expected `1\n`, status 0. A deterministic, versioned locale
data implementation or an explicit trusted collation provider could be a future
design, but would require its own API authority, resource bounds and pinned
Darwin-GNU qualification. No such API is asserted to exist or implemented here.

**Regex classes remain a separate gap:** `bre-worker.ts:134` refuses collating
symbols/equivalence classes; line 153 refuses non-ASCII range endpoints; line 280
refuses non-ASCII subjects with named character classes. Merely accepting a locale
name does not repair these refusals. Scalar literal/dot operations are not
locale-sensitive class/range coverage.

Do not use ambient host locale, implicit `Intl.Collator`, `localeCompare`, or an
unqualified ICU/CLDR mapping as GNU parity. E1 explicitly allows implementation-
dependent collation and version differences. An explicitly selected/pinned Intl
profile could be documented as its **own** profile after authorization, but one
matching `é < z` result would not certify Darwin libc or GNU/Linux behavior.
Implementing named locales is **not assigned to this leaf**; all ten mismatches
remain failures in the frozen matrix.

## Nine C diagnostic differences — concrete cause and bounded direction

All nine have status 2 and empty stdout on both sides. The precise expected and
actual stderr for every input are in `CASES.md`, including quotes and final LF.
At archived `syntax.ts:26`, missing operands produce a generic message instead
of GNU's preceding-token diagnostic; `syntax.ts:30` loses the distinction between
missing `)` at end and an unexpected token in its place; `syntax.ts:59` omits the
trailing token. `index.ts:61` prefixes the caught message with `expr: ` and LF;
there is no special zero-operand GNU help trailer.

The eight original rows are `ambiguous-index-keyword`, `missing-operands`,
`missing-rhs`, `missing-close`, `trailing-token`, `skip-still-requires-rhs`,
`skip-still-requires-close`, `skip-still-requires-keyword-args`. The extension row
is `class-parenthesis-not-capture`, argv `["(",":","[(]"]`: it is a **grammar
error**, not a successfully parsed BRE character-class case. Expected stderr is
`expr: syntax error: expecting ')' instead of '[(]'\n`.

A narrowly authorized future diagnostic fix should retain parser position and
previous/unexpected token data, distinguish empty invocation from incomplete
expression, preserve token quoting, and format exact pinned GNU/C messages.
Preserve syntax validation in skipped branches, status, stdout, budgets and
awaited stderr behavior; do not relax comparison assertions or strip prefixes.
P2 specifies diagnostics and status, not these exact GNU sentences, so the nine
are GNU-profile byte-compatibility targets, not nine newly proven POSIX violations.

The independent quoted correction argv `["+","(",":","[(]"]` gives `1\n`, status
0 under GNU and product. GNU prefix `+` forces the literal token (G1); it is not
the same input as the original error and remains separate **1/1**, not a repair
or waiver of that original diagnostic difference.

## Nullable 8 — preserve five failures and three controls

For `["+",subject,":","\\(a*\\)*\\1"]`, GNU yields LF/status 1 for subjects empty,
`a`, `aaa`, and `a\n`/status 0 for `aa`. The mandatory-empty case uses
`["+","",":","\\(a*\\)\\{2\\}\\1"]` and yields LF/status 1. All five product
observations return status 2, empty stdout and the exact unsupported-nullable-
capture diagnostic. The three controls (`no-reference`, `not-repeated`,
`nonnullable`) match GNU strictly; their outputs are respectively `aaa\n`,
`a\n`, `a\n`, all status 0. None is merged into original104 or extension23.

Immediate fixed-source cause: `bre-worker.ts:161` recursively determines
nullability and capture references; line 182 marks captures beneath a repeat
with maximum >1 and nullable child; line 186 refuses any referenced marked
capture. The rejection runs at `compile` entry (line 190), before matching.
It conservatively rejects the five inputs and excludes the three controls from
that condition. Returning an error is containment, **not native parity**.

Removing the refusal alone is not established safe. The archived interpreter's
epsilon-loop guard at line 291 keys only on program counter for the current
input position; capture history can change without consuming input. Its first
equal-length winning path is retained at line 296. Historical diagnosis commit
`7f22cb8c13d5520f870585ab0d1b476083a213bc` and the identical preserved text in the
independent replay distinguish capture-history pruning from GNU9.7's partially
open capture-register anomaly. Those old diagnostic workers were not the fixed
27a candidate: their source/dist qualification limits remain in the preserved
text. They are explanatory evidence, not additional current acceptance passes.

P3 provides leftmost-longest/subpattern context; it does not justify treating a
partially open register as a completed empty capture. A future bounded correction
would need explicit repetition identity/count/progress, branch-local capture
restoration, charged state/cycle handling and a separate decision about exact
GNU9.7 anomaly compatibility versus normative semantics. Test the eight retained
inputs plus focused overall-span/capture-history controls under that decision,
without rewriting these expectations. No safe one-line correction is claimed.

## Verification, limitations and cleanup

Only new files in this `frozen/` directory and the two requested task-owned `/tmp`
handoffs are written. No root wiring, product/old fixture edits, dependency
installation, builds, native utility replay, native temporary-directory deletion,
subagents or worker threads were used. Synchronous Git/apply_patch children were
awaited; no owned scratch directory, product worker, native child or timer remains.

This directory is explicit opt-in historical evidence: `extract.mjs` defaults to
read-only verification; extraction/sealing refuse overwrite. It is not a canonical
test that pins a historical product as current. No `.test.ts` or discovery/config
change is introduced. The owned seal rejects added, removed, changed entries and
unexpected directories/symlinks in this flat tree. It authenticates its file list
and byte hashes, excluding only the seal itself. See `VALIDATION.md` for execution
records, including pre-freeze extractor mistakes; they are not product failures.

From repository root:

```sh
node tests/commands/expr-stress/c-profile-gap-review/frozen/extract.mjs verify
node tests/commands/expr-stress/c-profile-gap-review/frozen/audit.mjs
git diff --check -- tests/commands/expr-stress/c-profile-gap-review/frozen
```

Primary normative/contextual references are P1/P2/P3/G1/G2/E1 in
`PRIMARY_SOURCES.json`, consulted with `web.run` on 2026-08-27. The online GNU
manual version is explicitly distinct from pinned 9.7 observations. The matrix
and native/source receipts, **not a current manual or Apple behavior**, determine
the exact GNU9.7 expected bytes. No full GNU parity, expr completion, Linux
qualification, named-locale implementation or 72-hour-work claim is made.
