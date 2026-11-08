# Independent column holdouts: preparation only

This directory belongs to the independent column verifier. Ownership is limited
to new files here and isolated temporary artifacts. Product column, shared table
code, runtime, package exports, and the author's tests are not verifier-owned.

The preparation reads the API proposal, contracts, and primary documentation,
not `src/commands/column/**`, `tests/commands/column/**`, or author oracle fixtures.
No candidate imports, product execution, comparison, build, pack, or full gate
is part of this phase. STOP after the coherent preparation commit; only an
explicit author handoff authorizes the separately documented replay phase.

## Data classification and denominators

`recipes.json` contains 40 bounded top-level recipes: 28 native input recipes and
12 contract/profile safety recipes. Some recipes have named variants; count
actual native invocations separately rather than calling 40 recipes 40 passes.
Safety schedules and product expectations are independent specifications, not
native outcomes and not executed tests. None is a candidate pass.

All fixture inputs, raw native observations, and provenance are JSON data.
Invalid UTF-8 and controls use hexadecimal byte strings. There are no `.test.ts`
files, missing product imports, generated TypeScript inputs, discovery exclusions,
test waivers, or changes to the canonical source/test inventory. The two `.mjs`
utilities use only Node builtins and do not load the product or dependencies.

`native-observations.json` retains literal argv, input bytes, raw stdout/stderr
bytes, exit status, signal, environment, time bounds and native binary identity.
Each output is an observation of that exact profile, not an approval of its
semantics. No whitespace, Unicode, stderr, exit status, or unsupported-option
normalization is permitted. `provenance.json` authenticates the corpus, harness,
contracts, proposal and available native/source prerequisites.

## Profile boundaries

Primary documentation: `https://man7.org/linux/man-pages/man1/column.1.html`.
The fetched page identifies util-linux development documentation, not an installed
GNU utility and not a guarantee about the pinned stable native binary. Its
development label, retrieval time and content hash are recorded in provenance.
The local BSD manual and binary are separately hashed. The local manual's historic
fill wording must not override the raw observations. Neither oracle is GNU column.

BSD does not support `-o`; preserve its failed invocations, including empty-output
separator and long-option probes. Modern util-linux explicit-separator handling
does not justify rewriting BSD's greedy empty-field observations. Invalid UTF-8,
controls, tabs, zero width, empty records, dash operands, and Unicode width have
separate native observations and proposed-product qualifications.

The proposal promises strict UTF-8, deterministic scalar widths, retained-tab
expansion, positive fill width and explicit input-empty-field preservation. It
does not enumerate scalar ranges, the complete whitespace set, work units or all
limit boundary conventions. Those gaps are named prerequisites, not inferred
expected bytes or candidate-dependent rewrites. Preserve the original fixtures
and expectations beside any later documented contract correction.

## Frozen native cohort

Capture completed on August 27, 2026: 44 literal variants on each of two native
profiles, totaling 88 corpus invocations plus 10 identity/host probes. BSD returned
status zero for 28 variants and nonzero for 16; the isolated util-linux 2.41.2
Darwin build returned status zero for 37 and nonzero for seven. These are native
exit-status counts, not semantic or candidate passes. There were no process signals,
deadline kills, output truncations or spawn failures in the recorded native cohort.

Preserved qualifications include BSD's `(null)` output for the all-empty explicit
separator record and its failure on the partial final line. Both captured natives
treat repeated `-` operands as missing filenames here; util-linux emits those
diagnostics while returning zero. Neither behavior overrides the proposed shared
stdin cursor. Unsupported BSD `-o`/long flags and both profiles' zero-width behavior
remain unchanged in the raw data. Unicode observations use Darwin's locale/library
profile, not GNU/Linux or a universal terminal/grapheme-width guarantee.

The optional primary-source build retained its initial failed attempt:
`--disable-all-programs --enable-column` did not enable column in this release
(`--enable-column` was unrecognized). One corrected configure followed by the
targeted `make -j2 column` succeeded without source patches, dependency installation
or global installation. Both attempts, timestamps, bounds and logs are retained
in provenance. Only column and its build prerequisites were requested from make;
this is a native oracle development artifact, not a product build or acceptance run.

## Reproduction and safety

`node tests/commands/column-stress/validate.mjs` performs only static corpus,
byte/hash, count, and ownership-scope checks. `node --check` syntax-checks the two
helpers. These are not product tests, typechecking, runtime or service acceptance.

`capture-native.mjs` is a native-only, explicit-path capture helper. It prints
JSON to stdout and never writes into the repository. Use its documented CLI only
when deliberately producing a new dated evidence cohort; never overwrite the
frozen observations or rerun against a candidate as a preparation shortcut.
The committed observations were added via `apply_patch`, not generated into test
discovery. Exact capture arguments and bounded dev-build details are in provenance.

Native processes run serially with per-process deadlines, bounded input and
stdout/stderr, isolated working directories, explicit locale/environment and no
shell interpolation. The optional native development build is confined to scratch,
uses a primary pinned release and a finite configure/make budget, and never installs
globally or changes product dependencies. Its source hash is checked against the
publisher's HTTPS checksum listing; absent signature verification is disclosed.

Keep raw failures and cleanup outcomes. Preserve unrelated index/worktree changes.
Commit only the individually named owned files. See `handoff-plan.md` for later
actual-Shell, pipeline and moved-packed-consumer verification boundaries.
