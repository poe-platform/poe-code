# ssconvert compatibility reference

Target: released Gnumeric **1.12.61**, official source archive SHA-256
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
This document freezes reference behavior for the TypeScript ESM engine in
`packages/ssconvert` and its opt-in Safe Bash virtual command. Source declarations
are requirements, not product passes. Current qualification and delivery gates
are recorded in `docs/ssconvert/final-coverage-and-delivery.json`; historical
pre-implementation dispositions below are retained for provenance. Complete
Gnumeric parity remains blocked, including full record semantics and optional
profiles.

Primary source:
<https://download.gnome.org/sources/gnumeric/1.12/gnumeric-1.12.61.tar.xz>.
All line citations below refer to that authenticated archive, not an unpinned
upstream branch. Native observations and the source-plugin register belong in
`docs/ssconvert/reference-profile.json`. Reproduction and manual qualification
steps belong in `docs/plans/ssconvert-reference-qa.md`.

## Initial measured primary profile

The fresh qualification section below supersedes the unmeasured runtime scope
in this initial preparation. Earlier observations are retained for provenance.

An isolated Debian trixie aarch64 container built the authenticated release with
GOffice 0.10.61, GLib 2.84.4, GTK/GDK 3.24.49, libgsf 1.14.53, Pango 1.56.3 and
Cairo 1.18.4. Locale is `C`, timezone is `UTC`, settings use explicit schema/data
paths and the memory backend. The profile retains the image digest, complete
installed package versions, binary/linked-library/font hashes, compile settings,
raw observations and source manifests. Initial observations with missing schema
initialization are retained separately as unqualified evidence.

There are 69 captured CLI invocations, 47 source Gnumeric plugin manifests,
41 installed and activated Gnumeric plugins and nine activated GOffice plugins.
GLPK, LPSolve and Nlsolve report functional availability; solution accuracy is
unmeasured. GTK reports 182 paper sizes. All 26 listed exporters returned status 0
for one original CSV input; 25 wrote nonempty files. Paradox wrote an empty file
and warned about missing field specifications (`plugins/paradox/paradox.c:348`),
so that format's smoke is unqualified. Automatic reimport of the resulting
`.bin` paths failed for the Paradox and PDF outputs. Those failures concern the
exact captured paths and probes; they do not establish unsupported whole formats.
Other imports, record fidelity and graph rendering remain unmeasured.

Observed CLI details include:

- `--usage`, `--help-gdk`, `--gtk-help` and `--gdk-help` return 1 for unknown
  options. `--help`, `-h`, `--help-all`, `--help-gtk` and
  `--help-libspreadsheet` return 0 and print to stdout.
- `--libspreadsheet-version` is accepted and prints `gnumeric version`.
- `--help --unknown` exits successfully during help processing, while
  `--unknown --help` reports the preceding unknown option. Main
  `--version --unknown` reports the parser error.
- GTK-qualified class/name/display/module/fatal-warning aliases and
  libspreadsheet-qualified library/data directory aliases are accepted in the
  measured version probes. GDK-qualified class/display aliases are rejected.
- GTK/GDK debug and no-debug flags, `--sync` and `--screen` are rejected by this
  dependency build. Debug flags remain in the dependency source register because
  they are conditional on `G_ENABLE_DEBUG`.
- Attached `-L/virtual/lib` and `-D/virtual/data` are rejected. Long directory
  options and the captured qualified long aliases succeed with version output.
- Loading a missing GTK module before `--version` prints a timestamped GTK
  message but returns 0. Repeated captures retain the differing message bytes;
  no blanket diagnostic normalization is applied.

Default native datadir/libdir paths have explicit proposed virtual mappings in
the profile. They do not establish an implemented VFS tree. Module loading and
custom directories still require explicit trusted host capability mappings.

The optional Psiconv attempt built the author's Psiconv 0.9.9 library with
`-fcommon` after preserving its original multiple-definition linker failure.
Gnumeric's unchanged released Psiconv plugin then failed to compile:
`plugins/psiconv/psiconv-read.c:323` and `:397` call undeclared `p_cellref_init`.
The profile retains the source hash, configure arguments and compiler output.
No source patch or alias macro was applied; no optional runtime was qualified.

## Main option contract from source

`src/ssconvert.c:98–246` declares the following entries. Hidden entries are
accepted parser inputs even though normal help omits them. Runtime probing is
required for GLib parsing details, inherited groups and compiled availability.

| Long option           | Short | Argument         | Hidden |
| --------------------- | ----- | ---------------- | ------ |
| version               | —     | none             | no     |
| verbose               | v     | none             | no     |
| import-encoding       | E     | string, ENCODING | no     |
| import-type           | I     | string, ID       | no     |
| list-importers        | —     | none             | no     |
| merge-to              | M     | string, file     | no     |
| export-type           | T     | string, ID       | no     |
| export-options        | O     | string, string   | no     |
| list-exporters        | —     | none             | no     |
| export-file-per-sheet | S     | none             | no     |
| export-graphs         | —     | none             | no     |
| list-image-formats    | —     | none             | no     |
| set                   | —     | string array     | no     |
| recalc                | —     | none             | no     |
| resize                | —     | string           | yes    |
| clipboard             | —     | string           | yes    |
| export-range          | —     | string           | yes    |
| goal-seek             | —     | string array     | yes    |
| solve                 | —     | none             | yes    |
| tool-test             | —     | string array     | yes    |

`--export-options` is a scalar in this version. Repeated occurrences must match
the measured GLib scalar behavior; ordered repetition in a future typed SDK must
not silently imply that native CLI occurrences accumulate.

`src/libgnumeric.c:133–197` adds the `libspreadsheet` group with `version` (`v`),
`lib-dir` (`L`, filename) and `data-dir` (`D`, filename). Its post-parse version
callback prints `gnumeric version`, directory lines and exits. The main group
also declares `version`; qualified aliases and short-option collisions need
independent observations. GTK is added through `gtk_get_option_group(FALSE)`;
inherited GTK/GDK options are a separate dependency-specific contract. Do not
invent aliases from group names.

## Control flow, channels and filesystem boundaries

`src/ssconvert.c:1609–1703` establishes the following source ordering:

1. Pre-parse initialization, nonpersistent configuration and GLib parsing with
   the main, libspreadsheet and GTK groups. Help and group callbacks can exit
   during parsing, before the subsequent main action selection.
2. Parse errors print the error and the suggestion to run `--help` to stderr,
   then return status 1.
3. Main `--version` prints version, datadir and libdir to stdout and returns 0.
4. Explicit `-S` with `--merge-to` prints their incompatibility to stderr and
   returns 1. Graph mode enables per-object export after this conflict check.
5. Initialize the engine and attempt activation of every available plugin.
   Main frees activation errors without displaying them; a clean command
   diagnostic stream therefore does not prove that every plugin activated.
6. Choose exporters listing, importers listing, image listing, clipboard,
   merge or normal conversion, in that order.
7. Clipboard requires exactly two operands and a nonempty range option. Merge
   requires at least two input operands. Normal conversion accepts one or two
   operands. Otherwise print usage to stderr and return 1.

`src/ssconvert.c:392–437` sorts file services by ID, omits interactive-only
services and prints a width-aligned `ID | Description` table to **stderr**.
`src/ssconvert.c:439–461` prints the image-format table to stderr, iterating
GOffice's image-format enum. A listed image format is not necessarily a usable
graph renderer. Listings require activated services; source declarations alone
do not predict a reference binary's list.

`src/stf.c:580–637` registers a noninteractive CSV/TSV opener, an interactive-only
configurable text opener, a noninteractive configurable text saver and a CSV
saver. The CSV saver has sheet scope and sheet-selection support. XML and PDF
services are registered by core source rather than plugin manifests; their
register rows must be added explicitly and must not disappear from the census.

Native deployment paths must be mapped explicitly to future virtual reference
paths. The product must use supplied VFS/byte capabilities, with no native
fallback, ambient host access or automatically discovered native plugins.
Reference executable paths in observations are provenance, not product APIs.

## Coverage and unresolved gates

The source-plugin inventory records declarations separately from installation,
activation and actual conversion. `plugins/Makefile.am:1–44` supplies default
families and optional Psiconv, Paradox, GDA, GNOME DB, Python and Perl conditions.
Arbitrary third-party plugins remain an extension contract; they are not a
finite source-release baseline.

The first task remains incomplete until its runtime measurements, all inherited
and hidden option behavior, directory mappings and optional file-format profiles
are qualified. Unavailable Psiconv or other plugin dependencies must remain
explicit blockers. No task is complete merely because its source was inventoried.

The later audit must reconcile every source service, built-in/function descriptor,
analysis property, format/version/record and upstream test/sample with an original
regression, independent QA case or unresolved blocker. A small workbook smoke
conversion only establishes that that path ran; it does not establish whole-format
fidelity, calculation correctness or JavaScript product parity.

No GPL implementation translation or dependency adoption is authorized by this
source audit. Product licensing and reuse decisions remain separate gates.

## Verification of this preparation

Fresh JSON decoding and byte-hash verification passed for 273 retained capture
and fixture entries. The source register was compared against all 47 authenticated
Gnumeric plugin manifests; 23 Gnumeric option declarations were bound to source
hashes. All ten GOffice plugin manifests were retained, including its unactivated
source entry. Exporter effects were checked separately from statuses, preserving
the empty Paradox output as unqualified. Repository Prettier checks passed for
the three owned documents. These are preparation checks, not product unit,
differential, build, interoperability or rendering gates.

## Fresh qualification, 2026-09-19

This section updates the initial preparation above. Earlier observations are
preserved as historical evidence; `requalification` in the profile contains the
fresh observations and the additional measured scope. The overall freeze remains
**incomplete**, principally because an unchanged Psiconv reference cannot compile
and some explicit importer fixtures remain unmeasured. These gaps do not reduce
the requested feature scope.

The product target is a JavaScript implementation named exactly `ssconvert`,
authored as TypeScript ESM in `packages/ssconvert`, with a virtual command exposed
by `packages/safe-bash`. This research introduces no implementation or product
dependency. Native ssconvert and the native inventory/fixture helpers are separate
QA oracles. Product execution must preserve invocation budgets, host isolation,
realm ownership and replay invariants through the existing virtual-command
capabilities. CLI behavior and SDK options must remain in parity, with the CLI
using the SDK. Those are requested architecture constraints, not observations
about Gnumeric's architecture.

### Installation and provenance

A fresh container used the same recorded Debian image digest and authenticated
Gnumeric/GOffice archives. Both source releases were built without source patches,
with the recorded prefix and configure arguments; this run used `make -j4`.
`requalification.compileFlags` records actual generated Makefile compiler/linker
settings. Its final native executable SHA-256 is again
`8a9a0ef179cc97f9588c8f54173f0d29a265277246f1d89b0eabc0be7e28ff57`.
The recorded upstream dependency versions agree with the initial profile.

The fresh profile retains OS/kernel/compiler observations, all installed package
versions and repository archive identities, linked-library hashes, font hashes,
locale output, timezone and a complete explicit runtime environment. Environment
construction excludes ambient display and desktop-session variables. HOME and
XDG roots are initially empty, task-owned QA paths; GSettings uses its memory
backend and the compiled schemas. `runtime-inventory` observes activated plugin
IDs, solver factory availability and paper dimensions; its source is retained in
the profile. Functional availability does not establish solver accuracy.

Debian source packages match installed GLib `2.84.4-3~deb13u5` and GTK
`3.24.49-3`. Their source descriptors, archive hashes, packaging rules and patch
manifests are retained under `requalification.debianDependencySource`. Patched
`glib/goption.c` and `gdk/gdk.c` are byte-identical to the authenticated upstream
files. GTK's `gtkmain.c` changes concern offscreen widget/device grab guards,
outside option declaration and parsing code. This qualifies the cited parser
source for this installation; it is not an audit of every dependency behavior.

Exact base-image, source and dependency archive identities define reproduction
inputs. A reproduction must reject version/hash drift rather than silently follow
current apt defaults. Public mirror retention is external state. Timestamped
messages and generated PDF/ZIP metadata are not asserted byte-reproducible.

### Exact CLI bytes and parser behavior

The authoritative output contract is the reversible base64 data, byte lengths and
SHA-256 values in the JSON observations. Each invocation records argv, status,
stdout and stderr independently. Do not trim output, transcode it, rewrap its
tables, repair its spelling or combine channels. In locale `C`, the measured help
usage line is `  ssconvert [OPTION?] INFILE [OUTFILE]`; the no-operand diagnostic
is `Usage: ssconvert [OPTION...] INFILE [OUTFILE]` on stderr. The differing spelling
is observed output, not an editorial correction. Required version/help/listing
captures are in both the original observations and the fresh profile.

There are 152 fresh CLI probes and 69 systematic group-alias probes. All original
69 CLI probes reproduced their exit statuses; only the two missing-GTK-module
captures differed in diagnostic bytes. Their original and fresh bytes remain
intact. Additional operation, importer, graph and clipboard observations are
separate registers, not inflated into that CLI-case count.

GLib `glib/goption.c:1118–1196`, `:1364–1539` and `:1855–2040` explain the measured
parser behavior:

- Long option names require exact spelling; `--ver` is rejected. `--` ends
  parsing. Short flags can cluster, but a valued short option consumes a
  subsequent argv element. Attached `-Ifoo`, `-L/virtual/lib` and
  `-D/virtual/data` are rejected in the captured invocations.
- Scalar strings replace earlier occurrences. An invalid first
  `--export-options` followed by `separator=;` succeeds and emits semicolon CSV;
  reversing the order reports the final invalid option and returns 1.
  Repeated `--set` entries accumulate in order; two updates to A2 write the
  second value. `--tool-test` and `--goal-seek` are also string arrays.
- A value attached to a no-argument option is accepted in measured probes:
  `--version=1` and `--verbose=0` return version output. A zero value is not
  evidence that the boolean becomes false.
- Main entries precede the libspreadsheet and GTK entries. `-v` selects verbose
  conversion, not the library version action. Qualified library version exits
  in its post-parse callback, after parser validation, before main version and
  action dispatch. Both orderings of main/library version flags print
  `gnumeric version`.
- Help exits while parsing. Earlier unknown options win; later unknown options
  are not reached after successful help. Help group names require exact names:
  `--help-l`, `--help-gt`, `--help-main` and `--help=gtk` are rejected.
- Qualified option groups have a distinct prefix rule: every nonempty prefix
  of `libspreadsheet` and `gtk` was probed for every declared group entry.
  `--l-version`, `--lib-version`, `--g-display` and `--gt-name` are accepted;
  overlong `--libspreadsheetx-version` and `--gtkx-name` are rejected.
  This rule does not abbreviate the option name after the group prefix.

The GLib-generated help inputs are `-h`, `-?`, `--help`, `--help-all`,
`--help-libspreadsheet` and `--help-gtk`. There is no registered GDK help group.
`--help-gdk`, `--gtk-help`, `--gdk-help` and the directly probed `--usage` all
return 1 with unknown-option diagnostics. A manpage mention does not override
these observations.

The inherited declaration register covers all three libspreadsheet entries and
all nine GTK/GDK source entries, including conditional entries:

| Group                | Entry                   | Primary binary behavior                                                |
| -------------------- | ----------------------- | ---------------------------------------------------------------------- |
| libspreadsheet       | version (`v`)           | Qualified version accepted; main `v` wins unqualified collision        |
| libspreadsheet       | lib-dir (`L`)           | Accepted; no measured directory effect                                 |
| libspreadsheet       | data-dir (`D`)          | Accepted; no measured directory effect                                 |
| gtk, declared by GDK | class                   | Accepted, including gtk-qualified aliases                              |
| gtk, declared by GDK | name                    | Accepted, including gtk-qualified aliases                              |
| gtk, declared by GDK | display                 | Accepted; version probes do not establish display connectivity         |
| gtk                  | gtk-module              | Accepted; missing module emits a diagnostic and returns 0 with version |
| gtk                  | g-fatal-warnings        | Accepted; version probe only                                           |
| gtk                  | gtk-debug, gtk-no-debug | Conditional source entries; rejected in this build                     |
| gtk, declared by GDK | gdk-debug, gdk-no-debug | Conditional source entries; rejected in this build                     |

GTK/GDK source citations are `gtk/gtkmain.c:460–477` and `gdk/gdk.c:226–245`.
GDK's entries are added to the **gtk** group, so GDK-qualified aliases are rejected.
`--sync` and `--screen` are also rejected. Alternate dependency builds must retain
separate profiles; conditional entries remain in the full source scope.

### Directory options and virtual reference mapping

`src/libgnumeric.c:130–155` stores `--lib-dir` and `--data-dir` in static variables
that have no other reads in that released translation unit. Fresh version probes
with short, long, qualified, repeated and empty directory values retain the
compiled default paths. Attempts to isolate plugins through those flags retained
all primary plugins. These failed isolation attempts are preserved under
`requalification.unqualifiedDirectoryProfiles`, explicitly disqualified as
optional-plugin evidence. The accepted flags must not be specified as effective
path overrides for this release.

`src/gutils.c:116–140` initializes native system/user paths; plugin discovery uses
`src/gnm-plugin.c:1012–1034`. System, external, user, configured extra and
`GNUMERIC_PLUGIN_PATH` directories are native reference concerns. They do not grant
ambient filesystem access to the virtual command. Default datadir/libdir output
uses the explicit mappings in `runtime.virtualReferenceMapping`. Diagnostic argv
references map the recorded native executable to virtual argv[0] `ssconvert`;
fixture/evidence paths map to invocation-owned VFS paths. Any further translation
must enumerate its mapping rather than apply blanket diagnostic normalization.
Missing module timestamps/process IDs remain raw evidence; deterministic virtual
diagnostics require an explicitly specified replay policy in the implementation
contract. No host module loading or native executable fallback is implied.

### Hidden options and diagnostic observations

All six hidden main options remain in the source/CLI contract. Fresh operation
probes establish the following limited examples:

| Option       | Observed operation                                                                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| resize       | Malformed `bad` silently leaves the smoke unchanged and returns 0; `65536x256` prints the verbose resize message and a GLib critical, returning 0         |
| clipboard    | Plain `text/plain` and an unknown MIME name fail; `text/plain;charset=utf-8`, `UTF8_STRING`, `text/html` and `application/x-gnumeric` succeed for A1:A3   |
| export-range | A1:B2 restricts CSV output; invalid `bad` reports an invalid range and returns 1                                                                          |
| goal-seek    | Two five-cell horizontal ranges solve independent original `=B1*2` / `=B2*3` examples, yielding X values 5 / 4 and returning 0; invalid range returns 1   |
| solve        | An unconfigured CSV reports `Solver: Invalid solver target` but returns 0; the authenticated `samples/solver/afiro.mps` invocation returns 0              |
| tool-test    | Moving-average with repeated data/interval arguments succeeds; unknown tool and an argument without a colon produce the captured diagnostics and return 1 |

The hidden goal-seek range means formula cell, variable cell, target, lower bound,
upper bound (`src/dialogs/dialog-goal-seek.c:427–489`). Tool-test's first repeated
value names the tool; subsequent values are `key:value` arguments
(`src/ssconvert.c:890–1040`). These cases establish executed paths, not exhaustive
analysis-tool or solver correctness. Nlsolve's source describes a Rosenbrock method
with tentative Newton steps (`plugins/nlsolve/gnm-nlsolve.c:1–38`); GLPK and LPSolve
use the captured external reference programs. All three solver factories report
functional availability in the primary profile.

Unknown importer/exporter IDs and invalid exporter options have captured stderr
and status-1 results. A later `-T` replaces an earlier `--export-type`, as the scalar
rule predicts. Per-sheet writing to `fd://1` attempts `fd://1.0` and reports its
unsupported operation. Combining graph export with merge takes the source action
path and the exact operand error captured by that probe; it does not establish
successful combined export. Native diagnostics with status 0 must not be
silently rewritten into status 1 in the reference contract.

### Format usability and optional profiles

The fresh primary binary lists 19 importers and 26 exporters. Ten importers
succeeded with explicitly selected fixtures/importer IDs: Excel, encoded Excel,
XLSX, OpenDocument, Gnumeric XML, DIF, HTML, SYLK, MPS and CSV/TSV. Paradox failed
with the independently checked pxlib fixture. Excel XML, QPro, Applix, Lotus,
Oleo, Plan Perfect, SC and Xbase remain unmeasured with explicit valid fixtures.
`requalification.formatUsability` records every listed ID, including those gaps.
The generated exporter fixtures establish single-path usability only; shared
writer/reader behavior is not independent whole-format fidelity evidence.

All 26 exporters returned 0 for the fresh ordinary CSV smoke; 25 outputs were
nonempty. Paradox's field-declaration fixture also returned 0 with an empty file
and a diagnostic. Its independent pxlib fixture was generated using pxlib 0.6.9,
reopened with pxlib and checked for two fields, two rows and the first `alpha,2`
record; ssconvert rejected its header. The fixture, generator source and check
output are retained. No whole-format failure claim or source repair follows from
those observations.

Eight listed graph formats were exercised against the authenticated upstream
`samples/graph-tests.gnumeric`, whose bytes/hash are retained. SVG, PNG, JPEG,
PDF, PS and EPS each produced 77 nonempty files and returned 0. EMF and WMF each
returned 1 with an unsupported-format warning and three empty outputs. Output
paths, lengths and hashes are retained. One native PNG was visually inspected;
this establishes visible axes/markers/line for that image only, not pixel fidelity
or JavaScript compatibility.

`plugins/Makefile.am:13–18` identifies the two optional file-format families:
Paradox and Psiconv. The additional profiles cover both without removing either
from the requested scope:

- `gnumeric-1.12.61-core-without-file-plugins` uses the same unchanged binary with
  the owned installation's Gnumeric plugin directory temporarily emptied. Only
  the nine GOffice plugins activate; core XML/text/PDF services remain listed.
  Explicit Paradox requests report unknown services.
- `gnumeric-1.12.61-paradox-only` copies back only the unchanged installed Paradox
  files. The nine GOffice plugins and `Gnumeric_paradox` activate without
  activation errors. Paradox's importer/exporter become listed, but the observed
  empty export/failing imports leave conversion usability unqualified. Primary
  plugin files were restored after capture.
- `gnumeric-1.12.61-psiconv-fresh-attempt` independently rebuilt Psiconv 0.9.9 with
  `-fcommon` and configured Gnumeric with `--enable-plugins=psiconv`. Compilation
  returned 2 for undeclared `p_cellref_init` in the unchanged release. This is an
  additional reproducible **failed-build profile**, not a successful native
  oracle. Qualifying optional Psiconv runtime remains a gate.

The complete 47-manifest Gnumeric and ten-manifest GOffice source registers remain
intact, including unavailable GDA/GNOME DB/Python families, interactive services,
function groups and optional graph/component engines. Each Gnumeric row now links
source/service coverage to measured availability without inferring conversion
usability from activation. Third-party plugin extensions and all unmeasured
source services remain explicitly outside established observations, within the
requested full implementation scope where applicable.

### Verification of the fresh qualification

Fresh JSON decoding and SHA-256/length checks passed for 1,208 retained encoded
evidence records. Both authenticated plugin inventories match exactly (47
Gnumeric, ten GOffice), all 23 Gnumeric option declarations match source, and
the fresh inventory reproduces all 50 activated IDs. Exact repository archive
identities were found for all 539 installed package versions. The expanded CLI,
optional-profile, importer, exporter and graph captures are retained separately.
Formatting checks cover the three edited documents. These checks qualify the
retained research evidence; the overall freeze remains incomplete and no product
compatibility, unit-test, release or publication claim follows.

## Feature/task/test register audit, 2026-09-19

The authoritative census is [coverage.json](../ssconvert/coverage.json).
It expands this specification with source locations/hashes, task membership,
independent QA procedures and explicit unresolved dispositions. This audit adds
no product implementation, public API, native fallback or dependency. The target
remains **ssconvert**, TypeScript ESM in `packages/ssconvert`, exposed as a virtual
command in `packages/safe-bash`. CLI/SDK parity, invocation budgets, host
isolation, realm ownership and replay invariants remain implementation gates.

The authenticated archive was acquired again into task-owned `out` and its
SHA-256 matched the target. All 47 manifest hashes match the retained reference
profile. No upstream implementation bodies or spreadsheet asset bytes are
copied into the source census. The earlier preparation and requalification
sections remain historical evidence; this section supplies the feature-register
work. It does not resolve the earlier optional-reference or full-fidelity gates.

### Reading the register

A source declaration, installed plugin, activated service, noninteractive
eligibility, observed conversion and implemented JavaScript feature are separate
facts. `sourceFiles` binds all audited source-unit locators to archive hashes;
every contained internal function inherits that unit's task/case/disposition.
`dispatchCases` retains every explicit lexical case, including branches that are
not file records. `xmlDispatchNodes` retains parent/name/namespace/content mode,
sharing/namespace flags and start/end handlers, including NULL handlers.
Neither register establishes supported records or preservation automatically.
The scanner parses balanced tokens and XML; it does not preprocess/typecheck C
or prove macro-expanded dispatch closure. Unreviewed attributes, nested handlers,
writer effects and format/version fidelity remain named semantic blockers.

`formats` records reviewed versions, handled/rejected/ignored/lost behaviors,
limits and warnings with citations. Null limits or empty reviewed-record lists
mean unresolved evidence, never unlimited size or whole-format support.
`cliOptionDescriptors` retains all 32 short/long names, flags, argument modes,
storage/callback symbols and source help labels; `parserGeneratedOptions` retains
help/group-alias grammar independently. `manifestFunctions` and
`functionDescriptors` reconcile declarations separately
from registration. `properties` retains declared type/default/range/flags;
`analysisTools` also retains native ownership/default/enum-name/nick observations.
`upstreamTests`, `upstreamTestSupport`, `upstreamSamplesAndTemplates`,
`upstreamFixtureReferences` and `upstreamInternalFamilies` assign every censused
artifact/selector an independent case or explicit blocker. `taskCoverage` binds
all 64 existing pipeline tasks to register membership or later gates.

The nine manual procedures are in
[ssconvert-audit-qa.md](../plans/ssconvert-audit-qa.md).
A specified independent case is not an executed regression. Three original
native QA cases are reduced into `executedIndependentQACases`: text-option
rejection/controls, writable-property metadata and output-version headers.
They establish their measured native scope only. Every product entry remains
unimplemented; statistical accuracy, full record fidelity and original product
regression execution remain unresolved. No product tests were added or changed.

| Census                                                                   | Entries |
| ------------------------------------------------------------------------ | ------: |
| Source plugin manifests                                                  |      47 |
| File opener declarations, including optional/interactive core entries    |      21 |
| File saver declarations, including optional services                     |      27 |
| Main/library/dependency option declarations                              |      32 |
| Function groups                                                          |      25 |
| Manifest function entries                                                |     651 |
| C function descriptors, including built-ins                              |     653 |
| Accepted analysis CLI constructors                                       |      31 |
| Class-owned analysis writable declarations (excluding solver properties) |     102 |
| Flattened native analysis tool/property observations                     |     154 |
| Audited source units                                                     |     242 |
| Explicit lexical switch cases                                            |    4811 |
| Explicit XML parser node macros                                          |    2130 |
| Upstream test entry files                                                |     204 |
| Upstream test support files                                              |       9 |
| Distributed samples/templates and additional workbook specimens          |     107 |
| Resolved candidate sample reference paths                                |     111 |
| Referenced candidate paths absent from the authenticated archive         |      50 |
| Unresolved dynamic fixture expressions                                   |       1 |
| Reviewed format families                                                 |      22 |

The 6,203 internal source function locators are implementation/dependency paths,
not that many user functions or separately verified features. Counts above are
archive declarations/files, not runtime supported-format counts or passed tests.

### Required source contracts and task ownership

| Primary source                                                                                          | Reviewed contract / task links                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/ssconvert.c:98–246`, `:290–385`, `:657–803`, `:821–1043`, `:1165–1703`                             | Main/hidden grammar; exporter callback/common-option fallback; save-scope and sheet-selection validation; merge/split/template/update/goal/solver/analysis/resize/recalc/range/clipboard operations; action ordering and errors. Links to parser, lifecycle, selection, numerical and analysis tasks individually in the register. |
| `src/libgnumeric.c:130–197`                                                                             | Library group/version callback and directory no-ops; inherited-help/version task. GTK/GDK/GLib declarations remain dependency-profile-specific in the retained reference profile.                                                                                                                                                  |
| `src/gutils.c:1064–1120`                                                                                | Common `sheet` and `active-sheet` export options; accumulated workbook sheet set and unknown-sheet/invalid-key errors. Export-options/selection tasks.                                                                                                                                                                             |
| `src/workbook-view.c:1396–1462`                                                                         | Opener content/name probe selection. A filename match also needs content matching if the opener can probe content. Provider-registry/lifecycle tasks.                                                                                                                                                                              |
| `src/stf.c:580–637`                                                                                     | Separate CSV/TSV opener, interactive-only text assistant opener, noninteractive configurable text saver and CSV saver. Text import/export tasks.                                                                                                                                                                                   |
| `src/stf-export.c:147–269`, `:543–586`, `:704–765`                                                      | Value/date/format paths, own properties, exporter whitelist and sheet-list reset. Text export/encoding/formatting tasks.                                                                                                                                                                                                           |
| `src/stf-parse.c`                                                                                       | Separated/fixed-width parser and guessing/quoting/boundaries: all source functions/branches retained; complete malformed/overflow/locale behavior remains the text-boundary blocker.                                                                                                                                               |
| `src/xml-sax-read.c:499–608`, `:2472–2631`, `:3218–3448`; `src/xml-sax-write.c:1514–1591`, `:1740–1768` | Historical version map, dimensions, unsupported objects/filters, parser node census, namespace/compression and saver registration. XML-codec task.                                                                                                                                                                                 |
| `src/print-info.c:931–1087`, `src/print.c`                                                              | Workbook/object PDF paths, object/paper/fit/common options and print/layout dependencies. Print/PDF/rendering tasks; layout/screenshots remain separate QA.                                                                                                                                                                        |
| `src/func-builtin.c:489–566`, all function-group manifests/C descriptors/scripts                        | Registration, debug-only/internal built-ins, signatures/evaluators/flags and dynamic entries. Calculation and family-specific function tasks.                                                                                                                                                                                      |
| `src/tools/*.c` / `*.h`, `src/ssconvert.c:821–1043`                                                     | All source analysis writable declarations/inheritance and accepted tool dispatch; separate solver/random/consolidation source paths. Property metadata is measured; setter effects/generated output/accuracy remain separate.                                                                                                      |
| Every source file-service manifest and its directory's C/H implementations                              | Declarative IDs/descriptions/suffix/MIME/priorities/scope/overwrite/selection attributes; version/record/writer/error/diagnostic locators. All format tasks; no extension-based support claims.                                                                                                                                    |

Supplementary pinned GOffice **0.10.61** source supplies the export grammar:
`goffice/utils/go-glib-extras.c:1227–1319` parses whitespace-separated key=value
pairs with quoted/unquoted names/values and handler-owned semantics. Its
`:1050–1130` property converter treats strings, locale/casefold booleans and enum
names/nicks differently from analysis's case-sensitive boolean and atoi/atof
conversion. Source hashes and separate QA links are in `supplementarySourceReview`.

Engine size constants are **16,777,216 rows / 16,384 columns**, defaults
65,536 / 256, minima 128 / 128 (`src/gnumeric.h:10–20`). Both dimensions must
independently be powers of two (`src/sheet.c:1208–1218`). These are not every
file format's limits and are not future host resource budgets.

### Text formulas manual discrepancy: source and runtime confirmed

The **released** `doc/ssconvert.1:288–360` omits `formulas`. The current upstream
master manpage acquired on 2026-09-19 _does_ describe exporting formulas rather
than values when true; its captured SHA-256 is
`eba8d0a25f0e73644dc425aa806e08043b12d8a34401bd4d0e09490f02148747`.
That mutable manual is documentary discrepancy evidence, not the release
baseline. Thus the earlier pipeline prose saying “the manpage documents
formulas=true” needs this version qualification; it is not true of the
authenticated released manpage.

Released `cb_set_export_option` (`src/stf-export.c:704–749`) accepts `eol`,
`charset`, `locale`, `quote`, `separator`, `format`, `transliterate-mode`,
`quoting-mode` and `quoting-on-whitespace`, then delegates to common sheet options.
The fallback (`src/gutils.c:1064–1120`) accepts only `sheet`/`active-sheet` and
rejects other keys. It does not make `formulas` accepted indirectly.

In the separate freshly built unchanged-source audit oracle:

- Configurable text with `formulas=true` **or** `formulas=false`: status **1**,
  zero stdout bytes, stderr exactly
  `ssconvert: Invalid export option "formulas" for format Gnumeric_stf:stf_assistant`
  followed by LF.
- CSV with `formulas=true`: status **1**, zero stdout bytes, same diagnostic
  with `Gnumeric_stf:stf_csv` as the saver ID.
- `format=raw` succeeds; an original `--set=A1==SUM(1,2)` control exports value
  `3`, rather than formula source.
- Analysis `--tool-test=formulas:true` succeeds in the original moving-average
  control. This belongs to the analysis protocol, not text export.

Exact argv/status/base64/length/hash data is retained in `auditOracle`; do not
add the newer documented text option speculatively to a 1.12.61 implementation.

### Per-format versions, records, limits and loss scope

The table summarizes bounded reviewed findings. Each row's `formats` entry
retains service-specific IDs, availability, exact source citations, complete
lexical record/node filters, reviewed records/losses and explicit unknowns.
“Unresolved” preserves required scope and blocks full compatibility completion.

| Family                          | Reviewed released behavior and remaining limits                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gnumeric XML                    | V1–V14 appear in the historical version map; writer emits **v10.dtd** plus separate application Version metadata. Compressed/uncompressed services differ; `.xml` disables compression. Unsupported object/filter diagnostics are explicit. Legacy namespace presence is not full version fidelity.                                                                                                                                          |
| CSV/TSV/configurable/fixed text | Guessing/parser modes, format/date/encoding paths and whitelist retained. `formulas` rejected. RFC 4180 cases are independent expectations; guessing, Unicode, quoting, overflow and defaults require per-case native qualification.                                                                                                                                                                                                         |
| Excel BIFF                      | BOF variant dispatch retained; separate BIFF7/BIFF8/double-stream savers. BIFF7 writer row bound **16,384**, BIFF8 **65,536**, columns **256** (`ms-excel-biff.h:79–81`, `ms-excel-write.c:5783–5815`). Formula/shared/array/string/encryption handlers retained. Ancient worksheet DIMENSIONS is ignored; DDE/OLE names can be lost with warnings. Selected VBA/CompObj/OLE blobs retained does not prove blanket macro fidelity/execution. |
| Excel OOXML                     | Manifest distinguishes ECMA-376 2006 and 2008 saver editions. Both measured outputs use **2006 main** namespace. Probe requires `xl/workbook.xml`; declared `.xlsb` suffix proves no binary decoder. Native read-range constants are **1,048,576 / 16,384**; writer uses actual sheet maxima. ECMA first edition allows extending its default grid with defined-name precedence rules; do not invent an unconditional format cap.            |
| Excel 2003 SpreadsheetML        | Separate XML opener; Workbook/Table/Cell/Data/rich-text node dispatch retained. Primary 2003 schema/version limits remain unresolved.                                                                                                                                                                                                                                                                                                        |
| ODS/SXC                         | Export version comes from **libgsf**, not extension/saver label; both measured ODF outputs are **1.2**. Mimetype first/uncompressed; separate content/styles/meta/settings streams. `with_extension` is distinct from version. Legacy SXC, repetitions, strict/extension and version-dependent fidelity remain unresolved.                                                                                                                   |
| HTML/XHTML                      | Separate HTML3.2/4.0/full/fragment/XHTML/range services and selection/scope attributes. Primary table/span/XHTML syntax reviewed; native styles/nesting/malformed-table behavior is not browser equivalence.                                                                                                                                                                                                                                 |
| LaTeX/TROFF                     | Full/table/table-visible LaTeX and TROFF write-only services are distinct. Complete escaping/style/encoding/grammar limits remain unresolved.                                                                                                                                                                                                                                                                                                |
| GnomeGlossary PO                | Source saver exists in the **WITH_PYTHON** example build; absent from primary installation. Optional runtime/PO grammar and field fidelity unresolved, independently of interactive eligibility.                                                                                                                                                                                                                                             |
| DIF                             | TABLE/DATA and numeric/NA/bool/string paths; TABLE rename FIXME. ERROR/unknown values warn/ignore; excess dimensions warn/drop; EOF errors retained. Original primary specification/record boundaries unresolved.                                                                                                                                                                                                                            |
| SYLK                            | B ignored; C/E/F/P/O/W dispatch; ID/NN have separate paths. Unknown directives/unhandled styles/options and missing E warn; duplicate values/expressions warn. Complete version/options/formula/coordinate/escaping limits unresolved.                                                                                                                                                                                                       |
| Applix                          | Header rejects version below **400** and non-**7BIT** encoding; does not enforce an upper version there. Line length **0–65,535**. Out-of-range contents ignored; 3D array functions unsupported. Full primary version/formula/style limits unresolved.                                                                                                                                                                                      |
| SC/xspread                      | Banner probe; source initial sheet **65,536 / 256**, ISO-8859-1 conversion and SC formula conventions. Revision/command/format limits unresolved.                                                                                                                                                                                                                                                                                            |
| GNU Oleo                        | R1C1 and command/style paths; initial **65,536 / 256**; expressions can exist without cached values; formatting is limited. Primary revision/record fidelity unresolved.                                                                                                                                                                                                                                                                     |
| Lotus/Symphony/Works            | Original123/Symphony/Symphony2 use old parser; V4/V6/V7/SS98 use new. Unexpected Lotus versions warn then use new parser; Works3 selects Works parser, other Works versions fail. Per-version records/LMBCS/limits unresolved.                                                                                                                                                                                                               |
| Quattro Pro                     | Probe words **0x1001/0x1002/0x1006/0x1007**; source questions later version names. Unsupported functions warn. Primary revision/record/style/formula limits unresolved.                                                                                                                                                                                                                                                                      |
| PlanPerfect                     | Ten-byte signature does not check documented major/minor version bytes. Column record handled; defaults record ignored; unknown preliminary records silently ignored. Undefined formula codes warn; source documentation notes most formatting lost. Full primary record/version limits unresolved.                                                                                                                                          |
| Psion                           | Optional unchanged plugin fails to compile against the recorded author's Psiconv0.9.9 profile. Runtime/version/record/primary-spec blocker retained; no patch or narrowing invented.                                                                                                                                                                                                                                                         |
| xBase DBF                       | C/N/L/D/I/F paths; invalid dates can remain strings. B explicitly warns it does not work; unsupported types become marker strings; unknown codepage warns/falls back and unrepresentable characters can become `?`. Dialect/memo/deleted-row/full limits unresolved.                                                                                                                                                                         |
| Paradox                         | pxlib-backed field conversion; unknown types become markers. Export requires field specifications; missing specification can give status0 and empty output. Successful valid fixtures, primary versions/blocks/field limits unresolved.                                                                                                                                                                                                      |
| MPS/GLPK/LPSolve                | MPS NAME/ROWS/COLUMNS/BOUNDS/RHS/RANGES/ENDATA and integer markers retained; unknown sections warn/ignore. Separate LP exporters, dialect/bounds/number/model limits and independent optima remain unresolved.                                                                                                                                                                                                                               |
| PDF                             | Separate output-only core service, named-object/paper/fit/common selection paths. Current audit header **PDF1.7**; no PDF import declaration. Fonts/paper/object/rendering/pagination accuracy remains screenshot QA, not a header pass.                                                                                                                                                                                                     |

Primary specifications acquired into `out`, hashed and selectively reviewed are
RFC 4180; W3C HTML 4.01 tables/XHTML1; OASIS ODF1.2 parts1–3; official ECMA-376
first/second-edition archives including OPC, cell/formula/shared-string/date/grid
sections and bundled schemas; Microsoft's **[MS-XLS] May20,2025** workbook stream,
record enumeration, BOF/Dimensions/Formula/Array/ShrFmla/SST/ExtSST/FilePass and
selected token structures; and Adobe's published ISO32000-1 PDF structure/page
tree sections. Exact URLs, artifact hashes, selected sections/pages and failed
acquisition attempts are retained. Full legacy-format primary specifications and
complete spec/implementation reconciliation are explicitly unresolved; no claim
that these selective reads establish complete specification coverage.

Notably, the original 2008 bundled **Strict** SpreadsheetML schema itself uses
the 2006 main namespace. Namespace equality alone cannot decide Strict
conformance. Preserve exact edition/schema distinctions rather than importing
assumptions from later OOXML editions.

### Function declaration and registration reconciliation

651 manifest entries = **645 matched C descriptors + six dynamic examples**.
653 C descriptors = **645 manifest-matched + one descriptor-only + seven
built-ins**. Descriptor-only `LOGMDETERM` is absent from its function manifest;
one original audit expression returned `#NAME?`. That observation is scoped to
this profile/expression, not proof of arbitrary extension registration behavior.
The dynamic examples are `perl_adder`, `perl_date`, `perl_sed`, `py_printf`,
`py_capwords`, `py_bitand`; Python's build availability and Perl's activation
must remain separate from calling semantics.

Built-ins are SUM, PRODUCT, GNUMERIC_VERSION, internal TABLE, IF, and debug-only
NUMBER_MATCH/DERIV. The last two register only under the testsuite debug flag
(`src/func-builtin.c:535–566`). Empty collected PRODUCT returns0; SUM/PRODUCT
range collectors ignore strings/booleans/blanks (`:58–142`). IF includes a
branch-selecting evaluator (`:368–420`) and missing-versus-blank argument
behavior; signatures/flags alone must not imply blanket eager evaluation.
Every function retains arity/evaluator/flags/upstream-status metadata, task and
independent coercion/array/laziness/error/domain/accuracy QA requirements.
Upstream “complete/exhaustive” descriptor flags are not product qualification.

| Source function service group                      | Entries | Responsible task                         |
| -------------------------------------------------- | ------: | ---------------------------------------- |
| `Gnumeric_fnchristiandate:christian_datetime`      |       5 | `functions-date-finance-calendars`       |
| `Gnumeric_fncomplex:complex`                       |      45 | `functions-math-engineering-complex`     |
| `Gnumeric_fndatabase:database`                     |      13 | `functions-math-engineering-complex`     |
| `Gnumeric_fndate:datetime`                         |      27 | `functions-date-finance-calendars`       |
| `Gnumeric_derivatives:derivatives`                 |      29 | `functions-math-engineering-complex`     |
| `Gnumeric_fneng:engineering`                       |      25 | `functions-math-engineering-complex`     |
| `Gnumeric_fnerlang:erlang`                         |       4 | `functions-statistics-random-timeseries` |
| `Gnumeric_fnfinancial:financial`                   |      57 | `functions-date-finance-calendars`       |
| `Gnumeric_fnflt:flt`                               |       4 | `functions-math-engineering-complex`     |
| `Gnumeric_fnhebdate:hebrew_datetime`               |       9 | `functions-date-finance-calendars`       |
| `Gnumeric_fninfo:info`                             |      24 | `functions-logical-text-lookup`          |
| `Gnumeric_fnlogical:logical`                       |      10 | `functions-logical-text-lookup`          |
| `Gnumeric_fnlookup:lookup`                         |      25 | `functions-logical-text-lookup`          |
| `Gnumeric_fnmath:math`                             |     101 | `functions-math-engineering-complex`     |
| `Gnumeric_numtheory:num_theory`                    |      10 | `functions-math-engineering-complex`     |
| `Gnumeric_numtheory:bitwise`                       |       5 | `functions-math-engineering-complex`     |
| `Gnumeric_r:rstat`                                 |      59 | `functions-statistics-random-timeseries` |
| `Gnumeric_fnrandom:random`                         |      34 | `functions-statistics-random-timeseries` |
| `Gnumeric_fnstat:stat`                             |     111 | `functions-statistics-random-timeseries` |
| `Gnumeric_fnstring:string`                         |      41 | `functions-logical-text-lookup`          |
| `Gnumeric_fnTimeSeriesAnalysis:TimeSeriesAnalysis` |       4 | `functions-statistics-random-timeseries` |
| `Gnumeric_gdaif:gdaif`                             |       2 | `optional-runtime-extension-profiles`    |
| `Gnumeric_PerlFunc:test`                           |       3 | `optional-runtime-extension-profiles`    |
| `Gnumeric_PyFunc:test`                             |       3 | `optional-runtime-extension-profiles`    |
| `Gnumeric_sample_datasource:ATL`                   |       1 | `optional-runtime-extension-profiles`    |

### Analysis writable properties and CLI protocol

All **31** accepted constructors' flattened writable-name sets match the native
GObject inventory: **154** tool/property observations, including inherited
ownership/defaults and enum numerical values/names/nicks. There are **102**
class-owned analysis writable declarations, excluding separate solver properties.
Both source and native metadata remain in the register; property setters,
initialized instance state, generated formulas/styles and statistical accuracy
are separate unmeasured gates.

| CLI tool                                | Own writable properties                                                                                                                            | Inherited writable properties |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `regression`                            | `group-by`, `intercept`, `multiple-regression`, `multiple-y`, `residual`                                                                           | `labels`, `alpha`             |
| `moving-average`                        | `interval`, `std-error-flag`, `df`, `offset`, `show-graph`, `ma-type`                                                                              | `labels`, `group-by`          |
| `anova`                                 | `alpha`                                                                                                                                            | `labels`, `group-by`          |
| `anova2`                                | `group-by`, `alpha`, `labels`, `replication`                                                                                                       | —                             |
| `chi-squared-test`                      | `alpha`, `independence`, `labels`                                                                                                                  | —                             |
| `descriptive-statistics`                | `do-summary-statistics`, `do-confidence-level`, `do-kth-largest`, `do-kth-smallest`, `use-ssmedian`, `k-smallest`, `k-largest`, `confidence-level` | `labels`, `group-by`          |
| `correlation`                           | —                                                                                                                                                  | `labels`, `group-by`          |
| `covariance`                            | —                                                                                                                                                  | `labels`, `group-by`          |
| `fourier-analysis`                      | `inverse`                                                                                                                                          | `labels`, `group-by`          |
| `sampling`                              | `periodic`, `row-major`, `offset`, `size`, `period`, `number`                                                                                      | `labels`, `group-by`          |
| `ranking`                               | `av-ties`                                                                                                                                          | `labels`, `group-by`          |
| `exponential-smoothing`                 | `damp-fact`, `g-damp-fact`, `s-damp-fact`, `s-period`, `std-error-flag`, `df`, `show-graph`, `es-type`                                             | `labels`, `group-by`          |
| `histogram`                             | `predetermined`, `bin-type`, `max-given`, `min-given`, `max`, `min`, `n`, `percentage`, `cumulative`, `only-numbers`, `chart`                      | `labels`, `group-by`          |
| `sign-test`                             | `median`, `alpha`                                                                                                                                  | `labels`, `group-by`          |
| `frequency-tables`                      | `predetermined`, `max`, `min`, `n`, `percentage`, `exact`, `chart`                                                                                 | `labels`, `group-by`          |
| `principal-components`                  | —                                                                                                                                                  | `labels`, `group-by`          |
| `auto-expression`                       | `multiple`, `below`, `function`                                                                                                                    | `labels`, `group-by`          |
| `normality-test`                        | `alpha`, `type`, `graph`                                                                                                                           | `labels`, `group-by`          |
| `one-mean-test`                         | `mean`, `alpha`                                                                                                                                    | `labels`, `group-by`          |
| `wilcoxon-signed-rank-test`             | `median`, `alpha`                                                                                                                                  | `labels`, `group-by`          |
| `wilcoxon-signed-rank-test-two-samples` | `median`                                                                                                                                           | `labels`, `alpha`             |
| `advanced-filter`                       | `unique-only-flag`                                                                                                                                 | `labels`, `alpha`             |
| `wilcoxon-mann-whitney`                 | —                                                                                                                                                  | `labels`, `alpha`             |
| `sign-test-two-samples`                 | `median`                                                                                                                                           | `labels`, `alpha`             |
| `f-test`                                | —                                                                                                                                                  | `labels`, `alpha`             |
| `t-test-paired`                         | `mean-diff`                                                                                                                                        | `labels`, `alpha`             |
| `t-test-equal-variances`                | `mean-diff`                                                                                                                                        | `labels`, `alpha`             |
| `t-test-unequal-variances`              | `mean-diff`                                                                                                                                        | `labels`, `alpha`             |
| `kaplan-meier`                          | `censored`, `censor-mark`, `censor-mark-to`, `chart`, `ticks`, `std-err`, `median`, `logrank-test`                                                 | `labels`, `alpha`             |
| `z-test`                                | `mean-diff`, `var1`, `var2`                                                                                                                        | `labels`, `alpha`             |
| `fill-series`                           | `type`, `date-unit`, `series-in-rows`, `step-value`, `stop-value`, `start-value`, `is-step-set`, `is-stop-set`                                     | —                             |

Canonical keys use hyphens. Arguments split at the first colon; repeated keys
replace earlier values; colonless arguments warn/are ignored. The analysis
converter uses strings, atof/atoi, exactly case-sensitive yes/y/true/1 booleans,
and enum nicks before numeric parsing when the first character is a digit.
Unsupported GTypes are not converted. This function does not reject leftover
unknown keys (`src/ssconvert.c:821–1043`); do not invent uniform strict rejection.
Special sheet/data/x/y/formulas arguments are not all GObject properties.
Consolidate/random-generator/random-generator-cor are explicitly missing from
this CLI test protocol (`:988–1000`), with their source tools retained separately.

### Complete upstream artifact census and limits

All **213** files under released `test` are assigned: **204** `.pl`/`.py` test
entry files and **nine** support/build/helper files. The **67** released sample
files and **40** template files are individually hashed/assigned. Every test's
literal subtests, sample/reference locators, option/assertion lines and
filter/default-exclusion/ignored-failure candidates are retained. Shared
`GnumericTest.pm` distribution/full-corpus references are also included: **111**
resolved candidate sample paths, **50** absent from this archive, plus one
explicitly unresolved dynamic introspection fixture expression. Literal
interpolation is a locator census, not a Perl execution/dataflow proof; drivers
and generated fixtures still require the stated independent-case review.

Relevant families include all calculation/accuracy t1000–t1111; operators/arrays/
intersections/regressions t1800–t1903; names/recalc/format/dependency/style t2000–
t2800; CSV parsing/export t5800–t5803; legacy imports t5900–t5906; BIFF/native/ODS
round trips and VBA t6000–t6104; syntax/determinism t6150–t6163; all strings/
numbers/styles/formulas/rows/comments/panes/validation/filter/solver/format/
merges/rich-text/conditional-format/graph/names/objects/selection/tabs/hyperlinks
and help-generated samples t6500–t6590; SYLK/SVG/LP export t6900–t6921; goal seek
and every released LP/NIST nonlinear solver driver t7000–t7147; all analysis
report drivers t7200–t7219; import/export memory checks t8000–t8050; and
ssconvert resize/merge/split/sheet behavior t9001/t9005–t9007. Native-only
introspection/GTK/C-source/allocator/other-utility/epilogue families are retained
with applicability blockers, not silently discarded. Eight `sstest` selectors
and their internal source-function families are separately registered.

Many missing references are the named nonlinear-solver benchmarks and
`tool-tests.gnumeric`; others concern statistical accuracy and legacy imports.
Each absent path has source references and a missing-fixture disposition, not an
invented hash or a passed test. Help-generated function samples, embedded DATA
assertions and dynamic corpus modes need independent original cases.

Upstream helper `test_roundtrip` can print **Pass after a failed diff when
ignore_failure is enabled** (`test/GnumericTest.pm:689–781`); several drivers
also exclude subtests, normalize fields/aliases/styles or substitute
Valgrind-only checkers. Those are retained upstream limitations, not permission
to suppress product failures, remove warnings/styles/formulas/cache/order effects,
or weaken independent assertions. No upstream suite/accuracy family was reported
as executed by this documentation audit.

### Build availability, legal provenance and final gates

The register distinguishes the six build-unavailable primary plugins
(Psiconv, GDA, GnomeDB, PythonLoader, PyFunc, GnomeGlossary) from the explicitly
interactive-only core **text assistant opener**. Its exporter is noninteractive.
UI/plugin-loader/data-source/solver services are separately typed, not silently
classified as file formats. Arbitrary third-party extensions cannot be a finite
release census; their explicit host interface/capability gate remains separate.
Build conditions are bound to `plugins/Makefile.am:1–44`, independently of
activation and converter success.

The audit oracle uses the same recorded Debian image digest and unchanged pinned
Gnumeric/GOffice sources/configure options, freshly installed dependencies,
out-of-tree `make -j4`, explicit C/UTC/memory settings and empty owned config roots.
Its binary SHA-256 is
`1929e936043740dd39ae05fa9ffb79d910bb36cc1445d43005af3edf47e536fb`.
This differs from the earlier primary binary and stays a **separate profile**;
exact bytes are not substituted wholesale into primary reference captures.
Package/dependency versions, linked-library hashes, eight font hashes, environment,
build commands/configure excerpts, original fixture and exact captures are retained
in `auditOracle`. The first property helper lacked plugin initialization and
emitted teardown GLib critical diagnostics; that unqualified run is preserved.
After initializing/activating plugins, the final metadata capture returned0 with
empty stderr and matching source name sets. Metadata is not numerical accuracy.

Research facts/identifiers, minimal diagnostic quotations and source citations
are recorded without translating implementation bodies or copying upstream
spreadsheet assets. Per-file GPL notices differ; the retained profile's source
notice evidence is not a blanket license decision. Future source/asset/schema
reuse requires a licensing/rights/notice decision and preservation of applicable
notices. Primary format specifications have separate copyright/patent terms.

The register has **37 named unresolved blocker categories**, with per-artifact
membership. They cover full per-record/attribute/write semantics, original
regression execution, absent/generated fixtures, primary legacy-format
specifications, edition/encryption/optional profiles, numerical accuracy,
rendering and extension capabilities. These preserve requested scope; they are
not exclusions or passes. The artifact census is complete within its stated
archive/lexical scope; **the complete semantic compatibility audit and product
parity are not established**. Existing plans/statuses/README/product files were
preserved. No commit, push or publication was performed.

### Verification of this register expansion

Fresh source/archive/manifest/test/sample/template/specification hash checks and
citation-boundary/membership/task/case/blocker-link checks passed. Exact capture
byte hashes/lengths and the measured native text/property controls also passed.
Repository Prettier verification passed for the expanded spec, coverage JSON and
manual QA plan. These are documentation/evidence checks, not product unit tests
or full interoperability/accuracy/rendering qualification. Task-owned scratch
captures and the owned QA container were removed after reducing findings; prior
unrelated `out` contents and pre-existing edits were preserved.

## Proposed public SDK contract

Status: proposed, 2026-09-19, for `design-javascript-engine`. This section adds
the public contract without replacing the historical source/oracle evidence
above. The [architecture](../ssconvert/architecture.md) records package collision
review, inspected reusable APIs, candidate-library primary-document hashes,
registry design and safety constraints. The proposed public workspace name
`@poe-code/ssconvert` follows that review; it is not currently an installable or
delivered API. Product implementation belongs in `packages/ssconvert`, TypeScript
ESM, with virtual integration in `packages/safe-bash/src/commands/ssconvert` and
literal command name `ssconvert`. No product code, dependency, README change,
commit, push or publication is introduced by this specification.

### Entry points and operation parity

The proposed package root exports `createEngine`, `parseCommand`, workbook and
expression types, directional service descriptors and structured errors. Engine
methods below perform domain work, not trivial forwarding wrappers. Hosts supply
capabilities/budgets at engine construction; each operation supplies cancellation
and uses invocation-owned resources. Neither engine construction nor inspection
may open input/output files or implicitly initialize external services.

| CLI action or control                                          | Public SDK equivalent                                                                                         | Contract                                                                                                        |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Help/version/libspreadsheet version                            | `parseCommand` terminal response                                                                              | Profile-defined channel bytes and parser exit ordering, without workbook I/O                                    |
| `--list-importers`, `--list-exporters`, `--list-image-formats` | `engine.listServices`, `engine.listImageFormats`; CLI listing serializer                                      | Separate source/reference/implemented availability; exact native rows only for qualified runtime profile        |
| One/two operands                                               | `engine.convert`                                                                                              | Infer opener/writer via descriptors; optional destination follows native naming/default policy                  |
| `-I`, `-E`, `-T`, `-O`, `-v`                                   | `importType`, `importEncoding`, `exportType`, `exportOptions`, `verbose`                                      | Exact IDs, one scalar raw option string; preserve provider-specific parsing and diagnostics                     |
| `-M`                                                           | `engine.merge`                                                                                                | Ordered inputs and native sheet/name/reference conflict semantics; no implicit flattening                       |
| `-S`                                                           | `perSheet` on conversion/merge request                                                                        | Native scope and sheet-selection validation; explicit merge conflict retained                                   |
| `--export-graphs`                                              | `engine.exportGraphs`                                                                                         | Graph-only traversal/ordering/naming; image-ID dispatch and image grammar                                       |
| `--set`, `--goal-seek`, `--tool-test`                          | Ordered `updates`, ordered `goalSeek`, `toolTest` protocol on operation request; typed workbook methods below | Arrays stay arrays; toolTest first item names tool, remaining items retain order and native property conversion |
| `--solve`, `--recalc`, `--resize`, `--export-range`            | `solve`, `recalc`, `resize`, `exportRange` on request                                                         | Execute in source-defined order; parse/error quirks stay in raw CLI protocol                                    |
| `--clipboard`                                                  | `engine.exportClipboard`                                                                                      | File serialization for requested target/range via explicit host target binding; no desktop clipboard access     |
| Library/data dirs and inherited GTK groups                     | `nativeOptionMappings` host capability with parsed inherited entries                                          | Explicit virtual reference mappings and qualified behavior; unmapped effects remain blockers                    |

All accepted hidden and inherited options in the reference register must be
representable through `parseCommand` and host configuration. This table does
not authorize new user flags for capabilities, budgets, profile selection,
cache policy or deterministic seeds. Programmatic typed APIs may reject invalid
types more strictly than the raw native CLI grammar; they must not be presented
as exact argv-parser equivalents.

Proposed API shapes (normative signatures; type names are proposed, not imports
from existing packages):

```ts
export type ByteSource = AsyncIterable<Uint8Array>;
export interface ByteSink {
  write(bytes: Uint8Array): Promise<void>;
}
export interface Operation {
  readonly signal: AbortSignal;
}
export interface Input {
  readonly source: ByteSource;
  readonly identity?: string; // Explicit host provenance, not authority.
  readonly filename?: string; // Optional probe hint, never an ambient read.
}
export type Destination =
  | { readonly kind: "stream"; readonly sink: ByteSink }
  | { readonly kind: "resource"; readonly uri: string };
export interface CommandControls {
  readonly importType?: string;
  readonly importEncoding?: string;
  readonly exportType?: string;
  readonly exportOptions?: string;
  readonly verbose?: boolean;
  readonly updates?: readonly string[];
  readonly goalSeek?: readonly string[];
  readonly toolTest?: readonly string[];
  readonly solve?: boolean;
  readonly recalc?: boolean;
  readonly resize?: string;
  readonly exportRange?: string;
  readonly perSheet?: boolean;
}
export interface ConversionRequest extends CommandControls {
  readonly input: Input;
  readonly destination?: Destination;
}
export interface MergeRequest extends CommandControls {
  readonly inputs: readonly Input[];
  readonly destination: Destination;
}
export interface GraphRequest extends CommandControls {
  readonly input: Input;
  readonly template: string;
}
export interface ClipboardRequest {
  readonly input: Input;
  readonly destination: Destination;
  readonly target: string;
  readonly range: string;
  readonly updates?: readonly string[];
  readonly importEncoding?: string;
}
export interface ReadOptions {
  readonly importType?: string;
  readonly importEncoding?: string;
  readonly calculation?: "none";
}
export interface WriteOptions {
  readonly exportType: string;
  readonly exportOptions?: string;
  readonly selection?: SheetSelection;
}
export interface Engine {
  listServices(direction: "read" | "write"): readonly ServiceDescriptor[];
  listImageFormats(): readonly ImageDescriptor[];
  readWorkbook(input: Input, options: ReadOptions, op: Operation): Promise<Workbook>;
  createWorkbook(options: WorkbookSettings, op: Operation): Promise<Workbook>;
  writeWorkbook(
    book: Workbook,
    destination: Destination,
    options: WriteOptions,
    op: Operation
  ): Promise<OperationResult>;
  convert(request: ConversionRequest, op: Operation): Promise<OperationResult>;
  merge(request: MergeRequest, op: Operation): Promise<OperationResult>;
  exportGraphs(request: GraphRequest, op: Operation): Promise<OperationResult>;
  exportClipboard(request: ClipboardRequest, op: Operation): Promise<OperationResult>;
  dispose(): Promise<void>;
}
export declare function createEngine(config: EngineConfig): Engine;
export declare function parseCommand(
  argv: readonly Uint8Array[],
  profile: CommandProfile
): ParsedCommand;
```

`CommandProfile` binds the pinned native parser/dependency/locale contract and
reference virtual dirs/help/version bytes. `ParsedCommand` is a discriminated
union: terminal `{kind: "terminal", exitCode, stdout, stderr}` or
`{kind: "operation", action, operands, controls, inheritedOptions}`. Terminal
parse errors are responses too; operands retain owned raw bytes. It does not
perform path resolution or capability acquisition. `action` distinguishes all
listing/conversion/merge/graph/clipboard actions with native precedence.
`inheritedOptions` retain group, canonical name, raw value and parse order.
Parser tests must reproduce GLib callbacks, scalar/array repetition and early
help exits; a conventional permissive JS argument parser is insufficient.

`OperationResult` contains the CLI-compatible `exitCode`, ordered structured
`diagnostics`, emitted artifacts (URI/type/sheet/object identity and byte count),
measured usage and profile identity. `Diagnostic` carries code, severity, stage,
source location where relevant, and optional exact channel bytes. Domain calls
deliver diagnostic events through the configured awaited sink; results retain
bounded metadata, not an unbounded duplicate transcript. `runCommand`, if exposed
later, must use these same methods and serializer, not a second conversion path.
SDK `convert` follows native dirty recalculation; `readWorkbook` explicitly
requires no calculation, with omission treated as that read-only policy at
implementation. `writeWorkbook` does not evaluate implicitly. This difference
is intentional and must remain visible in API documentation.

### Workbook, expression and projection API

`WorkbookSettings` declares date system (1900/1904), calculation mode/iteration
parameters and explicit locale/timezone profile. `SheetSelection` is `all`,
`active`, or ordered explicit sheet IDs; it is separate from raw native `sheet`
option accumulation. Errors, duplicates and scope behavior follow the chosen
entry point's documented semantics, never automatic first-sheet flattening.

`Workbook` is an opaque session-owned handle. It exposes ordered sheet metadata,
active sheet, settings, workbook/sheet names, bounded metadata, source profile
and diagnostics. It provides `getCell(sheetId, position)`, bounded
`cells(sheetId, range, op)` sparse enumeration, `projectTable(request, op)`,
`applyEdits(edits, op)`, `recalculate(request, op)`, `analyze(request, op)`,
`goalSeek(request, op)`, `solve(request, op)` and idempotent `close()`.
Each method performs substantive domain work; there is no redundant wrapper API.
Mutation rejects foreign/closed handles and invalid ranges before effects.
Engine disposal closes admitted owned workbooks and cooperative resources;
parallel mutations of the same handle are rejected, not data races. Read
snapshots have explicit revision identity. No mutable backing maps or source
Uint8Array aliases are returned.

`Position` is `{row, column}` with zero-based safe integers; `Range` has inclusive
`start`/`end`. A sparse enumeration yields occupied records in a documented
coordinate order, including explicitly represented blank/style records when
requested; it never walks the entire declared dimensions. Content, occupied and
styled extents and codec/logical dimensions are separately queryable.

```ts
export type CellValue =
  | { readonly kind: "blank" }
  | { readonly kind: "string"; readonly text: string; readonly richRuns?: readonly RichTextRun[] }
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "error"; readonly code: string; readonly sourceText?: string };
export type FormulaCache =
  | { readonly state: "absent" }
  | {
      readonly state: "present";
      readonly value: CellValue;
      readonly trust: "imported" | "calculated";
      readonly dirty: boolean;
    };
export interface CellRecord {
  readonly position: Position;
  readonly value?: CellValue;
  readonly expression?: Expression;
  readonly formulaSource?: { readonly text: string; readonly dialect: string };
  readonly cache?: FormulaCache;
  readonly styleId?: string;
  readonly sharedFormulaId?: string;
  readonly arrayFormula?: { readonly anchor: Position; readonly range: Range };
}
```

Absent `getCell` returns undefined, distinct from explicit blank/empty string.
Formula value selection never substitutes zero for an absent cache. Numbers
remain binary64; dates are serial numbers plus format/date-system semantics,
not automatically JS Date objects. Unsupported/error identities retain source
spelling without asserting identical error enums across formats. A present
imported cache is untrusted input, even if it looks numerically valid.

`Expression` is an immutable tagged AST of scalar/array constants, unary/binary
operations, function calls, scoped names, references/ranges and intersection/
union sets. References retain sheet/workbook identity, absolute/relative axes
and origin. Shared and array groups are independent of imported cache state.
Dependency mutation and edits must update references, dirty state and bounds;
missing/unsupported function evaluation produces a qualified native-equivalent
error or explicit unsupported-feature failure, never a successful #NAME? stub
counted toward function coverage. Recalculation returns changes and numerical
status; solver returns feasibility/optimality/convergence independently from
command exit status.

Style/format, object, print and solver records use the distinctions in the
architecture model table. `RichTextRun` has explicit spans/font/style references.
All style/object/range snapshots are bounded and immutable. Full discriminants,
per-codec field mappings, numeric enum values and native defaults remain to be
qualified from the cited source register before implementation; these proposed
semantic types are not a claim of a complete Gnumeric serialization schema.

`projectTable` is the public workbook API required by Pandoc. Its request selects
sheets explicitly, hidden/empty sheet policy, a bounded range or bounded content
extent, visited/output cell ceilings, typed versus formatted values, imported
cache permission, merge policy (`anchor`/explicit expansion/reject), and header/
caption policy. Its result streams bounded rows and merge metadata with sheet
identity/order/visibility, cell presence, typed value, formatted text, formula
cache state and loss diagnostics. Rich runs/formulas/objects that cannot map to
the Pandoc AST must be diagnosed explicitly. Formatting is pure with respect to
calculation and capabilities; it cannot fetch links or replace missing caches.
The formatter uses the explicit engine locale/date/font profile rather than
ambient Intl. Dense projection charges visited and synthesized blank cells even
when the underlying workbook is sparse.

This contract can unblock SDK discovery only after the real exports, bounded
OPC/ZIP reader and original memfs tests exist. Pandoc must separately qualify
sparse high-coordinate cells, shared/inline/rich strings, booleans/errors,
1900/1904 dates, leading zeroes, cache absence, merged cells, Unicode and
multiple/hidden/empty sheets under its existing XLSX gate. No XLSX reader/writer
availability or Pandoc behavior changes through this documentation.

### Services, capabilities and errors

`ServiceDescriptor` includes `(direction, exactId)`, exact description bytes,
source/profile availability, declared/effective priority, probe levels, default
saver priority/registration order, extensions/MIME, format level, save scope,
sheet-selection, interactivity/overwrite semantics, grammar and capability IDs.
`ImageDescriptor` distinguishes listed image metadata from executable graph
render capability. Unknown/null metadata is explicit, not an inferred MIME or
zero priority. Providers export declarative descriptors and codec callbacks;
static generated discovery enables one provider file with no ID branches.
Callbacks accept invocation resources and cannot know logging/dry-run or ambient
host paths. CLI lists and dispatch share this registry, with independent oracle
inventory assertions. Source declaration does not imply implementation.

`EngineConfig` requires finite `budgets`, resource/byte I/O, an awaited diagnostic
sink, explicit command/reference profile, cooperative scheduling and resource
cleanup ownership. Optional capabilities include bounded random access/spooling,
URI/descriptor resolution, atomic conditional publication, encoding/locale
resources, fonts/text shaping, image decoding/JavaScript scene rendering,
clock/random and external-data/extension bindings. Omitted capabilities deny
that operation. No network/native runtime/credentials are discovered implicitly.
Inherited native flags map through `nativeOptionMappings`, not new CLI flags.

Resource I/O exposes bounded reads and output handles acquired through the
registered invocation cleanup scope. File outputs verify input/output identity
and provider authority before conditional publication; lexical containment alone
is insufficient. No promise of all-or-nothing multi-file split/graph output is
made where the provider lacks transactions. Results retain already published
artifacts and diagnostics on later failure; uncommitted owned scratch is cleaned.
Stream output cannot be rolled back. Denials required for safe publication are
explicit native divergences pending QA, not silently changed success behavior.

Budgets cover the input/output/archive, retained memory, XML/workbook,
expression/dependency/array/iteration, numerical/solver, print/image/font and
invocation groups in the architecture resource table. Usage is per invocation
and aggregates child operations; host limits can tighten but cannot enlarge the
remaining shell budget. Admission happens before copy/allocation/expansion,
including retained raw caches, output assembly and dense blank projection.
Finite host configuration is required; default numeric calibration remains open.

`SsconvertError` has a stable SDK code (`invalid-option`, `invalid-workbook`,
`unsupported-feature`, `capability-denied`, `resource-limit`, `io`, `cancelled`,
`ownership`), stage and bounded details. Raw parser failures return exact terminal
responses instead of guessed error text. Native-equivalent operational failures
use per-case qualified CLI status/diagnostic mapping; do not reuse Pandoc's status
table or assume all domain errors return 1. Resource/authority/ownership failures
are recorded safety divergences. Root cancellation and escaping execution/control
failures retain the existing shell's precedence; the adapter cannot convert
unrecognized failures into successful or ordinary native error results.

Retained chunks/argv/snapshots are owned before producers advance, sink writes
are awaited, cancellation reaches cooperative host work, and cleanup enrolls
before acquisition. One execution realm owns mutable resources and budget
bindings. Replay uses explicit observations and preserves effect order; there
is no global cache, environment mutation, automatic module discovery or replay
bypass. The [safe-bash contracts](../../packages/safe-bash/src/contracts/command.md)
remain authoritative for runtime resource binding and settlement.

### Qualification boundary

Exact CLI bytes/status/channels, serialized semantics, numerical/rendering
equivalence and artifact byte determinism are independent contracts. The source
profile fixes identity, not product parity. Four-way fixtures must distinguish
formula source, cache presence/value/trust, calculated result and displayed text.
Library author claims do not validate our codecs. Remaining native/parser,
legacy/encryption, optional-plugin, solver/function, graphics/metrics, capability
mapping and budget questions stay explicit blockers in the architecture and
retained coverage register. QA procedures stay in `docs/plans`; unit tests use
memfs and mocked capabilities, with no native/disk/LLM work. No runtime repairs
or speculative implementation are part of this task.
