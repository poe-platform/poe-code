# Gnumeric main CLI grammar verification

Implemented the main option parser in `packages/ssconvert/src/cli/parser.ts`.
The SDK exports the same byte/string argument API used by the opt-in Safe Bash
command named exactly `ssconvert`. The command uses the existing injected engine,
byte filesystem/sinks and cancellation; no native subprocess or fallback was
added. README files, root package/export wiring and unrelated edits were preserved.
No commits, pushes, publications or releases were performed.

The executed procedure is
`docs/plans/ssconvert-glib-cli-parser-qa.md`. The supplementary captured
dependency/plugin/locale contract is `glib-cli-parser-profile.json`; the prior
full reference contract remains `reference-profile.json`.

## Authenticated oracle and measured profile

- Official Gnumeric 1.12.61 archive SHA-256:
  `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
  Primary source was acquired/extracted exclusively in task-owned out scratch.
- Authenticated goffice 0.10.61 archive SHA-256:
  `558597fd9ca59b93ff562750218d1e7ea8ec3c8d0ed6a5cc096aa715ef909a15`.
- Unchanged native binary SHA-256:
  `8a9a0ef179cc97f9588c8f54173f0d29a265277246f1d89b0eabc0be7e28ff57`,
  identical to the previously captured fresh primary oracle.
- Separate Debian aarch64 QA container: GLib 2.84.4, GTK 3.24.49,
  goffice 0.10.61, libgsf 1.14.53; C locale, UTC, explicit HOME/XDG roots,
  memory GSettings and explicit library/schema paths. The supplementary profile
  retains 465 installed package versions, 72 linked-library identities and
  38 installed Gnumeric plugin-manifest identities.
- Native version/help/image-format bytes agree with the prior fresh capture.
  Paradox is absent from this supplementary build: both service lists lack
  `Gnumeric_paradox:paradox`. This profile difference is not a format pass.
  Bootstrap configure failures for missing bison, required goffice 0.10.61,
  itstool and xmllint were resolved by installing QA dependencies/building the
  authenticated release, without modifying upstream source.

## Verified parser behavior

All requested main entries are represented: version; verbose; import encoding
and type; importer list; merge target; export type/options; exporter list;
per-sheet/graph export; image-format list; repeated set; recalc; hidden resize,
clipboard, range, repeated goal-seek, solve and repeated tool-test.

Short options use GLib clusters and consume separate argv slots. Attached values
are not conventional getopt values: `-Ifoo value` is unknown, `-Ifoo` without a
following slot first fails with `Missing argument for -I`, and `-IT value` fails
with `Error parsing option -T`. Long values accept equals or separate slots,
including option-looking values and empty strings. Attached boolean values are
ignored, even `=false`; separate boolean values remain operands. Short/long
namespaces are distinct and abbreviated long options are rejected.

Options may occur among operands. Scalar duplicates retain the last value;
arrays retain every value in order; flags remain enabled. Empty merge/clipboard/
range values retain presence. GLib retains the `--` separator if a subsequent
remaining argument starts with `-`, which can change ssconvert's operand count.
Help exits during parsing; preceding errors win. Parser errors precede version,
which precedes the explicit split/merge conflict; lists then take exporter,
importer, image precedence, followed by clipboard, merge and normal conversion.
Graph export does not create an explicit split/merge conflict by itself.

Argument parsing uses owned bytes. C-profile string-option values reject
non-ASCII bytes with native conversion diagnostics; UTF-8 option decoding is an
explicit profile choice. Positional BOMs are retained. Unknown-option diagnostics
match GLib's C print channel, including Unicode replacement and `[Invalid UTF-8]`
byte escapes. Distinct invalid filename bytes retain distinct parser provenance.
They are never resolved through replacement display text.

Normal grammar accepts one or two operands; merge requires at least two inputs.
One-input conversion requires an explicit exporter with an extension and without
per-sheet export. Native original fixtures verified `original.txt` ->
`original.csv`, and the less convenient dotless `original` -> `originalcsv`.
The shared command performs that inference from engine service metadata and emits
the native missing-output/unknown-exporter diagnostics. A memfs regression checks
inference can overwrite the input when its extension already matches.

## Checks and independent stress

- TDD: seven initial grammar failures before the first repair; separate failing
  cases for byte parsing, inference and replacement-filename aliasing. A different
  agent independently reproduced/repaired retained separators and diagnostic
  rendering with failing tests before implementation.
- Actual native matrix: 644 cases, 641 exact terminal-result matches and zero
  terminal mismatches in both source and final rebuilt public SDK. Three cases
  reached conversion and were excluded from the terminal pass count. The only
  substitution was native argv0 -> `ssconvert` in help and parser-error hints.
  An initial help comparison using an unmapped profile was corrected; no output
  spelling, whitespace, timestamps or arbitrary paths were normalized.
- Native dispatch controls measured list precedence, empty clipboard/range,
  explicit conflict, scalar last-wins, one/two-input merge grammar and inferred
  destination namespace effects. Native two-input merge succeeded; product
  merge remains unsupported and is not counted as product parity.
- Passed maintained uncached domain build and selected Safe Bash build closure,
  including its maintained postbuild. A final domain rebuild followed the
  independent diagnostic repair; stale earlier declarations/runtime were not
  used for the final public differential.
- Passed `npm test --workspace=@poe-code/ssconvert -- --no-cache`:
  185 cases in 14 files, no skips/TODOs/failures. Passed domain maintained lint
  including source/test TypeScript checks. Passed maintained Node/tsx command
  route with concurrency one: all nine Safe Bash ssconvert cases.
- Passed strict NodeNext built public consumer compilation, built SDK/virtual
  command byte-argv controls and original pre-abort reason identity without sink
  effects. Existing domain ownership, limits and producer-buffer tests also pass;
  this is not a new host-isolation or checkpoint/replay guarantee.
- Ad hoc maintained screenshot tool captured actual built virtual-command
  unknown-option, cluster-value and empty-target conflict diagnostics. Viewed the
  image: command/error order and both hint lines were readable and intact.
  No screenshot tests or unrelated root CLI subcommands were added.
- Passed whitespace validation and guarded repository `npm run lint:eslint`:
  complete, exit 0, 16,503 configured subjects linted, zero errors and four
  warnings. The warnings remain warnings; they were not suppressed or reclassified.

## Remaining mismatches and unmeasured behavior

The broader maintained Safe Bash typecheck exited 2 before compiling consumers:
`Public SafeFS must preserve shared SafeJS runtime identity`, expected
`./packages/safe-js/dist/safe-fs.js`, actual undefined. No assertions were weakened
and no unrelated public export was changed. Focused strict public compilation is
a separate pass and does not complete that broader gate. Full root unit/build
routes were not rerun for this selected parser/integration change.

This task qualifies main grammar, not the existing unsupported conversion modes.
Image-format execution/listing, clipboard, merge, graph and per-sheet execution,
verbose execution, raw set/goal-seek/tool-test operations and resize/range execution
remain unsupported by the existing command/engine routes. Accepted syntax and
selected action are not successful operation passes. Recalc/solve execution still
requires explicitly injected capabilities. Actual non-UTF-8 resource filenames
remain unsupported by the string filesystem contract; the command fails before
filesystem effects instead of aliasing a replacement-character path. Native can
operate on those filenames, so this is an explicit runtime mismatch.

Help/version output requires the existing explicit captured command profile.
Inherited GLib/libspreadsheet/GTK options and help-group/all-help output are not
qualified here; `--help-all` currently uses the supplied main help text and is a
known mismatch with native group output. Locale profiles beyond measured C and
the independent UTF-8 decoding/print controls are not full locale passes.
Native URI canonicalization/error paths, arbitrary URI/escaped-name inference,
exporters without extensions, all combinations of unsupported transforms and
format conversion fidelity remain unmeasured or unsupported. The three withheld
matrix cases are `- --`, `-- -`, and `-- --version`; conversion URI diagnostics
are not counted as parser terminal matches. No claim of full ssconvert parity,
all-input equivalence, all plugin coverage or release delivery is made.

## Current graph-dispatch follow-up

This follow-up preserves the earlier evidence above; its native matrix was not
rerun. Base HEAD is `b97c4938a469ee70e09bd08a0e5fcf7e868ca04c`, with existing
uncommitted edits preserved. Exact candidate SHA-256 values:

- `src/cli/parser.ts`: `3316139f8fc400a783773e9f29afa8996f5e1d20ae284603d33dc468e79e04f4`
- `src/cli.ts`: `d293d85de9446bc84e79ed6a43a2653be7daed2e553aa8499798a0b28a567305`

Fresh official source acquisition into task-owned out scratch verified the required
archive digest. Gnumeric main lines 1639–1652 and 1686–1688 validate the repaired
gap: graphs derive per-sheet splitting after the explicit conflict and dispatch
through normal conversion. A concrete added regression failed before repair
(one failure, 41 passes), then passed. The shared command continues to reject
unsupported graph execution before acquiring file I/O; merge/list precedence is
preserved. No native product dependency, alias, prompt or output mode was added.

Current passes: maintained uncached domain and Safe Bash build closures, including
postbuild; final uncached domain tests (190 tests, 14 files, no skips); domain lint
and source/test TypeScript checks; existing Safe Bash command tests (nine passes,
no skips); adapter/test ESLint; built public SDK and virtual-command manual QA;
cross-realm bytes, original pre-abort reason, no file acquisition or namespace
effects; screenshot capture and visual inspection. Independent agent stress added
120 complete action permutations with version/conflict negative controls, locale
and boolean byte controls, cluster help/error ordering, memfs graph rejection,
listing override and cancellation identity. No additional mismatch was validated.
These are deterministic semantic checks, not performance qualifications.

Fresh native differential and dependency/plugin/locale recapture are unverified:
Docker is installed but its daemon socket is unavailable. Historical captured
profile remains unchanged; source inspection does not count as native runtime
parity. Existing unsupported operations and help-group mismatches listed above
remain. Full repository test/build/lint and broader Safe Bash typecheck were not
rerun for this focused change; no checkpoint/replay or new host-isolation guarantee
is claimed. No current executed gate failed or timed out after repair. The initial
regression failure is TDD evidence, not a passing gate. Task-owned downloads, logs,
manual QA host and screenshot were purged after inspection. No README edits,
commits, remote-main delivery, pushes, publications or releases were performed.
