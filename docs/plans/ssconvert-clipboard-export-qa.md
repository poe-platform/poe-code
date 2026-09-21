# Clipboard export QA

## Procedure

Verify the unchanged Gnumeric 1.12.61 source archive SHA-256 against
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
Use the separately built native oracle in the isolated statistics QA container.
Capture its binary, dependency, plugin and C locale profile under `out`.
Never use the oracle from product code or unit tests.

Enumerate every atom accepted by `gui_clipboard_test`, plus unknown MIME types.
Use original small CSV and XML fixtures to measure bytes, stderr, status and
output namespace effects without a desktop display. Exercise qualified and
unqualified ranges, formulas, styles, rich text, objects, updates, encoding,
invalid ranges, load failures and output failures. Record unsupported and
unmeasured cases separately from passes.

First reproduce missing built-in serialization with a failing memfs regression.
Run the same engine through SDK, CLI and the virtual shell. Verify cancellation
and byte/work budgets. After implementation assign a different agent to stress
the tool and repair validated package-local problems; root owns integration,
exports and Git. Run maintained uncached scoped build, test and lint routes.

## Results

Executed 2026-09-21. Independent stress and repairs are recorded in
`ssconvert-clipboard-independent-qa.md`. This is bounded verified coverage,
not a claim of complete Gnumeric clipboard parity.

### Reference profile

Official source URL:
`https://download.gnome.org/sources/gnumeric/1.12/gnumeric-1.12.61.tar.xz`.
The existing archive under `out/ssconvert-lifecycle` was verified against the
required hash above; no primary source was acquired outside `out`.
Unmodified native 1.12.61 was invoked only in the isolated Linux arm64
`ssconvert-statistics-qa` container. Product code has no native process or
desktop clipboard dependency.

Captured profile ID: `gnumeric-1.12.61-clipboard-20260921`.
Binary SHA-256:
`104f1e5500432c95ac3d46a679d476d05d2bf84e7483e991d212703cb0ed131c`.
Profile capture SHA-256:
`bcada2879e869abad4078f5fd9f840b1dfeaee17b396d5a76a4d9920a21bf629`.
The profile captured version, importer/exporter listings, linked libraries,
Debian dependency versions, locale and 47 installed plugin manifest hashes.
All 29 target cases were recaptured using precisely its recorded environment:
`LC_ALL=C`, `LANG=C`, `TZ=UTC`, no DISPLAY, memory GSettings backend, explicit
prefix library/schema/data roots and invocation-owned HOME/XDG roots.

Relevant dependency versions: Goffice 0.10.61; GLib `2.84.4-3~deb13u5`;
GTK `3.24.49-3`; libgsf `1.14.53-1`; libxml2
`2.12.7+dfsg+really2.9.14-2.1+deb13u3`; libjpeg62-turbo `1:2.1.5-4`;
libpng `1.6.48-1+deb13u5`. Installed manifests are not a blanket plugin
activation pass. Concrete serializers exercise XML, HTML and Excel services.

Installed plugin directories: applix, dif, excel, fn-christian-date, fn-complex,
fn-database, fn-date, fn-derivatives, fn-eng, fn-erlang, fn-financial, fn-flt,
fn-hebrew-date, fn-info, fn-logical, fn-lookup, fn-math, fn-numtheory, fn-r,
fn-random, fn-stat, fn-string, fn-tsa, glpk, html, lotus, lpsolve, mps, nlsolve,
oleo, openoffice, plan_perfect, plot_barcol, plot_distrib, plot_pie, plot_radar,
plot_surface, plot_xy, qpro, reg_linear, reg_logfit, sample_datasource, sc,
smoothing, sylk, uihello, xbase.

### Native target census

Original fixture bytes: `1,2\n3,4\n`; range `A1:B2`. All stdout is empty.
The released `gui_clipboard_test` accepts exactly its atom-name array; GTK's
broader desktop target registries do not expand this hidden command's whitelist.
There is no RTF atom. Windows HTML emits the same XHTML bytes, not CF_HTML.

| Targets | Native result | Product coverage |
| --- | --- | --- |
| `application/x-gnumeric` | status 0, 1053 XML bytes, empty stderr | Exact bytes for original CSV; independent exact styled and array fixtures |
| `UTF8_STRING`, `text/plain;charset=utf-8`, `STRING`, `COMPOUND_TEXT` | status 0, zero bytes, empty stderr | Exact released behavior; `GtkSelectionData` target is unset, so set_text leaves the initialized empty payload |
| `text/html`, `HTML Format` | status 0, identical 1253 XHTML bytes, empty stderr | Exact original CSV bytes; both use `Gnumeric_html:xhtml_range` |
| `Biff8`, `_CITRIX_Biff8`, `Biff5`, `Biff`, `application/x-openoffice-biff-8;windows_formatname="Biff8"` | status 0, identical 4608 BIFF8 bytes, empty stderr | All delegate to shared BIFF8 writer; measured container bytes differ |
| `application/x-openoffice;windows_formatname="Star Embed Source (XML)"`, `Star Embed Source (XML)`, `application/x-openoffice-embed-source-xml;windows_formatname="Star Embed Source (XML)"` | status 0, zero bytes, empty stderr | Exact empty INFO_OOO behavior |
| `image/svg+xml`, `image/x-wmf`, `image/x-emf`, `image/png`, `image/jpeg`, `image/bmp` | without copied objects: status 0, zero bytes, GLib critical `image_write` assertion | Matching bytes/status; stable assertion retained, GLib dynamic prefix differs |
| `application/x-goffice-graph` | without copied objects: status 0, zero bytes; `Unknown info type` followed by GLib critical `object_write` assertion | Matching bytes/status; exact Unknown info line, dynamic prefix differs |
| `text/uri-list`, `x-special/gnome-copied-files`, `application/x-kde-cutselection`, `SAVE_TARGETS` | status 0, zero bytes, `Unknown info type\n` | Exact |
| `text/plain`, `text/rtf`, `application/unknown` | status 1, `Failed to get clipboard data.\n`, no output created | Exact |

Target capture SHA-256:
`96ef79f8af686dbfa89446255fb366623f27f371be83510caf8b3da79ad35d26`.
The capture retained actual native dynamic PID/time strings. One native image
example is `\n** (ssconvert:84810): CRITICAL **: 07:55:45.003: image_write: assertion 'cr->objects != NULL' failed\n`. These dynamic prefixes are observations,
not normalized byte passes.

### Lifecycle and object coverage

Two operands plus a range are required; missing either yields status 1 and
`Usage: ssconvert [OPTION...] INFILE [OUTFILE]\n`. Auto-import uses `-E` and
ignores `-I`; updates precede range setup. Verified ordinary flags ignored here:
unknown `-I`/`-T`, invalid `-O`/resize, solve, recalc and per-sheet export.
Unqualified ranges copy the active sheet; qualified ranges focus that sheet.
Original Latin-1 `e9 0a` with `-E ISO-8859-1` emits `é`; `--set B2=8` changes
the selected native XML value. Dirty XML formulas settle during load, including
manual mode; updates then respect the restored calculation mode.
Workbook DateConvention input is unqualified; clipboard output is qualified
`gnm:DateConvention`, exactly as released native source and captures demonstrate.

Measured ordering: missing input reports `E /out/ssconvert-clipboard/missing.csv:
No such file or directory\n` before invalid range/MIME; loaded invalid range
reports `Invalid range specified.\n` before MIME lookup. Missing output parent
reports `Failed to write to file:///out/ssconvert-clipboard/absent/output\n`,
status 1. Existing output is preserved on range/MIME/budget failures.
Known errors from injected output openers use the same clipboard-specific
diagnostic; opaque capability failures and cancellation retain identity.

Contained embedded PNG exports preserve source bytes (68-byte original image,
and 73-byte original RGB fixture); source PNG to BMP/JPEG is implemented with
bounded JavaScript codecs. The BMP header/pixels match native's stable prefix;
native alignment padding is uninitialized and is not a full byte pass. JPEG
is functional but native byte fidelity is not established. A native empty graph
object XML fixture matches full resolved default bytes and emits the released
`Unknown info type` line. Contained object/comment records and translated anchors
are retained in native cells and table copies; partially contained objects are
excluded by native containment rules.

### Verification and limits

Final verification completed on the live checkout:

- `npm run build:workspaces -- --workspace=@poe-code/ssconvert --no-cache`:
  passed the maintained four-build dependency closure. The earlier maintained
  uncached safe-bash build closure also passed all 18 selected builds.
- `npm run test --workspace=@poe-code/ssconvert -- --no-cache`:
  275 files, 5,752 tests passed; no skipped tests.
- `npm run lint --workspace=@poe-code/ssconvert`: passed ESLint and source/test
  TypeScript checks. ESLint of the edited safe-bash test also passed.
- `node --import tsx --test packages/safe-bash/tests/commands/ssconvert*.test.ts`:
  all 90 actual virtual-command tests passed, zero skipped/cancelled cases.
  Independent focused clipboard stress passed all 45 cases.
- Maintained safe-bash typecheck failed before compilation: root `./safe-fs`
  export is absent, but its guard requires `./packages/safe-js/dist/safe-fs.js`.
  No root API repair was made; this cross-workspace check is not a pass.
- The maintained safe-bash unit invocation with `SAFE_BASH_TEST_RG=ssconvert`
  selected all 1,344 files rather than the requested scope. Our process tree
  was stopped after roughly 500 files. This interrupted run is not a pass;
  the 90-test command-family run above supplies focused integration evidence.

All new unit fixtures are
original in-memory data; file changes use memfs. No new unit test spawns an
oracle, queries an LLM or writes host files. Screenshot of the actual virtual
command was generated and inspected with `npm run screenshot`: native cells,
XHTML, released empty text and rejected RTF status/diagnostics were readable.

The independent QA document lists remaining style/reference/object/rich-text
and shared BIFF limits. Additional limits: unknown image payload forms and
malformed embedded images are not fully measured; clipboard write/close fault
behavior is not a parity pass. Released native code ignores write/close return
values, while injected product I/O remains strict and cancellation-aware.
No provider-specific runtime fallback was introduced.

Owned temporary logs, generated screenshots and differential fixture/output files
were purged after recording results and reference-profile details here. Capture
hashes above identify the measurements; the temporary captures are not retained
artifacts. The pre-existing source archive and separate oracle were preserved.

No README files changed. No local commit, remote-main delivery, push,
publication or release is claimed. Unrelated edits were preserved.

### Captured reference manifest profile

Native prefix: `/out/ssconvert-statistics-oracle/prefix`; LD_LIBRARY_PATH is
its `lib`, GSETTINGS_SCHEMA_DIR its `share/glib-2.0/schemas`, XDG_DATA_DIRS
its `share:/usr/local/share:/usr/share`. HOME and XDG config/data/cache roots
are under `/out/ssconvert-clipboard`; no display is configured. Additional
captured rendering/compression/C runtime dependencies:

```text
libbz2-1.0:arm64	1.0.8-6
libc6:arm64	2.41-12+deb13u4
libcairo2:arm64	1.18.4-1+b1
libfreetype6:arm64	2.13.3+dfsg-1+deb13u1
libgdk-pixbuf-2.0-0:arm64	2.42.12+dfsg-4+deb13u1
libharfbuzz0b:arm64	10.2.0-1+deb13u1
liblzma5:arm64	5.8.1-1+deb13u1
libpango-1.0-0:arm64	1.56.3-1
zlib1g:arm64	1:1.3.dfsg+really1.3.1-1+b1
```

The following manifest paths are relative to that prefix. These hashes record
installed manifests; only exercised serializer activation is qualified.

| Installed manifest | SHA-256 |
| --- | --- |
| lib/goffice/0.10.61/plugins/plot_distrib/plugin.xml | `543b4cf53cba8f99093f8db297318c2297ccfef4234260ee29428f335e812bc6` |
| lib/goffice/0.10.61/plugins/smoothing/plugin.xml | `6eca57428639edb9287c85cb1f7e7391db671cffe7fcaf65cba0cb0fb89b2b88` |
| lib/goffice/0.10.61/plugins/plot_radar/plugin.xml | `d7dd65cc7729f5f48fb017fd74740547efcc3890f9bb35531fbf0f124b868f5d` |
| lib/goffice/0.10.61/plugins/plot_barcol/plugin.xml | `f48224671f251c9a5bd552c83880ee298c9d1e20cd5a6dd8eb283999607cc893` |
| lib/goffice/0.10.61/plugins/plot_xy/plugin.xml | `622c3cc07448c521d3fa1b5edf7df3d943a309550704e082a431a864514b1f79` |
| lib/goffice/0.10.61/plugins/plot_pie/plugin.xml | `78b0ae28b3356f21e1eb2961ac21d6e046fbb5b8c1f532362a812ef179e71516` |
| lib/goffice/0.10.61/plugins/reg_logfit/plugin.xml | `956faddbdc7e8af08aadd3af0b9077edc213bfd2257ed0e885766987706c3b56` |
| lib/goffice/0.10.61/plugins/reg_linear/plugin.xml | `0d62886da479e604186f03b81a258e9e7ac7d4c021d8607395066d8bc27e5f28` |
| lib/goffice/0.10.61/plugins/plot_surface/plugin.xml | `08b9354e4d9ca8e6767b48a3bbe30505b11d023b57c145d15bf2856e26ba9bb3` |
| lib/gnumeric/1.12.61/plugins/fn-derivatives/plugin.xml | `512e2debdc09f8ab5adaab5c7f99b5c414a31d7b4285dfe81c5b7b382c7a5093` |
| lib/gnumeric/1.12.61/plugins/fn-lookup/plugin.xml | `73f79393f3e38c493080afe204a0bea3b8ee936d6342aa680800f6dfc5b507a6` |
| lib/gnumeric/1.12.61/plugins/fn-r/plugin.xml | `8bb27356e050e4ac7598412725bc400431ce3e6c7a481e55e6ebbf8bc351b959` |
| lib/gnumeric/1.12.61/plugins/sc/plugin.xml | `ac9c8c8ca7b20045cd6e297b985f47ed0109468752357adf99e81275c3e6674c` |
| lib/gnumeric/1.12.61/plugins/sylk/plugin.xml | `5b0dff2a02ef7efa50773c1c775766c9cb9c8ae8a70645a9fe1c7b1cf8aa3c54` |
| lib/gnumeric/1.12.61/plugins/fn-numtheory/plugin.xml | `4540ff972f2b5c35e1c709ca522bb385333d1fb9832ebcb9a355c87000075978` |
| lib/gnumeric/1.12.61/plugins/fn-database/plugin.xml | `7ebcf83d399b971cfa949a512515f149707e66fd70e63a977035766d56f16e44` |
| lib/gnumeric/1.12.61/plugins/fn-info/plugin.xml | `9871ad45a606d789ea8a88c8ebf0f3c24c8ad36a48085c0d3640855537d593d1` |
| lib/gnumeric/1.12.61/plugins/mps/plugin.xml | `b4af2d3924241b0e15ad39afb433cf802135d92a6c8b5bde328e409cf4814f9d` |
| lib/gnumeric/1.12.61/plugins/fn-hebrew-date/plugin.xml | `1bc6f5cf11d2ff63acf624460e792028348a3b779bd9d912f05c3cf3f2b536c3` |
| lib/gnumeric/1.12.61/plugins/fn-stat/plugin.xml | `9dc90aaf8202a8dae7000c7a740df897f7cf477932652bb14c60d86515d34606` |
| lib/gnumeric/1.12.61/plugins/fn-erlang/plugin.xml | `98edcc7806bf6e51ad0a27ca299b207750ecfd2367460ef13dc42a3ab8c83bda` |
| lib/gnumeric/1.12.61/plugins/fn-eng/plugin.xml | `d06c9e7d9aec1849fa9ea5d9bd267f4af20f227a98c708dc57ed3b63f17f93cc` |
| lib/gnumeric/1.12.61/plugins/lpsolve/plugin.xml | `48a4d9c2142d9eb0bf8ecf0136841e9e500cf5c0bd88471e1802159232f1a0f3` |
| lib/gnumeric/1.12.61/plugins/excel/plugin.xml | `04af00f442424ae635c43d758c9da5a9cef93731015519e5a01c0da7a635aff2` |
| lib/gnumeric/1.12.61/plugins/lotus/plugin.xml | `a38de08bb20b878d566708a305d242ff898b8df6fbfd467af43362d46cd38f5b` |
| lib/gnumeric/1.12.61/plugins/html/plugin.xml | `0e24fe00f38781cdb1a63056cd382747edcd41c8decb7b355cb8ac8485de31cd` |
| lib/gnumeric/1.12.61/plugins/applix/plugin.xml | `6d35f6abb0886d915ba6e4b7cfc17e23678804e82cbb92018b277d12321c686a` |
| lib/gnumeric/1.12.61/plugins/fn-complex/plugin.xml | `a5574fbeca4886d4b2d1833c87d426ecbbe0dcfb3cd3aa4889f05ec26a1131a3` |
| lib/gnumeric/1.12.61/plugins/fn-flt/plugin.xml | `4377e08837429c637fd528229634443a84d1e1b1ff442e942a427d44026b9f8d` |
| lib/gnumeric/1.12.61/plugins/glpk/plugin.xml | `f9ff2f40013f2ba14c5f2cf363591508fed7c681ac4e7b426f889e754fa37ea6` |
| lib/gnumeric/1.12.61/plugins/qpro/plugin.xml | `2ad3b9c8436d47d497fe8394626a19efb085f53afaa420637ec758401039a9f3` |
| lib/gnumeric/1.12.61/plugins/xbase/plugin.xml | `77dee717114afeecce37ea4d348fff0c2ffe230b345607e0e10819578ec6780a` |
| lib/gnumeric/1.12.61/plugins/fn-logical/plugin.xml | `5389636fe217178ea53c2f786576f03171f7272cda505116d1ff120353557712` |
| lib/gnumeric/1.12.61/plugins/fn-financial/plugin.xml | `b26fadcf27e9783fa243775f74851730675703f8a25fa1c3c16cd775803505d3` |
| lib/gnumeric/1.12.61/plugins/fn-string/plugin.xml | `4c576c6678566525258e4ed3102db586429e9e4b178b3c14ef3ab62be773b3bf` |
| lib/gnumeric/1.12.61/plugins/dif/plugin.xml | `c4df295133bbea7ec076e0334c7c8578258e34e1ccbd492eaa52ab21bd3553d6` |
| lib/gnumeric/1.12.61/plugins/fn-random/plugin.xml | `e9802b5951b077a533f7c90ae6feae5b2a22aa38191911a04b58c45bbdbfa634` |
| lib/gnumeric/1.12.61/plugins/uihello/plugin.xml | `54f9eb2f628c6d4d069a89426ad5e9b9e4229340d0a9dc628e63f991befb6a37` |
| lib/gnumeric/1.12.61/plugins/oleo/plugin.xml | `04785baf2b561c260c0b5d6b86f0f3ce372d4e52446fba12aabe723a8b61862f` |
| lib/gnumeric/1.12.61/plugins/fn-math/plugin.xml | `971a835f16d9c26130875f07b1eece000a3405ac05244305f0472bff4823430c` |
| lib/gnumeric/1.12.61/plugins/nlsolve/plugin.xml | `e8e43964a2956c5c2d671aa84f529142868fc6a8a4bf4e959f3cc1562a7a73c8` |
| lib/gnumeric/1.12.61/plugins/fn-date/plugin.xml | `ebe04a5845a58a9b5838d81974053e79ffb9ef22f505827d3673a9606dee66e5` |
| lib/gnumeric/1.12.61/plugins/plan_perfect/plugin.xml | `725750f75463e7e23bcef0d258e6d608f8acb3b40420dd34c41c5aabc3d6c0ac` |
| lib/gnumeric/1.12.61/plugins/fn-tsa/plugin.xml | `b1efca176c3e4acb7988b62619d942b345dc4651441e45d8faad2db52f22d351` |
| lib/gnumeric/1.12.61/plugins/openoffice/plugin.xml | `261ac77c377ed815456a8f6934cc12a9a6edca868e08cfe331a17fdadce73c0f` |
| lib/gnumeric/1.12.61/plugins/fn-christian-date/plugin.xml | `a17f4faa5ccea0be71c413b1ab15617ab935a0492bc79c376aadc611c978fb46` |
| lib/gnumeric/1.12.61/plugins/sample_datasource/plugin.xml | `82285e2a1f04ca5e9ff50b3c534710fd3de52faad19ad1bb2fdf65adfafbd2ac` |

### Reference environment and service capture

The captured profile fields below retain exact environment, linked-library and
registered-service observations. Installed manifest hashes are listed above.

```json
{
  "id": "gnumeric-1.12.61-clipboard-20260921",
  "scope": "QA oracle only",
  "sourceSha256": "2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12",
  "environment": {
    "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    "HOSTNAME": "ba43b94e9cee",
    "HOME": "/out/ssconvert-clipboard/home",
    "LC_CTYPE": "C.UTF-8",
    "LC_ALL": "C",
    "LANG": "C",
    "TZ": "UTC",
    "LD_LIBRARY_PATH": "/out/ssconvert-statistics-oracle/prefix/lib",
    "GSETTINGS_SCHEMA_DIR": "/out/ssconvert-statistics-oracle/prefix/share/glib-2.0/schemas",
    "GSETTINGS_BACKEND": "memory",
    "XDG_DATA_DIRS": "/out/ssconvert-statistics-oracle/prefix/share:/usr/local/share:/usr/share",
    "XDG_CONFIG_HOME": "/out/ssconvert-clipboard/config",
    "XDG_DATA_HOME": "/out/ssconvert-clipboard/data",
    "XDG_CACHE_HOME": "/out/ssconvert-clipboard/cache"
  },
  "binarySha256": "104f1e5500432c95ac3d46a679d476d05d2bf84e7483e991d212703cb0ed131c",
  "version": {
    "argv": [
      "/out/ssconvert-statistics-oracle/prefix/bin/ssconvert",
      "--version"
    ],
    "status": 0,
    "stdout": "ssconvert version '1.12.61'\ndatadir := '/out/ssconvert-statistics-oracle/prefix/share/gnumeric/1.12.61'\nlibdir := '/out/ssconvert-statistics-oracle/prefix/lib/gnumeric/1.12.61'\n",
    "stderr": ""
  },
  "importers": {
    "argv": [
      "/out/ssconvert-statistics-oracle/prefix/bin/ssconvert",
      "--list-importers"
    ],
    "status": 0,
    "stdout": "",
    "stderr": "ID                           | Description\nGnumeric_Excel:excel         | MS Excel? (*.xls)\nGnumeric_Excel:excel_enc     | MS Excel? (*.xls) requiring encoding specification\nGnumeric_Excel:excel_xml     | MS Excel? 2003 SpreadsheetML\nGnumeric_Excel:xlsx          | ECMA 376 / Office Open XML [MS Excel? 2007/2010] (*.xlsx)\nGnumeric_OpenCalc:openoffice | Open Document Format (*.sxc, *.ods)\nGnumeric_QPro:qpro           | Quattro Pro (*.wb1, *.wb2, *.wb3)\nGnumeric_XmlIO:sax           | Gnumeric XML (*.gnumeric)\nGnumeric_applix:applix       | Applix (*.as)\nGnumeric_dif:dif             | Data Interchange Format (*.dif)\nGnumeric_html:html           | HTML (*.html, *.htm)\nGnumeric_lotus:lotus         | Lotus 123 (*.wk1, *.wks, *.123)\nGnumeric_mps:mps             | Linear and integer program (*.mps) file format\nGnumeric_oleo:oleo           | GNU Oleo (*.oleo)\nGnumeric_plan_perfect:pln    | Plan Perfect Format (PLN) import\nGnumeric_sc:sc               | SC/xspread\nGnumeric_stf:stf_csvtab      | Comma or tab separated values (CSV/TSV)\nGnumeric_sylk:sylk           | MultiPlan (SYLK)\nGnumeric_xbase:xbase         | Xbase (*.dbf) file format\n"
  },
  "exporters": {
    "argv": [
      "/out/ssconvert-statistics-oracle/prefix/bin/ssconvert",
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
    "stdout": "adduser\t3.152\nadwaita-icon-theme\t48.1-1\napt\t3.0.3\nat-spi2-common\t2.56.2-1+deb13u2\nat-spi2-core\t2.56.2-1+deb13u2\nautoconf\t2.72-3.1\nautomake\t1:1.17-4\nautotools-dev\t20240727.1\nbase-files\t13.8+deb13u7\nbase-passwd\t3.6.7\nbash\t5.2.37-2+b10\nbash-completion\t1:2.16.0-7\nbinutils\t2.44-3\nbinutils-aarch64-linux-gnu\t2.44-3\nbinutils-common:arm64\t2.44-3\nbison\t2:3.8.2+dfsg-1+b2\nbsdutils\t1:2.41.5-0+deb13u1\nbuild-essential\t12.12\nbzip2\t1.0.8-6\nbzip2-doc\t1.0.8-6\nca-certificates\t20250419\ncoreutils\t9.7-3\ncpp\t4:14.2.0-1\ncpp-14\t14.2.0-19\ncpp-14-aarch64-linux-gnu\t14.2.0-19\ncpp-aarch64-linux-gnu\t4:14.2.0-1\ncurl\t8.14.1-2+deb13u5\ndash\t0.5.12-12\ndbus\t1.16.2-2\ndbus-bin\t1.16.2-2\ndbus-daemon\t1.16.2-2\ndbus-session-bus-common\t1.16.2-2\ndbus-system-bus-common\t1.16.2-2\ndbus-user-session\t1.16.2-2\ndconf-gsettings-backend:arm64\t0.40.0-5\ndconf-service\t0.40.0-5\ndebconf\t1.5.91\ndebian-archive-keyring\t2025.1\ndebianutils\t5.23.2\ndiffutils\t1:3.10-4\ndmsetup\t2:1.02.205-2\ndpkg\t1.22.22\ndpkg-dev\t1.22.22\nfakeroot\t1.37.1.1-1\nfile\t1:5.46-5\nfindutils\t4.10.0-3\nfontconfig\t2.15.0-2.3\nfontconfig-config\t2.15.0-2.3\nfonts-dejavu-core\t2.37-8\nfonts-dejavu-mono\t2.37-8\ng++\t4:14.2.0-1\ng++-14\t14.2.0-19\ng++-14-aarch64-linux-gnu\t14.2.0-19\ng++-aarch64-linux-gnu\t4:14.2.0-1\ngcc\t4:14.2.0-1\ngcc-14\t14.2.0-19\ngcc-14-aarch64-linux-gnu\t14.2.0-19\ngcc-14-base:arm64\t14.2.0-19\ngcc-aarch64-linux-gnu\t4:14.2.0-1\ngettext\t0.23.1-2\ngettext-base\t0.23.1-2\ngir1.2-atk-1.0:arm64\t2.56.2-1+deb13u2\ngir1.2-atspi-2.0:arm64\t2.56.2-1+deb13u2\ngir1.2-cloudproviders-0.3.0:arm64\t0.3.6-2\ngir1.2-freedesktop:arm64\t1.84.0-1\ngir1.2-freedesktop-dev:arm64\t1.84.0-1\ngir1.2-gdkpixbuf-2.0:arm64\t2.42.12+dfsg-4+deb13u1\ngir1.2-glib-2.0:arm64\t2.84.4-3~deb13u5\ngir1.2-glib-2.0-dev:arm64\t2.84.4-3~deb13u5\ngir1.2-goffice-0.10\t0.10.57-2+b1\ngir1.2-gsf-1:arm64\t1.14.53-1\ngir1.2-gtk-3.0:arm64\t3.24.49-3\ngir1.2-harfbuzz-0.0:arm64\t10.2.0-1+deb13u1\ngir1.2-pango-1.0:arm64\t1.56.3-1\ngir1.2-rsvg-2.0:arm64\t2.60.0+dfsg-1\ngirepository-tools:arm64\t2.84.4-3~deb13u5\ngrep\t3.11-4+b1\ngsettings-desktop-schemas\t48.0-1\ngtk-update-icon-cache\t4.18.6+ds-2\ngzip\t1.13-1+deb13u1\nhicolor-icon-theme\t0.18-2\nhostname\t3.25\nicu-devtools\t76.1-4\ninit-system-helpers\t1.69~deb13u1\nintltool\t0.51.0-7\nitstool\t2.0.6-4\nkrb5-locales\t1.21.3-5+deb13u1\nlibacl1:arm64\t2.3.2-2+b1\nlibalgorithm-diff-perl\t1.201-1\nlibalgorithm-diff-xs-perl\t0.04-9\nlibalgorithm-merge-perl\t0.08-5\nlibapparmor1:arm64\t4.1.0-1\nlibapt-pkg7.0:arm64\t3.0.3\nlibasan8:arm64\t14.2.0-19\nlibatk-bridge2.0-0t64:arm64\t2.56.2-1+deb13u2\nlibatk-bridge2.0-dev:arm64\t2.56.2-1+deb13u2\nlibatk1.0-0t64:arm64\t2.56.2-1+deb13u2\nlibatk1.0-dev:arm64\t2.56.2-1+deb13u2\nlibatomic1:arm64\t14.2.0-19\nlibatspi2.0-0t64:arm64\t2.56.2-1+deb13u2\nlibatspi2.0-dev:arm64\t2.56.2-1+deb13u2\nlibattr1:arm64\t1:2.5.2-3\nlibaudit-common\t1:4.0.2-2+deb13u1\nlibaudit1:arm64\t1:4.0.2-2+deb13u1\nlibauthen-sasl-perl\t2.1700-1\nlibavahi-client3:arm64\t0.8-16\nlibavahi-common-data:arm64\t0.8-16\nlibavahi-common3:arm64\t0.8-16\nlibbinutils:arm64\t2.44-3\nlibblkid-dev:arm64\t2.41.5-0+deb13u1\nlibblkid1:arm64\t2.41.5-0+deb13u1\nlibbrotli-dev:arm64\t1.1.0-2+b7\nlibbrotli1:arm64\t1.1.0-2+b7\nlibbsd0:arm64\t0.12.2-2\nlibbz2-1.0:arm64\t1.0.8-6\nlibbz2-dev:arm64\t1.0.8-6\nlibc-bin\t2.41-12+deb13u4\nlibc-dev-bin\t2.41-12+deb13u4\nlibc6:arm64\t2.41-12+deb13u4\nlibc6-dev:arm64\t2.41-12+deb13u4\nlibcairo-gobject2:arm64\t1.18.4-1+b1\nlibcairo-script-interpreter2:arm64\t1.18.4-1+b1\nlibcairo2:arm64\t1.18.4-1+b1\nlibcairo2-dev:arm64\t1.18.4-1+b1\nlibcap-dev:arm64\t1:2.75-10+deb13u1+b3\nlibcap-ng0:arm64\t0.8.5-4+b1\nlibcap2:arm64\t1:2.75-10+deb13u1+b3\nlibcc1-0:arm64\t14.2.0-19\nlibclone-perl:arm64\t0.47-1+b1\nlibcloudproviders-dev:arm64\t0.3.6-2\nlibcloudproviders0:arm64\t0.3.6-2\nlibcolord2:arm64\t1.4.7-3\nlibcom-err2:arm64\t1.47.2-3+b12\nlibcrypt-dev:arm64\t1:4.4.38-1\nlibcrypt1:arm64\t1:4.4.38-1\nlibcryptsetup12:arm64\t2:2.7.5-2\nlibctf-nobfd0:arm64\t2.44-3\nlibctf0:arm64\t2.44-3\nlibcups2t64:arm64\t2.4.10-3+deb13u2\nlibcurl4t64:arm64\t8.14.1-2+deb13u5\nlibdata-dump-perl\t1.25-1\nlibdatrie-dev:arm64\t0.2.13-3+b1\nlibdatrie1:arm64\t0.2.13-3+b1\nlibdav1d-dev:arm64\t1.5.1-1\nlibdav1d7:arm64\t1.5.1-1\nlibdb5.3t64:arm64\t5.3.28+dfsg2-9\nlibdbus-1-3:arm64\t1.16.2-2\nlibdbus-1-dev:arm64\t1.16.2-2\nlibdconf1:arm64\t0.40.0-5\nlibdebconfclient0:arm64\t0.280\nlibdeflate-dev:arm64\t1.23-2\nlibdeflate0:arm64\t1.23-2\nlibdevmapper1.02.1:arm64\t2:1.02.205-2\nlibdpkg-perl\t1.22.22\nlibdrm-amdgpu1:arm64\t2.4.124-2\nlibdrm-common\t2.4.124-2\nlibdrm2:arm64\t2.4.124-2\nlibedit2:arm64\t3.1-20250104-1\nlibegl-dev:arm64\t1.7.0-1+b2\nlibegl-mesa0:arm64\t25.0.7-2+deb13u1\nlibegl1:arm64\t1.7.0-1+b2\nlibegl1-mesa-dev:arm64\t25.0.7-2+deb13u1\nlibelf1t64:arm64\t0.192-4\nlibencode-locale-perl\t1.05-3\nlibepoxy-dev:arm64\t1.5.10-2\nlibepoxy0:arm64\t1.5.10-2\nlibexpat1:arm64\t2.8.3-1~deb13u1\nlibexpat1-dev:arm64\t2.8.3-1~deb13u1\nlibfakeroot:arm64\t1.37.1.1-1\nlibffi-dev:arm64\t3.4.8-2\nlibffi8:arm64\t3.4.8-2\nlibfile-fcntllock-perl\t0.22-4+b4\nlibfile-listing-perl\t6.16-1\nlibfont-afm-perl\t1.20-4\nlibfontconfig-dev:arm64\t2.15.0-2.3\nlibfontconfig1:arm64\t2.15.0-2.3\nlibfreetype-dev:arm64\t2.13.3+dfsg-1+deb13u1\nlibfreetype6:arm64\t2.13.3+dfsg-1+deb13u1\nlibfribidi-dev:arm64\t1.0.16-1\nlibfribidi0:arm64\t1.0.16-1\nlibgbm1:arm64\t25.0.7-2+deb13u1\nlibgcc-14-dev:arm64\t14.2.0-19\nlibgcc-s1:arm64\t14.2.0-19\nlibgcrypt20:arm64\t1.11.0-7+deb13u1\nlibgdbm-compat4t64:arm64\t1.24-2\nlibgdbm6t64:arm64\t1.24-2\nlibgdk-pixbuf-2.0-0:arm64\t2.42.12+dfsg-4+deb13u1\nlibgdk-pixbuf-2.0-dev:arm64\t2.42.12+dfsg-4+deb13u1\nlibgdk-pixbuf2.0-bin\t2.42.12+dfsg-4+deb13u1\nlibgdk-pixbuf2.0-common\t2.42.12+dfsg-4+deb13u1\nlibgio-2.0-dev:arm64\t2.84.4-3~deb13u5\nlibgio-2.0-dev-bin\t2.84.4-3~deb13u5\nlibgirepository-2.0-0:arm64\t2.84.4-3~deb13u5\nlibgl-dev:arm64\t1.7.0-1+b2\nlibgl1:arm64\t1.7.0-1+b2\nlibgl1-mesa-dri:arm64\t25.0.7-2+deb13u1\nlibgles-dev:arm64\t1.7.0-1+b2\nlibgles1:arm64\t1.7.0-1+b2\nlibgles2:arm64\t1.7.0-1+b2\nlibglib2.0-0t64:arm64\t2.84.4-3~deb13u5\nlibglib2.0-bin\t2.84.4-3~deb13u5\nlibglib2.0-data\t2.84.4-3~deb13u5\nlibglib2.0-dev:arm64\t2.84.4-3~deb13u5\nlibglib2.0-dev-bin\t2.84.4-3~deb13u5\nlibglvnd-core-dev:arm64\t1.7.0-1+b2\nlibglvnd-dev:arm64\t1.7.0-1+b2\nlibglvnd0:arm64\t1.7.0-1+b2\nlibglx-dev:arm64\t1.7.0-1+b2\nlibglx-mesa0:arm64\t25.0.7-2+deb13u1\nlibglx0:arm64\t1.7.0-1+b2\nlibgmp-dev:arm64\t2:6.3.0+dfsg-3\nlibgmp10:arm64\t2:6.3.0+dfsg-3\nlibgmpxx4ldbl:arm64\t2:6.3.0+dfsg-3\nlibgnutls30t64:arm64\t3.8.9-3+deb13u4\nlibgoffice-0.10-10-common\t0.10.57-2\nlibgoffice-0.10-10t64\t0.10.57-2+b1\nlibgoffice-0.10-dev\t0.10.57-2+b1\nlibgomp1:arm64\t14.2.0-19\nlibgpg-error-l10n\t1.51-4\nlibgpg-error0:arm64\t1.51-4\nlibgpm2:arm64\t1.20.7-11+b2\nlibgprofng0:arm64\t2.44-3\nlibgraphite2-3:arm64\t1.3.14-2+deb13u1\nlibgraphite2-dev:arm64\t1.3.14-2+deb13u1\nlibgsf-1-114:arm64\t1.14.53-1\nlibgsf-1-common\t1.14.53-1\nlibgsf-1-dev:arm64\t1.14.53-1\nlibgssapi-krb5-2:arm64\t1.21.3-5+deb13u1\nlibgtk-3-0t64:arm64\t3.24.49-3\nlibgtk-3-bin\t3.24.49-3\nlibgtk-3-common\t3.24.49-3\nlibgtk-3-dev:arm64\t3.24.49-3\nlibharfbuzz-cairo0:arm64\t10.2.0-1+deb13u1\nlibharfbuzz-dev:arm64\t10.2.0-1+deb13u1\nlibharfbuzz-gobject0:arm64\t10.2.0-1+deb13u1\nlibharfbuzz-icu0:arm64\t10.2.0-1+deb13u1\nlibharfbuzz-subset0:arm64\t10.2.0-1+deb13u1\nlibharfbuzz0b:arm64\t10.2.0-1+deb13u1\nlibhogweed6t64:arm64\t3.10.1-1\nlibhtml-form-perl\t6.12-1\nlibhtml-format-perl\t2.16-2\nlibhtml-parser-perl:arm64\t3.83-2~deb13u1\nlibhtml-tagset-perl\t3.24-1\nlibhtml-tree-perl\t5.07-3\nlibhttp-cookies-perl\t6.11-1\nlibhttp-daemon-perl\t6.16-1+deb13u1\nlibhttp-date-perl\t6.06-1\nlibhttp-message-perl\t7.00-2\nlibhttp-negotiate-perl\t6.01-2\nlibhwasan0:arm64\t14.2.0-19\nlibice-dev:arm64\t2:1.1.1-1\nlibice6:arm64\t2:1.1.1-1\nlibicu-dev:arm64\t76.1-4\nlibicu76:arm64\t76.1-4\nlibidn2-0:arm64\t2.3.8-2\nlibio-compress-brotli-perl\t0.004001-2+b3\nlibio-html-perl\t1.004-3\nlibio-socket-ssl-perl\t2.089-1\nlibisl23:arm64\t0.27-1\nlibitm1:arm64\t14.2.0-19\nlibjansson4:arm64\t2.14-2+b3\nlibjbig-dev:arm64\t2.1-6.1+b2\nlibjbig0:arm64\t2.1-6.1+b2\nlibjpeg-dev:arm64\t1:2.1.5-4\nlibjpeg62-turbo:arm64\t1:2.1.5-4\nlibjpeg62-turbo-dev:arm64\t1:2.1.5-4\nlibjson-c5:arm64\t0.18+ds-1\nlibk5crypto3:arm64\t1.21.3-5+deb13u1\nlibkeyutils1:arm64\t1.6.3-6\nlibkmod2:arm64\t34.2-2\nlibkrb5-3:arm64\t1.21.3-5+deb13u1\nlibkrb5support0:arm64\t1.21.3-5+deb13u1\nliblastlog2-2:arm64\t2.41.5-0+deb13u1\nliblcms2-2:arm64\t2.16-2+deb13u2\nlibldap-common\t2.6.10+dfsg-1\nlibldap2:arm64\t2.6.10+dfsg-1\nliblerc-dev:arm64\t4.0.0+ds-5\nliblerc4:arm64\t4.0.0+ds-5\nlibllvm19:arm64\t1:19.1.7-3+b1\nliblocale-gettext-perl\t1.07-7+b1\nliblsan0:arm64\t14.2.0-19\nliblwp-mediatypes-perl\t6.04-2\nliblwp-protocol-https-perl\t6.14-1\nliblz4-1:arm64\t1.10.0-4\nliblzma-dev:arm64\t5.8.1-1+deb13u1\nliblzma5:arm64\t5.8.1-1+deb13u1\nliblzo2-2:arm64\t2.10-3+b1\nlibmagic-mgc\t1:5.46-5\nlibmagic1t64:arm64\t1:5.46-5\nlibmailtools-perl\t2.22-1\nlibmd0:arm64\t1.1.0-2+b1\nlibmount-dev:arm64\t2.41.5-0+deb13u1\nlibmount1:arm64\t2.41.5-0+deb13u1\nlibmpc3:arm64\t1.3.1-1+b3\nlibmpfr6:arm64\t4.2.2-1\nlibncursesw6:arm64\t6.5+20250216-2\nlibnet-http-perl\t6.23-1\nlibnet-smtp-ssl-perl\t1.04-2\nlibnet-ssleay-perl:arm64\t1.94-3\nlibnettle8t64:arm64\t3.10.1-1\nlibnghttp2-14:arm64\t1.64.0-1.1+deb13u1\nlibnghttp3-9:arm64\t1.8.0-1\nlibnss-systemd:arm64\t257.13-1~deb13u1\nlibopengl-dev:arm64\t1.7.0-1+b2\nlibopengl0:arm64\t1.7.0-1+b2\nlibp11-kit0:arm64\t0.25.5-3\nlibpam-modules:arm64\t1.7.0-5\nlibpam-modules-bin\t1.7.0-5\nlibpam-runtime\t1.7.0-5\nlibpam-systemd:arm64\t257.13-1~deb13u1\nlibpam0g:arm64\t1.7.0-5\nlibpango-1.0-0:arm64\t1.56.3-1\nlibpango1.0-dev:arm64\t1.56.3-1\nlibpangocairo-1.0-0:arm64\t1.56.3-1\nlibpangoft2-1.0-0:arm64\t1.56.3-1\nlibpangoxft-1.0-0:arm64\t1.56.3-1\nlibpcre2-16-0:arm64\t10.46-1~deb13u2\nlibpcre2-32-0:arm64\t10.46-1~deb13u2\nlibpcre2-8-0:arm64\t10.46-1~deb13u2\nlibpcre2-dev:arm64\t10.46-1~deb13u2\nlibpcre2-posix3:arm64\t10.46-1~deb13u2\nlibperl5.40:arm64\t5.40.1-6+deb13u1\nlibpixman-1-0:arm64\t0.44.0-3\nlibpixman-1-dev:arm64\t0.44.0-3\nlibpkgconf3:arm64\t1.8.1-4\nlibpng-dev:arm64\t1.6.48-1+deb13u5\nlibpng-tools\t1.6.48-1+deb13u5\nlibpng16-16t64:arm64\t1.6.48-1+deb13u5\nlibproc2-0:arm64\t2:4.0.4-9\nlibpsl5t64:arm64\t0.21.2-1.1+b1\nlibpython3-stdlib:arm64\t3.13.5-1\nlibpython3.13-minimal:arm64\t3.13.5-2+deb13u5\nlibpython3.13-stdlib:arm64\t3.13.5-2+deb13u5\nlibreadline8t64:arm64\t8.2-6\nlibrsvg2-2:arm64\t2.60.0+dfsg-1\nlibrsvg2-common:arm64\t2.60.0+dfsg-1\nlibrsvg2-dev:arm64\t2.60.0+dfsg-1\nlibrtmp1:arm64\t2.4+20151223.gitfa8646d.1-2+b5\nlibsasl2-2:arm64\t2.1.28+dfsg1-9\nlibsasl2-modules:arm64\t2.1.28+dfsg1-9\nlibsasl2-modules-db:arm64\t2.1.28+dfsg1-9\nlibseccomp2:arm64\t2.6.0-2\nlibselinux1:arm64\t3.8.1-1\nlibselinux1-dev:arm64\t3.8.1-1\nlibsemanage-common\t3.8.1-1\nlibsemanage2:arm64\t3.8.1-1\nlibsensors-config\t1:3.6.2-2\nlibsensors5:arm64\t1:3.6.2-2\nlibsepol-dev:arm64\t3.8.1-1\nlibsepol2:arm64\t3.8.1-1\nlibsframe1:arm64\t2.44-3\nlibsharpyuv-dev:arm64\t1.5.0-0.1\nlibsharpyuv0:arm64\t1.5.0-0.1\nlibsm-dev:arm64\t2:1.2.6-1\nlibsm6:arm64\t2:1.2.6-1\nlibsmartcols1:arm64\t2.41.5-0+deb13u1\nlibsqlite3-0:arm64\t3.46.1-7+deb13u2\nlibssh2-1t64:arm64\t1.11.1-1+deb13u2\nlibssl3t64:arm64\t3.5.7-1~deb13u2\nlibstdc++-14-dev:arm64\t14.2.0-19\nlibstdc++6:arm64\t14.2.0-19\nlibsysprof-capture-4-dev:arm64\t48.0-2\nlibsystemd-dev:arm64\t257.13-1~deb13u1\nlibsystemd-shared:arm64\t257.13-1~deb13u1\nlibsystemd0:arm64\t257.13-1~deb13u1\nlibtasn1-6:arm64\t4.20.0-2+deb13u1\nlibthai-data\t0.1.29-2\nlibthai-dev:arm64\t0.1.29-2+b1\nlibthai0:arm64\t0.1.29-2+b1\nlibtiff-dev:arm64\t4.7.0-3+deb13u3\nlibtiff6:arm64\t4.7.0-3+deb13u3\nlibtiffxx6:arm64\t4.7.0-3+deb13u3\nlibtimedate-perl\t2.3300-2\nlibtinfo6:arm64\t6.5+20250216-2\nlibtry-tiny-perl\t0.32-1\nlibtsan2:arm64\t14.2.0-19\nlibubsan1:arm64\t14.2.0-19\nlibudev1:arm64\t257.13-1~deb13u1\nlibunistring5:arm64\t1.3-2\nliburi-perl\t5.30-1\nlibuuid1:arm64\t2.41.5-0+deb13u1\nlibvulkan1:arm64\t1.4.309.0-1\nlibwayland-bin\t1.23.1-3\nlibwayland-client0:arm64\t1.23.1-3\nlibwayland-cursor0:arm64\t1.23.1-3\nlibwayland-dev:arm64\t1.23.1-3\nlibwayland-egl1:arm64\t1.23.1-3\nlibwayland-server0:arm64\t1.23.1-3\nlibwebp-dev:arm64\t1.5.0-0.1\nlibwebp7:arm64\t1.5.0-0.1\nlibwebpdecoder3:arm64\t1.5.0-0.1\nlibwebpdemux2:arm64\t1.5.0-0.1\nlibwebpmux3:arm64\t1.5.0-0.1\nlibwww-perl\t6.78-1\nlibwww-robotrules-perl\t6.02-1\nlibx11-6:arm64\t2:1.8.12-1\nlibx11-data\t2:1.8.12-1\nlibx11-dev:arm64\t2:1.8.12-1\nlibx11-xcb1:arm64\t2:1.8.12-1\nlibxau-dev:arm64\t1:1.0.11-1\nlibxau6:arm64\t1:1.0.11-1\nlibxcb-dri3-0:arm64\t1.17.0-2+b1\nlibxcb-glx0:arm64\t1.17.0-2+b1\nlibxcb-present0:arm64\t1.17.0-2+b1\nlibxcb-randr0:arm64\t1.17.0-2+b1\nlibxcb-render0:arm64\t1.17.0-2+b1\nlibxcb-render0-dev:arm64\t1.17.0-2+b1\nlibxcb-shm0:arm64\t1.17.0-2+b1\nlibxcb-shm0-dev:arm64\t1.17.0-2+b1\nlibxcb-sync1:arm64\t1.17.0-2+b1\nlibxcb-xfixes0:arm64\t1.17.0-2+b1\nlibxcb1:arm64\t1.17.0-2+b1\nlibxcb1-dev:arm64\t1.17.0-2+b1\nlibxcomposite-dev:arm64\t1:0.4.6-1\nlibxcomposite1:arm64\t1:0.4.6-1\nlibxcursor-dev:arm64\t1:1.2.3-1\nlibxcursor1:arm64\t1:1.2.3-1\nlibxdamage-dev:arm64\t1:1.1.6-1+b2\nlibxdamage1:arm64\t1:1.1.6-1+b2\nlibxdmcp-dev:arm64\t1:1.1.5-1\nlibxdmcp6:arm64\t1:1.1.5-1\nlibxext-dev:arm64\t2:1.3.4-1+b3\nlibxext6:arm64\t2:1.3.4-1+b3\nlibxfixes-dev:arm64\t1:6.0.0-2+b4\nlibxfixes3:arm64\t1:6.0.0-2+b4\nlibxft-dev:arm64\t2.3.6-1+b4\nlibxft2:arm64\t2.3.6-1+b4\nlibxi-dev:arm64\t2:1.8.2-1\nlibxi6:arm64\t2:1.8.2-1\nlibxinerama-dev:arm64\t2:1.1.4-3+b4\nlibxinerama1:arm64\t2:1.1.4-3+b4\nlibxkbcommon-dev:arm64\t1.7.0-2\nlibxkbcommon0:arm64\t1.7.0-2\nlibxml-parser-perl\t2.47-2~deb13u1\nlibxml2:arm64\t2.12.7+dfsg+really2.9.14-2.1+deb13u3\nlibxml2-dev:arm64\t2.12.7+dfsg+really2.9.14-2.1+deb13u3\nlibxml2-utils\t2.12.7+dfsg+really2.9.14-2.1+deb13u3\nlibxrandr-dev:arm64\t2:1.5.4-1+b3\nlibxrandr2:arm64\t2:1.5.4-1+b3\nlibxrender-dev:arm64\t1:0.9.12-1\nlibxrender1:arm64\t1:0.9.12-1\nlibxshmfence1:arm64\t1.3.3-1\nlibxslt1-dev:arm64\t1.1.35-1.2+deb13u3\nlibxslt1.1:arm64\t1.1.35-1.2+deb13u3\nlibxtst-dev:arm64\t2:1.2.5-1\nlibxtst6:arm64\t2:1.2.5-1\nlibxxf86vm1:arm64\t1:1.1.4-1+b4\nlibxxhash0:arm64\t0.8.3-2\nlibz3-4:arm64\t4.13.3-1\nlibzstd-dev:arm64\t1.5.7+dfsg-1\nlibzstd1:arm64\t1.5.7+dfsg-1\nlinux-libc-dev\t6.12.107-1\nlinux-sysctl-defaults\t4.12.1\nlogin\t1:4.16.0-2+really2.41.5-0+deb13u1\nlogin.defs\t1:4.17.4-2\nm4\t1.4.19-8\nmake\t4.4.1-2\nmanpages\t6.9.1-1\nmanpages-dev\t6.9.1-1\nmawk\t1.3.4.20250131-1\nmedia-types\t13.0.0\nmesa-libgallium:arm64\t25.0.7-2+deb13u1\nmesa-vulkan-drivers:arm64\t25.0.7-2+deb13u1\nmount\t2.41.5-0+deb13u1\nnative-architecture\t0.2.6\nncurses-base\t6.5+20250216-2\nncurses-bin\t6.5+20250216-2\nnetbase\t6.5\nopenssl\t3.5.7-1~deb13u2\nopenssl-provider-legacy\t3.5.7-1~deb13u2\npango1.0-tools\t1.56.3-1\npasswd\t1:4.17.4-2\npatch\t2.8-2\nperl\t5.40.1-6+deb13u1\nperl-base\t5.40.1-6+deb13u1\nperl-modules-5.40\t5.40.1-6+deb13u1\nperl-openssl-defaults:arm64\t7+b2\npkg-config:arm64\t1.8.1-4\npkgconf:arm64\t1.8.1-4\npkgconf-bin\t1.8.1-4\nprocps\t2:4.0.4-9\npsmisc\t23.7-2\npublicsuffix\t20250328.1952-0.1\npython3\t3.13.5-1\npython3-libxml2:arm64\t2.12.7+dfsg+really2.9.14-2.1+deb13u3\npython3-minimal\t3.13.5-1\npython3-packaging\t25.0-1\npython3.13\t3.13.5-2+deb13u5\npython3.13-minimal\t3.13.5-2+deb13u5\nreadline-common\t8.2-6\nrpcsvc-proto\t1.4.3-1+b1\nsed\t4.9-2+deb13u1\nsgml-base\t1.31+nmu1\nshared-mime-info\t2.4-5+b2\nsq\t1.3.1-2+b2\nsqv\t1.3.0-3+b2\nsystemd\t257.13-1~deb13u1\nsystemd-cryptsetup\t257.13-1~deb13u1\nsystemd-sysv\t257.13-1~deb13u1\nsystemd-timesyncd\t257.13-1~deb13u1\nsysvinit-utils\t3.14-4\ntar\t1.35+dfsg-3.1\ntzdata\t2026c-0+deb13u1\nutil-linux\t2.41.5-0+deb13u1\nuuid-dev:arm64\t2.41.5-0+deb13u1\nwayland-protocols\t1.44-1\nx11-common\t1:7.7+24+deb13u1\nx11proto-dev\t2024.1-1\nxdg-user-dirs\t0.18-2\nxkb-data\t2.42-1\nxml-core\t0.19\nxorg-sgml-doctools\t1:1.11-1.1\nxtrans-dev\t1.4.0-1\nxz-utils\t5.8.1-1+deb13u1\nzlib1g:arm64\t1:1.3.dfsg+really1.3.1-1+b1\nzlib1g-dev:arm64\t1:1.3.dfsg+really1.3.1-1+b1\n",
    "stderr": ""
  },
  "linked": {
    "argv": [
      "ldd",
      "/out/ssconvert-statistics-oracle/prefix/bin/ssconvert"
    ],
    "status": 0,
    "stdout": "\tlinux-vdso.so.1 (0x0000eb120600a000)\n\tlibspreadsheet-1.12.61.so => /out/ssconvert-statistics-oracle/prefix/lib/libspreadsheet-1.12.61.so (0x0000eb1205a50000)\n\tlibgoffice-0.10.so.10 => /out/ssconvert-statistics-oracle/prefix/lib/libgoffice-0.10.so.10 (0x0000eb1205860000)\n\tlibgsf-1.so.114 => /lib/aarch64-linux-gnu/libgsf-1.so.114 (0x0000eb12057f0000)\n\tlibgtk-3.so.0 => /lib/aarch64-linux-gnu/libgtk-3.so.0 (0x0000eb1204f90000)\n\tlibgobject-2.0.so.0 => /lib/aarch64-linux-gnu/libgobject-2.0.so.0 (0x0000eb1204f00000)\n\tlibglib-2.0.so.0 => /lib/aarch64-linux-gnu/libglib-2.0.so.0 (0x0000eb1204d70000)\n\tlibc.so.6 => /lib/aarch64-linux-gnu/libc.so.6 (0x0000eb1204bb0000)\n\tlibxml2.so.2 => /lib/aarch64-linux-gnu/libxml2.so.2 (0x0000eb12049e0000)\n\tlibgmodule-2.0.so.0 => /lib/aarch64-linux-gnu/libgmodule-2.0.so.0 (0x0000eb12049b0000)\n\tlibgdk-3.so.0 => /lib/aarch64-linux-gnu/libgdk-3.so.0 (0x0000eb1204880000)\n\tlibpangocairo-1.0.so.0 => /lib/aarch64-linux-gnu/libpangocairo-1.0.so.0 (0x0000eb1204850000)\n\tlibpango-1.0.so.0 => /lib/aarch64-linux-gnu/libpango-1.0.so.0 (0x0000eb12047c0000)\n\tlibatk-1.0.so.0 => /lib/aarch64-linux-gnu/libatk-1.0.so.0 (0x0000eb1204770000)\n\tlibcairo.so.2 => /lib/aarch64-linux-gnu/libcairo.so.2 (0x0000eb1204610000)\n\tlibgdk_pixbuf-2.0.so.0 => /lib/aarch64-linux-gnu/libgdk_pixbuf-2.0.so.0 (0x0000eb12045c0000)\n\tlibgio-2.0.so.0 => /lib/aarch64-linux-gnu/libgio-2.0.so.0 (0x0000eb1204390000)\n\tlibm.so.6 => /lib/aarch64-linux-gnu/libm.so.6 (0x0000eb12042e0000)\n\tlibxslt.so.1 => /lib/aarch64-linux-gnu/libxslt.so.1 (0x0000eb1204280000)\n\tlibrsvg-2.so.2 => /lib/aarch64-linux-gnu/librsvg-2.so.2 (0x0000eb1203d10000)\n\tlibz.so.1 => /lib/aarch64-linux-gnu/libz.so.1 (0x0000eb1203cd0000)\n\tlibbz2.so.1.0 => /lib/aarch64-linux-gnu/libbz2.so.1.0 (0x0000eb1203ca0000)\n\t/lib/ld-linux-aarch64.so.1 (0x0000eb1205fc0000)\n\tlibharfbuzz.so.0 => /lib/aarch64-linux-gnu/libharfbuzz.so.0 (0x0000eb1203b40000)\n\tlibpangoft2-1.0.so.0 => /lib/aarch64-linux-gnu/libpangoft2-1.0.so.0 (0x0000eb1203b00000)\n\tlibfontconfig.so.1 => /lib/aarch64-linux-gnu/libfontconfig.so.1 (0x0000eb1203a90000)\n\tlibfribidi.so.0 => /lib/aarch64-linux-gnu/libfribidi.so.0 (0x0000eb1203a50000)\n\tlibcairo-gobject.so.2 => /lib/aarch64-linux-gnu/libcairo-gobject.so.2 (0x0000eb1203a20000)\n\tlibepoxy.so.0 => /lib/aarch64-linux-gnu/libepoxy.so.0 (0x0000eb12038b0000)\n\tlibXi.so.6 => /lib/aarch64-linux-gnu/libXi.so.6 (0x0000eb1203880000)\n\tlibX11.so.6 => /lib/aarch64-linux-gnu/libX11.so.6 (0x0000eb1203710000)\n\tlibatk-bridge-2.0.so.0 => /lib/aarch64-linux-gnu/libatk-bridge-2.0.so.0 (0x0000eb12036b0000)\n\tlibcloudproviders.so.0 => /lib/aarch64-linux-gnu/libcloudproviders.so.0 (0x0000eb1203670000)\n\tlibXfixes.so.3 => /lib/aarch64-linux-gnu/libXfixes.so.3 (0x0000eb1203640000)\n\tlibffi.so.8 => /lib/aarch64-linux-gnu/libffi.so.8 (0x0000eb1203610000)\n\tlibatomic.so.1 => /lib/aarch64-linux-gnu/libatomic.so.1 (0x0000eb12035e0000)\n\tlibpcre2-8.so.0 => /lib/aarch64-linux-gnu/libpcre2-8.so.0 (0x0000eb1203520000)\n\tliblzma.so.5 => /lib/aarch64-linux-gnu/liblzma.so.5 (0x0000eb12034d0000)\n\tlibxkbcommon.so.0 => /lib/aarch64-linux-gnu/libxkbcommon.so.0 (0x0000eb1203460000)\n\tlibwayland-client.so.0 => /lib/aarch64-linux-gnu/libwayland-client.so.0 (0x0000eb1203430000)\n\tlibwayland-cursor.so.0 => /lib/aarch64-linux-gnu/libwayland-cursor.so.0 (0x0000eb1203400000)\n\tlibwayland-egl.so.1 => /lib/aarch64-linux-gnu/libwayland-egl.so.1 (0x0000eb12033d0000)\n\tlibXext.so.6 => /lib/aarch64-linux-gnu/libXext.so.6 (0x0000eb1203390000)\n\tlibXcursor.so.1 => /lib/aarch64-linux-gnu/libXcursor.so.1 (0x0000eb1203360000)\n\tlibXdamage.so.1 => /lib/aarch64-linux-gnu/libXdamage.so.1 (0x0000eb1203330000)\n\tlibXcomposite.so.1 => /lib/aarch64-linux-gnu/libXcomposite.so.1 (0x0000eb1203300000)\n\tlibXrandr.so.2 => /lib/aarch64-linux-gnu/libXrandr.so.2 (0x0000eb12032d0000)\n\tlibXinerama.so.1 => /lib/aarch64-linux-gnu/libXinerama.so.1 (0x0000eb12032a0000)\n\tlibthai.so.0 => /lib/aarch64-linux-gnu/libthai.so.0 (0x0000eb1203270000)\n\tlibpng16.so.16 => /lib/aarch64-linux-gnu/libpng16.so.16 (0x0000eb1203210000)\n\tlibfreetype.so.6 => /lib/aarch64-linux-gnu/libfreetype.so.6 (0x0000eb1203130000)\n\tlibXrender.so.1 => /lib/aarch64-linux-gnu/libXrender.so.1 (0x0000eb1203100000)\n\tlibxcb.so.1 => /lib/aarch64-linux-gnu/libxcb.so.1 (0x0000eb12030b0000)\n\tlibxcb-render.so.0 => /lib/aarch64-linux-gnu/libxcb-render.so.0 (0x0000eb1203080000)\n\tlibxcb-shm.so.0 => /lib/aarch64-linux-gnu/libxcb-shm.so.0 (0x0000eb1203050000)\n\tlibpixman-1.so.0 => /lib/aarch64-linux-gnu/libpixman-1.so.0 (0x0000eb1202fa0000)\n\tlibjpeg.so.62 => /lib/aarch64-linux-gnu/libjpeg.so.62 (0x0000eb1202f20000)\n\tlibmount.so.1 => /lib/aarch64-linux-gnu/libmount.so.1 (0x0000eb1202e80000)\n\tlibselinux.so.1 => /lib/aarch64-linux-gnu/libselinux.so.1 (0x0000eb1202e20000)\n\tlibgcc_s.so.1 => /lib/aarch64-linux-gnu/libgcc_s.so.1 (0x0000eb1202de0000)\n\tlibdav1d.so.7 => /lib/aarch64-linux-gnu/libdav1d.so.7 (0x0000eb1202ce0000)\n\tlibgraphite2.so.3 => /lib/aarch64-linux-gnu/libgraphite2.so.3 (0x0000eb1202ca0000)\n\tlibexpat.so.1 => /lib/aarch64-linux-gnu/libexpat.so.1 (0x0000eb1202c50000)\n\tlibatspi.so.0 => /lib/aarch64-linux-gnu/libatspi.so.0 (0x0000eb1202bf0000)\n\tlibdbus-1.so.3 => /lib/aarch64-linux-gnu/libdbus-1.so.3 (0x0000eb1202b70000)\n\tlibdatrie.so.1 => /lib/aarch64-linux-gnu/libdatrie.so.1 (0x0000eb1202b40000)\n\tlibbrotlidec.so.1 => /lib/aarch64-linux-gnu/libbrotlidec.so.1 (0x0000eb1202b10000)\n\tlibXau.so.6 => /lib/aarch64-linux-gnu/libXau.so.6 (0x0000eb1202ae0000)\n\tlibXdmcp.so.6 => /lib/aarch64-linux-gnu/libXdmcp.so.6 (0x0000eb1202ab0000)\n\tlibblkid.so.1 => /lib/aarch64-linux-gnu/libblkid.so.1 (0x0000eb1202a30000)\n\tlibsystemd.so.0 => /lib/aarch64-linux-gnu/libsystemd.so.0 (0x0000eb1202900000)\n\tlibbrotlicommon.so.1 => /lib/aarch64-linux-gnu/libbrotlicommon.so.1 (0x0000eb12028c0000)\n\tlibcap.so.2 => /lib/aarch64-linux-gnu/libcap.so.2 (0x0000eb1202890000)\n",
    "stderr": ""
  }
}
```
