# Time and environment commands

Opt-in leaf module, zero runtime dependencies. **Root/package exports and the
default registry are not changed by this batch.** Frozen author/reviewer base
`d904ca9` has65 default commands, excluding date, sleep and printenv. The earlier
author narrative claiming60 at that freeze was stale; retained run output says65.

## API for integration

`createTimeEnvCommands(options?: TimeEnvCommandsOptions)` returns readonly
definitions in order `date`, `sleep`, `printenv`.
`timeEnvCommands(options?: TimeEnvCommandsOptions)` returns a
`VirtualShellPlugin`; collision preflight is atomic and `replace: true` is
explicit. Import these from this leaf's `index.js` after the appropriate TS build;
there is no published `virtual-bash/commands/time-env` export yet.

```ts
const plugin = timeEnvCommands({
  clock: () => 1709210096123,
  defaultTimeZone: "UTC",
});
const shell = new Shell({ fs, env: { TZ: "America/New_York" } }).use(plugin);
const result = await shell.exec("date -u +%FT%T.%3NZ");
```

Options are readonly: `replace`, `clock: () => number` (Unix milliseconds),
`defaultTimeZone` (default UTC), `scheduler: SleepScheduler`,
`maxTimerMilliseconds` (1..2147483647, default2147483647), and partial `limits`.
`SleepScheduler` supplies `now(): number` (finite monotonic milliseconds),
`setTimeout(callback, milliseconds): unknown` and `clearTimeout(handle): void`.
Callbacks must be asynchronously scheduled; injected host hooks are trusted,
not sandboxed or universally preemptible. Default sleep uses `performance.now`
and ordinary cancellable Node timers, not the injectable wall clock.

Default invocation limits:4096 arguments,65536 argument bytes,1MiB stdout,
10000 own environment properties,4096 format width. Limit violations propagate
typed EFBIG; invalid factory limits throw. Arguments and generated stdout are
bounded before publication. Family limits do not replace shared shell budgets.
Output uses awaited `writeBytes`, owned <=16384-byte chunks and the caller signal;
sink errors/budget failures propagate unchanged. None of these commands consumes
stdin or mutates command.env, cwd or filesystem contents.

## printenv

- `printenv [-0|--null] [--] [NAME ...]`; repeated/combined `-0` is accepted.
- Uses **only own string-keyed properties of command.env**, including
  `__proto__`, `constructor`, `toString` and nonenumerable properties. No inherited
  values, implicit host process environment or injected PWD.
- No operands: emit `name=value` records. Named operands: emit values in operand
  order, including repeated names and empty values. A name containing `=` is
  missing, matching the selected GNU profile. Values may contain Unicode/newlines.
- Default terminator LF; `-0` emits NUL. Parsing stops at the first name; a later
  `-0` is a variable name. All output is snapshotted before asynchronous delivery.
- Exit0 if all requested names exist (or enumeration succeeds);1 if any is
  missing;2 for usage errors. Missing names have no diagnostic. Enumeration
  order follows JS own-property order here, **not a portable environment-order
  guarantee**. No claim to represent duplicate OS environment entries.
- `--help`/`--version` identify the virtual implementation, not GNU or Node.

## sleep

- One or more nonnegative C-decimal operands, optional leading `+`, decimal
  fraction/exponent, and optional lowercase `s`, `m`, `h`, `d` suffix.
  Durations sum as exact finite decimal quantities, then round upward **once**
  to whole milliseconds for timers. Sparse base-billion columns retain carries
  even below nanoseconds without allocating buffers proportional to exponent
  magnitude. Work/storage follow bounded operand digits/columns, not elapsed
  duration. No epsilon or per-operand rounding: two subnanosecond fractions can
  sum to exactly1ms, and any positive excess still rounds to2ms. Timer resolution
  remains milliseconds; no nanosecond wake-up accuracy is claimed.
- Total is bounded by Number.MAX_SAFE_INTEGER milliseconds. No operands,
  negative operands (including `-0` option syntax), malformed/overflowing values,
  locale decimal commas, hex floats, NaN and infinity fail with status1 before
  any timer. Hex/infinite GNU forms are explicit unsupported scope, not emulated.
- `--help`/`--version` are informational options. A standalone `--` is rejected
  as an interval, matching the pinned GNU9.7 **Darwin build** used here. Do not
  infer that delimiter behavior for every GNU platform; no Linux control ran.
- Monotonic elapsed time is rechecked after every timer; early wakes re-arm,
  long delays chunk at the configured timer maximum, and zero creates no timer.
  No busy wait. Scheduler regressions/nonfinite readings reject explicitly.
- Cancellation before/during sleep preserves its reason, clears the outstanding
  timer and removes the abort listener. Successful sleep emits zero bytes and
  does not consume output budget. No promise of exact scheduling latency or
  preemption of an uncooperative injected host scheduler.

## date

Supported options: `-u`, `--utc`, `--universal`; `-d DATE`, `--date=DATE`;
`-r FILE`, `--reference=FILE`; `-I[date|hours|minutes|seconds|ns]`,
`--iso-8601[=PRECISION]`; `-R`, `--rfc-email`, `--rfc-2822`;
`--rfc-3339=date|seconds|ns`; one `+FORMAT`; `--`; help/version.
Short options can combine (`-ud@0`, `-uR`); required values may attach.
`--date` and `--reference` conflict. Output style flags conflict with `+FORMAT`.
Reference paths resolve through cwd and **VFS stat**, following VFS symlinks.
`-r` means file mtime, not the BSD date epoch operand.

Default clock is Date.now; an injected clock is sampled at most once and is not
consulted for absolute dates/reference files. Default output is C-profile
`%a %b %e %T %Z %Y`. Locale environment variables do not select host locale.
Only an **own** virtual `TZ` overrides the configured default UTC; `-u` overrides
even an invalid TZ. Empty TZ means UTC. Supported zones: Intl-recognized IANA
names/aliases (optional leading colon), UTC/GMT/Z aliases, and POSIX fixed
`UTC±H[:MM[:SS]]` / `GMT±H[:MM[:SS]]` with **reversed POSIX sign**.
Host timezone files, arbitrary POSIX DST rules and implicit host TZ are excluded.
IANA rules/names follow the installed Node ICU/tzdb, recorded in test evidence.
`%Z` uses ICU short names: e.g. Kolkata can be `GMT+5:30` rather than GNU `IST`.
Numeric offsets and instants are tested separately from those label differences.

Explicit, case-sensitive input grammar (trimmed surrounding whitespace):

- `@[-+]SECONDS[.FRACTION]`, or comma decimal,1..9 fractional digits.
- `YYYY-MM-DD`, optionally `T`/space `HH:MM[:SS[.FRACTION]]`, optionally
  `Z`, `UTC`, `GMT` or numeric `±HH[:MM[:SS]]` / `±HHMM` offset.
- C-English RFC date `[Wdy, ]D Mon YYYY HH:MM:SS GMT|UTC|±HHMM`;
  a supplied weekday must agree with the calendar date.
- `now`, `today`, `yesterday`, `tomorrow`. Today preserves the instant;
  yesterday/tomorrow preserve local wall time across calendar-day changes.
- `[now ]SIGNED_INTEGER second[s]|minute[s]|hour[s][ ago]`, elapsed arithmetic.

No arbitrary Date.parse, host eval, subprocess, natural-language parser or
ambient locale parsing. Calendar years0000..9999, leap-year/day validity and
offset ranges are checked; invalid dates and leap seconds are rejected rather
than rolled over. IANA nonexistent wall times reject. Ambiguous DST folds also
reject and require an explicit numeric offset; GNU libc's selected occurrence
is **not** claimed. Month/year-relative expressions, arbitrary GNU grammar,
file-batch parsing, debugging/resolution flags and OS clock setting are excluded.
`-s`, `--set`, and legacy clock-setting operands always fail without mutation.

Format directives:
`%% a A b B h c C d D e F g G H I j k l m M n N p P q r R s S t T u U V w W x X y Y z Z`.
Usual `-`, `_`, `0`, `^`, `#` padding/case flags and bounded widths are supported;
C-equivalent E/O modifiers are limited to their supported standard directives.
Width/padding on `%F` formats its year component (remaining six characters are
`-MM-DD`); explicit `%D` inherits year padding. C-locale `%c`, `%x`, `%X` are
opaque composites in the selected GNU9.7/Darwin profile: `#` does not recursively
toggle case. `^` uppercases text, except `%P` stays lowercase; `#` on `%p`/`%Z`
forces lowercase even with `^`, and on weekday/month names forces uppercase.
Numeric zone padding covers the sign and raw offset; colon-separated minutes
and seconds retain their two digits, while unpadded hours need not have two.
`%:z`, `%::z`, `%:::z` produce colonized offsets. An unmodified `%%` is literal;
decorated/width-qualified percent literals reject. `%N` defaults to nine fractional
digits; an explicit width truncates digits or pads on the right. `%3N` and `%6N`
give milliseconds/microseconds without rounding; widths above9 append zeros,
not measured precision. `0` pads right with zeros, `_` with spaces, and `-` omits
insignificant trailing zeros after truncation (at least one digit remains).
Padding flags obey their order; `^`/`#` do not change numeric digits. Width and
remaining byte limits are checked before allocating padding. E/O/colon modifiers
on N still reject. Negative epoch `%s` floors, with a nonnegative fractional
remainder. UTC/Gregorian and ISO-week formatting do not use host locale.

For a negative ISO week-year at the supported calendar's lower boundary, `%g`
formats the magnitude of its final two digits, matching the chosen GNU9.7 rule;
`%G` retains the sign and ISO week arithmetic is unchanged. Thus0000 January1/2
give `%G=-001`, `%g=01`, not an arithmetic wrap to99. This is a qualified component
formatting rule, not new negative-calendar-year input support or a claim about
every platform. Primary-source reasoning and native year neighbors are recorded
in `tests/commands/time-env/fraction-expansion/SEMANTICS.md`.

Bare `%-N` follows that same unpadded virtual rule and retains all available input
precision. GNU date9.7 specially rewrites this exact spelling to a precision based
on the native machine's clock resolution, even for explicit input; the observed
Darwin oracle uses six digits. The virtual command does not invent a host clock
resolution or truncate explicit nanoseconds to it. This measured native profile
difference is retained in `tests/commands/time-env/fraction-expansion/native-v1.json`.
The historical rejection profile for decorated/>9-width N remains preserved in
the original author and independent captures; the expansion has new versioned
positive assertions rather than silently rewriting those old results.

**No fake measured nanosecond precision:** Date.now supplies milliseconds, so
its N output ends in six zeros. Explicit input may supply nine digits. A VFS
number-valued mtime/clock is interpreted from its shortest decimal millisecond
representation and floored to nanoseconds; this cannot recover precision absent
from that metadata. Tests distinguish Node/Apple utimes quantization from date
formatting. Unsupported usage/date syntax returns1 with no partial stdout;
reference errors remain failures. Cancellation and output errors propagate.

## Validation boundary

`tests/commands/time-env/` has deterministic byte/status/effect fixtures, real
Shell workflows, timers/quota/abort stress and optional pinned-native comparisons.
The evidence runner freezes committed regular files and builds/imports the leaf;
the native profile records GNU9.7 Darwin and Apple separately. Missing native
tools remain explicit external skips, never passes; deterministic tests still run.
This is author coverage. A **different verifier** must review holdouts before
root public/default integration. No full GNU-date grammar, all-backend guarantee,
whole-product gate closure or superiority claim is made.
