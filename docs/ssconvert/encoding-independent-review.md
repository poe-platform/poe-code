# Independent encoding and locale review

Independent reviewer exercised the newly implemented encoding/locale runtime using original small fixtures. Unit fixtures remain in memory; no unit test starts native tools or writes files. Native processes below were separate QA oracles in the existing `ssconvert-statistics-qa` Colima container, never product capabilities.

Reference: Gnumeric 1.12.61, source archive SHA-256 `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`. Native dependency/plugin/environment profile is captured in `configurable-text-export-profile.json`; QA used fresh HOME/XDG directories under `/out/ssconvert-encodings-independent`, UTC, and explicit C/C.UTF-8 locale values. This review does not qualify other installed-library or locale profiles.

## Validated repairs

- Ordinary object prototype properties were accepted as encoding aliases or locale names. Original `constructor`, `__proto__`, and `toString` regressions failed before repair. Runtime now admits only own properties of captured dictionaries. Unknown import encodings retain the measured guessing path; unknown output encodings remain unavailable; unknown runtime locales remain explicit capability gaps.
- Root's native differential cases reproduced missing `ANSI_X3.4-1968` ASCII admission; added its measured explicit alias.
- Root's native differential case reproduced UCS-2 C.UTF-8 emoji transliteration as `:-D`, rather than `?`. UCS-2 now uses the captured converter-locale replacement and admits its actual encoded byte length before allocation.
- Native UCS-2LE import of `3dd800de0a00` rejects surrogate units and falls back to Latin-1; UTF-16LE accepts the same pair as U+1F600. The original UCS-2 regression failed before repair. UCS-2 import now rejects surrogate units before invoking UTF-16 decoding. Native full CSV fallback emits `223dc39820c39e220a2220220a` with its two-NUL warning; the root owns importer warning/publication integration.
- Original suffix regressions reproduced native `//TRANSLIT` export admission and its override of escape mode. Export now admits case-insensitive repeated `TRANSLIT` modifiers after measured alias resolution. Native QA validated `IBM437` as CP437; added its explicit alias. Native ssconvert also validated empty-base `//TRANSLIT`: injected C selects ASCII and C.UTF-8 selects UTF-8. Tests failed before those repairs.
- Native UCS-2/UCS-2BE of `𝚨 𝐀 𝟎 😀` under C.UTF-8 retains BMP Greek Alpha, Latin A, digit zero, and `:-D`. Four original Greek supplementary-scalar tests failed before integrating root's supplementary-scalar UCS-2 captures. Both endian variants now preserve the measured BMP replacements and byte budgets.
- Final bounded gconv declaration audit found canonical converter atoms omitted from declaration-key aliases: IBM850/852/855/857/858/860/861/862/863/864/865/866/869 and MAC-UK. Fourteen original one-byte decode/encode fixtures failed before adding explicit measured canonical mappings. No punctuation or IBM-number heuristic was added. Native libc iconv QA compared every byte for all 44 captured names against their canonical resolution: 11,264 status/consumption/output comparisons, plus 10,899 re-encoding comparisons of successful conversion results, with no differences. The comparison covers conversion-call behavior, including buffering; it does not establish all sequence/finalization behavior. Bounded regular `gconv-modules` and `.conf` source files were hashed; evidence is `out/ssconvert-encodings/canonical-aliases.json` pending root's evidence cleanup.

## Stress verification

`encoding-independent-stress.test.ts` contains 56 passing cases covering dictionary admission, UCS-2 versus UTF-16 scalar admission, WINDOWS-1255 trailing/combining/bidi bytes, CP864 percent-byte identity, exact cancellation-reason identity, exact output-budget boundaries, per-target replacements, measured export suffixes, empty-base locale selection, UCS-2 supplementary replacements, UTF-32 BOM guessing, native canonical names, and explicit/omitted TZ behavior without configuration mutation. Root's 266 captured native differential cases also pass after the repairs. Maintained package lint passed after the earlier reviews; the final canonical rerun is reported separately by root.

Native ssconvert accepted both a final WINDOWS-1255 E0 byte and E0 followed by LF as ALEF. Separate native iconv QA examined 13 trailing/combining/bidi sequences, including reversed combining order and adjacent directional controls; simple captured byte mappings agreed in those cases. This is bounded sequence coverage, not proof of all stateful conversion inputs. All 44 captured single-byte decoding tables were inspected for duplicate Unicode-to-byte assignments; none were found.

Native CP864 fixtures `% ٪ ‰ ‱` and `é 😀 €` agreed with runtime byte encoding in both escape and transliterate modes. CP864 byte 25 represents U+066A; unrepresentable ASCII percent becomes `\\u0025` in escape mode and `?` in transliterate mode. These fixtures do not establish all escape/transliteration replacement behavior for all encodings.

## Per-target repair verification

ASCII-target transliteration tables alone failed other output targets. In C.UTF-8, native CP437 output of U+2126 OHM SIGN is byte EA (U+03A9), whereas the ASCII-captured replacement was `?`. Native ssconvert reproduced this using `Å Ǻ ḗ Ω K Ḁ é`; native output hex was `22412041206520ea204b20412065220a`. Separate iconv QA also measured ISO-8859-7 and CP1253 byte D9, while CP850 remains `?`. In C locale the same OHM SIGN transliterates to `Ohm`. Root captured per-target scalar replacement facts for all 44 single-byte converters and both locales; finished-runtime stress tests confirm the measured CP437/ISO-8859-7 repair. Native MACINTOSH half-fraction replacement is `20 31 da 32 20`, while MAC-CYRILLIC uses `20 31 2f 32 20`; finished tests preserve both exact byte sequences and enforce their five-byte budget. These measured scalar gaps are repaired without normalization heuristics.

## Remaining gaps and bounded observations

UTF-32 BOM bytes do not imply automatic UTF-32 detection in this reference. Native no-override LE bytes `fffe0000410000000a000000` follow the UTF-16 guess and produce three-NUL warning plus `22204120220a2220220a`. BE bytes `0000feff000000410000000a` fall back to Latin-1 and produce eight-NUL warning plus `222020c3bec3bf20202041202020220a`. Direct decoding tests preserve these choices; importer NUL warnings/publication are root-owned integration.

Root validated explicit `TZ=""` as UTC using 20 deterministic native formula cases. Independent direct runtime checks confirm that empty TZ selects UTC, omitted TZ preserves the explicitly configured timezone, and neither operation mutates injected configuration. The direct checks independently review runtime state handling; native formula coverage is root-owned.

Uncaptured `//IGNORE`, mixed modifiers, unknown modifiers, and import modifiers remain explicit unsupported capabilities. Separate native QA observed ASCII//IGNORE export of Unicode crash with SIGSEGV, ASCII//garbage behave like ordinary escape, and valid UTF-8//IGNORE export succeed. Native UTF-8//IGNORE and UTF-8//TRANSLIT import of invalid byte FF both followed fallback Latin-1 in the exercised case; these observations do not establish general modifier semantics. The product does not reproduce native crashes or silently promote unmeasured suffixes to supported behavior.

Other locales, arbitrary multibyte output encoders, arbitrary invalid/truncated sequences, and every possible multi-character transliteration interaction remain unmeasured here. Full per-scalar facts do not establish context-sensitive sequence parity. Cancellation/budget checks are synchronous cooperative checks; this review does not claim asynchronous preemption or independent host isolation qualification.

## Final exporter budget review

Root reproduced a source-native combining-mark case that produces only LF under
C.UTF-8 ASCII transliteration but was rejected by the exporter's intermediate
scalar count at outputBytes=1. Root now bounds intermediate text with the explicit
source-text allowance as well as the four-byte output expansion allowance, and
the encoder retains its final byte limit. Nine independent original memfs SDK
cases in `encoding-budget-independent.test.ts` pass: 512 discarded marks fit one
byte; marks plus emoji, ligature expansion and escape output hit exact native byte
boundaries; each overflowing expansion preserves the destination with no writes;
aggregate intermediate text is bounded across separately admitted fields; and
formatter-triggered cancellation preserves the exact reason and destination.
No corrective runtime change was needed in this final review. Maintained package
lint passed with the new cases. These nine cases supplement the 56 alias/runtime
stress cases and root's 266 native differential cases.
