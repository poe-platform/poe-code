# ssconvert lifecycle and output inference oracle QA

## Scope and provenance

Executed 2026-09-19. This document records a separately captured native QA oracle, not a product dependency, fallback, or compatibility claim. Product differential coverage and remaining implementation mismatches must be recorded separately by the integration owner. The retained `docs/ssconvert/reference-profile.json` remains unchanged and incomplete; this current Debian package snapshot is a distinct reference profile.

Oracle profile: `gnumeric-1.12.61-lifecycle-20260919`; binary SHA-256 `d7b57fbb10a99097326d381f6e8c6ab9150092fca78cd03d7f41e5c968d64e82`.

Gnumeric official source `https://download.gnome.org/sources/gnumeric/1.12/gnumeric-1.12.61.tar.xz`, SHA-256 `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`; verified before extracting unchanged release under container `/out`. Goffice official source 0.10.61 SHA-256 `558597fd9ca59b93ff562750218d1e7ea8ec3c8d0ed6a5cc096aa715ef909a15`. Supplementary libgsf 1.14.53 official archive SHA-256 `0eb59a86e0c50f97ac9cfe4d8cc1969f623f2ae8c5296f2414571ff0a9e8bcba`, matched GNOME HTTPS published `.sha256sum`; source only under `out`.

Debian trixie arm64 isolated Docker/colima container; Goffice configure `--prefix=/opt/ssconvert-reference --disable-introspection`; Gnumeric configure `--prefix=/opt/ssconvert-reference --disable-introspection --disable-component --without-python`; both `make -j4` and `make install`; schemas compiled after install. Initial configure attempts failed for missing bison, itstool and xmllint; those dependencies were installed and unchanged source rebuilt successfully. A preparatory shell wait accidentally matched a zombie dpkg-preconfigure process; stopped the wait and started the build after apt completed. A first QA collector could not read a deliberately unreadable fixture on the host bind mount; collector records PermissionError rather than suppressing runtime failures, cleans its own fixtures, and the final collector completed.

Captured dependencies: GLib `2.84.4-3~deb13u5`, libgsf `1.14.53-1`, GTK `3.24.49-3`, libxml2 `2.12.7+dfsg+really2.9.14-2.1+deb13u3`. Optional libgda development dependency installed; no optional Paradox/psiconv conversion qualification. Environment: `LC_ALL=C`, `LANG=C`, `TZ=UTC`, `LD_LIBRARY_PATH=/opt/ssconvert-reference/lib`, `GSETTINGS_SCHEMA_DIR=/opt/ssconvert-reference/share/glib-2.0/schemas`, `GSETTINGS_BACKEND=memory`, `XDG_DATA_DIRS=/opt/ssconvert-reference/share:/usr/local/share:/usr/share`; HOME/XDG roots invocation-owned under `/evidence`.

Installed plugin manifests: 47; importer/exporter listings captured, both status 0 with empty stdout; listings are on stderr (importers1144 bytes, exporters1649 bytes). Installed manifests alone do not establish runtime activation. Concrete successful conversions above qualify only the exercised CSV/Gnumeric and XLS/XLSX services, and no blanket all-plugin activation pass is claimed. Installed manifest directory names: `fn-complex`, `html`, `fn-info`, `oleo`, `plan_perfect`, `fn-hebrew-date`, `fn-logical`, `nlsolve`, `fn-date`, `excel`, `fn-r`, `fn-string`, `sylk`, `applix`, `fn-database`, `fn-numtheory`, `fn-lookup`, `sc`, `fn-math`, `fn-eng`, `fn-christian-date`, `glpk`, `fn-financial`, `fn-tsa`, `fn-derivatives`, `fn-erlang`, `mps`, `fn-flt`, `qpro`, `xbase`, `lotus`, `openoffice`, `uihello`, `dif`, `fn-stat`, `lpsolve`, `sample_datasource`, `fn-random`, `plot_barcol`, `reg_logfit`, `plot_surface`, `plot_pie`, `reg_linear`, `plot_distrib`, `plot_xy`, `plot_radar`, `smoothing`.

Temporary evidence: `out/ssconvert-lifecycle-oracle/{profile.json,observations.json,special-observations.json,measure.py,measure-special.py,io-fault.c}`. Temporary captures are not committed. SHA-256 of captures at reduction time:

- `profile.json`: `aa9cbf01a87c96c83d7c60e7ded3e56884f1cac443255eb7bc4df60a06420aa1`
- `observations.json`: `a3579194fb2583a37d30a6595b6ad58a043ce6eb60eba10fff718591a3bccd4b`
- `special-observations.json`: `f8d83f02ad76b00a381fd3525a6238685bf90141e68319a46b9fcea44be1616e`
- `goffice-configure.log`: `bfc075df0bb813f12ca5815cb91b86f5b5e61e2461d67cdbc03b17c312f6e942`
- `gnumeric-configure.log`: `86a27cd8aa77e51baf51e7d5d57531b9f6eb158040de2ef68be3a132476eb182`
- `io-fault.c`: `5e462f47c0448a80572490af9a32e854a4998b25068c981a574d4eac99156ed1`

## Procedure

Use original CSV bytes `31 2c 32 0a 33 2c 34 0a` (`1,2\n3,4\n`), with two-sheet fixture produced by native `--merge-to two.gnumeric input.csv other.csv` from `1,2\n` and `3,4\n`. Run commands with exact captured environment and per-case working directory; record status, stdout/stderr, bytes, type, inode and mode before/after. Unit tests must reproduce these with injected byte I/O and memfs; never spawn this native oracle in unit tests. For comparison, enumerate exact fixture-root/argv substitutions rather than blanket diagnostic normalization.

The ordinary collector ran on the host bind mount `/evidence/cases`; permissions must be qualified using the separate container-local `/out/special-cases` collector because host virtiofs identity mapping allowed a nominally unwritable directory in the first collector. `permission-directory` in that collector is an observation, not a qualified permission-denial pass.

For injected native QA only, `io-fault.c` uses LD_PRELOAD to redirect fdopen for `.gsf-save-*` descriptors to actual `/dev/full`, or makes rename of `.gsf-save-*` return EACCES. This changes external I/O capability, not released source. Ordinary cases use no preload. This verifies specified close/publication failures, not real exhausted filesystem, crash recovery, or all writer failures.

## Native cases

All commands below invoke `/opt/ssconvert-reference/bin/ssconvert`. All stdout was empty. Case IDs are also directory names under `/evidence/cases`. Diagnostics retain actual captured bytes; dynamic PID/time and random temporary names below are observations, not normalization rules.

### `infer-plain`

`ssconvert -T Gnumeric_stf:stf_csv plain`

Status: **0**.

stderr: empty.

Effects: `plaincsv` mode 0o644, regular file, created, bytes `1,2\n3,4\n`.

### `infer-.hidden`

`ssconvert -T Gnumeric_stf:stf_csv .hidden`

Status: **0**.

stderr: empty.

Effects: `.csv` mode 0o644, regular file, created, bytes `1,2\n3,4\n`.

### `infer-tail.`

`ssconvert -T Gnumeric_stf:stf_csv tail.`

Status: **0**.

stderr: empty.

Effects: `tail.csv` mode 0o644, regular file, created, bytes `1,2\n3,4\n`.

### `infer-a.csv`

`ssconvert -T Gnumeric_stf:stf_csv a.csv`

Status: **0**.

stderr: empty.

Effects: `a.csv` mode 0o644, regular file, inode replaced, bytes `1,2\n3,4\n`.

### `infer-a%20b.csv`

`ssconvert -T Gnumeric_stf:stf_csv a%20b.csv`

Status: **0**.

stderr: empty.

Effects: `a%20b.csv` mode 0o644, regular file, inode replaced, bytes `1,2\n3,4\n`.

### `infer-a?x.csv`

`ssconvert -T Gnumeric_stf:stf_csv a?x.csv`

Status: **0**.

stderr: empty.

Effects: `a?x.csv` mode 0o644, regular file, inode replaced, bytes `1,2\n3,4\n`.

### `infer-a#x.csv`

`ssconvert -T Gnumeric_stf:stf_csv a#x.csv`

Status: **0**.

stderr: empty.

Effects: `a#x.csv` mode 0o644, regular file, inode replaced, bytes `1,2\n3,4\n`.

### `uri-encoded`

`ssconvert -T Gnumeric_stf:stf_csv file:///evidence/cases/uri-encoded/a%20b.csv`

Status: **0**.

stderr: empty.

Effects: `a b.csv` mode 0o644, regular file, inode replaced, bytes `1,2\n`.

### `uri-query`

`ssconvert -T Gnumeric_stf:stf_csv file:///evidence/cases/uri-query/a.csv?query`

Status: **0**.

stderr: empty.

Effects: `a.csv` mode 0o644, regular file, inode replaced, bytes `3,4\n`.

### `uri-fragment`

`ssconvert -T Gnumeric_stf:stf_csv file:///evidence/cases/uri-fragment/a.csv#fragment`

Status: **0**.

stderr: empty.

Effects: `a.csv` mode 0o644, regular file, inode replaced, bytes `3,4\n`.

### `alone`

`ssconvert input.csv`

Status: **1**.

```text
An output file name or an explicit export type is required.
Try --list-exporters to see a list of possibilities.
```

Effects: recorded regular files unchanged; no output file created.

### `unknown-ext`

`ssconvert input.csv output.unknown`

Status: **2**.

```text
Unable to guess exporter to use for 'file:///evidence/cases/unknown-ext/output.unknown'.
Try --list-exporters to see a list of possibilities.
```

Effects: recorded regular files unchanged; no output file created.

### `bad-export-import`

`ssconvert -T bad-export -I bad-import absent output.csv`

Status: **1**.

```text
Unknown exporter 'bad-export'.
Try --list-exporters to see a list of possibilities.
```

Effects: recorded regular files unchanged; no output file created.

### `bad-import-no-output`

`ssconvert -I bad-import input.csv`

Status: **1**.

```text
An output file name or an explicit export type is required.
Try --list-exporters to see a list of possibilities.
```

Effects: recorded regular files unchanged; no output file created.

### `bad-import-ext`

`ssconvert -I bad-import input.csv output.unknown`

Status: **2**.

```text
Unable to guess exporter to use for 'file:///evidence/cases/bad-import-ext/output.unknown'.
Try --list-exporters to see a list of possibilities.
```

Effects: recorded regular files unchanged; no output file created.

### `bad-import-load`

`ssconvert -I bad-import absent output.csv`

Status: **1**.

```text
Unknown importer 'bad-import'.
Try --list-importers to see a list of possibilities.
```

Effects: recorded regular files unchanged; no output file created.

### `missing-options`

`ssconvert -O bad-option=x absent output.csv`

Status: **1**.

```text
E /evidence/cases/missing-options/absent: No such file or directory
```

Effects: recorded regular files unchanged; no output file created.

### `set-options`

`ssconvert --set nonsense -O bad-option=x input.csv output.csv`

Status: **1**.

```text
Failed to set cell nonsense
```

Effects: recorded regular files unchanged; no output file created.

### `options-solve-resize`

`ssconvert -O bad-option=x --solve --resize 1x1 input.csv output.csv`

Status: **1**.

```text
ssconvert: Invalid export option "bad-option" for format Gnumeric_stf:stf_csv
```

Effects: recorded regular files unchanged; no output file created.

### `solve-tool-resize`

`ssconvert --solve --tool-test unknown --resize 1x1 input.csv output.csv`

Status: **1**.

```text
Solver: Invalid solver target
no test for tool "unknown"
```

Effects: recorded regular files unchanged; no output file created.

### `resize-recalc`

`ssconvert --resize 1x1 --recalc input.csv output.csv`

Status: **0**.

```text

** (ssconvert:65640): CRITICAL **: 15:44:28.581: gnm_sheet_resize: assertion 'gnm_sheet_valid_size (cols, rows)' failed
Resizing of sheet input.csv failed

(ssconvert:65640): GLib-GObject-CRITICAL **: 15:44:28.581: g_object_unref: assertion 'G_IS_OBJECT (object)' failed
```

Effects: `output.csv` mode 0o644, regular file, created, bytes `1,2\n3,4\n`.

### `merge-set`

`ssconvert --merge-to output.csv --set nonsense input.csv input.csv`

Status: **0**.

```text
Adding sheets from file:///evidence/cases/merge-set/input.csv
Adding sheets from file:///evidence/cases/merge-set/input.csv
```

Effects: `output.csv` mode 0o644, regular file, created, bytes `1,2\n3,4\n`.

### `merge-options`

`ssconvert --merge-to output.csv -O bad-option=x absent input.csv`

Status: **1**.

```text
ssconvert: Invalid export option "bad-option" for format Gnumeric_stf:stf_csv
```

Effects: recorded regular files unchanged; no output file created.

### `split-no-output`

`ssconvert -S -T Gnumeric_stf:stf_csv input.csv`

Status: **1**.

```text
An output file name or an explicit export type is required.
Try --list-exporters to see a list of possibilities.
```

Effects: recorded regular files unchanged; no output file created.

### `same-file`

`ssconvert input.csv input.csv`

Status: **0**.

stderr: empty.

Effects: `input.csv` mode 0o644, regular file, inode replaced, bytes `1,2\n3,4\n`.

### `hardlink`

`ssconvert input.csv output.csv`

Status: **0**.

stderr: empty.

Effects: `output.csv` mode 0o644, regular file, inode replaced, bytes `1,2\n3,4\n`.

### `symlink`

`ssconvert input.csv output.csv`

Status: **0**.

stderr: empty.

Effects: `input.csv` mode 0o644, regular file, inode replaced, bytes `1,2\n3,4\n`; `output.csv` mode 0o644, symlink target, inode replaced, bytes `1,2\n3,4\n`.

### `output-dir`

`ssconvert input.csv output.csv`

Status: **1**.

```text
E Can't open 'file:///evidence/cases/output-dir/output.csv' for writing: /evidence/cases/output-dir/output.csv: Is not a regular file
```

Effects: recorded regular files unchanged; no output file created.

### `missing-parent`

`ssconvert input.csv missing/output.csv`

Status: **1**.

```text
E Can't open 'file:///evidence/cases/missing-parent/missing/output.csv' for writing: /evidence/cases/missing-parent/missing/.gsf-save-KYXGV3: No such file or directory
```

Effects: recorded regular files unchanged; no output file created.

### `readonly`

`ssconvert input.csv output.csv`

Status: **0**.

stderr: empty.

Effects: `output.csv` mode 0o444, regular file, inode replaced, bytes `1,2\n3,4\n`.

### `split-collision`

`ssconvert -S input.csv out.csv`

Status: **0**.

stderr: empty.

Effects: `out.csv.0` mode 0o644, regular file, created, bytes `1,2\n3,4\n`.

### `make-two`

`ssconvert --merge-to two.gnumeric input.csv other.csv`

Status: **0**.

```text
Adding sheets from file:///evidence/cases/make-two/input.csv
Adding sheets from file:///evidence/cases/make-two/other.csv
```

Effects: `two.gnumeric` mode 0o644, regular file, created, bytes `SHA-256 0c75e546c30833ead8ca092fc960777f3b49ff5eb84d5e7fe26d5c992baf39e1`.

### `split-two-collision`

`ssconvert -S -T Gnumeric_stf:stf_csv two.gnumeric out.csv`

Status: **0**.

stderr: empty.

Effects: `out.csv.0` mode 0o644, regular file, inode replaced, bytes `1,2\n`; `out.csv.1` mode 0o644, regular file, inode replaced, bytes `3,4\n`.

### `split-two-failure`

`ssconvert -S -T Gnumeric_stf:stf_csv two.gnumeric out.csv`

Status: **1**.

```text
E Can't open 'file:///evidence/cases/split-two-failure/out.csv.1' for writing: /evidence/cases/split-two-failure/out.csv.1: Is not a regular file
```

Effects: `out.csv.0` mode 0o644, regular file, created, bytes `1,2\n`.

### `loss-warning`

`ssconvert two.gnumeric out.csv`

Status: **0**.

stderr: empty.

Effects: `out.csv` mode 0o644, regular file, created, bytes `1,2\n`.

### `split-constant`

`ssconvert -S -T Gnumeric_stf:stf_csv two.gnumeric out%%.csv`

Status: **0**.

stderr: empty.

Effects: `out%.csv` mode 0o644, regular file, created, bytes `3,4\n`.

### `permission-directory`

`ssconvert input.csv output.csv`

Status: **0**.

stderr: empty.

Effects: `output.csv` mode 0o644, regular file, created, bytes `1,2\n3,4\n`.

### `permission-readonly`

`ssconvert input.csv output.csv`

Status: **1**.

```text
E Can't open 'file:///evidence/cases/permission-readonly/output.csv' for writing: /evidence/cases/permission-readonly/output.csv: Permission denied
```

Effects: recorded regular files unchanged; no output file created.

### `permission-input`

`ssconvert input.csv output.csv`

Status: **1**.

```text
E /evidence/cases/permission-input/input.csv: Permission denied
```

Effects: recorded regular files unchanged; no output file created.

### `goal-options`

`ssconvert --goal-seek bad -O bad-option=x input.csv output.csv`

Status: **1**.

```text
ssconvert: Invalid export option "bad-option" for format Gnumeric_stf:stf_csv
```

Effects: recorded regular files unchanged; no output file created.

### `goal-solve-tool`

`ssconvert --goal-seek bad --solve --tool-test unknown input.csv output.csv`

Status: **1**.

```text
Invalid range specified.
```

Effects: recorded regular files unchanged; no output file created.

### `tool-resize`

`ssconvert --tool-test unknown --resize 1x1 input.csv output.csv`

Status: **1**.

```text
no test for tool "unknown"
```

Effects: recorded regular files unchanged; no output file created.

### `range-options`

`ssconvert --export-range bad -O bad-option=x input.csv output.csv`

Status: **1**.

```text
ssconvert: Invalid export option "bad-option" for format Gnumeric_stf:stf_csv
```

Effects: recorded regular files unchanged; no output file created.

### `set-unknown-xls`

`ssconvert --set A1==NO_SUCH_FUNCTION(1) input.csv output.xls`

Status: **0**.

stderr: empty.

Effects: `output.xls` mode 0o644, regular file, created, bytes `SHA-256 c8d406b5e507304bcf10553adb1c5b06e26d639c5f03da16fef29855e4e2113d`.

### `set-unknown-xlsx`

`ssconvert --set A1==NO_SUCH_FUNCTION(1) input.csv output.xlsx`

Status: **0**.

stderr: empty.

Effects: `output.xlsx` mode 0o644, regular file, created, bytes `SHA-256 6ef099889aea8f71f783043f2d2a3b8226950e9223c756a8bc7e2abe3048583a`.

### `merge-sheet-selection`

`ssconvert --merge-to output.csv -O sheet=input.csv input.csv input.csv`

Status: **1**.

```text
ssconvert: Unknown sheet "input.csv"
```

Effects: recorded regular files unchanged; no output file created.

## Container-local publication and permissions

### `new-0o22`

`ssconvert input.csv output.csv`; umask `0o22`, uid `0`, injected fault `None`; status **0**.

stderr: empty.

- `output.csv`: file, mode `0o644`, new inode, bytes `312c320a332c340a`.
- `input.csv`: file, mode `0o644`, same inode, bytes `312c320a332c340a`.

### `new-0o77`

`ssconvert input.csv output.csv`; umask `0o77`, uid `0`, injected fault `None`; status **0**.

stderr: empty.

- `output.csv`: file, mode `0o600`, new inode, bytes `312c320a332c340a`.
- `input.csv`: file, mode `0o644`, same inode, bytes `312c320a332c340a`.

### `new-0o0`

`ssconvert input.csv output.csv`; umask `0o0`, uid `0`, injected fault `None`; status **0**.

stderr: empty.

- `output.csv`: file, mode `0o666`, new inode, bytes `312c320a332c340a`.
- `input.csv`: file, mode `0o644`, same inode, bytes `312c320a332c340a`.

### `existing-0751`

`ssconvert input.csv output.csv`; umask `0o77`, uid `0`, injected fault `None`; status **0**.

stderr: empty.

- `output.csv`: file, mode `0o751`, new inode, bytes `312c320a332c340a`.
- `input.csv`: file, mode `0o644`, same inode, bytes `312c320a332c340a`.

### `alias-hard`

`ssconvert input.csv output.csv`; umask `0o22`, uid `0`, injected fault `None`; status **0**.

stderr: empty.

- `output.csv`: file, mode `0o640`, new inode, bytes `312c320a332c340a`.
- `input.csv`: file, mode `0o640`, same inode, bytes `312c320a332c340a`.

### `alias-relative`

`ssconvert input.csv output.csv`; umask `0o22`, uid `0`, injected fault `None`; status **0**.

stderr: empty.

- `output.csv`: symlink, mode `0o777`, same inode, link `input.csv`.
- `input.csv`: file, mode `0o640`, new inode, bytes `312c320a332c340a`.

### `alias-absolute`

`ssconvert input.csv output.csv`; umask `0o22`, uid `0`, injected fault `None`; status **0**.

stderr: empty.

- `output.csv`: symlink, mode `0o777`, same inode, link `/out/special-cases/alias-absolute/input.csv`.
- `input.csv`: file, mode `0o640`, new inode, bytes `312c320a332c340a`.

### `directory-denied`

`ssconvert input.csv output.csv`; umask `0o22`, uid `65534`, injected fault `None`; status **1**.

```text
E Can't open 'file:///out/special-cases/directory-denied/output.csv' for writing: /out/special-cases/directory-denied/.gsf-save-HIBJV3: Permission denied
```

- `input.csv`: file, mode `0o644`, same inode, bytes `312c320a332c340a`.

### `readonly-denied`

`ssconvert input.csv output.csv`; umask `0o22`, uid `65534`, injected fault `None`; status **1**.

```text
E Can't open 'file:///out/special-cases/readonly-denied/output.csv' for writing: /out/special-cases/readonly-denied/output.csv: Permission denied
```

- `output.csv`: file, mode `0o444`, same inode, bytes `4f4c44`.
- `input.csv`: file, mode `0o644`, same inode, bytes `312c320a332c340a`.

### `injected-enospc-existing`

`ssconvert input.csv output.csv`; umask `0o22`, uid `0`, injected fault `full`; status **1**.

```text
  ==> Failed to close file: No space left on device
E Failed to close file: No space left on device
```

- `output.csv`: file, mode `0o644`, same inode, bytes `4f4c44`.
- `input.csv`: file, mode `0o644`, same inode, bytes `312c320a332c340a`.

### `injected-enospc-new`

`ssconvert input.csv output.csv`; umask `0o22`, uid `0`, injected fault `full`; status **1**.

```text
  ==> Failed to close file: No space left on device
E Failed to close file: No space left on device
```

- `input.csv`: file, mode `0o644`, same inode, bytes `312c320a332c340a`.

### `injected-rename-existing`

`ssconvert input.csv output.csv`; umask `0o22`, uid `0`, injected fault `rename`; status **1**.

```text
  ==> Permission denied
E Permission denied
```

- `output.csv`: file, mode `0o644`, same inode, bytes `4f4c44`.
- `input.csv`: file, mode `0o644`, same inode, bytes `312c320a332c340a`.
- `.gsf-save-ZU8GV3`: file, mode `0o600`, new inode, bytes `312c320a332c340a`.

### `injected-rename-new`

`ssconvert input.csv output.csv`; umask `0o22`, uid `0`, injected fault `rename`; status **1**.

```text
  ==> Permission denied
E Permission denied
```

- `.gsf-save-SD9GV3`: file, mode `0o600`, new inode, bytes `312c320a332c340a`.
- `input.csv`: file, mode `0o644`, same inode, bytes `312c320a332c340a`.

## GOffice URI primitive measurements

The unchanged built GOffice 0.10.61 helper calls `go_shell_arg_to_uri` with container cwd `/`. These helper observations qualify URI inference primitives, not successful conversions of absent files. Source `go-file.c:521` special-cases valid fd URIs; otherwise uses GLib `g_file_new_for_commandline_arg` and `g_file_get_uri`.

| Input | Actual resulting URI |
| --- | --- |
| `plain` | `file:///plain` |
| `.hidden` | `file:///.hidden` |
| `tail.` | `file:///tail.` |
| `a%20b.csv` | `file:///a%2520b.csv` |
| `a?x.csv` | `file:///a%3Fx.csv` |
| `a#x.csv` | `file:///a%23x.csv` |
| `file:///a%20b.csv` | `file:///a%20b.csv` |
| `file:///a%2Fcsv` | `file:///a%2Fcsv` |
| `file://localhost/a%2Ecsv` | `file:///a.csv` |
| `http://host/a%2Ecsv?query#frag` | `http://host/a%2Ecsv?query#frag` |
| `file:///a.csv#frag` | `file:///a.csv` |
| `file:///a.csv?x.y` | `file:///a.csv` |
| `./dir/../a.csv` | `file:///a.csv` |
| `./dir/../a.csv/` | `file:///a.csv` |
| `fd://0` | `fd://0` |
| `file:///a%41.csv` | `file:///aA.csv` |
| `file:///a%2eCSV` | `file:///a.CSV` |
| `file:///a%3F.csv` | `file:///a%3F.csv` |
| `file:///a%23.csv` | `file:///a%23.csv` |
| `FILE:///a.csv` | `file:///a.csv` |
| `file://remote/a.csv` | `file:///a.csv` |
| `file:/a.csv` | `file:///a.csv` |

Dependency libgsf `gsf_extension_pointer` helper returned the end of `file:///x/plain`, the `hidden` position after the dot in `file:///x/.hidden`, end after the dot in `file:///x/tail.`, and the `csv?query`/`csv#fragment` positions in raw (uncanonicalized) URI strings. It does not itself canonicalize URI strings. File query/fragment conversion must happen before this primitive.

## Source interpretation and remaining unmeasured scope

Authenticated Gnumeric `src/ssconvert.c:convert` source order: resolve image/export mode and exporter/type/output name; require output; resolve forced importer; load and apply updates only outside merge; configure/validate exporter; merge; goal seek; solve; tool-test; resize; explicit recalc then automatic recalc; export range and default sheet; save/split. This ordering is backed by combined failure cases above. Merge exporter sheet selection is validated against the initially empty workbook, before input loading; ordinary `--set` is skipped in merge. Solver target error prints a diagnostic and conversion can continue. Invalid goal range exits before solve/tool-test.

Gnumeric inference uses GOffice `go_shell_arg_to_uri` (GFile commandline canonicalization, valid fd URI special case) then libgsf `gsf_extension_pointer`. Suffix-free `plain` becomes `plaincsv`, not `plain.csv`; hidden `.hidden` becomes `.csv`. File URI query/fragment are removed by GFile before extension inference. An explicit exporter that infers the same filename performs a real conversion; an INFILE alone without exporter fails before load.

libgsf `gsf-output-stdio.c` follows final output symlinks, rejects existing nonregular targets, checks existing target W_OK, snapshots its mode/uid/gid, creates same-directory `.gsf-save-XXXXXX` mode0600, then closes and renames. On write/close errors it unlinks the temp; rename publication error leaves the complete temp. New output final mode is0666 &~umask; existing mode preserved. Hardlinks are broken by publication rename; symlinks retained and targets replaced. Gnumeric split saves sequentially and stops at first failure, preserving earlier outputs and collisions overwriting existing outputs. A template with `%%` but no varying selector can overwrite the same path repeatedly; final bytes are last successful sheet.

The measured two-sheet Gnumeric-to-CSV case and unknown-function XLS/XLSX cases emitted no format-loss warning. This does not qualify all format losses or all exporters. Do not add generic warnings based solely on format identity.

Unmeasured or not qualified: exporter-specific error/partial effects for Paradox, Psion and other optional exporters; loss warnings for every exporter/feature; native crashes and process-kill recovery; actual full filesystem and all asynchronous I/O failures; write-time ENOSPC distinct from buffered close-time ENOSPC; fd/remote stream partial writes; symlink loops and parent symlink chains; ACL, uid/gid/group restoration, setgid directories; split failure after write error rather than nonregular destination; output-selection interactions for every exporter; graph/image rendering; clipboard lifecycle; successful solver/goal seek and full recalculation semantics. Invalid resize emits dynamic GLib critical diagnostics yet status0; the exact emitted PID/time bytes are recorded above but are not a product-match pass. No unsupported/unmeasured case is counted as a pass.

## Follow-up: publication chmod, graph/clipboard dispatch and resize

Executed 15 additional native cases in container-local `/out/followup`; raw capture SHA-256 `33c55ac4898be7e02a2bec2ad21ac34ec681ad45c990b3e2024703fba1c29624`. Updated fault interposer SHA-256 `94cee63c0d177dda4495d405bc7cd199458f042f1b1f41a60c3aac9e80b7c0de`; prior interposer identity above applies to the earlier publication captures.

Authenticated libgsf 1.14.53 `gsf/gsf-output-stdio.c:288` and `:297` call chmod without inspecting its return; lines282–284 explain that final data is already saved and permission restoration offers little error checking. Injecting EACCES only in chmod for `output.csv` confirms successful conversion with empty diagnostics while output remains temporary-file mode0600. Existing OLD output and new output both publish successfully; this is a QA fault profile, not ordinary filesystem behavior.

Authenticated Gnumeric1.12.61 `src/ssconvert.c:1305–1315` resolves graph mode/image format; importer resolution at1353–1364 still occurs before load, even if no graphs exist. The no-graph save loop performs no codec operation, so an unknown inferred extension/explicit codec need not fail. `clipboard_export` at1520–1542 opens with fo=NULL and applies --set before range; it does not resolve forced importer or run solver. On early update failure wb remains NULL, so released cleanup leaks the loaded workbook: this profile emits nondeterministic addresses/PID/time in leak diagnostics. These bytes are retained as observed and not represented as exact product parity passes.

Authenticated Gnumeric `src/ssconvert.c:1445` uses `sscanf(spec, "%dx%d", &rows, &cols) == 2`; suffix garbage is accepted, uppercase X fails the literal match and resize is skipped. Sparse fixture contains1 at row1,2 at row128,3 at row139. Valid128x128 and128x128garbage remove row139; bad/128X128 retain it.

### `chmod-new`

`ssconvert input.csv output.csv`

Injected fault `chmod`; status **0**; stdout empty.

stderr: empty.

- `output.csv`: mode `0o600`, bytes `1,2\n3,4\n`.
- `input.csv`: mode `0o644`, bytes `1,2\n3,4\n`.

### `chmod-existing`

`ssconvert input.csv output.csv`

Injected fault `chmod`; status **0**; stdout empty.

stderr: empty.

- `output.csv`: mode `0o600`, bytes `1,2\n`.
- `input.csv`: mode `0o644`, bytes `1,2\n`.

### `graphs-importer`

`ssconvert --export-graphs -T png -I bad input.csv output.png`

Injected fault `None`; status **1**; stdout empty.

```text
Unknown importer 'bad'.
Try --list-importers to see a list of possibilities.
```

- `input.csv`: mode `0o644`, bytes `1,2\n3,4\n`.

### `graphs-unknown`

`ssconvert --export-graphs input.csv output.unknown`

Injected fault `None`; status **0**; stdout empty.

stderr: empty.

- `input.csv`: mode `0o644`, bytes `1,2\n3,4\n`.

### `graphs-bad-codec`

`ssconvert --export-graphs -T bad input.csv output.unknown`

Injected fault `None`; status **0**; stdout empty.

stderr: empty.

- `input.csv`: mode `0o644`, bytes `1,2\n3,4\n`.

### `clipboard-set-importer`

`ssconvert --clipboard text/plain --set bad -I bad --solve --export-range A1 input.csv output.txt`

Injected fault `None`; status **1**; stdout empty.

```text
Failed to set cell bad
Function sum still has a usage count of 1
Leaking 4 rendered values.
Leaking 4 cells.
Leaking expression at 0xbeaad89e44a8: #REF!.
Leaking expression at 0xbeaad89e44c8: "input.csv".

** (ssconvert:65795): WARNING **: 15:53:02.886: Leaked 2 nodes from expression pool for small nodes.
Leaking 7 values.
Leaking style at 0xbeaad89dedf8.
Style Refs 2
	Color.Back: ff:ff:ff auto
	Color.Pattern: 0:0:0
	Border.Top: 0
	Border.Bottom: 0
	Border.Left: 0
	Border.Right: 0
	Border.RevDiagonal: 0
	Border.Diagonal: 0
	pattern 0
	Color.Fore: 0:0:0
	name 'Sans'
	not bold
	not italic
	no underline
	no strikethrough
	no super or sub
	size 10.000000
	format 'General'
	valign 2
	halign 1
	indent 0
	rotation 0
	text dir 0
	wrap text 0
	shrink to fit 0
	locked 1
	hidden 0
	validation (nil)
	hlink (nil)
	input msg (nil)
	conditions (nil)

** (ssconvert:65795): WARNING **: 15:53:02.886: Leaked 1 nodes from style pool.

** (ssconvert:65795): WARNING **: 15:53:02.886: Font Sans has 2 references instead of the expected single.
Leaking style-border at 0xbeaad89e3c90 [color=0xbeaad89e3df0  line=0] refs=7.
Leaking style-color at 0xbeaad88a6630 [000000ff].
Leaking style-color at 0xbeaad89e3df0 [c7c7c7ff].
Leaking style-color at 0xbeaad89e3dd0 [ffffffff].
Leaking style-color at 0xbeaad89e3db0 [000000ff].

** (ssconvert:65795): CRITICAL **: 15:53:02.886: go_font_free: assertion 'font->ref_count == 1' failed
Leaking GOFormat at 0xbeaad89fbc90 [General].
Leaking string [input.csv] with ref_count=1.
Leaking string [Sans] with ref_count=1.
Leaking string [Sheet_Title] with ref_count=1.
Leaking string [Print_Area] with ref_count=1.
Leaking string [#REF!] with ref_count=1.
```

- `input.csv`: mode `0o644`, bytes `1,2\n3,4\n`.

### `resize-bad`

`ssconvert --resize bad input.csv output.csv`

Injected fault `None`; status **0**; stdout empty.

stderr: empty.

- `output.csv`: mode `0o644`, bytes `1,2\n3,4\n`.
- `input.csv`: mode `0o644`, bytes `1,2\n3,4\n`.

### `resize-128x128garbage`

`ssconvert --resize 128x128garbage input.csv output.csv`

Injected fault `None`; status **0**; stdout empty.

stderr: empty.

- `output.csv`: mode `0o644`, bytes `1,2\n3,4\n`.
- `input.csv`: mode `0o644`, bytes `1,2\n3,4\n`.

### `resize-128X128`

`ssconvert --resize 128X128 input.csv output.csv`

Injected fault `None`; status **0**; stdout empty.

stderr: empty.

- `output.csv`: mode `0o644`, bytes `1,2\n3,4\n`.
- `input.csv`: mode `0o644`, bytes `1,2\n3,4\n`.

### `resize-128x128`

`ssconvert --resize 128x128 input.csv output.csv`

Injected fault `None`; status **0**; stdout empty.

stderr: empty.

- `output.csv`: mode `0o644`, bytes `1,2\n3,4\n`.
- `input.csv`: mode `0o644`, bytes `1,2\n3,4\n`.

### `resize-sparse`

`ssconvert --resize 128x128 input.csv output.csv`

Injected fault `None`; status **0**; stdout empty.

stderr: empty.

- `output.csv`: mode `0o644`, bytes `1\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n2\n`.
- `input.csv`: mode `0o644`, bytes `1\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n2\n\n\n\n\n\n\n\n\n\n\n3\n`.

### `resize-verbose-sparse-bad`

`ssconvert --verbose --resize bad input.csv output.csv`

Injected fault `None`; status **0**; stdout empty.

```text
Using exporter Gnumeric_stf:stf_csv
```

- `output.csv`: mode `0o644`, bytes `1\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n2\n\n\n\n\n\n\n\n\n\n\n3\n`.
- `input.csv`: mode `0o644`, bytes `1\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n2\n\n\n\n\n\n\n\n\n\n\n3\n`.

### `resize-verbose-sparse-128x128garbage`

`ssconvert --verbose --resize 128x128garbage input.csv output.csv`

Injected fault `None`; status **0**; stdout empty.

```text
Using exporter Gnumeric_stf:stf_csv
Resizing to 128x128
```

- `output.csv`: mode `0o644`, bytes `1\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n2\n`.
- `input.csv`: mode `0o644`, bytes `1\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n2\n\n\n\n\n\n\n\n\n\n\n3\n`.

### `resize-verbose-sparse-128X128`

`ssconvert --verbose --resize 128X128 input.csv output.csv`

Injected fault `None`; status **0**; stdout empty.

```text
Using exporter Gnumeric_stf:stf_csv
```

- `output.csv`: mode `0o644`, bytes `1\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n2\n\n\n\n\n\n\n\n\n\n\n3\n`.
- `input.csv`: mode `0o644`, bytes `1\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n2\n\n\n\n\n\n\n\n\n\n\n3\n`.

### `resize-verbose-sparse-128x128`

`ssconvert --verbose --resize 128x128 input.csv output.csv`

Injected fault `None`; status **0**; stdout empty.

```text
Using exporter Gnumeric_stf:stf_csv
Resizing to 128x128
```

- `output.csv`: mode `0o644`, bytes `1\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n2\n`.
- `input.csv`: mode `0o644`, bytes `1\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n2\n\n\n\n\n\n\n\n\n\n\n3\n`.

## Final selection and image-option combinations

Executed 10 additional native cases under `/out/selection` using the original two-sheet fixture. Capture SHA-256 `400b4a7e23e025fcf77ce8f25428f94d7fcd950fdda8ba73842987894eab8130`. `input.csv` sheet has `1,2\n`; `other.csv` sheet has `3,4\n`.

Nonsplit explicit first-sheet selection is superseded by a qualified second-sheet export range, producing3\n. In split mode the explicit sheet list drives iteration, but the range still references the second sheet; the first iteration produces an empty file. Multiple explicit sheet entries (including duplicates) fail nonsplit sheet-scope validation but remain ordered entries in split mode. Default active-sheet=true picks first-view sheet; a qualified second-sheet range overrides it. These behaviors follow authenticated Gnumeric `src/ssconvert.c:1479–1507` for final selection, `:1171–1243` split selection/save, and CSV exporter range handling.

Graph/image export options are configured inside each selected-sheet export call before scanning objects, authenticated `src/ssconvert.c:1124–1140`. Consequently invalid options fail even with no graph objects and invalid image codec. `infer_image_format` at1067–1082 matches extension against GOImageFormatInfo.ext and returns .name. The built unchanged GOffice format-info helper measured:

```text
0 name=svg ext=svg
1 name=png ext=png
2 name=jpeg ext=jpg
3 name=pdf ext=pdf
4 name=ps ext=ps
5 name=emf ext=emf
6 name=wmf ext=wmf
7 name=eps ext=eps
```

Thus automatic `.jpg` inference maps to format name `jpeg`. This helper table qualifies metadata mapping; successful graph JPEG rendering remains unmeasured.

### `explicit-first-range-second`

`ssconvert -T Gnumeric_stf:stf_csv -O sheet=input.csv --export-range 'other.csv'!A1:A1 input.gnumeric output.csv`

Status **0**; stdout empty.

stderr: empty.

- `output.csv`: mode `0o644`, bytes `3\n`.

### `split-first-range-second`

`ssconvert -T Gnumeric_stf:stf_csv -S -O sheet=input.csv --export-range 'other.csv'!A1:A1 input.gnumeric output-%n.csv`

Status **0**; stdout empty.

stderr: empty.

- `output-0.csv`: mode `0o644`, bytes ``.

### `active-sheet-default`

`ssconvert -T Gnumeric_stf:stf_csv -O active-sheet=true input.gnumeric output.csv`

Status **0**; stdout empty.

stderr: empty.

- `output.csv`: mode `0o644`, bytes `1,2\n`.

### `active-sheet-range-second`

`ssconvert -T Gnumeric_stf:stf_csv -O active-sheet=true --export-range 'other.csv'!A1:A1 input.gnumeric output.csv`

Status **0**; stdout empty.

stderr: empty.

- `output.csv`: mode `0o644`, bytes `3\n`.

### `duplicate-selection`

`ssconvert -T Gnumeric_stf:stf_csv -O sheet=input.csv sheet=input.csv input.gnumeric output.csv`

Status **1**; stdout empty.

```text
Selected exporter (Gnumeric_stf:stf_csv) can only export one sheet at a time.
```

No output file created.


### `duplicate-selection-split`

`ssconvert -T Gnumeric_stf:stf_csv -S -O sheet=input.csv sheet=input.csv input.gnumeric output-%n.csv`

Status **0**; stdout empty.

stderr: empty.

- `output-0.csv`: mode `0o644`, bytes `1,2\n`.
- `output-1.csv`: mode `0o644`, bytes `1,2\n`.

### `first-second-selection`

`ssconvert -T Gnumeric_stf:stf_csv -O sheet=input.csv sheet=other.csv input.gnumeric output.csv`

Status **1**; stdout empty.

```text
Selected exporter (Gnumeric_stf:stf_csv) can only export one sheet at a time.
```

No output file created.


### `first-second-selection-split-range`

`ssconvert -T Gnumeric_stf:stf_csv -S -O sheet=input.csv sheet=other.csv --export-range 'other.csv'!A1:A1 input.gnumeric output-%n.csv`

Status **0**; stdout empty.

stderr: empty.

- `output-0.csv`: mode `0o644`, bytes ``.
- `output-1.csv`: mode `0o644`, bytes `3\n`.

### `graph-options-no-objects`

`ssconvert --export-graphs -O bad=1 input.gnumeric output.jpg`

Status **1**; stdout empty.

```text
ssconvert: Invalid export option "bad=1" for image export
```

No output file created.


### `graph-options-no-objects-bad-codec`

`ssconvert --export-graphs -T bad -O bad=1 input.gnumeric output.jpg`

Status **1**; stdout empty.

```text
ssconvert: Invalid export option "bad=1" for image export
```

No output file created.


## Retained reference profile capture

This reduced profile retains the complete installed package census, runtime listings, locale and installed plugin manifest identities even after temporary evidence is purged. It is a native QA snapshot only.

```json
{
  "id": "gnumeric-1.12.61-lifecycle-20260919",
  "scope": "QA oracle only; separately captured current Debian dependency snapshot; not product dependency or fallback",
  "source": {
    "version": "1.12.61",
    "sha256": "2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12",
    "unchanged": true
  },
  "gofficeSourceSha256": "558597fd9ca59b93ff562750218d1e7ea8ec3c8d0ed6a5cc096aa715ef909a15",
  "binarySha256": "d7b57fbb10a99097326d381f6e8c6ab9150092fca78cd03d7f41e5c968d64e82",
  "version": {
    "argv": [
      "/opt/ssconvert-reference/bin/ssconvert",
      "--version"
    ],
    "status": 0,
    "stdout": "ssconvert version '1.12.61'\ndatadir := '/opt/ssconvert-reference/share/gnumeric/1.12.61'\nlibdir := '/opt/ssconvert-reference/lib/gnumeric/1.12.61'\n",
    "stderr": ""
  },
  "importers": {
    "argv": [
      "/opt/ssconvert-reference/bin/ssconvert",
      "--list-importers"
    ],
    "status": 0,
    "stdout": "",
    "stderr": "ID                           | Description\nGnumeric_Excel:excel         | MS Excel? (*.xls)\nGnumeric_Excel:excel_enc     | MS Excel? (*.xls) requiring encoding specification\nGnumeric_Excel:excel_xml     | MS Excel? 2003 SpreadsheetML\nGnumeric_Excel:xlsx          | ECMA 376 / Office Open XML [MS Excel? 2007/2010] (*.xlsx)\nGnumeric_OpenCalc:openoffice | Open Document Format (*.sxc, *.ods)\nGnumeric_QPro:qpro           | Quattro Pro (*.wb1, *.wb2, *.wb3)\nGnumeric_XmlIO:sax           | Gnumeric XML (*.gnumeric)\nGnumeric_applix:applix       | Applix (*.as)\nGnumeric_dif:dif             | Data Interchange Format (*.dif)\nGnumeric_html:html           | HTML (*.html, *.htm)\nGnumeric_lotus:lotus         | Lotus 123 (*.wk1, *.wks, *.123)\nGnumeric_mps:mps             | Linear and integer program (*.mps) file format\nGnumeric_oleo:oleo           | GNU Oleo (*.oleo)\nGnumeric_plan_perfect:pln    | Plan Perfect Format (PLN) import\nGnumeric_sc:sc               | SC/xspread\nGnumeric_stf:stf_csvtab      | Comma or tab separated values (CSV/TSV)\nGnumeric_sylk:sylk           | MultiPlan (SYLK)\nGnumeric_xbase:xbase         | Xbase (*.dbf) file format\n"
  },
  "exporters": {
    "argv": [
      "/opt/ssconvert-reference/bin/ssconvert",
      "--list-exporters"
    ],
    "status": 0,
    "stdout": "",
    "stderr": "ID                                | Description\nGnumeric_Excel:excel_biff7        | MS Excel? 5.0/95\nGnumeric_Excel:excel_biff8        | MS Excel? 97/2000/XP\nGnumeric_Excel:excel_dsf          | MS Excel? 97/2000/XP & 5.0/95\nGnumeric_Excel:xlsx               | ECMA 376 1st edition (2006); [MS Excel? 2007]\nGnumeric_Excel:xlsx2              | ISO/IEC 29500:2008 & ECMA 376 2nd edition (2008); [MS Excel? 2010]\nGnumeric_OpenCalc:odf             | ODF 1.2 extended conformance (*.ods)\nGnumeric_OpenCalc:openoffice      | ODF 1.2 strict conformance (*.ods)\nGnumeric_XmlIO:sax                | Gnumeric XML (*.gnumeric)\nGnumeric_XmlIO:sax:0              | Gnumeric XML uncompressed (*.xml)\nGnumeric_dif:dif                  | Data Interchange Format (*.dif)\nGnumeric_glpk:glpk                | GLPK Linear Program Solver\nGnumeric_html:html32              | HTML 3.2 (*.html)\nGnumeric_html:html40              | HTML 4.0 (*.html)\nGnumeric_html:html40frag          | HTML (*.html) fragment\nGnumeric_html:latex               | LaTeX 2e (*.tex)\nGnumeric_html:latex_table         | LaTeX 2e (*.tex) table fragment\nGnumeric_html:latex_table_visible | LaTeX 2e (*.tex) table fragment of visible rows\nGnumeric_html:roff                | TROFF (*.me)\nGnumeric_html:xhtml               | XHTML (*.html)\nGnumeric_html:xhtml_range         | XHTML range - for export to clipboard\nGnumeric_lpsolve:lpsolve          | LPSolve Linear Program Solver\nGnumeric_pdf:pdf_assistant        | PDF export\nGnumeric_stf:stf_assistant        | Text (configurable)\nGnumeric_stf:stf_csv              | Comma separated values (CSV)\nGnumeric_sylk:sylk                | MultiPlan (SYLK)\n"
  },
  "locale": {
    "argv": [
      "locale"
    ],
    "status": 0,
    "stdout": "LANG=C\nLANGUAGE=\nLC_CTYPE=\"C\"\nLC_NUMERIC=\"C\"\nLC_TIME=\"C\"\nLC_COLLATE=\"C\"\nLC_MONETARY=\"C\"\nLC_MESSAGES=\"C\"\nLC_PAPER=\"C\"\nLC_NAME=\"C\"\nLC_ADDRESS=\"C\"\nLC_TELEPHONE=\"C\"\nLC_MEASUREMENT=\"C\"\nLC_IDENTIFICATION=\"C\"\nLC_ALL=C\n",
    "stderr": ""
  },
  "packages": {
    "argv": [
      "dpkg-query",
      "-W"
    ],
    "status": 0,
    "stdout": "adduser\t3.152\nadwaita-icon-theme\t48.1-1\napt\t3.0.3\nat-spi2-common\t2.56.2-1+deb13u2\nat-spi2-core\t2.56.2-1+deb13u2\nautoconf\t2.72-3.1\nautomake\t1:1.17-4\nautotools-dev\t20240727.1\nbase-files\t13.8+deb13u7\nbase-passwd\t3.6.7\nbash\t5.2.37-2+b10\nbash-completion\t1:2.16.0-7\nbinutils\t2.44-3\nbinutils-aarch64-linux-gnu\t2.44-3\nbinutils-common:arm64\t2.44-3\nbison\t2:3.8.2+dfsg-1+b2\nbsdutils\t1:2.41.5-0+deb13u1\nbuild-essential\t12.12\nbzip2\t1.0.8-6\nbzip2-doc\t1.0.8-6\nca-certificates\t20250419\ncoreutils\t9.7-3\ncpp\t4:14.2.0-1\ncpp-14\t14.2.0-19\ncpp-14-aarch64-linux-gnu\t14.2.0-19\ncpp-aarch64-linux-gnu\t4:14.2.0-1\ncurl\t8.14.1-2+deb13u5\ndash\t0.5.12-12\ndbus\t1.16.2-2\ndbus-bin\t1.16.2-2\ndbus-daemon\t1.16.2-2\ndbus-session-bus-common\t1.16.2-2\ndbus-system-bus-common\t1.16.2-2\ndbus-user-session\t1.16.2-2\ndconf-gsettings-backend:arm64\t0.40.0-5\ndconf-service\t0.40.0-5\ndebconf\t1.5.91\ndebian-archive-keyring\t2025.1\ndebianutils\t5.23.2\ndiffutils\t1:3.10-4\ndmsetup\t2:1.02.205-2\ndpkg\t1.22.22\ndpkg-dev\t1.22.22\nfakeroot\t1.37.1.1-1\nfile\t1:5.46-5\nfindutils\t4.10.0-3\nfontconfig\t2.15.0-2.3\nfontconfig-config\t2.15.0-2.3\nfonts-dejavu-core\t2.37-8\nfonts-dejavu-mono\t2.37-8\ng++\t4:14.2.0-1\ng++-14\t14.2.0-19\ng++-14-aarch64-linux-gnu\t14.2.0-19\ng++-aarch64-linux-gnu\t4:14.2.0-1\ngcc\t4:14.2.0-1\ngcc-14\t14.2.0-19\ngcc-14-aarch64-linux-gnu\t14.2.0-19\ngcc-14-base:arm64\t14.2.0-19\ngcc-aarch64-linux-gnu\t4:14.2.0-1\ngettext\t0.23.1-2\ngettext-base\t0.23.1-2\ngir1.2-atk-1.0:arm64\t2.56.2-1+deb13u2\ngir1.2-atspi-2.0:arm64\t2.56.2-1+deb13u2\ngir1.2-cloudproviders-0.3.0:arm64\t0.3.6-2\ngir1.2-freedesktop:arm64\t1.84.0-1\ngir1.2-freedesktop-dev:arm64\t1.84.0-1\ngir1.2-gda-5.0:arm64\t5.2.10-5\ngir1.2-gdkpixbuf-2.0:arm64\t2.42.12+dfsg-4+deb13u1\ngir1.2-glib-2.0:arm64\t2.84.4-3~deb13u5\ngir1.2-glib-2.0-dev:arm64\t2.84.4-3~deb13u5\ngir1.2-gsf-1:arm64\t1.14.53-1\ngir1.2-gtk-3.0:arm64\t3.24.49-3\ngir1.2-harfbuzz-0.0:arm64\t10.2.0-1+deb13u1\ngir1.2-pango-1.0:arm64\t1.56.3-1\ngir1.2-rsvg-2.0:arm64\t2.60.0+dfsg-1\ngirepository-tools:arm64\t2.84.4-3~deb13u5\ngrep\t3.11-4+b1\ngsettings-desktop-schemas\t48.0-1\ngtk-update-icon-cache\t4.18.6+ds-2\ngzip\t1.13-1+deb13u1\nhicolor-icon-theme\t0.18-2\nhostname\t3.25\nicu-devtools\t76.1-4\ninit-system-helpers\t1.69~deb13u1\nintltool\t0.51.0-7\nitstool\t2.0.6-4\njavascript-common\t12+nmu1\nkrb5-locales\t1.21.3-5+deb13u1\nlibacl1:arm64\t2.3.2-2+b1\nlibalgorithm-diff-perl\t1.201-1\nlibalgorithm-diff-xs-perl\t0.04-9\nlibalgorithm-merge-perl\t0.08-5\nlibapparmor1:arm64\t4.1.0-1\nlibapt-pkg7.0:arm64\t3.0.3\nlibasan8:arm64\t14.2.0-19\nlibatk-bridge2.0-0t64:arm64\t2.56.2-1+deb13u2\nlibatk-bridge2.0-dev:arm64\t2.56.2-1+deb13u2\nlibatk1.0-0t64:arm64\t2.56.2-1+deb13u2\nlibatk1.0-dev:arm64\t2.56.2-1+deb13u2\nlibatomic1:arm64\t14.2.0-19\nlibatspi2.0-0t64:arm64\t2.56.2-1+deb13u2\nlibatspi2.0-dev:arm64\t2.56.2-1+deb13u2\nlibattr1:arm64\t1:2.5.2-3\nlibaudit-common\t1:4.0.2-2+deb13u1\nlibaudit1:arm64\t1:4.0.2-2+deb13u1\nlibauthen-sasl-perl\t2.1700-1\nlibavahi-client3:arm64\t0.8-16\nlibavahi-common-data:arm64\t0.8-16\nlibavahi-common3:arm64\t0.8-16\nlibbinutils:arm64\t2.44-3\nlibblkid-dev:arm64\t2.41.5-0+deb13u1\nlibblkid1:arm64\t2.41.5-0+deb13u1\nlibbrotli-dev:arm64\t1.1.0-2+b7\nlibbrotli1:arm64\t1.1.0-2+b7\nlibbsd0:arm64\t0.12.2-2\nlibbz2-1.0:arm64\t1.0.8-6\nlibbz2-dev:arm64\t1.0.8-6\nlibc-bin\t2.41-12+deb13u4\nlibc-dev-bin\t2.41-12+deb13u4\nlibc-l10n\t2.41-12+deb13u4\nlibc6:arm64\t2.41-12+deb13u4\nlibc6-dev:arm64\t2.41-12+deb13u4\nlibcairo-gobject2:arm64\t1.18.4-1+b1\nlibcairo-script-interpreter2:arm64\t1.18.4-1+b1\nlibcairo2:arm64\t1.18.4-1+b1\nlibcairo2-dev:arm64\t1.18.4-1+b1\nlibcap-dev:arm64\t1:2.75-10+deb13u1+b3\nlibcap-ng0:arm64\t0.8.5-4+b1\nlibcap2:arm64\t1:2.75-10+deb13u1+b3\nlibcc1-0:arm64\t14.2.0-19\nlibclone-perl:arm64\t0.47-1+b1\nlibcloudproviders-dev:arm64\t0.3.6-2\nlibcloudproviders0:arm64\t0.3.6-2\nlibcolord2:arm64\t1.4.7-3\nlibcom-err2:arm64\t1.47.2-3+b12\nlibcrypt-dev:arm64\t1:4.4.38-1\nlibcrypt1:arm64\t1:4.4.38-1\nlibcryptsetup12:arm64\t2:2.7.5-2\nlibctf-nobfd0:arm64\t2.44-3\nlibctf0:arm64\t2.44-3\nlibcups2t64:arm64\t2.4.10-3+deb13u2\nlibcurl4t64:arm64\t8.14.1-2+deb13u5\nlibdata-dump-perl\t1.25-1\nlibdatrie-dev:arm64\t0.2.13-3+b1\nlibdatrie1:arm64\t0.2.13-3+b1\nlibdav1d-dev:arm64\t1.5.1-1\nlibdav1d7:arm64\t1.5.1-1\nlibdb5.3t64:arm64\t5.3.28+dfsg2-9\nlibdbus-1-3:arm64\t1.16.2-2\nlibdbus-1-dev:arm64\t1.16.2-2\nlibdconf1:arm64\t0.40.0-5\nlibdebconfclient0:arm64\t0.280\nlibdeflate-dev:arm64\t1.23-2\nlibdeflate0:arm64\t1.23-2\nlibdevmapper1.02.1:arm64\t2:1.02.205-2\nlibdpkg-perl\t1.22.22\nlibdrm-amdgpu1:arm64\t2.4.124-2\nlibdrm-common\t2.4.124-2\nlibdrm2:arm64\t2.4.124-2\nlibedit2:arm64\t3.1-20250104-1\nlibegl-dev:arm64\t1.7.0-1+b2\nlibegl-mesa0:arm64\t25.0.7-2+deb13u1\nlibegl1:arm64\t1.7.0-1+b2\nlibegl1-mesa-dev:arm64\t25.0.7-2+deb13u1\nlibelf1t64:arm64\t0.192-4\nlibencode-locale-perl\t1.05-3\nlibepoxy-dev:arm64\t1.5.10-2\nlibepoxy0:arm64\t1.5.10-2\nlibexpat1:arm64\t2.8.3-1~deb13u1\nlibexpat1-dev:arm64\t2.8.3-1~deb13u1\nlibfakeroot:arm64\t1.37.1.1-1\nlibffi-dev:arm64\t3.4.8-2\nlibffi8:arm64\t3.4.8-2\nlibfile-fcntllock-perl\t0.22-4+b4\nlibfile-listing-perl\t6.16-1\nlibfont-afm-perl\t1.20-4\nlibfontconfig-dev:arm64\t2.15.0-2.3\nlibfontconfig1:arm64\t2.15.0-2.3\nlibfreetype-dev:arm64\t2.13.3+dfsg-1+deb13u1\nlibfreetype6:arm64\t2.13.3+dfsg-1+deb13u1\nlibfribidi-dev:arm64\t1.0.16-1\nlibfribidi0:arm64\t1.0.16-1\nlibgbm1:arm64\t25.0.7-2+deb13u1\nlibgcc-14-dev:arm64\t14.2.0-19\nlibgcc-s1:arm64\t14.2.0-19\nlibgcrypt20:arm64\t1.11.0-7+deb13u1\nlibgda-5.0-4t64:arm64\t5.2.10-5\nlibgda-5.0-common\t5.2.10-5\nlibgda-5.0-dev:arm64\t5.2.10-5\nlibgdbm-compat4t64:arm64\t1.24-2\nlibgdbm6t64:arm64\t1.24-2\nlibgdk-pixbuf-2.0-0:arm64\t2.42.12+dfsg-4+deb13u1\nlibgdk-pixbuf-2.0-dev:arm64\t2.42.12+dfsg-4+deb13u1\nlibgdk-pixbuf2.0-bin\t2.42.12+dfsg-4+deb13u1\nlibgdk-pixbuf2.0-common\t2.42.12+dfsg-4+deb13u1\nlibgio-2.0-dev:arm64\t2.84.4-3~deb13u5\nlibgio-2.0-dev-bin\t2.84.4-3~deb13u5\nlibgirepository-2.0-0:arm64\t2.84.4-3~deb13u5\nlibgl-dev:arm64\t1.7.0-1+b2\nlibgl1:arm64\t1.7.0-1+b2\nlibgl1-mesa-dri:arm64\t25.0.7-2+deb13u1\nlibgles-dev:arm64\t1.7.0-1+b2\nlibgles1:arm64\t1.7.0-1+b2\nlibgles2:arm64\t1.7.0-1+b2\nlibglib2.0-0t64:arm64\t2.84.4-3~deb13u5\nlibglib2.0-bin\t2.84.4-3~deb13u5\nlibglib2.0-data\t2.84.4-3~deb13u5\nlibglib2.0-dev:arm64\t2.84.4-3~deb13u5\nlibglib2.0-dev-bin\t2.84.4-3~deb13u5\nlibglvnd-core-dev:arm64\t1.7.0-1+b2\nlibglvnd-dev:arm64\t1.7.0-1+b2\nlibglvnd0:arm64\t1.7.0-1+b2\nlibglx-dev:arm64\t1.7.0-1+b2\nlibglx-mesa0:arm64\t25.0.7-2+deb13u1\nlibglx0:arm64\t1.7.0-1+b2\nlibgmp10:arm64\t2:6.3.0+dfsg-3\nlibgnutls30t64:arm64\t3.8.9-3+deb13u4\nlibgomp1:arm64\t14.2.0-19\nlibgpg-error-l10n\t1.51-4\nlibgpg-error0:arm64\t1.51-4\nlibgpm2:arm64\t1.20.7-11+b2\nlibgprofng0:arm64\t2.44-3\nlibgraphite2-3:arm64\t1.3.14-2+deb13u1\nlibgraphite2-dev:arm64\t1.3.14-2+deb13u1\nlibgsf-1-114:arm64\t1.14.53-1\nlibgsf-1-common\t1.14.53-1\nlibgsf-1-dev:arm64\t1.14.53-1\nlibgssapi-krb5-2:arm64\t1.21.3-5+deb13u1\nlibgtk-3-0t64:arm64\t3.24.49-3\nlibgtk-3-bin\t3.24.49-3\nlibgtk-3-common\t3.24.49-3\nlibgtk-3-dev:arm64\t3.24.49-3\nlibharfbuzz-cairo0:arm64\t10.2.0-1+deb13u1\nlibharfbuzz-dev:arm64\t10.2.0-1+deb13u1\nlibharfbuzz-gobject0:arm64\t10.2.0-1+deb13u1\nlibharfbuzz-icu0:arm64\t10.2.0-1+deb13u1\nlibharfbuzz-subset0:arm64\t10.2.0-1+deb13u1\nlibharfbuzz0b:arm64\t10.2.0-1+deb13u1\nlibhogweed6t64:arm64\t3.10.1-1\nlibhtml-form-perl\t6.12-1\nlibhtml-format-perl\t2.16-2\nlibhtml-parser-perl:arm64\t3.83-2~deb13u1\nlibhtml-tagset-perl\t3.24-1\nlibhtml-tree-perl\t5.07-3\nlibhttp-cookies-perl\t6.11-1\nlibhttp-daemon-perl\t6.16-1+deb13u1\nlibhttp-date-perl\t6.06-1\nlibhttp-message-perl\t7.00-2\nlibhttp-negotiate-perl\t6.01-2\nlibhwasan0:arm64\t14.2.0-19\nlibice-dev:arm64\t2:1.1.1-1\nlibice6:arm64\t2:1.1.1-1\nlibicu-dev:arm64\t76.1-4\nlibicu76:arm64\t76.1-4\nlibidn2-0:arm64\t2.3.8-2\nlibio-compress-brotli-perl\t0.004001-2+b3\nlibio-html-perl\t1.004-3\nlibio-socket-ssl-perl\t2.089-1\nlibisl23:arm64\t0.27-1\nlibitm1:arm64\t14.2.0-19\nlibjansson4:arm64\t2.14-2+b3\nlibjbig-dev:arm64\t2.1-6.1+b2\nlibjbig0:arm64\t2.1-6.1+b2\nlibjpeg-dev:arm64\t1:2.1.5-4\nlibjpeg62-turbo:arm64\t1:2.1.5-4\nlibjpeg62-turbo-dev:arm64\t1:2.1.5-4\nlibjs-jquery\t3.6.1+dfsg+~3.5.14-1\nlibjson-c5:arm64\t0.18+ds-1\nlibk5crypto3:arm64\t1.21.3-5+deb13u1\nlibkeyutils1:arm64\t1.6.3-6\nlibkmod2:arm64\t34.2-2\nlibkrb5-3:arm64\t1.21.3-5+deb13u1\nlibkrb5support0:arm64\t1.21.3-5+deb13u1\nliblastlog2-2:arm64\t2.41.5-0+deb13u1\nliblcms2-2:arm64\t2.16-2+deb13u2\nlibldap-common\t2.6.10+dfsg-1\nlibldap2:arm64\t2.6.10+dfsg-1\nliblerc-dev:arm64\t4.0.0+ds-5\nliblerc4:arm64\t4.0.0+ds-5\nlibllvm19:arm64\t1:19.1.7-3+b1\nliblocale-gettext-perl\t1.07-7+b1\nliblsan0:arm64\t14.2.0-19\nliblwp-mediatypes-perl\t6.04-2\nliblwp-protocol-https-perl\t6.14-1\nliblz4-1:arm64\t1.10.0-4\nliblzma-dev:arm64\t5.8.1-1+deb13u1\nliblzma5:arm64\t5.8.1-1+deb13u1\nliblzo2-2:arm64\t2.10-3+b1\nlibmagic-mgc\t1:5.46-5\nlibmagic1t64:arm64\t1:5.46-5\nlibmailtools-perl\t2.22-1\nlibmd0:arm64\t1.1.0-2+b1\nlibmount-dev:arm64\t2.41.5-0+deb13u1\nlibmount1:arm64\t2.41.5-0+deb13u1\nlibmpc3:arm64\t1.3.1-1+b3\nlibmpfr6:arm64\t4.2.2-1\nlibncursesw6:arm64\t6.5+20250216-2\nlibnet-http-perl\t6.23-1\nlibnet-smtp-ssl-perl\t1.04-2\nlibnet-ssleay-perl:arm64\t1.94-3\nlibnettle8t64:arm64\t3.10.1-1\nlibnghttp2-14:arm64\t1.64.0-1.1+deb13u1\nlibnghttp3-9:arm64\t1.8.0-1\nlibnss-systemd:arm64\t257.13-1~deb13u1\nlibopengl-dev:arm64\t1.7.0-1+b2\nlibopengl0:arm64\t1.7.0-1+b2\nlibp11-kit0:arm64\t0.25.5-3\nlibpam-modules:arm64\t1.7.0-5\nlibpam-modules-bin\t1.7.0-5\nlibpam-runtime\t1.7.0-5\nlibpam-systemd:arm64\t257.13-1~deb13u1\nlibpam0g:arm64\t1.7.0-5\nlibpango-1.0-0:arm64\t1.56.3-1\nlibpango1.0-dev:arm64\t1.56.3-1\nlibpangocairo-1.0-0:arm64\t1.56.3-1\nlibpangoft2-1.0-0:arm64\t1.56.3-1\nlibpangoxft-1.0-0:arm64\t1.56.3-1\nlibpcre2-16-0:arm64\t10.46-1~deb13u2\nlibpcre2-32-0:arm64\t10.46-1~deb13u2\nlibpcre2-8-0:arm64\t10.46-1~deb13u2\nlibpcre2-dev:arm64\t10.46-1~deb13u2\nlibpcre2-posix3:arm64\t10.46-1~deb13u2\nlibperl5.40:arm64\t5.40.1-6+deb13u1\nlibpixman-1-0:arm64\t0.44.0-3\nlibpixman-1-dev:arm64\t0.44.0-3\nlibpkgconf3:arm64\t1.8.1-4\nlibpng-dev:arm64\t1.6.48-1+deb13u5\nlibpng-tools\t1.6.48-1+deb13u5\nlibpng16-16t64:arm64\t1.6.48-1+deb13u5\nlibproc2-0:arm64\t2:4.0.4-9\nlibpsl5t64:arm64\t0.21.2-1.1+b1\nlibpython3-stdlib:arm64\t3.13.5-1\nlibpython3.13-minimal:arm64\t3.13.5-2+deb13u5\nlibpython3.13-stdlib:arm64\t3.13.5-2+deb13u5\nlibreadline8t64:arm64\t8.2-6\nlibrsvg2-2:arm64\t2.60.0+dfsg-1\nlibrsvg2-common:arm64\t2.60.0+dfsg-1\nlibrsvg2-dev:arm64\t2.60.0+dfsg-1\nlibrtmp1:arm64\t2.4+20151223.gitfa8646d.1-2+b5\nlibsasl2-2:arm64\t2.1.28+dfsg1-9\nlibsasl2-modules:arm64\t2.1.28+dfsg1-9\nlibsasl2-modules-db:arm64\t2.1.28+dfsg1-9\nlibseccomp2:arm64\t2.6.0-2\nlibselinux1:arm64\t3.8.1-1\nlibselinux1-dev:arm64\t3.8.1-1\nlibsemanage-common\t3.8.1-1\nlibsemanage2:arm64\t3.8.1-1\nlibsensors-config\t1:3.6.2-2\nlibsensors5:arm64\t1:3.6.2-2\nlibsepol-dev:arm64\t3.8.1-1\nlibsepol2:arm64\t3.8.1-1\nlibsframe1:arm64\t2.44-3\nlibsharpyuv-dev:arm64\t1.5.0-0.1\nlibsharpyuv0:arm64\t1.5.0-0.1\nlibsm-dev:arm64\t2:1.2.6-1\nlibsm6:arm64\t2:1.2.6-1\nlibsmartcols1:arm64\t2.41.5-0+deb13u1\nlibsqlite3-0:arm64\t3.46.1-7+deb13u2\nlibssh2-1t64:arm64\t1.11.1-1+deb13u2\nlibssl3t64:arm64\t3.5.7-1~deb13u2\nlibstdc++-14-dev:arm64\t14.2.0-19\nlibstdc++6:arm64\t14.2.0-19\nlibsysprof-capture-4-dev:arm64\t48.0-2\nlibsystemd-dev:arm64\t257.13-1~deb13u1\nlibsystemd-shared:arm64\t257.13-1~deb13u1\nlibsystemd0:arm64\t257.13-1~deb13u1\nlibtasn1-6:arm64\t4.20.0-2+deb13u1\nlibthai-data\t0.1.29-2\nlibthai-dev:arm64\t0.1.29-2+b1\nlibthai0:arm64\t0.1.29-2+b1\nlibtiff-dev:arm64\t4.7.0-3+deb13u3\nlibtiff6:arm64\t4.7.0-3+deb13u3\nlibtiffxx6:arm64\t4.7.0-3+deb13u3\nlibtimedate-perl\t2.3300-2\nlibtinfo6:arm64\t6.5+20250216-2\nlibtry-tiny-perl\t0.32-1\nlibtsan2:arm64\t14.2.0-19\nlibubsan1:arm64\t14.2.0-19\nlibudev1:arm64\t257.13-1~deb13u1\nlibunistring5:arm64\t1.3-2\nliburi-perl\t5.30-1\nlibuuid1:arm64\t2.41.5-0+deb13u1\nlibvulkan1:arm64\t1.4.309.0-1\nlibwayland-bin\t1.23.1-3\nlibwayland-client0:arm64\t1.23.1-3\nlibwayland-cursor0:arm64\t1.23.1-3\nlibwayland-dev:arm64\t1.23.1-3\nlibwayland-egl1:arm64\t1.23.1-3\nlibwayland-server0:arm64\t1.23.1-3\nlibwebp-dev:arm64\t1.5.0-0.1\nlibwebp7:arm64\t1.5.0-0.1\nlibwebpdecoder3:arm64\t1.5.0-0.1\nlibwebpdemux2:arm64\t1.5.0-0.1\nlibwebpmux3:arm64\t1.5.0-0.1\nlibwww-perl\t6.78-1\nlibwww-robotrules-perl\t6.02-1\nlibx11-6:arm64\t2:1.8.12-1\nlibx11-data\t2:1.8.12-1\nlibx11-dev:arm64\t2:1.8.12-1\nlibx11-xcb1:arm64\t2:1.8.12-1\nlibxau-dev:arm64\t1:1.0.11-1\nlibxau6:arm64\t1:1.0.11-1\nlibxcb-dri3-0:arm64\t1.17.0-2+b1\nlibxcb-glx0:arm64\t1.17.0-2+b1\nlibxcb-present0:arm64\t1.17.0-2+b1\nlibxcb-randr0:arm64\t1.17.0-2+b1\nlibxcb-render0:arm64\t1.17.0-2+b1\nlibxcb-render0-dev:arm64\t1.17.0-2+b1\nlibxcb-shm0:arm64\t1.17.0-2+b1\nlibxcb-shm0-dev:arm64\t1.17.0-2+b1\nlibxcb-sync1:arm64\t1.17.0-2+b1\nlibxcb-xfixes0:arm64\t1.17.0-2+b1\nlibxcb1:arm64\t1.17.0-2+b1\nlibxcb1-dev:arm64\t1.17.0-2+b1\nlibxcomposite-dev:arm64\t1:0.4.6-1\nlibxcomposite1:arm64\t1:0.4.6-1\nlibxcursor-dev:arm64\t1:1.2.3-1\nlibxcursor1:arm64\t1:1.2.3-1\nlibxdamage-dev:arm64\t1:1.1.6-1+b2\nlibxdamage1:arm64\t1:1.1.6-1+b2\nlibxdmcp-dev:arm64\t1:1.1.5-1\nlibxdmcp6:arm64\t1:1.1.5-1\nlibxext-dev:arm64\t2:1.3.4-1+b3\nlibxext6:arm64\t2:1.3.4-1+b3\nlibxfixes-dev:arm64\t1:6.0.0-2+b4\nlibxfixes3:arm64\t1:6.0.0-2+b4\nlibxft-dev:arm64\t2.3.6-1+b4\nlibxft2:arm64\t2.3.6-1+b4\nlibxi-dev:arm64\t2:1.8.2-1\nlibxi6:arm64\t2:1.8.2-1\nlibxinerama-dev:arm64\t2:1.1.4-3+b4\nlibxinerama1:arm64\t2:1.1.4-3+b4\nlibxkbcommon-dev:arm64\t1.7.0-2\nlibxkbcommon0:arm64\t1.7.0-2\nlibxml-parser-perl\t2.47-2~deb13u1\nlibxml2:arm64\t2.12.7+dfsg+really2.9.14-2.1+deb13u3\nlibxml2-dev:arm64\t2.12.7+dfsg+really2.9.14-2.1+deb13u3\nlibxml2-utils\t2.12.7+dfsg+really2.9.14-2.1+deb13u3\nlibxrandr-dev:arm64\t2:1.5.4-1+b3\nlibxrandr2:arm64\t2:1.5.4-1+b3\nlibxrender-dev:arm64\t1:0.9.12-1\nlibxrender1:arm64\t1:0.9.12-1\nlibxshmfence1:arm64\t1.3.3-1\nlibxslt1-dev:arm64\t1.1.35-1.2+deb13u3\nlibxslt1.1:arm64\t1.1.35-1.2+deb13u3\nlibxtst-dev:arm64\t2:1.2.5-1\nlibxtst6:arm64\t2:1.2.5-1\nlibxxf86vm1:arm64\t1:1.1.4-1+b4\nlibxxhash0:arm64\t0.8.3-2\nlibz3-4:arm64\t4.13.3-1\nlibzstd-dev:arm64\t1.5.7+dfsg-1\nlibzstd1:arm64\t1.5.7+dfsg-1\nlinux-libc-dev\t6.12.107-1\nlinux-sysctl-defaults\t4.12.1\nlocales\t2.41-12+deb13u4\nlogin\t1:4.16.0-2+really2.41.5-0+deb13u1\nlogin.defs\t1:4.17.4-2\nm4\t1.4.19-8\nmake\t4.4.1-2\nmanpages\t6.9.1-1\nmanpages-dev\t6.9.1-1\nmawk\t1.3.4.20250131-1\nmedia-types\t13.0.0\nmesa-libgallium:arm64\t25.0.7-2+deb13u1\nmesa-vulkan-drivers:arm64\t25.0.7-2+deb13u1\nmount\t2.41.5-0+deb13u1\nnative-architecture\t0.2.6\nncurses-base\t6.5+20250216-2\nncurses-bin\t6.5+20250216-2\nnetbase\t6.5\nopenssl\t3.5.7-1~deb13u2\nopenssl-provider-legacy\t3.5.7-1~deb13u2\npango1.0-tools\t1.56.3-1\npasswd\t1:4.17.4-2\npatch\t2.8-2\nperl\t5.40.1-6+deb13u1\nperl-base\t5.40.1-6+deb13u1\nperl-modules-5.40\t5.40.1-6+deb13u1\nperl-openssl-defaults:arm64\t7+b2\npkg-config:arm64\t1.8.1-4\npkgconf:arm64\t1.8.1-4\npkgconf-bin\t1.8.1-4\nprocps\t2:4.0.4-9\npsmisc\t23.7-2\npublicsuffix\t20250328.1952-0.1\npython3\t3.13.5-1\npython3-libxml2:arm64\t2.12.7+dfsg+really2.9.14-2.1+deb13u3\npython3-minimal\t3.13.5-1\npython3-packaging\t25.0-1\npython3.13\t3.13.5-2+deb13u5\npython3.13-minimal\t3.13.5-2+deb13u5\nreadline-common\t8.2-6\nrpcsvc-proto\t1.4.3-1+b1\nsed\t4.9-2+deb13u1\nsgml-base\t1.31+nmu1\nshared-mime-info\t2.4-5+b2\nsq\t1.3.1-2+b2\nsqv\t1.3.0-3+b2\nsystemd\t257.13-1~deb13u1\nsystemd-cryptsetup\t257.13-1~deb13u1\nsystemd-sysv\t257.13-1~deb13u1\nsystemd-timesyncd\t257.13-1~deb13u1\nsysvinit-utils\t3.14-4\ntar\t1.35+dfsg-3.1\ntzdata\t2026c-0+deb13u1\nutil-linux\t2.41.5-0+deb13u1\nuuid-dev:arm64\t2.41.5-0+deb13u1\nwayland-protocols\t1.44-1\nx11-common\t1:7.7+24+deb13u1\nx11proto-dev\t2024.1-1\nxdg-user-dirs\t0.18-2\nxkb-data\t2.42-1\nxml-core\t0.19\nxorg-sgml-doctools\t1:1.11-1.1\nxtrans-dev\t1.4.0-1\nxz-utils\t5.8.1-1+deb13u1\nzlib1g:arm64\t1:1.3.dfsg+really1.3.1-1+b1\nzlib1g-dev:arm64\t1:1.3.dfsg+really1.3.1-1+b1\n",
    "stderr": ""
  },
  "linked": {
    "argv": [
      "ldd",
      "/opt/ssconvert-reference/bin/ssconvert"
    ],
    "status": 0,
    "stdout": "\tlinux-vdso.so.1 (0x0000f0f9ff1a5000)\n\tlibspreadsheet-1.12.61.so => /opt/ssconvert-reference/lib/libspreadsheet-1.12.61.so (0x0000f0f9febf0000)\n\tlibgoffice-0.10.so.10 => /opt/ssconvert-reference/lib/libgoffice-0.10.so.10 (0x0000f0f9fea00000)\n\tlibgsf-1.so.114 => /lib/aarch64-linux-gnu/libgsf-1.so.114 (0x0000f0f9fe990000)\n\tlibgtk-3.so.0 => /lib/aarch64-linux-gnu/libgtk-3.so.0 (0x0000f0f9fe130000)\n\tlibgobject-2.0.so.0 => /lib/aarch64-linux-gnu/libgobject-2.0.so.0 (0x0000f0f9fe0a0000)\n\tlibglib-2.0.so.0 => /lib/aarch64-linux-gnu/libglib-2.0.so.0 (0x0000f0f9fdf10000)\n\tlibc.so.6 => /lib/aarch64-linux-gnu/libc.so.6 (0x0000f0f9fdd50000)\n\tlibxml2.so.2 => /lib/aarch64-linux-gnu/libxml2.so.2 (0x0000f0f9fdb80000)\n\tlibgmodule-2.0.so.0 => /lib/aarch64-linux-gnu/libgmodule-2.0.so.0 (0x0000f0f9fdb50000)\n\tlibgdk-3.so.0 => /lib/aarch64-linux-gnu/libgdk-3.so.0 (0x0000f0f9fda20000)\n\tlibpangocairo-1.0.so.0 => /lib/aarch64-linux-gnu/libpangocairo-1.0.so.0 (0x0000f0f9fd9f0000)\n\tlibpango-1.0.so.0 => /lib/aarch64-linux-gnu/libpango-1.0.so.0 (0x0000f0f9fd960000)\n\tlibatk-1.0.so.0 => /lib/aarch64-linux-gnu/libatk-1.0.so.0 (0x0000f0f9fd910000)\n\tlibcairo.so.2 => /lib/aarch64-linux-gnu/libcairo.so.2 (0x0000f0f9fd7b0000)\n\tlibgdk_pixbuf-2.0.so.0 => /lib/aarch64-linux-gnu/libgdk_pixbuf-2.0.so.0 (0x0000f0f9fd760000)\n\tlibgio-2.0.so.0 => /lib/aarch64-linux-gnu/libgio-2.0.so.0 (0x0000f0f9fd530000)\n\tlibm.so.6 => /lib/aarch64-linux-gnu/libm.so.6 (0x0000f0f9fd480000)\n\tlibxslt.so.1 => /lib/aarch64-linux-gnu/libxslt.so.1 (0x0000f0f9fd420000)\n\tlibrsvg-2.so.2 => /lib/aarch64-linux-gnu/librsvg-2.so.2 (0x0000f0f9fceb0000)\n\tlibz.so.1 => /lib/aarch64-linux-gnu/libz.so.1 (0x0000f0f9fce70000)\n\tlibbz2.so.1.0 => /lib/aarch64-linux-gnu/libbz2.so.1.0 (0x0000f0f9fce40000)\n\t/lib/ld-linux-aarch64.so.1 (0x0000f0f9ff160000)\n\tlibharfbuzz.so.0 => /lib/aarch64-linux-gnu/libharfbuzz.so.0 (0x0000f0f9fcce0000)\n\tlibpangoft2-1.0.so.0 => /lib/aarch64-linux-gnu/libpangoft2-1.0.so.0 (0x0000f0f9fcca0000)\n\tlibfontconfig.so.1 => /lib/aarch64-linux-gnu/libfontconfig.so.1 (0x0000f0f9fcc30000)\n\tlibfribidi.so.0 => /lib/aarch64-linux-gnu/libfribidi.so.0 (0x0000f0f9fcbf0000)\n\tlibcairo-gobject.so.2 => /lib/aarch64-linux-gnu/libcairo-gobject.so.2 (0x0000f0f9fcbc0000)\n\tlibepoxy.so.0 => /lib/aarch64-linux-gnu/libepoxy.so.0 (0x0000f0f9fca50000)\n\tlibXi.so.6 => /lib/aarch64-linux-gnu/libXi.so.6 (0x0000f0f9fca20000)\n\tlibX11.so.6 => /lib/aarch64-linux-gnu/libX11.so.6 (0x0000f0f9fc8b0000)\n\tlibatk-bridge-2.0.so.0 => /lib/aarch64-linux-gnu/libatk-bridge-2.0.so.0 (0x0000f0f9fc850000)\n\tlibcloudproviders.so.0 => /lib/aarch64-linux-gnu/libcloudproviders.so.0 (0x0000f0f9fc810000)\n\tlibXfixes.so.3 => /lib/aarch64-linux-gnu/libXfixes.so.3 (0x0000f0f9fc7e0000)\n\tlibffi.so.8 => /lib/aarch64-linux-gnu/libffi.so.8 (0x0000f0f9fc7b0000)\n\tlibatomic.so.1 => /lib/aarch64-linux-gnu/libatomic.so.1 (0x0000f0f9fc780000)\n\tlibpcre2-8.so.0 => /lib/aarch64-linux-gnu/libpcre2-8.so.0 (0x0000f0f9fc6c0000)\n\tliblzma.so.5 => /lib/aarch64-linux-gnu/liblzma.so.5 (0x0000f0f9fc670000)\n\tlibxkbcommon.so.0 => /lib/aarch64-linux-gnu/libxkbcommon.so.0 (0x0000f0f9fc600000)\n\tlibwayland-client.so.0 => /lib/aarch64-linux-gnu/libwayland-client.so.0 (0x0000f0f9fc5d0000)\n\tlibwayland-cursor.so.0 => /lib/aarch64-linux-gnu/libwayland-cursor.so.0 (0x0000f0f9fc5a0000)\n\tlibwayland-egl.so.1 => /lib/aarch64-linux-gnu/libwayland-egl.so.1 (0x0000f0f9fc570000)\n\tlibXext.so.6 => /lib/aarch64-linux-gnu/libXext.so.6 (0x0000f0f9fc530000)\n\tlibXcursor.so.1 => /lib/aarch64-linux-gnu/libXcursor.so.1 (0x0000f0f9fc500000)\n\tlibXdamage.so.1 => /lib/aarch64-linux-gnu/libXdamage.so.1 (0x0000f0f9fc4d0000)\n\tlibXcomposite.so.1 => /lib/aarch64-linux-gnu/libXcomposite.so.1 (0x0000f0f9fc4a0000)\n\tlibXrandr.so.2 => /lib/aarch64-linux-gnu/libXrandr.so.2 (0x0000f0f9fc470000)\n\tlibXinerama.so.1 => /lib/aarch64-linux-gnu/libXinerama.so.1 (0x0000f0f9fc440000)\n\tlibthai.so.0 => /lib/aarch64-linux-gnu/libthai.so.0 (0x0000f0f9fc410000)\n\tlibpng16.so.16 => /lib/aarch64-linux-gnu/libpng16.so.16 (0x0000f0f9fc3b0000)\n\tlibfreetype.so.6 => /lib/aarch64-linux-gnu/libfreetype.so.6 (0x0000f0f9fc2d0000)\n\tlibXrender.so.1 => /lib/aarch64-linux-gnu/libXrender.so.1 (0x0000f0f9fc2a0000)\n\tlibxcb.so.1 => /lib/aarch64-linux-gnu/libxcb.so.1 (0x0000f0f9fc250000)\n\tlibxcb-render.so.0 => /lib/aarch64-linux-gnu/libxcb-render.so.0 (0x0000f0f9fc220000)\n\tlibxcb-shm.so.0 => /lib/aarch64-linux-gnu/libxcb-shm.so.0 (0x0000f0f9fc1f0000)\n\tlibpixman-1.so.0 => /lib/aarch64-linux-gnu/libpixman-1.so.0 (0x0000f0f9fc140000)\n\tlibjpeg.so.62 => /lib/aarch64-linux-gnu/libjpeg.so.62 (0x0000f0f9fc0c0000)\n\tlibmount.so.1 => /lib/aarch64-linux-gnu/libmount.so.1 (0x0000f0f9fc020000)\n\tlibselinux.so.1 => /lib/aarch64-linux-gnu/libselinux.so.1 (0x0000f0f9fbfc0000)\n\tlibgcc_s.so.1 => /lib/aarch64-linux-gnu/libgcc_s.so.1 (0x0000f0f9fbf80000)\n\tlibdav1d.so.7 => /lib/aarch64-linux-gnu/libdav1d.so.7 (0x0000f0f9fbe80000)\n\tlibgraphite2.so.3 => /lib/aarch64-linux-gnu/libgraphite2.so.3 (0x0000f0f9fbe40000)\n\tlibexpat.so.1 => /lib/aarch64-linux-gnu/libexpat.so.1 (0x0000f0f9fbdf0000)\n\tlibatspi.so.0 => /lib/aarch64-linux-gnu/libatspi.so.0 (0x0000f0f9fbd90000)\n\tlibdbus-1.so.3 => /lib/aarch64-linux-gnu/libdbus-1.so.3 (0x0000f0f9fbd10000)\n\tlibdatrie.so.1 => /lib/aarch64-linux-gnu/libdatrie.so.1 (0x0000f0f9fbce0000)\n\tlibbrotlidec.so.1 => /lib/aarch64-linux-gnu/libbrotlidec.so.1 (0x0000f0f9fbcb0000)\n\tlibXau.so.6 => /lib/aarch64-linux-gnu/libXau.so.6 (0x0000f0f9fbc80000)\n\tlibXdmcp.so.6 => /lib/aarch64-linux-gnu/libXdmcp.so.6 (0x0000f0f9fbc50000)\n\tlibblkid.so.1 => /lib/aarch64-linux-gnu/libblkid.so.1 (0x0000f0f9fbbd0000)\n\tlibsystemd.so.0 => /lib/aarch64-linux-gnu/libsystemd.so.0 (0x0000f0f9fbaa0000)\n\tlibbrotlicommon.so.1 => /lib/aarch64-linux-gnu/libbrotlicommon.so.1 (0x0000f0f9fba60000)\n\tlibcap.so.2 => /lib/aarch64-linux-gnu/libcap.so.2 (0x0000f0f9fba30000)\n",
    "stderr": ""
  },
  "installedPlugins": [
    {
      "path": "/opt/ssconvert-reference/lib/gnumeric/1.12.61/plugins/fn-complex/plugin.xml",
      "sha256": "a5574fbeca4886d4b2d1833c87d426ecbbe0dcfb3cd3aa4889f05ec26a1131a3"
    },
    {
      "path": "/opt/ssconvert-reference/lib/gnumeric/1.12.61/plugins/html/plugin.xml",
      "sha256": "0e24fe00f38781cdb1a63056cd382747edcd41c8decb7b355cb8ac8485de31cd"
    },
    {
      "path": "/opt/ssconvert-reference/lib/gnumeric/1.12.61/plugins/fn-info/plugin.xml",
      "sha256": "9871ad45a606d789ea8a88c8ebf0f3c24c8ad36a48085c0d3640855537d593d1"
    },
    {
      "path": "/opt/ssconvert-reference/lib/gnumeric/1.12.61/plugins/oleo/plugin.xml",
      "sha256": "04785baf2b561c260c0b5d6b86f0f3ce372d4e52446fba12aabe723a8b61862f"
    },
    {
      "path": "/opt/ssconvert-reference/lib/gnumeric/1.12.61/plugins/plan_perfect/plugin.xml",
      "sha256": "725750f75463e7e23bcef0d258e6d608f8acb3b40420dd34c41c5aabc3d6c0ac"
    },
    {
      "path": "/opt/ssconvert-reference/lib/gnumeric/1.12.61/plugins/fn-hebrew-date/plugin.xml",
      "sha256": "1bc6f5cf11d2ff63acf624460e792028348a3b779bd9d912f05c3cf3f2b536c3"
    },
    {
      "path": "/opt/ssconvert-reference/lib/gnumeric/1.12.61/plugins/fn-logical/plugin.xml",
      "sha256": "5389636fe217178ea53c2f786576f03171f7272cda505116d1ff120353557712"
    },
    {
      "path": "/opt/ssconvert-reference/lib/gnumeric/1.12.61/plugins/nlsolve/plugin.xml",
      "sha256": "e8e43964a2956c5c2d671aa84f529142868fc6a8a4bf4e959f3cc1562a7a73c8"
    },
    {
      "path": "/opt/ssconvert-reference/lib/gnumeric/1.12.61/plugins/fn-date/plugin.xml",
      "sha256": "ebe04a5845a58a9b5838d81974053e79ffb9ef22f505827d3673a9606dee66e5"
    },
    {
      "path": "/opt/ssconvert-reference/lib/gnumeric/1.12.61/plugins/excel/plugin.xml",
      "sha256": "04af00f442424ae635c43d758c9da5a9cef93731015519e5a01c0da7a635aff2"
    },
    {
      "path": "/opt/ssconvert-reference/lib/gnumeric/1.12.61/plugins/fn-r/plugin.xml",
      "sha256": "8bb27356e050e4ac7598412725bc400431ce3e6c7a481e55e6ebbf8bc351b959"
    },
    {
      "path": "/opt/ssconvert-reference/lib/gnumeric/1.12.61/plugins/fn-string/plugin.xml",
      "sha256": "4c576c6678566525258e4ed3102db586429e9e4b178b3c14ef3ab62be773b3bf"
    },
    {
      "path": "/opt/ssconvert-reference/lib/gnumeric/1.12.61/plugins/sylk/plugin.xml",
      "sha256": "5b0dff2a02ef7efa50773c1c775766c9cb9c8ae8a70645a9fe1c7b1cf8aa3c54"
    },
    {
      "path": "/opt/ssconvert-reference/lib/gnumeric/1.12.61/plugins/applix/plugin.xml",
      "sha256": "6d35f6abb0886d915ba6e4b7cfc17e23678804e82cbb92018b277d12321c686a"
    },
    {
      "path": "/opt/ssconvert-reference/lib/gnumeric/1.12.61/plugins/fn-database/plugin.xml",
      "sha256": "7ebcf83d399b971cfa949a512515f149707e66fd70e63a977035766d56f16e44"
    },
    {
      "path": "/opt/ssconvert-reference/lib/gnumeric/1.12.61/plugins/fn-numtheory/plugin.xml",
      "sha256": "4540ff972f2b5c35e1c709ca522bb385333d1fb9832ebcb9a355c87000075978"
    },
    {
      "path": "/opt/ssconvert-reference/lib/gnumeric/1.12.61/plugins/fn-lookup/plugin.xml",
      "sha256": "73f79393f3e38c493080afe204a0bea3b8ee936d6342aa680800f6dfc5b507a6"
    },
    {
      "path": "/opt/ssconvert-reference/lib/gnumeric/1.12.61/plugins/sc/plugin.xml",
      "sha256": "ac9c8c8ca7b20045cd6e297b985f47ed0109468752357adf99e81275c3e6674c"
    },
    {
      "path": "/opt/ssconvert-reference/lib/gnumeric/1.12.61/plugins/fn-math/plugin.xml",
      "sha256": "971a835f16d9c26130875f07b1eece000a3405ac05244305f0472bff4823430c"
    },
    {
      "path": "/opt/ssconvert-reference/lib/gnumeric/1.12.61/plugins/fn-eng/plugin.xml",
      "sha256": "d06c9e7d9aec1849fa9ea5d9bd267f4af20f227a98c708dc57ed3b63f17f93cc"
    },
    {
      "path": "/opt/ssconvert-reference/lib/gnumeric/1.12.61/plugins/fn-christian-date/plugin.xml",
      "sha256": "a17f4faa5ccea0be71c413b1ab15617ab935a0492bc79c376aadc611c978fb46"
    },
    {
      "path": "/opt/ssconvert-reference/lib/gnumeric/1.12.61/plugins/glpk/plugin.xml",
      "sha256": "f9ff2f40013f2ba14c5f2cf363591508fed7c681ac4e7b426f889e754fa37ea6"
    },
    {
      "path": "/opt/ssconvert-reference/lib/gnumeric/1.12.61/plugins/fn-financial/plugin.xml",
      "sha256": "b26fadcf27e9783fa243775f74851730675703f8a25fa1c3c16cd775803505d3"
    },
    {
      "path": "/opt/ssconvert-reference/lib/gnumeric/1.12.61/plugins/fn-tsa/plugin.xml",
      "sha256": "b1efca176c3e4acb7988b62619d942b345dc4651441e45d8faad2db52f22d351"
    },
    {
      "path": "/opt/ssconvert-reference/lib/gnumeric/1.12.61/plugins/fn-derivatives/plugin.xml",
      "sha256": "512e2debdc09f8ab5adaab5c7f99b5c414a31d7b4285dfe81c5b7b382c7a5093"
    },
    {
      "path": "/opt/ssconvert-reference/lib/gnumeric/1.12.61/plugins/fn-erlang/plugin.xml",
      "sha256": "98edcc7806bf6e51ad0a27ca299b207750ecfd2367460ef13dc42a3ab8c83bda"
    },
    {
      "path": "/opt/ssconvert-reference/lib/gnumeric/1.12.61/plugins/mps/plugin.xml",
      "sha256": "b4af2d3924241b0e15ad39afb433cf802135d92a6c8b5bde328e409cf4814f9d"
    },
    {
      "path": "/opt/ssconvert-reference/lib/gnumeric/1.12.61/plugins/fn-flt/plugin.xml",
      "sha256": "4377e08837429c637fd528229634443a84d1e1b1ff442e942a427d44026b9f8d"
    },
    {
      "path": "/opt/ssconvert-reference/lib/gnumeric/1.12.61/plugins/qpro/plugin.xml",
      "sha256": "2ad3b9c8436d47d497fe8394626a19efb085f53afaa420637ec758401039a9f3"
    },
    {
      "path": "/opt/ssconvert-reference/lib/gnumeric/1.12.61/plugins/xbase/plugin.xml",
      "sha256": "77dee717114afeecce37ea4d348fff0c2ffe230b345607e0e10819578ec6780a"
    },
    {
      "path": "/opt/ssconvert-reference/lib/gnumeric/1.12.61/plugins/lotus/plugin.xml",
      "sha256": "a38de08bb20b878d566708a305d242ff898b8df6fbfd467af43362d46cd38f5b"
    },
    {
      "path": "/opt/ssconvert-reference/lib/gnumeric/1.12.61/plugins/openoffice/plugin.xml",
      "sha256": "261ac77c377ed815456a8f6934cc12a9a6edca868e08cfe331a17fdadce73c0f"
    },
    {
      "path": "/opt/ssconvert-reference/lib/gnumeric/1.12.61/plugins/uihello/plugin.xml",
      "sha256": "54f9eb2f628c6d4d069a89426ad5e9b9e4229340d0a9dc628e63f991befb6a37"
    },
    {
      "path": "/opt/ssconvert-reference/lib/gnumeric/1.12.61/plugins/dif/plugin.xml",
      "sha256": "c4df295133bbea7ec076e0334c7c8578258e34e1ccbd492eaa52ab21bd3553d6"
    },
    {
      "path": "/opt/ssconvert-reference/lib/gnumeric/1.12.61/plugins/fn-stat/plugin.xml",
      "sha256": "9dc90aaf8202a8dae7000c7a740df897f7cf477932652bb14c60d86515d34606"
    },
    {
      "path": "/opt/ssconvert-reference/lib/gnumeric/1.12.61/plugins/lpsolve/plugin.xml",
      "sha256": "48a4d9c2142d9eb0bf8ecf0136841e9e500cf5c0bd88471e1802159232f1a0f3"
    },
    {
      "path": "/opt/ssconvert-reference/lib/gnumeric/1.12.61/plugins/sample_datasource/plugin.xml",
      "sha256": "82285e2a1f04ca5e9ff50b3c534710fd3de52faad19ad1bb2fdf65adfafbd2ac"
    },
    {
      "path": "/opt/ssconvert-reference/lib/gnumeric/1.12.61/plugins/fn-random/plugin.xml",
      "sha256": "e9802b5951b077a533f7c90ae6feae5b2a22aa38191911a04b58c45bbdbfa634"
    },
    {
      "path": "/opt/ssconvert-reference/lib/goffice/0.10.61/plugins/plot_barcol/plugin.xml",
      "sha256": "f48224671f251c9a5bd552c83880ee298c9d1e20cd5a6dd8eb283999607cc893"
    },
    {
      "path": "/opt/ssconvert-reference/lib/goffice/0.10.61/plugins/reg_logfit/plugin.xml",
      "sha256": "956faddbdc7e8af08aadd3af0b9077edc213bfd2257ed0e885766987706c3b56"
    },
    {
      "path": "/opt/ssconvert-reference/lib/goffice/0.10.61/plugins/plot_surface/plugin.xml",
      "sha256": "08b9354e4d9ca8e6767b48a3bbe30505b11d023b57c145d15bf2856e26ba9bb3"
    },
    {
      "path": "/opt/ssconvert-reference/lib/goffice/0.10.61/plugins/plot_pie/plugin.xml",
      "sha256": "78b0ae28b3356f21e1eb2961ac21d6e046fbb5b8c1f532362a812ef179e71516"
    },
    {
      "path": "/opt/ssconvert-reference/lib/goffice/0.10.61/plugins/reg_linear/plugin.xml",
      "sha256": "0d62886da479e604186f03b81a258e9e7ac7d4c021d8607395066d8bc27e5f28"
    },
    {
      "path": "/opt/ssconvert-reference/lib/goffice/0.10.61/plugins/plot_distrib/plugin.xml",
      "sha256": "543b4cf53cba8f99093f8db297318c2297ccfef4234260ee29428f335e812bc6"
    },
    {
      "path": "/opt/ssconvert-reference/lib/goffice/0.10.61/plugins/plot_xy/plugin.xml",
      "sha256": "622c3cc07448c521d3fa1b5edf7df3d943a309550704e082a431a864514b1f79"
    },
    {
      "path": "/opt/ssconvert-reference/lib/goffice/0.10.61/plugins/plot_radar/plugin.xml",
      "sha256": "d7dd65cc7729f5f48fb017fd74740547efcc3890f9bb35531fbf0f124b868f5d"
    },
    {
      "path": "/opt/ssconvert-reference/lib/goffice/0.10.61/plugins/smoothing/plugin.xml",
      "sha256": "6eca57428639edb9287c85cb1f7e7391db671cffe7fcaf65cba0cb0fb89b2b88"
    }
  ]
}
```
