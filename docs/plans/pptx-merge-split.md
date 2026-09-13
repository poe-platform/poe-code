# Merge and split implementation

Implement the requested F08 slice using import semantics. Do not execute the whole
pipeline, push, release, edit README files, or stage unrelated work.

## Ownership

The domain worker owns merge/split domain code and original tests, necessary import
changes, and package exports. The command worker owns command engine/schema tests
and safe-bash pptx adapters/acceptance, including exact test registration if needed.
The research worker owns new supplemental merge/split research accounting and usage
drafts. Root owns this plan, integration review, disposable QA and local commits.
These assignments satisfy scoped safe-bash delegation and supersede historical
ownership snapshots for this task.

## Acceptance procedure

1. Reproduce missing merge/split support with failing original TypeScript tests.
2. Merge destination plus ordered source decks and ordered slide selections using
   the imported dependency closure, including notes, media, layouts and masters.
3. Split selected slides into independently valid packages. Resolve self/selected
   navigation; explicitly reject navigation outside an independent output when it
   cannot be preserved. Reject missing referenced parts before publication.
4. Charge combined admitted bytes, package/XML/graph work and outputs. Exercise
   sparse arrays, cancellation and caller-owned option/input mutation boundaries.
5. Verify deterministic names, manifests and hashes using independent ZIP/XML/hash
   assertions and both byte SDK and actual virtual-shell commands.
6. Exercise atomic publication capability refusal and explicit partial publication,
   including a second-output failure, preexisting destinations and input aliases.
7. Reconcile applicable parametrized/BDD cases and public API obligations with exact
   canonical provenance pointers. Unsupported model APIs remain visibly pending.
8. Hash-check cached disposable corpus fixtures from the manifest and exercise the
   implemented operation. Keep QA artifacts ignored; reduce meaningful findings to
   original small regressions. Inspect screenshots of actual CLI text.
9. Run maintained focused package tests/lint/build and adapter checks, then stage
   only named owned files and this plan for atomic Conventional Commits on main.

## Execution receipt

The command worker observed five expected failing cases before implementation.
Merge requires explicit `themePolicy` per section 6.4 and its closed argument
schema; existing import retains its previously documented source-policy default.
The CLI uses closed `{vfsPath}` input descriptors. Output manifest records remain
closed path/byte-count/SHA-256 records, with source locations recorded separately.

Cached disposable inputs were hash-verified without downloading:

- `.cache/pptx-corpus/CERN-job-opp-250925.pptx`, 43,231 bytes,
  SHA-256 `85cc7b338a11b9d1a9dfcaaaa504bf21ab643e4c30004a478152f390ee9f5f1d`.
- `.cache/pptx-corpus/WWL-template-1slide.pptx`, 213,136 bytes,
  SHA-256 `0c728ea3fd2ab76906247931fcb5c966074d21e804187893d954cc913cc89689`.

Both fixtures were exercised through `mergeSlides` (selected slide 1, original
one-slide destination, source themes, explicit destination dimensions) and
`splitSlides` (selected slide 1). Both merges rejected `unsupported-edit` for
unequal presentation-wide text defaults; both splits rejected `unsupported-edit`
because the copy remapper cannot safely rewrite opaque structure/dependencies.
No output files were published. The explicit QA context used 256 MiB byte/archive,
1 GiB expanded, 32 MiB XML, 5,000,000 XML nodes, depth 256, 50,000 members/parts
and 250,000 relationships. These are rejection checks, not successful corpus
editing or rendered-fidelity evidence.

Actual engine help, authored merge/split success and transaction-refusal output
were captured under `.cache/pptx-corpus/qa-merge-split-*.txt` and rendered with
`npm run screenshot` into ignored PNGs. Root inspected help/result PNGs: text and
full manifests were legible. Help omitted the two new schema paths; the command
worker added a failing original help assertion before correcting that omission
and adding scoped-source/publication guidance. Final help/result captures were
regenerated and inspected after those changes; schema routes, descriptor syntax,
publication policies, hashes and canonical source locations are readable.

## Review and validation receipt

Original regressions cover deterministic source/selection order; missing linked
slides; self links versus links crossing split outputs; notes backlinks, media and
embedded workbook bytes; independently resolved relationship targets; source
dialects and normalized split output kind; combined byte/read/directory/XML/graph
limits; source/option/context ownership; and cancellation. Split retains global
line-break settings. Merge rejects incompatible line-break defaults, just as it
rejects incompatible text defaults. Generic property/section/show cloning and
unsupported import structures remain documented limitations.

The command and domain share one operation budget. The reader exposes internal
entry-count and byte-length metadata to admit directory records and cloned bytes
without first allocating another copy. Remaining limits constrain decompression,
XML parsing and serialization. XML edit work uses conservative reservations; this
is a bounded operation ledger, not an exact performance profiler.

Command regressions reproduced and fixed theme-policy validation bypass through
the internal merge entry point, location-owner drift from inspection, reused input
buffers, and empty partial manifests before any publication. Atomic callbacks,
preflight conflicts, aliases, conditional-write failures, cancellation after one
write and reserved failure-manifest space have original memfs acceptance cases.
The existing safe-bash dry-run publication path supplies destination preflight;
its adapter has no multi-file transaction, so split requires explicit partial mode.

`npm test --workspace=pptx` passed 897 tests in 31 files. The first full run caught
an original Strict test fixture calling unsupported Strict creation; the fixture
was corrected without expanding creation support. Final type checking caught an
unsupported content-type limit field; the fix explicitly validates and reserves
the XML parse work using supported parser arguments. After that correction, 87
focused domain/reader tests and 20 command tests passed.

Final `npm run lint --workspace=pptx` passed source ESLint and both source/test
TypeScript checks. `npm run build:workspaces -- --workspace=pptx` passed the selected
three-workspace build closure. Final focused shell acceptance passed 64 tests:
`node --import tsx --test --test-concurrency=1 packages/safe-bash/tests/commands/pptx/create.test.ts packages/safe-bash/tests/commands/pptx/selectors.test.ts`.
Guarded root `npm run lint:eslint` completed all 11,878 configured inputs with
zero errors/warnings and 25 validated receipts. No full pipeline was executed.

Final corpus rerun reproduced the same four safe rejections. Merge diagnostics
now explicitly name both text and line-break defaults; split diagnostics remain
unchanged. No corpus bytes or output packages will be committed.

## Local delivery

Final review found no whitespace errors or reference-project identities in the
owned product files. Supplemental research preserves 434 unit variants, 113 BDD
examples and 484 public API rows with exact canonical pointers; all provenance
input hashes matched. Adjacent model APIs remain explicit obligations, not
completed by graph preservation. Existing standalone legal notices remain intact.

Stage only the 15 named owned implementation/test/research/usage/procedure files
for one atomic merge/split
feature commit on main. The local hash is reported in chat and Git history.
Unrelated dirty files, ignored QA artifacts and README files remain untouched.
No push, remote-main delivery or release was attempted.
