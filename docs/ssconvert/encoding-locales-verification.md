# Encoding, locale and transliteration verification

The TypeScript ESM ssconvert engine now uses measured local tables for 44
single-byte codepages, 238 declared iconv aliases and 27 additional measured
built-in/canonical names. Import and export share these mappings; WHATWG's
Latin-1/Windows-1252 substitution no longer determines legacy mappings. No
native converter, process, ambient environment or host locale is a product
dependency or fallback. The virtual command continues to use the SDK engine.

The official 1.12.61 archive SHA-256 was reverified as
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
The five consulted primary source members match the archive bytes. Source stayed
in `out`. The separately built oracle's dependency, shared-library, plugin,
locale, source and binary bindings are captured in
`encoding-reference-profile.json`; results qualify that profile only.

The bounded strategy is static JavaScript tables, with no extra runtime library.
Captured data conservatively carries LGPL-2.1-or-later notices, license text and
complete corresponding source data in the package file list; handwritten code
retains GPL-2.0-or-later. See `src/encoding/NOTICE.md`. Generated facts are not
inferred from Unicode normalization or the JavaScript host's encoding aliases.

## Verified coverage

All 11,264 byte positions were measured across the 44 codepages, including 365
invalid positions. The successful 10,899 mappings were inversely checked.
Canonical converter admission was separately compared for byte consumption,
status and output; unavailable or invalid outcomes are not counted as decoded
successes. WINDOWS-1255 has additional bounded trailing/combining/bidi checks.

ASCII transliteration was measured for all 1,111,936 non-ASCII Unicode scalars in
each of C and C.UTF-8. Per-target sparse differences were measured for the same
scalars in each of 44 converters: 219 C and 5,047 C.UTF-8 differences from the
ASCII/direct mapping strategy. UCS-2 additionally measures all 1,048,576 astral
scalars per locale, including 1,042 C.UTF-8 BMP replacement differences. These
are scalar observations, not arbitrary sequence certification.

Original small fixtures provide 266 native differential cases asserting exact
destination bytes, statuses, diagnostics, input preservation and absent output
on failed probes. They cover both locales, every selected codepage, escape and
transliterate modes, Unicode/BOM output defaults, measured aliases, invalid and
truncated overrides, and deterministic TZ formulas. Native unrepresentable
escape/transliteration cases emit no loss warning; that empty stderr is asserted,
rather than treating a plausible decoded string as sufficient evidence.

Import retains the measured failed-override guessing behavior for invalid bytes
and consumes complete characters before a truncated tail. A source-admitted
uncaptured converter is an explicit unsupported feature, not a silent fallback.
UCS-2 rejects surrogate units; UTF-16 admits valid pairs. Output retains native
UTF-16/32 BOM defaults, UCS-2 little-endian and UCS-4 network-order defaults,
and `\uXXXX`/`\UXXXXXXXX` codepoint escapes with lower-case hex digits. Measured case-insensitive
repeated `//TRANSLIT` modifiers override escape mode, including empty charset
selection from injected LC_CTYPE.

Only injected environment/config drives locale selection. Nonempty LC_ALL
precedes the category variable, then LANG; explicit config supplies the baseline
when locale environment values are absent. C/POSIX/C.UTF-8 profiles are captured.
LC_CTYPE determines the converter when opened, before export locale changes;
LC_NUMERIC/LC_TIME are validated and both captured profiles use the same decimal
point/date names. Failed native export setlocale leaves the current locale intact.
Unknown runtime profiles fail before payload reads or destination effects.

TZ is taken from injected env/config, with empty TZ selecting UTC. Native and SDK
bytes agree for UNIX2DATE(0), DATE2UNIX(25569), DATE and TEXT under UTC,
America/New_York, Europe/Berlin, EST5EDT and empty TZ. Native tzdata is 2026c;
the measured Node candidate uses ICU 78.2/tzdata 2025c. These 20 deterministic
cases do not establish every zone/date transition or volatile NOW/TODAY parity.

Final encoded bytes remain bounded. Intermediate storage also has an explicit
finite source-text allowance because transliteration can discard scalars. Native
two-combining-mark output is one LF byte and now succeeds at outputBytes=1.
Nine independent memfs SDK cases verify larger discarded inputs, exact expansion
boundaries, aggregate intermediate limits, cancellation reason identity and zero
publication on rejection. Existing namespace, replay and engine realm ownership
contracts remain covered by package and focused virtual-command tests.

## Checks and remaining gaps

Fresh maintained package tests pass: 139 files, 3,865 tests. Package lint and its
production/test TypeScript checks pass. Independent review contributes 56
runtime/alias tests plus nine SDK budget tests; see `encoding-independent-review.md`.
Manual built virtual-command screenshots for C.UTF-8 ASCII transliteration and
escape output were visually inspected. QA/replay steps are in
`docs/plans/ssconvert-encodings-locales-and-transliteration-qa.md`.

The final uncached maintained safe-bash build closure passes (18 declared builds).
All 47 focused virtual-command tests and 558 maintained safe-bash runner tests
pass. The final guarded root ESLint invocation completes with zero errors and
four warnings, using its maintained authenticated cache. Exact route outcomes,
source/log hashes and successful/failed gates are in `encoding-checks.json`.

The maintained safe-bash typecheck exits 2 before type compilation because the
root public SafeFS export does not preserve the required shared SafeJS runtime
identity (`./packages/safe-js/dist/safe-fs.js` is missing). This is a failed gate,
not a typecheck pass; unrelated manifest edits and identity policy were preserved.

Missing runtime locale profiles are intentionally refused. Native instead emits
GTK fallback warnings (and sometimes Fontconfig warnings) and continues in C;
the two measured startup-failure cases remain mismatches, excluded from the 266
passing comparisons. Other installed locale profiles, GNU locale modifiers,
locale-specific diagnostic catalogs and non-C numeric/time conventions remain
uncaptured. Earlier explicit German formatting support is not proof of an
installed German native profile.

The existing CLI CommandProfile must also explicitly select `argumentEncoding: "utf8"`
for non-ASCII GOption strings in C.UTF-8; its captured C default does not infer
that channel from engine environment. A separate native probe of `-E é` under
C.UTF-8 succeeds with `fixture` plus LF (`666978747572650a`); the default parser
profile instead exits 1 with its conversion-input diagnostic, while an explicitly
injected UTF-8 argument profile admits it. The 266 comparisons use ASCII option
values. This configuration/inference limitation remains a measured mismatch.

Multibyte/stateful output encoders outside the implemented Unicode variants are
unsupported. Previously admitted multibyte TextDecoder paths are now refused
explicitly; their native mappings and invalid/truncated behavior are uncaptured.
See `encoding-current-verification.md` for the fresh SHIFT_JIS mismatch and
capability-boundary checks. Captured single-byte facts do not
prove all stateful WINDOWS-1255 sequences. UTF-7 output, import modifiers,
`//IGNORE`, mixed/unknown output modifiers and other native converters remain
explicit gaps. Native UTF-8//IGNORE succeeds in the measured case while product
rejects it; native ASCII//IGNORE crashed with SIGSEGV, which is not reproduced.

UTF-32 BOM input does not imply automatic UTF-32 detection in this reference:
LE follows its UTF-16 guess and BE follows Latin-1 fallback. Direct choices were
checked; the independent review records native NUL-warning bytes. Those exact
full importer warning/publication cases were not added to the 266 passing cases.
Arbitrary malformed Unicode, transliteration across adjacent source scalars,
every timezone transition and behavior under other dependency/plugin profiles
are gaps. No unsupported or unmeasured case is a pass.

The initial exploratory TZ assignments set strings rather than formulas and
were excluded from coverage. A concurrent verification attempt also timed out
the numerical QTukey test and read changing stress-test files; after the reviewer
finished edits, the full unchanged assertions passed without timeout changes.
These failed attempts were retained until recording the successful fresh checks.

No README changes, commits, pushes or publication were performed.
