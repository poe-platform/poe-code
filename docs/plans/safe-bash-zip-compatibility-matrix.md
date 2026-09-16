# ZIP compatibility qualification plan

Baseline: `c75f0499a1fe7a5b4f5455779eed99cb4ee6cbab` on `main`, inspected
2026-09-16. Revision, commands, oracle construction, failures and exclusions are
in [the evidence plan](safe-bash-zip-remaining-features-evidence.md).
This inventory is a qualification plan, not a claim of completed compatibility.

Fresh execution on the same revision is recorded in the **Current-revision
revalidation** section of the evidence plan. The addendum below refines short
switch effects, record coverage and source-only findings; those refinements take
precedence over the initial inventory's narrower probes.

## Classification and acceptance

These dispositions are distinct:

- **Supported**: implemented in the bounded package profile, with current tests.
  This does not certify all native interactions or all five acceptance controls.
- **Missing**: concrete current rejection or implementation gap reproduced.
- **Restricted**: deliberately narrower safety/host-capability profile.
- **N/A**: outside the pinned Unix build, or reserved/nonfunctional upstream.
- **Unverified**: no sufficient current execution evidence; never counted as a pass.

Each feature needs positive, negative, boundary, cancellation and neighboring
regression controls before completion. All rows remain open for exhaustive
qualification. Parser-only evidence proves missing syntax, not native behavior.
`R` below refers to the evidence plan's 40-case rejection experiment. Each `R`
case uses `sample.zip binary` in memory, returns 16, preserves the archive, and
has a separate successful `-q control.zip binary` control. The isolated native
build accepts that option followed by `-h` with status 0. Value samples are shown.

## Native Zip 3.0 option inventory

The inventory is the complete `options[]` table in the pinned LuaDist Zip 3.0
source, including aliases and conditional entries, checked against both native
`zip -so` outputs. Long options are case-sensitive. `value` denotes a required
value, `list` a value list; `neg` denotes native negation. Negation and attached
value interactions remain separate qualification obligations.

Test references are relative to `packages/safe-bash/tests/commands/`. General
coverage: `zip.test.ts`, `zip-review.test.ts`, `zip-format.test.ts`,
`unzip.test.ts`, `zip-atomic-ownership.test.ts`, and plugin ZIP safety tests.

| Short | Long | Native form/build | Disposition | Evidence / next qualification |
| --- | --- | --- | --- | --- |
| 0 | store | flag | Supported | `zip-standard-flags.test.ts`; empty/binary/storage precedence |
| 1 | compress-1 | flag | Supported | `zip-standard-flags.test.ts`; effort/flags/store fallback |
| 2 | compress-2 | flag | Supported | same; independent level-2 native comparison open |
| 3 | compress-3 | flag | Supported | same; independent level-3 native comparison open |
| 4 | compress-4 | flag | Supported | same; independent level-4 native comparison open |
| 5 | compress-5 | flag | Supported | same; independent level-5 native comparison open |
| 6 | compress-6 | flag | Supported | default; compressed bytes need not be identical |
| 7 | compress-7 | flag | Supported | same; independent level-7 native comparison open |
| 8 | compress-8 | flag | Supported | same; independent level-8 native comparison open |
| 9 | compress-9 | flag | Supported | suffix override; `zip-standard-flags.test.ts` |
| A | adjust-sfx | flag | Missing | R; adjusted SFX offsets/corruption controls open |
| b | temp-path | value | Missing | R with `.`; cross-device VFS staging/cleanup open |
| c | entry-comments | flag | Supported | `zip-entry-comments.test.ts`; comment/input ownership |
| d | delete | flag | Supported | `zip.test.ts`, `zip-standard-flags.test.ts`; selected deletion |
| db | display-bytes | neg | Missing | R; exact bytes/progress frequency open |
| dc | display-counts | neg | Missing | R; counts for filtered/updated members open |
| dd | display-dots | neg | Missing | R; gated input and dot thresholds open |
| dg | display-globaldots | neg | Missing | R; archive-wide progress open |
| ds | dot-size | value | Missing | R with `1m`; invalid/unit/threshold values open |
| du | display-usize | neg | Missing | R; compressed versus uncompressed counters open |
| dv | display-volume | neg | Missing | R; single/split volume labels open |
| D | no-dir-entries | flag | Supported | `zip.test.ts`; recursion without directory records |
| DF | difference-archive | flag | Missing | R; changed/new-only separate output open |
| e | encrypt | encryption build | Missing | R; transform exists but no password/header workflow |
| F | fix | flag | Missing | R; intact directory repair versus damaged inputs open |
| FF | fixfix | flag | Missing | R; bounded local-record recovery/ambiguity open |
| FI | fifo | neg; Unix capability | Missing | R; no permission to read implicit host FIFO |
| FS | filesync | flag | Supported | `zip-filesync.test.ts`; deletion scope and missing sources |
| f | freshen | flag | Supported | `zip.test.ts`; existing-only timestamp updates |
| fd | force-descriptors | flag | Supported | `zip-standard-flags.test.ts`, `zip-format.test.ts` |
| fz | force-zip64 | neg; ZIP64_SUPPORT | Supported | bounded forced ZIP64; automatic large sizes Missing below |
| g | grow | flag | Missing | R; append semantics and failure effects open |
| h | help | non-WINDLL | Supported | `zip.test.ts`; immediate exit and invalid earlier option |
| H | none | help alias; non-WINDLL | Missing | R with `-H`; native 0, product 16 |
| ? | none | help alias; non-WINDLL | Missing | R with literal `-?`; shell quoting required |
| h2 | more-help | non-WINDLL | Supported | `zip-more-help.test.ts`; content/early exit |
| i | include | list | Supported | `zip-standard-flags.test.ts`, `zip-pattern-ranges.test.ts` |
| j | junk-paths | flag | Supported | `zip.test.ts`, `zip-review.test.ts`; duplicate basename controls |
| J | junk-sfx | flag | Missing | R; strip prefixes with rebased offsets open |
| k | DOS-names | flag | Missing | R; 8.3 mapping/collisions/attributes open |
| l | to-crlf | flag | Supported | `zip-line-endings.test.ts`, `zip-text-attributes.test.ts` |
| ll | from-crlf | flag | Missing | R; native `a\r\nb\r\n` conversion versus current rejection |
| lf | logfile-path | value | Missing | R with `log`; VFS logging and destination failures open |
| la | log-append | neg | Missing | R; append/negation/alias protection open |
| li | log-info | neg | Missing | R; info/diagnostic separation and secret omission open |
| L | license | non-WINDLL | Missing | R; package/native-license distinction must be explicit |
| m | move | flag | Supported | `zip-move.test.ts`; publication before owned source deletion |
| mm | none | reserved invalid switch | Supported rejection | Follow-up TDD fix rejects at 16 without deleting source; historical destructive reproduction retained in evidence plan |
| MM | must-match | flag | Supported | `zip-standard-flags.test.ts`; status 18, no publication |
| n | suffixes | value | Supported | `zip-standard-flags.test.ts`; case, empty/default, `:` |
| nw | no-wild | flag | Supported | same; native `?` behavior retained |
| o | latest-time | flag | Supported | `zip-latest-time.test.ts`; timestamp capabilities/failure |
| O | output-file | value | Supported | `zip-standard-flags.test.ts`; input/output identity and copies |
| p | paths | flag | Supported | `zip-paths-option.test.ts`; Unix no-op, does not undo `-j` |
| P | password | value; encryption build | Missing | R with fixture-only password; native encrypted fixture cross-read |
| q | quiet | flag | Supported | `zip.test.ts`; fatal output/status retained, suppressed text budget |
| r | recurse-paths | flag | Supported | `zip.test.ts`; depth/work limits, source links |
| R | recurse-patterns | flag | Supported | `zip-standard-flags.test.ts`; conflicts, hidden files, trailing components |
| RE | regex | flag | Missing | R; Info-ZIP means bracket-list glob matching, not general regex engine |
| s | split-size | value | Missing | R with `64k`; minimum/units/zero and disk offsets open |
| sp | split-pause | flag | Missing | R; legitimate injected interactive input needed |
| sv | split-verbose | flag | Missing | R; split progress/failure controls open |
| sb | split-bell | flag | Missing | R; bell bytes and pause interaction open |
| sc | show-command | flag | Missing | R; ZIPOPT expansion/quoting and password omission open |
| sd | show-debug | flag | Missing | R; no secret/host information leakage |
| sf | show-files | neg | Missing | R; dry listing must avoid payload reads/publication |
| so | show-options | flag | Missing | R; independent option inventory/format open |
| su | show-unicode | neg; UNICODE_SUPPORT | Missing | R; absent from Apple build, present in constructed build |
| sU | show-just-unicode | neg; UNICODE_SUPPORT | Missing | R; absent from Apple build, present in constructed build |
| t | from-date | value | Supported | `zip-standard-flags.test.ts`; local DOS date selection |
| tt | before-date | value | Supported | same; strict upper bound, repeated bounds |
| T | test | flag | Supported | `zip.test.ts`; internal CRC/length check; stdout ignores with advisory |
| TT | unzip-command | value | Restricted | R with `unzip`; arbitrary host command is forbidden; no fallback |
| u | update | flag | Supported | `zip.test.ts`; adds new and updates older entries |
| U | copy-entries | flag | Supported | `zip-standard-flags.test.ts`; compressed payload copy without source reads |
| UN | unicode | value; UNICODE_SUPPORT | Missing | R with `warn`; quit/warn/ignore/no/escape individually open |
| v | verbose | flag | Missing | R; version-alone versus operational progress open |
| none | version | flag | Missing | R; truthful package version/build details needed |
| ws | wild-stop-dirs | flag | Supported | `zip-standard-flags.test.ts`; `*`, `?`, `**`, slash class |
| x | exclude | list | Supported | `zip.test.ts`, `zip-pattern-ranges.test.ts`; exclude wins |
| X | strip-extra | neg | Supported | `zip-standard-flags.test.ts`; rewritten versus untouched extras |
| y | symlinks | S_IFLNK | Supported | `zip.test.ts`; explicit VFS capabilities and escaping target refusal |
| z | archive-comment | flag | Supported | `zip.test.ts`; EOF/byte limit and prompt ownership |
| Z | compression-method | value | Supported | store/deflate; `zip-bzip2.test.ts` for method 12 |
| @ | names-stdin | non-classic-MACOS | Supported | `zip-standard-flags.test.ts`; names/payload share iterator |

All native flags above are applicable to at least one pinned Unix build; `mm`
specifically requires rejection. `--no-extra` is a commented-out source predecessor, not an active option.
BZIP2 is a build-dependent value of `-Z`, not a separate switch.

### Other conditional options in the same source table

These entries prevent platform-specific source options from silently vanishing
from the inventory. None is certified by Darwin execution. Classic `MACOS` is
distinct from Unix macOS (`__APPLE__`); Apple downstream additions outside this
pinned source table remain Unverified extensions.

| Short | Long | Condition | Disposition |
| --- | --- | --- | --- |
| a | ascii | EBCDIC | N/A: non-target character-set build; unverified there |
| B | binary | CMS_MVS | N/A: non-Unix |
| B | none (numeric) | TANDEM | N/A: non-Unix |
| AC | archive-clear | WIN32 | N/A: DOS archive-bit capability |
| AS | archive-set | WIN32 | N/A: DOS archive-bit capability |
| C | preserve-case | VMS; neg | N/A: VMS |
| C2 | preserve-case-2 | VMS; neg | N/A: VMS |
| C5 | preserve-case-5 | VMS; neg | N/A: VMS |
| df | datafork | classic MACOS | N/A: classic Mac |
| E | longnames | OS2 | N/A: OS/2 |
| ic | ignore-case | VMS or WIN32; neg | N/A: this native Unix option table omits it |
| I | no-image | RISCOS | N/A: RISC OS |
| jj | absolute-path | classic MACOS | N/A: classic Mac; absolute extraction stays Restricted |
| N | notes | AMIGA or classic MACOS | N/A: platform notes |
| Q | Q-flag | QDOS or QLZIP; numeric | N/A: QDOS |
| sC | create-files | UNICODE_TEST | Unverified: optional development build, not enabled |
| S | none | MSDOS/OS2/WIN32/ATARI | N/A: Unix hidden files already participate |
| V | VMS-portable | VMS | N/A: VMS |
| VV | VMS-specific | VMS | N/A: VMS |
| w | VMS-versions | VMS | N/A: VMS |
| ww | VMS-dot-versions | VMS | N/A: VMS |
| $ | volume-label | MSDOS or OS2 | N/A: volume labels |
| ! | use-privileges | NTSD_EAS | N/A: NT privileges |
| / | exts-to-swap | RISCOS; value | N/A: RISC OS |

### Invocation behaviors outside `options[]`

| Behavior | Disposition | Qualification |
| --- | --- | --- |
| `--`, options after operands, grouped options, unique abbreviations, `=value` | Supported | current standard-flags tests; all native negation interactions Unverified |
| ambiguity includes reserved long names | Supported | current normalizer; Unicode build names are Missing from ambiguity inventory |
| ZIPOPT then ZIP_OPTS fallback | Supported | environment helper/standard-flags tests; quotes never shell-evaluated |
| native ZIP environment / platform-specific defaults | Unverified | not inferred from ZIPOPT support |
| bare archive name `.zip` suffix, implicit stdin filter, literal dash source | Supported | standard-flags tests; stdout actions constrained |
| end-to-end incremental source/compression/output | Missing | source `collectBytes` precedes serialization; gated-source acceptance still open |
| update/copy/archive reads | Restricted | bounded buffered archive; not random access or multi-gigabyte support |
| shell-local TZ / locale overriding runtime timestamp encoding | Restricted | no ambient host mutation/fallback; runtime timezone used |
| exact native statuses/diagnostic bytes for all malformed formats | Unverified | documented generic bounded failures differ |

## Relevant UnZip 6.00 behavior

The ordinary native command and modifiers below come from `unzip -hh` on the
Apple 6.00 build. Unsupported options are rejected by `unzip/arguments.ts`.
Rejection checks and ordinary extraction/pipe controls are in the evidence plan.
ZipInfo/funzip/unzipsfx are distinct native interfaces, not inferred SDK support.

| Native behavior/options | Disposition | Scope / requirement |
| --- | --- | --- |
| default extraction, `-l`, `-p`, `-o`, `-d DIR`, `--`, member globs | Supported | `unzip.test.ts`, standard-flags tests; `-p` wins over `-l` |
| overwrite yes/no/all/none/rename/EOF | Supported | bounded stdin input; earlier extraction effects can remain |
| binary concatenation with `-p`, CRC/length checking | Supported | no output headings; final failures cannot retract delivered bytes |
| `-c` | Missing | stdout with names/text conversion differs from `-p` |
| `-f`, `-u` | Missing | freshness/update extraction |
| `-t`, `-T` | Missing | test-only / archive timestamp workflows |
| `-v`, `-z`, `-h`, `-hh` | Missing | verbose/version/comment/help interfaces |
| `-a`, `-aa`, `-b`, `-bb` | Missing | text/binary conversion controls; plain extraction preserves bytes |
| `-B` | Missing | UNIXBACKUP build feature; suffix collisions/failure controls |
| `-C` | Missing | case-insensitive selection |
| `-D`, `-DD` | Missing | timestamp restoration suppression |
| `-j`, `-L`, `-LL` | Missing | extraction name transformations/collision checks |
| `-M`, `-n`, `-q`, `-qq`, `-P value`, `-x list` | Missing | pager, never-overwrite, quiet, passwords, exclusions |
| `-K`, `-X` | Restricted | privileged attributes/UID/GID need honest VFS capability, never host privileges |
| `-:`, `-^` | Restricted | no extraction-root escape; control-character-name parity Unverified |
| `-U`, `-UU` | Missing | Unicode build-dependent controls, separate from automatic UTF-8 reading |
| `-W` | Unverified | WILD_STOP_AT_DIR build not obtained |
| `-A` | N/A | OS/2 or Unix DLL mode, not ordinary binary |
| `-E`, `-i`, `-J` (Mac), `-J` (BeOS), `-N` | N/A | classic Mac/BeOS/Amiga metadata |
| `-F`, `-/ value` | N/A | Acorn/ACORN_FTYPE_NFS optional build unavailable |
| `-s`, `-XX`, `-$`, `-$$` | N/A | Windows/DOS/OS2 security/naming/volume profiles |
| `-S`, `-V`, `-Y`, `-2` | N/A | VMS-specific restoration |
| ZipInfo `-Z`; `-1 -2 -s -m -l -v -h -M -t -T -U -UU -z` | Missing | distinct mode; product only has ordinary `-l` |
| funzip first-member streaming / unzipsfx executable | N/A | separate executables; no host-process fallback |
| split input | Missing | package rejects multi-disk; native 6.00 also documents conversion via Zip first |
| stdin archive streaming | Unverified | native UnZip documents no streaming; product archive path is VFS file |
| native UNZIP/UNZIPOPT/ZIPINFO/ZIPINFOOPT defaults | Missing | not implemented by ordinary argument parser |
| native metadata ownership, platform encodings and permissions | Unverified | only bounded timestamp/mode/name profiles tested |

## ZIP records and fields: PKWARE APPNOTE 6.3.10

Pinned FINAL revision: 2022-11-01, SHA-256
`0b993022a7d320a0bf704e6980bea36fafd17a6066ab994db0a0c16278a50cd6`.
Fetch URL is mutable; verify this digest before use. Native Zip 3.0 compatibility
does not imply support for every record or codec in this later APPNOTE.

| Record / field | APPNOTE section | Disposition | Profile / proof obligation |
| --- | --- | --- | --- |
| archive layout and local file header `04034b50` | 4.3.6–4.3.7 | Supported | contiguous referenced single-disk entries; format mutation tests |
| payload data | 4.3.8 | Supported | methods 0/8/12 only; actual size/CRC and codec EOF |
| classic signed/unsigned data descriptor `08074b50` | 4.3.9 | Supported | unique span/CRC/size match; both read forms, signed writer |
| 64-bit signed/unsigned descriptor | 4.3.9 | Supported | bounded ZIP64; existing format tests; ambiguity refused |
| archive decryption header | 4.3.10 | Missing | encrypted formats rejected; no credential workflow |
| archive extra data `08064b50` | 4.3.11 | Restricted | unreferenced/gap records rejected; no encrypted directory |
| central directory header `02014b50` | 4.3.12 | Supported | central/local metadata, names, spans and counts validated |
| central-directory digital signature `05054b50` | 4.3.13 | Restricted | no signature verification contract; extra spans refused |
| ZIP64 end `06064b50` | 4.3.14 | Supported | single disk, version 45; bounded extension size and safe integers |
| ZIP64 locator `07064b50` | 4.3.15 | Supported | exactly one disk and checked record offset/span |
| classic end `06054b50` | 4.3.16 | Supported | bounded comment; exact end; ambiguous end records refused |
| extraction version / flags / creator / attributes | 4.4.2–4.4.5, 4.4.14–15 | Restricted | admitted version/method/flag/type combinations only |
| DOS date/time, CRC32, name/comment lengths | 4.4.6–12, 4.4.16 | Supported | valid DOS dates, two-second resolution, NUL/traversal refusal |
| 32-bit sentinel sizes, offsets, directory size | 4.4, 4.5.3 | Missing | automatic byte-size/offset promotion not implemented; classic caps |
| 65,535 count and automatic larger count | 4.4.21–22 | Supported | `zip-count-boundaries.test.ts`; not proof of large byte-size ZIP64 |
| disk numbers, multi-volume directory/offsets | 4.4 | Missing | explicit multi-disk rejection; split workflow absent |
| strong-encryption masked headers/central directory | 4.3.10–12, 7 | Missing | reject bits 0/6/13 and protected extras |
| traditional encryption header/keys/verifier | 6 | Missing | `zipCrypto` helper tested; reader/writer integration absent |
| self-extracting prefixes | 4.3 layout / native extension | Restricted | spans must cover bytes starting at zero; no executable launch |
| appended data, orphan locals, gaps, overlaps, duplicate records | 4.3 layout | Restricted | fail rather than recover/guess; recovery switches Missing |
| extensible descriptors | 4.3.9.5 | Unverified | future format not inferred from classic descriptor support |
| ZIP64 version-2 encrypted directory extensions | 4.3.14, 7 | Missing | reader requires bounded supported profile, not arbitrary ZIP64 |

### Compression method registry (4.4.5)

| Method IDs | Disposition | Qualification |
| --- | --- | --- |
| 0 STORE | Supported | binary/empty/malformed size/CRC/budget controls |
| 8 DEFLATE | Supported | raw framing/EOF/CRC/expansion/cancellation |
| 12 BZIP2 | Supported | existing codec; method/version, integrity, trailing-stream tests |
| 1 SHRINK, 2–5 REDUCE, 6 IMPLODE | Missing | reader method whitelist rejects; native UnZip supports some build-dependent legacy methods |
| 9 DEFLATE64 | Missing | Apple UnZip has USE_DEFLATE64; product rejects |
| 10 old TERSE, 14 LZMA, 16 CMPSC, 18 TERSE, 19 IBM LZ77 | Missing | product method whitelist rejects; valid fixture interoperability Unverified |
| 20 deprecated Zstd, 93 Zstd, 94 MP3, 95 XZ, 96 JPEG, 97 WavPack, 98 PPMd | Missing | no ZIP codec paths; not native Zip 3.0 write features |
| 99 AE-x | Missing | separate AES extension; never reinterpret native `-e` |
| 7, 11, 13, 15, 17 reserved | N/A | no defined codec to implement |
| all unassigned method IDs | Restricted | rejected; no format guessing |

### Extra-field registry (4.5–4.6)

| IDs / semantics | Disposition | Qualification |
| --- | --- | --- |
| 0001 ZIP64 | Supported | required sentinel fields, duplicate/truncated/unsafe numeric refusal |
| 5455 extended Unix time | Supported | regenerated on rewrite; local/central consistency |
| 7075 Unicode path, 6375 Unicode comment | Supported | version/CRC/UTF-8/flag consistency; narrower than permissive native fallback |
| 9901 AES; 0017 strong encryption, 0018 record controls, 0019 recipient list | Missing | explicitly rejected; no decryption or authentication implied |
| 0007 AV, 0008 language encoding, 0009 OS/2, 000a NTFS, 000c OpenVMS, 000d Unix | Unverified | opaque retention can occur; semantic decoding/restoration not established |
| 000e stream/fork, 000f patch, 0014–0016 certificates/signatures | Unverified | unknown-extra retention is not implemented semantics/authentication |
| 0020 timestamp reservation, 0021 policy key, 0022 Smartcrypt provider, 0023 policy | Unverified | no security semantics; must not claim encrypted support from opaque acceptance |
| 0065/0066 IBM attributes, 4690 POSZIP | Unverified | platform-specific payload interpretation absent |
| 4.6 third-party extras (including Unix UID/GID 5855/7855/7875, Macintosh, BeOS, Acorn, Windows) | Unverified | bounded opaque retention on untouched entries / `-X-`; no ownership/fork restoration claim |
| any other extra-field ID | Unverified | bounded TLV preservation only; malformed/duplicate extras Restricted |

The catch-all extra rows cover the complete extensible ID space without asserting
meaning for unimplemented payloads. Unknown extras are not "Supported" merely
because their bytes survive a copy. APPNOTE appendices, encryption algorithms,
vendor versions, metadata subrecords and feature combinations require separate
qualification when their enclosing record is implemented.

## Pinned public-test sources and adaptation requirements

These sources were downloaded and inspected; their suites were not executed.
No external code/fixtures were adapted in this documentation-only task.

| Project / immutable revision | Useful source cases | Requirement mapping / license |
| --- | --- | --- |
| libarchive v3.8.1, `9525f90ca4bd14c7b335e2f8c84a4607b0af6bdf` | `libarchive/test/test_read_format_zip.c`: bzip2 one/multi/blockread, LZMA stream-end/7z, PPMd crash, invalid BZIP2 hang | ZIP codec framing, chunk partitions, malformed work bounds; file BSD 2-clause notices (Tim Kientzle/Michihiro NAKAJIMA), repository COPYING; preserve per-file notices and adjacent fixture provenance |
| CPython v3.13.7, `bcee1c322115c581da27600f2ae55e5439c027eb` | `Lib/test/test_zipfile/test_core.py`: bad/generated ZIP64 extra, force ZIP64, unseekable ZIP, short extra, overlap with archive comment, bad CRC, Unicode extras, password cases | sentinel/descriptor framing, metadata ambiguity, final CRC, wrong-password controls; PSF LICENSE and applicable historical notices; translate disk fixtures to memory rather than importing Python dependencies |
| Go go1.25.1, `56ebf80e57db9f61981fc0636fc6419dc6f68eda` | `src/archive/zip/reader_test.go`: invalid files, under-size, insecure paths, compressed directory, base-offset overflow; `writer_test.go`: comment, UTF8, time, offset, flush, directory attributes, copy/raw | safe arithmetic, path admission, header/record boundaries, incremental output and retained metadata; BSD 3-clause LICENSE plus source copyright and fixture notices |

Adapt each useful case independently against the pinned APPNOTE requirement,
retain its original provenance/license, and use compact offline memory fixtures.
Do not inherit permissive upstream extraction sanitization or concatenated/SFX
acceptance where the package deliberately refuses it. Independent expected bytes
must not be generated solely with the implementation helper under test.

## Next qualification steps

1. Add failing tests only for validated implementation gaps selected for work.
   Keep this audit separate from the later remaining-features implementation tasks.
2. For every Supported row, bind exact positive/negative/boundary/cancellation/
   neighbor test names and independent oracle observations; missing dimensions
   remain Unverified even when the focused suite passes.
3. Execute native behavior cases after syntax probes: no-echos password input,
   damaged/SFX/split archives, logging, display timing and archive operations.
   Record effects, output bytes, status and failure preservation, not just acceptance.
4. Qualify UTC and America/Chicago runtime TZ, DST boundaries, UTF-8/C locale,
   Linux and unavailable optional builds separately. No Darwin run certifies Linux.
5. Rebind evidence after implementation/integration; run maintained scope checks
   and visible CLI screenshots when behavior changes. Keep all unavailable
   platforms, tools and unexecuted upstream cases explicitly Unverified.

## Revalidated inventory refinements

The pinned source contains **109 active option entries** across its conditional
builds, including aliases; the constructed Unix build exposes **85**. Every
active `(short, long)` pair was independently matched to the tables above.
`--no-extra` is commented out and excluded. `-RE` is unconditional in this source
table; it enables bracket-list glob matching, despite the native label "regex".
It does not authorize a general regular-expression engine. Optional Unicode,
ZIP64, encryption and BZIP2 behavior must still be qualified per build.

Fresh probes distinguish **78 spellings** of 41 missing/reserved cases: 73
returned 16 and preserved archive/source bytes; five did something else.
All 78 had passing independent create controls. The 40 non-`mm` cases have
77 passing native syntax controls. Syntax controls do not verify operation effects.

| Switch | Refined disposition | Current effect / native control |
| --- | --- | --- |
| `-dc` / `--display-counts` | Missing; short parser defect | Short form deletes `binary`, status 0; native updates it with count progress. Long form rejects at 16. |
| `-dd` / `--display-dots` | Missing; short parser defect | Short form deletes `binary`, status 0; native updates it. The six-byte native input does not qualify dot thresholds. Long form rejects. |
| `-lf log` / `--logfile-path log` | Missing; short parser defect | Short form selects `log.zip` as archive and freshen mode, status 12; native creates `log.log`. Long form rejects. |
| `-TT unzip` / `--unzip-command unzip` | Restricted host execution; Missing virtual-command workflow; short parser defect | Short form creates `unzip.zip` containing `sample.zip` and `binary`, status 0; native consumes the command value. Long form rejects. Native command invocation is oracle-only; a future product implementation must use registered virtual commands. |
| `-mm` | Missing required rejection; destructive parser defect | Status 0, archive rewritten and source deleted; native status 16 preserves both. Separate `-m -m` semantics are not inferred from `-mm`. |
| `-A` / `-J` | Missing explicit operations; Restricted ordinary reader | Native 64-byte `MZ` prefix is adjusted and stripped with successful cross-reads. Product refuses the adjusted prefix. Two-byte-prefix native failure is retained separately. |
| `-s 64k` | Missing | Native creates 65,536-byte `.z01` and 4,628-byte final `.zip`, then recombines successfully. Product refuses the final multi-disk record. Pause/bell/transaction semantics remain Unverified. |
| method 14 LZMA | Missing, independently reproduced | Python 3.9.6 creates and cross-reads a 120-byte, one-byte-payload archive; product rejects its EOS flag. This is an extension beyond native Zip 3.0. |
| other missing method IDs | Missing dispatch; Unverified valid codec interoperability | Twenty method-header mutations reject at 2 with STORE controls; mutated payloads are not valid fixtures for those codecs. |
| automatic byte-size ZIP64 | Missing sentinel emission; Unverified large interoperability | Synthetic advertised-size `0xffffffff` is refused before output even with enlarged limits; a small archive with those limits passes. No multi-gigabyte allocation or native large-file proof. |
| incremental stdin-to-stdout | Missing, reproduced | No output before the second source pull; cooperative cancellation preserves its reason. A finite one-byte input produces 269 bytes successfully. Not proof of random-access or large-file streaming. |
| UnZip `UNZIP` / `UNZIPOPT` defaults | Missing, reproduced | Each variable set to `-p`: product still prompts for overwrite and returns 1 at EOF; native pipes one-byte `x` at 0. Explicit product `-p` passes. `ZIPINFO`/`ZIPINFOOPT` behavior in the absent ZipInfo mode remains Unverified. |

No feature is marked complete by these probes. In particular, intact repair
syntax, display switches on tiny inputs, `-FI` on a regular file, Unicode controls
on ASCII names and split controls without rollover do not qualify their intended
behaviors. Native `-F` failed on the tiny intact fixture; `-FF` recovered it and
cross-read successfully. Damaged recovery remains Unverified.

## Complete field and flag qualification index

This index fills out the field families within the record table. Section numbers
refer to the pinned APPNOTE 6.3.10, not a moving specification.

| Fields / sections | Disposition | Qualification limits |
| --- | --- | --- |
| integer ordering, variable strings, central ordering, sentinel rules; 4.4.1 | Supported bounded profile | Central-order extraction and checked spans; full ordering permutations Unverified. |
| creator and extraction version; 4.4.2–3 | Restricted | Admitted 10/20/45/46 feature combinations; other platforms and extraction versions Unverified. |
| GPBF bits 0, 6, 13; 4.4.4 | Missing encryption profiles | Explicit refusal; traditional independent encrypted fixture refuses. Valid strong-encryption/masked-directory fixtures Unverified. |
| GPBF bits 1–2; 4.4.4 | Supported for DEFLATE; Missing other methods | Method-dependent admission; independent LZMA EOS refusal reproduced. IMPLODE/DEFLATE64 interactions Unverified. |
| GPBF bit 3; 4.4.4 | Supported bounded descriptors | Signed/unsigned and classic/wide framing; method cross-products remain open. |
| GPBF bits 4, 7–10, 12, 14–15; 4.4.4 | Restricted reserved/unused values | Refused rather than assigning invented semantics. |
| GPBF bit 5; 4.4.4 | Missing patched-data interpretation; Restricted ordinary admission | No patch reconstruction; independent patch fixture Unverified. |
| GPBF bit 11; 4.4.4 and Appendix D | Supported bounded UTF-8 profile | Raw/effective consistency and invalid UTF-8 refusal; runtime locale override Restricted. |
| method, DOS time, CRC, sizes; 4.4.5–9 | Supported 0/8/12; Missing other codecs/large sizes | Final CRC failure can follow delivered `-p` bytes; native byte equivalence is scoped. |
| name/extra/comment lengths; 4.4.10–12 | Supported bounded profile | 16-bit and configured limits; zero/maximum/malformed interactions need per-feature controls. |
| disk start; 4.4.13 | Missing multi-disk | Classic/wide multi-disk refusal; native split workflow reproduced. |
| internal/external attributes; 4.4.14–15 | Restricted | Text bit and supported Unix/DOS types; internal bit 1 record format, native ownership/ACLs Unverified. |
| local offset; 4.4.16 | Supported bounded single-disk; Missing automatic promotion | Checked safe offsets and contiguous coverage; arbitrary prefix scanning Restricted. |
| name/comment bytes; 4.4.17–18 | Supported UTF-8/CP437/Unicode-extra profile | Traversal/NUL restrictions; raw comment retention is not every native encoding behavior. |
| end disk fields; 4.4.19–20 | Missing multi-disk | Ordinary and ZIP64 single-disk controls only. |
| per-disk/total counts; 4.4.21–22 | Supported classic maximum/automatic larger counts | Existing count tests; not large byte-size evidence. |
| central size/offset; 4.4.23–24 | Supported bounded single-disk; Missing automatic promotion | Exact checked central span and ZIP64 locator relationships. |
| end comment length/bytes; 4.4.25–26 | Supported bounded profile | Exact end and ambiguous-record refusal; trailing data Restricted. |
| ZIP64 extensible sector; 4.4.27 | Unverified semantics; Restricted version profile | Bounded extension bytes are not authentication or encrypted-directory support. |
| extra TLV framing; 4.4.28, 4.5.1 | Supported framing; Unverified unknown semantics | Duplicate/truncated refusal and scoped opaque retention. |
| spanning/split marker `08074b50`; 8.5.3–5 | Missing | Native first-volume marker observed; descriptor signature has a different contextual meaning. |
| temporary single-segment spanning marker `30304b50`; 8.5.4 | Unverified | No independently valid fixture executed. |

### Explicit third-party extra-field inventory

The following enumerates every ID in APPNOTE 4.6.1; none is hidden behind an
opaque-retention claim. The PKWARE IDs are enumerated in the earlier 4.5 table.
Reserved PKWARE IDs `0008`, `000e`, `0020`, `0066`, `4690` are **N/A** for a
defined semantic implementation at this revision; opaque payload behavior is
separately **Unverified**. `9902` is explicitly unknown, not AES support.

| ID | APPNOTE mapping | Disposition |
| --- | --- | --- |
| 07c8 | Macintosh | Unverified semantics |
| 1986 | Pixar USD | Unverified semantics |
| 2605 | ZipIt Macintosh | Unverified semantics |
| 2705 | ZipIt Macintosh 1.3.5+ | Unverified semantics |
| 2805 | ZipIt Macintosh 1.3.5+ | Unverified semantics |
| 334d | Info-ZIP Macintosh | Unverified semantics |
| 4154 | Tandem | Unverified semantics |
| 4341 | Acorn/SparkFS | Unverified semantics |
| 4453 | Windows NT security descriptor | Unverified; privileged restoration Restricted |
| 4704 | VM/CMS | Unverified semantics |
| 470f | MVS | Unverified semantics |
| 4854 | THEOS (old) | Unverified semantics |
| 4b46 | FWKCS MD5 | Unverified; no authenticity claim |
| 4c41 | OS/2 ACL | Unverified; privileged restoration Restricted |
| 4d49 | Info-ZIP OpenVMS | Unverified semantics |
| 4d63 | Macintosh Smartzip | Unverified semantics |
| 4f4c | Xceed original location | Unverified semantics; extraction containment Restricted |
| 5356 | AOS/VS ACL | Unverified; privileged restoration Restricted |
| 5455 | Extended timestamp | Supported bounded timestamp profile |
| 554e | Xceed Unicode | Unverified semantics |
| 5855 | Original Info-ZIP UNIX | Unverified semantics |
| 6375 | Info-ZIP Unicode comment | Supported bounded consistency profile |
| 6542 | BeOS/BeBox | Unverified semantics |
| 6854 | THEOS | Unverified semantics |
| 7075 | Info-ZIP Unicode path | Supported bounded consistency profile |
| 7441 | AtheOS/Syllable | Unverified semantics |
| 756e | ASi UNIX | Unverified semantics |
| 7855 | New Info-ZIP UNIX | Unverified semantics |
| 7875 | Newer Info-ZIP UID/GID | Unverified; ownership restoration Restricted |
| a11e | Data stream alignment | Unverified semantics |
| a220 | Open Packaging growth hint | Unverified semantics |
| cafe | Java JAR | Unverified semantics |
| d935 | Android ZIP alignment | Unverified semantics |
| e57a | Korean code page | Unverified semantics |
| fd4a | SMS/QDOS | Unverified semantics |
| 9901 | AE-x | Missing encryption; independent authenticated fixture Unverified |
| 9902 | Unknown | Unverified semantics |

### Exact public-test requirement anchors

These are candidate adaptations at the immutable revisions above, **not executed
upstream tests**. Preserve their per-file notices and repository licenses when
adapting; accompanying archive fixtures require their own provenance check.

| Source | Exact cases | Required controls when adapted |
| --- | --- | --- |
| libarchive `test_read_format_zip.c` | `test_read_format_zip_bzip2_one_file`, `test_read_format_zip_bzip2_one_file_blockread`, `test_read_format_zip_bzip2_multi`, `test_read_format_zip_bzip2_multi_blockread` | Positive cross-read; corrupt stream; chunk boundary; cancellation; STORE/DEFLATE neighbors. |
| same | `test_read_format_zip_lzma_stream_end`, `test_read_format_zip_lzma_stream_end_blockread`, `test_read_format_zip_7z_lzma`, `test_read_format_zip_lzma_alone_leak` | EOS/property framing; truncated and excessive dictionary requests; chunk partitions; cancellation; existing codec neighbors. |
| same | `test_read_format_zip_ppmd8_crash_1`, `test_read_format_zip_ppmd8_crash_2`, `test_read_format_zip_bz2_hang_on_invalid` | Positive minimal valid codec control beside malformed fixture; bounded work; cancellation; unaffected codecs. |
| CPython `test_core.py` | `test_bad_zip64_extra`, `test_generated_valid_zip64_extra`, `test_force_zip64`, `test_zip64_required_not_allowed_fail` | Positive sentinel; negative absent/truncated extras; exact numeric boundary; cancellation before publication; classic count neighbor. |
| same | `test_zipfile_with_short_extra_field`, `test_overlap_with_central_dir`, `test_overlap_with_archive_comment` | Valid compact control; bad TLV/overlap; span boundary; cancelled decode; ordinary archive neighbor. |
| same | `test_read_zipfile_containing_unicode_path_extra_field`, `DecryptionTests.test_no_password`, `.test_bad_password`, `.test_good_password`, `.test_unicode_password` | UTF-8/CRC consistency and correct password; wrong/missing password; empty/non-ASCII boundary; cancellation; unencrypted neighbor. |
| Go `reader_test.go` | `TestInvalidFiles`, `TestUnderSize`, `TestInsecurePaths`, `TestCompressedDirectory`, `TestBaseOffsetPlusOverflow` | Valid archive; malformed/path refusal; arithmetic boundary; cancellation; safe extraction/pipe neighbors. |
| Go `writer_test.go` | `TestWriterComment`, `TestWriterUTF8`, `TestWriterTime`, `TestWriterOffset`, `TestWriterFlush`, `TestWriterDirAttributes`, `TestWriterCopy`, `TestWriterCreateRaw` | Positive raw/copy metadata; negative conflict; field/flush boundary; sink/source cancellation; ordinary write/update neighbors. |

## Completion accounting

| Evidence dimension | Current status |
| --- | --- |
| Positive | Scoped product create/pipe controls and selected independent oracle workflows executed. |
| Negative | Missing syntax, short misdispatch, selected format refusal and sentinel guard reproduced. |
| Boundary | Small LZMA payload, ZIP64 advertised sentinel and actual native split rollover observed; exhaustive boundaries Unverified. |
| Cancellation | Gated stdin cancellation reproduced; no per-option cancellation qualification. |
| Neighboring regression | 863 existing ZIP tests pass separately under C/UTC and UTF-8/America/Chicago. |
| Complete features | None newly qualified; five dimensions must bind to each individual feature and exact candidate. |
| Unavailable environments | Linux/container, Go binary, other feature/platform builds Unverified; not passes. |

## Follow-up user workflow validation and parser fixes

Current working candidate is based on `c75f0499a1fe7a5b4f5455779eed99cb4ee6cbab`
with the package changes authenticated in the evidence plan's **User workflow
follow-up** section. Earlier captures above remain baseline evidence.
Native two-character options now take precedence over grouped flags for the
five validated collisions `dc`, `dd`, `lf`, `TT`, and `mm`, including after a
grouped `q`. `dc`/`dd` no longer select deletion, `lf` no longer selects line
conversion/freshen, `TT` no longer selects a different archive and integrity
test, and `mm` no longer removes sources.

The display/logging features remain **Missing** and the external host-test
workflow remains **Restricted**; rejection fixes do not implement them. `mm`
is a **Supported rejection**, with positive ordinary-create/literal/help
controls, negative option refusals, attached-value/negation/order boundaries,
diagnostic-write cancellation with reason preservation, and ZIP neighboring
regressions. Exact native diagnostic text for `mm` is not claimed.
All 41 audit cases / 78 short and long spellings now reject at 16, preserve
source and archive bytes, and have independent passing create controls.
The 77 ordinary native syntax controls pass; native `mm` has its separate
negative operation control. Both maintained-source ZIP regression profiles
pass 883 tests. Full feature cross-products and upstream suite execution
remain unverified as enumerated above.
