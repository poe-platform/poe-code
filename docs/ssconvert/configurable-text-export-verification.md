# Configurable text and plain CSV verification

Implemented two separate writers in `packages/ssconvert`, registered declaratively
and executed by the same SDK engine as the safe-bash virtual `ssconvert` command.
Native Gnumeric is a separate manual QA oracle, never a product dependency or
fallback. No README edits, Git commits, pushes or publication were performed.

The official Gnumeric 1.12.61 archive retained under `out/ssconvert-lifecycle`
was verified as SHA-256
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
The [captured profile](configurable-text-export-profile.json) records the actual
binary identity, installed plugin hashes, dependency versions, locale availability
and explicit isolated HOME/XDG/GSettings environment. Procedures are in
[the QA plan](../plans/ssconvert-configurable-text-export-qa.md).

The initial memfs regression failed because both writers were unavailable. Subsequent
repairs retained failing regressions before changes: native used-range exclusion of
styled empty cells; failed converter publication; UCS-2 astral escaping; UCS-4
byte order; Windows undefined bytes; Macintosh character differences;
ISO-8859-9/16 mapping; charset aliases and C-locale transliteration expansions.
A different agent independently stressed and repaired the encoding implementation.

Verified behavior includes the exact reviewed configurable option whitelist;
case-insensitive ASCII eol nicknames; property enum names/nicknames and boolean
parsing; multi-character separators and quotes; native per-character quote escaping;
fixed original quoting triggers; empty quotes/separators; leading/trailing whitespace;
embedded newlines; ragged/empty ranges; and ordered duplicate sheet concatenation.
Configurable export selects all sheets by default; plain CSV selects the active
sheet and accepts only common selection options. `formulas=true` is rejected.
`--import-options` remains nonexistent and rejected. Formatting uses the existing
automatic/raw/preserve engine. Locale changes honor only installed captured locales;
unavailable locale names retain the current locale, matching native setlocale failure.

The 48 option cohorts match native exit status and output bytes in every case.
Raw captures match 46/48 stderr sequences. One difference is a GLib warning envelope;
the other is the absolute oracle executable name in a help diagnostic. A separate
native recapture using `ssconvert` through PATH matches that complete diagnostic,
without normalizing the original capture. The 60 independent charset cohorts match
native statuses and output bytes in every case, with 58/60 exact stderr matches.
Three native empty/range measurements have corresponding passing canonical cases.

The [historical differential summary](configurable-text-export-differential.json)
links to the original captures in Git history, including rejected fixtures, failures
and corrections. The [coverage record](configurable-text-export-coverage.json) enumerates every
captured accepted charset name still unsupported. The 1,180-name classification
audit found 1,025 explicitly unsupported names and 155 names reaching existing
encoding routes. This certifies classification, not all alias bytes or repertoires.
No unavailable implementation is counted as native compatibility coverage.

Remaining compatibility limits are explicit: native invalid-converter warnings
contain GLib process/time prefixes; the product emits `Failed to create converter.`
and the exact final export error, preserving measured status and publication bytes.
Unimplemented native multibyte/stateful charsets report unsupported capability;
arbitrary Unicode transliteration, conversion suffix flags, unlisted aliases and
profiles beyond captured dependency/plugin/locale availability are unmeasured.
Full native text-export parity is not established.

Fresh verification passed 3,506 package unit tests in 133 files, package ESLint/source/test TypeScript,
42 actual virtual-command integrations, 558 maintained safe-bash runner checks and
the maintained uncached safe-bash workspace build closure (18 declared build tasks).
Canonical units use original in-memory fixtures and memfs; none spawn native
utilities, query LLMs or create host files. Tests cover cancellation identity,
encoding/quoting byte expansion, bounded sparse range work, unchanged rejected
destinations and SDK/virtual-command byte/namespace parity. Exporter listing and
preserve output screenshots were captured and visually inspected.

The maintained safe-bash typecheck exited 2 before checking source/consumers:
`Public SafeFS must preserve shared SafeJS runtime identity`, because the current
root manifest lacks `./safe-fs` importing `./packages/safe-js/dist/safe-fs.js`.
Existing root manifest edits were preserved. A separate focused strict TypeScript
check of the touched virtual-command test passes; it does not replace or certify
the failed maintained guarded route. No full repository lint/unit/release gate is
claimed. This record describes the dirty worktree, not a committed candidate.

One concurrent package test/lint attempt timed out an existing R.QTUKEY logarithmic
inverter case at its unchanged 5,000ms limit. The complete unchanged package suite
rerun without concurrent lint passed 3,506/3,506. Both attempts are retained in the
differential record; neither test assertions nor timeouts were weakened.

Temporary logs, screenshots and generated native fixtures were retained only under
the task-owned `out/configurable-text-export` during execution and are purged after
summarizing their coverage and hashes. Inherited source/evidence directories remain
untouched.
