# Bounded GNU human timestamp checkpoint

This fixes the routed `command/stat/timestamp` human fraction defect, not full
stat/shell parity. Production changes are confined to `timestamp()` and metadata
documentation. No SGID, filesystem, contract, root export, benchmark, table-text,
diff/patch, dependency or host-execution implementation changes are included.
The separate `../sgid-feasibility/` archive retains all six unresolved failures;
passing archive integrity tests do not close them.

## Numeric conversion contract

`FileStat` has only Number-valued `atimeMs`, `mtimeMs`, `ctimeMs` and optional
`birthtimeMs`. It has no nanosecond field or per-field resolution declaration.
For human `%x/%y/%z/%w`, interpret the Number's shortest round-trip decimal text
as milliseconds, scale that decimal exactly using BigInt, then round to the
nearest integer nanosecond. Exact half-nanosecond ties round away from zero.
Normalize signed nanoseconds into a floor-second calendar value and a fraction
in `[0, 999999999]`. Date receives only exact integral whole-second milliseconds.
The existing inclusive Date range is enforced; nonfinite/out-of-range values
fail EIO. Missing birth remains `-`; missing required timestamps remain ENOTSUP.

This deliberately does **not** expand the Number's binary residual into invented
precision or multiply a large epoch by one million in floating-point arithmetic.
For example `1700000000123.456` ms yields `.123456000`, not `.123456055`;
`999.9999995` ms rounds across the next second. It is a documented decimal
interpretation/rounding policy, not a reconstruction of unknowable original
native storage. Integral milliseconds pad six zeros; available sub-millisecond
digits are retained to nanosecond output resolution. Nine displayed columns
are not a claim of nanosecond storage or universally exact native comparisons.
The default report remains virtual, UTC remains deterministic, and human string
width/precision and output budgets still apply. No format breadth was added.

`epoch()` and epoch `formatField()` are unchanged, preserving `2cacd04` and
`0c4709f`, including negative fractional rounding and narrow-width trailing bytes.
Their existing three-test regression cohort passes in the full scoped run.

## Runtime evidence and denominators

`VALIDATION.json` pins source/test/author hashes, commands, outcomes and artifact
hashes. Logs are original command output, not rewritten expectations.
Raw Node assertion logs retain their whitespace-only indented lines exactly;
the all-artifact `git diff --check` flags these in `red.log` and `author.log`.
Source/tests/docs/JSON pass their separate whitespace check. Evidence bytes are
not reformatted merely to suppress those diagnostic-log whitespace warnings.

- Before fix: **2/39 passed, 37/39 failed** in the new deterministic suite.
  After fix: **39/39 passed**. These tests include 35 explicit numeric values
  through all four human directives, signed zero, whole seconds, milliseconds,
  sub-millisecond/nanosecond/subnormal values, tie rounding, second/day carry,
  realistic positive/negative epochs, Date boundaries, unavailable/invalid
  fields, default output, string formatting and exact output byte budgets.
- Native test: **1/1 passed**, with **19 measured native fixtures**. Their actual
  requested nanoseconds were retained, including positive/negative one nanosecond;
  that is this setter/filesystem observation, not a universal granularity claim.
  **15** rows have identical native/shortest-decimal VFS numeric values and exact
  output; **2** negative rows have numeric conversion residuals but round to exact
  native output; **2** large-epoch rows remain nonexact because native precision
  is unavailable in VFS numeric milliseconds. Thus output equality is **17/19**,
  not 19/19 native parity. Neither loss is discarded from the denominator.
- The native test reads raw BigInt host nanoseconds, measured RealFS numeric
  milliseconds, then passes those same numeric values through MemoryFS. Actual
  metadata command dispatch produces both product outputs. It verifies both
  GNU stat builds independently and preserves all argv/status/stdout hex/stderr,
  requested/measured timestamps and classifications in `native-freeze.json`.
- Metadata GNU 9.7 stat SHA-256:
  `9bfc67687cc527eb69aa7a877c1551c22db6ea46ff910ad055015958924e1fea`.
  Benchmark GNU 9.7 stat SHA-256:
  `bf6f8514f2a220a3c3743154e0530baeec864b9d1f20315cd9cb5832d28c9860`.
  They are distinct builds. The latter is the routed report's pin, not silently
  substituted for the metadata oracle. Native touch is separately hashed and
  version-checked in the capture. Both stat executables report GNU coreutils 9.7.
- Positive fresh `%z/%w` native observations retain raw and numeric precision
  separately. After negative setters, GNU reports birth unavailable while Node
  exposes zero and the virtual command renders epoch-zero birth. This existing
  metadata-availability discrepancy is retained, not fixed or called parity.
- Scoped metadata stress: **93/93 passed**: 51 preexisting tests, 40 new timestamp
  tests, and 2 historical SGID archive-integrity tests. Existing author suite:
  **42/43 passed**, with the single original three-digit human timestamp
  assertion still failing. All **seven original author artifact hashes remain
  unchanged**. No profile expectation was rewritten, skipped or green-waived.
- Scoped `tsc --noEmit` includes metadata source, metadata stress and read-only
  author tests: exit 0, no diagnostics. No root build or emitted JS siblings.

The two new native-harness calibration mistakes are also preserved: initial
classification assumed every unequal numeric millisecond value must lose a
nanosecond; nearest-nanosecond rendering recovered two rows. A subsequent birth
assertion incorrectly treated raw Node birth zero as available epoch-zero;
actual GNU output was `-`. The initial failure logs remain. These are explicitly
harness corrections, not additional production fixes or rewritten old oracles.

The final capture also records full argv/cwd and freezes shared-field numeric
metadata before sentinel reads can change access time. Earlier `native.json`
and `native-final.log` are retained as preliminary captures: their 19 fixture
rows remain valid, but their shared-field numeric stat was read after the content
checks and is not a synchronized atime comparison. Use `native-freeze.json`
for paired shared-field observations and the final test-source checkpoint.

The native tests require the pinned existing local builds; they fail rather than
skip if a build disappears or its hash changes. Only their uniquely-created
`namespace()` fixtures are cleaned, with content/sentinel checks before cleanup.
The shared oracle and unrelated temporary artifacts are not removed.

## Primary references

Consulted through `web.run` and kept distinct from runtime proof:

- GNU 9.7 source: `https://raw.githubusercontent.com/coreutils/coreutils/v9.7/src/stat.c`;
  local release `src/stat.c` SHA-256
  `32c77c3620837a73dc0ed72dc7ee874f8e52946c8c8c2c4b2255e4f41bea6bad`.
  `human_time()` renders a timespec through `%N`; x/y/z/available-w share it.
- ECMAScript 2024 Number conversion:
  `https://tc39.es/ecma262/2024/multipage/ecmascript-data-types-and-values.html#sec-numeric-types-number-tostring`.
- ECMAScript 2024 Date TimeClip:
  `https://tc39.es/ecma262/2024/multipage/numbers-and-dates.html#sec-timeclip`.

The current online GNU manual identifies a later version; it is not the 9.7
oracle or an authority replacing this pinned executable's epoch behavior.
No unchanged five-row benchmark, table-text corpus, original 3758-test corpus,
global audit, performance/superiority claim or 72-hour completion is made here.
Root's independent reviewer owns the next unchanged cross-module replay.
