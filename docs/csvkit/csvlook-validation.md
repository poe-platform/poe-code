# csvlook reference and validation

Reference: csvkit 2.2.0, source archive SHA-256
`147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`,
under `darwin-cpython-3.14.2-csvkit-2.2.0` from reference-profile.json.
The capture records CPython 3.14.2, Agate 1.14.2, Babel 2.18.0 and SQLAlchemy
2.0.54. The existing frozen profile contains locale, driver and dependency
qualification; this pass adds no database execution or profile change.

`csvlook-reference.json` preserves 195 original stdout/stderr/status cases and
full authenticated installed print_table/config/utils sources. The csvlook source
captured in `csvlook-terminal-reference.json` matches the existing archive source
manifest's SHA-256. Sources are research data, never imported as executable
product code. Captures use C locale, UTC, UTF-8, columns 80/lines 24 and piped
stdio; stdout/stderr are decoded directly from bytes without universal-newline
conversion. The config snapshot includes `en_US_POSIX`, ASCII table separators,
`...` text/omission markers and `…` numeric truncation.
`csvlook-rowlimit-reference.json` adds three integer-boundary captures: 2^53 and
sys.maxsize are valid loading limits, while sys.maxsize+1 raises the native islice
error. Two failing cases preceded the raw BigInt range-admission fix.

Two original stdout-PTY captures at 80×24 and 5×3 retain terminal CRLF bytes.
Their table data are identical: no automatic dimension truncation or ANSI styling.
Canonical comparisons account for the PTY driver's LF→CRLF transformation;
product sinks receive LF bytes. stdin-TTY prompting beyond the existing explicit
file/piped-data error and other terminal drivers are not requalified here.

TDD began with 174 failures / 12 passes across the first domain cases. Added
cases reproduced payload-NaN grouping and zero-row field parsing failures before
their fixes. Independent safe-bash original regressions then reproduced skipped
line consumption and named-file open error gaps before the capability binding
fix. All canonical cases use memory streams or the memory filesystem; no native
oracle, disk creation, network, LLM or real database is used by these tests.

Current measured checks:

- 198 exact original command differentials, two terminal-format comparisons,
  flag collision audit and SDK invocation-local/probe checks.
- Independent safe-bash stress: 208/208 pass, including the 198 originals,
  fragmented mutable input, physical-line numbering, VFS input/pipeline/output
  effects, backpressure, false cancellation, consumer closure and delayed open
  cleanup. No skips or unsupported cases enter that compatibility denominator.
- Maintained csvkit workspace tests: 2,288 passes, one skipped and six TODOs;
  those seven cases remain explicit suite blockers, not passes.
- Selected safe-bash workspace dependency build closure succeeds (10 builds).
  Domain lint/source/test typechecks and maintained integration runner tests
  succeed (536 runner tests). Focused maintained Node reporter run succeeds
  (226 tests in the final run, including open-cleanup and integer-boundary cases).
  Maintained safe-bash source/test and all 26 consumer-group typechecks succeed;
  expected negative consumer fixtures reject as declared.
- Final guarded repository ESLint: complete, exit 0, zero errors and two warnings
  in unrelated DOCX tests, across all 15,885 configured subjects. The first run
  reproduced a prefer-const error in the new open-probe binding, fixed before
  the final stable-source run; unrelated warning sources were preserved.
- Ad hoc screenshot generated from the actual safe-bash command and visually
  inspected: typed headers, grouping, alignment and multiline line numbers are
  correct. The screenshot font displays a missing glyph for `↵`; emitted bytes
  match the reference. Temporary screenshot/capture tooling is removed after use.

An exploratory workspace npm test with a name pattern still launched unrelated
test-file imports and saw the two then-unfixed zero-row regressions. It was
stopped in favor of exact focused paths, and is incomplete evidence, not a full
workspace or repository gate. Full csvkit-suite parity, other CPython profiles,
all inference/locales and quoting modes 2/4/5, reference verbose traceback
deployment identity and hosts lacking open-only capability remain unqualified.
Specification: ../specs/csvlook.md. QA: ../plans/csvlook-qa.md and
../plans/csvlook-stress-qa.md. No README, staging, commits, push or publication.

## Additional user edge validation

The user edge pass authenticates the same CPython 3.14.2 / csvkit 2.2.0 /
Agate 1.14.2 / Babel 2.18.0 / SQLAlchemy 2.0.54 runtime and installed
print_table source hash `8794cd8902a4624857ad563f8cb760310d1f8a006410e8e9ddd1c2fc24df089c`.
`csvlook-user-numeric-reference.json` retains 50 C/UTC/UTF-8 native stdout,
stderr and status captures across ten numeric inputs and five precision settings.
The initial matrix had 20 mismatches. Four failing domain regressions reproduced
float-overflow Decimal formatting and leaked Decimal quantization exceptions.
The renderer fixes both; the rebuilt safe-bash integration matrix has zero
mismatches in all 50 comparisons.

Current additional checks pass: 257 domain csvlook cases; 233 safe-bash csvlook
stress/user edge cases (25 independently authored new cases); 109 maintained
discovery tests; selected safe-bash dependency build closure (10 builds);
csvkit workspace lint/source/test typechecks and focused integration ESLint.
The maintained safe-bash typecheck route also succeeds for source/tests and
all 26 consumer groups, including declared rejection of negative fixtures.
The complete maintained csvkit workspace unit route has 2,342 passes,
one skipped case and six TODOs; those seven remain blockers, not passes.
An actual safe-bash screenshot was visually inspected for line numbers, grouping,
precision ellipsis and signed `1E+309` scientific output. New canonical tests use
memory only; native commands and temporary screenshots are ad hoc oracle/QA
work. The named-file control-character observation was an input-role mismatch
in the exploratory harness: native named-file execution confirms intentional
CR/NUL normalization, so no product normalization change was made.

QA procedures: ../plans/csvlook-user-edge-qa.md and
../plans/csvlook-user-stress-qa.md. This scoped pass does not establish universal
edge coverage, full suite parity, previously unqualified locales/quoting modes
or Python traceback deployment identity. No README additions, staging, commits,
push or publication occurred.
