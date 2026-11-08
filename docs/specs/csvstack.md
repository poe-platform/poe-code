# csvstack source contract

Target: `csvkit/utilities/csvstack.py` from csvkit 2.2.0, PyPI archive
SHA-256 `147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`.
Reference execution uses the existing frozen
`darwin-cpython-3.14.2-csvkit-2.2.0` profile in
`../csvkit/reference-profile.json`, including Agate 1.14.2, SQLAlchemy 2.0.54,
locale C and timezone UTC. Exact observations are in
`../csvkit/csvstack-reference.json`.

The executable overrides shared `f`, `L`, and `I` flags. Its local options are
`FILE` (`*`, default stdin), `-g/--groups`, `-n/--group-name`, and `--filenames`.
`-n` names a grouping column; it does not mean another utility's local option.
The regression asserts the complete inherited option list and uniqueness.
The existing fourteen-command registration and public `execute`/`run` engine
continue to dispatch the literal executable name.

The first pass reads each file's header and closes named inputs before emitting
the first-seen union. It retains stdin's header and cursor without closing stdin.
The second pass reopens named inputs, skips `-K` physical lines in each named
input again, and reads dictionaries. Missing trailing cells are null; keys absent
from a particular file use the dictionary writer's empty rest value. Duplicate
header names take the last value, including a missing last duplicate. Blank data
records are skipped. Extra input cells are stored under Python's `None` key and
produce the source ValueError after all earlier completed output.

Without headers, only the first input supplies generated positional headers.
Rows from other files keep their actual widths, even when they differ. Stdin's
cached first row is emitted without a grouping cell, including when grouping is
requested. If stdin is not the first positional input in this mode, `-K` is not
applied to it during the second pass. Repeated stdin references retain the source
reconfiguration/closed-stream behavior; they are not replayable inputs.

Grouping values must match the input count unless filenames override groups.
Filename groups use input stream basename (`<stdin>` for stdin). The default
column name is `group`. Dictionary grouping overwrites an existing field with
the same name; both duplicate output columns receive the grouping value.
Agate dictionary line numbering similarly overwrites `line_number` fields,
including a grouping column named `line_number`. Counters run across files.
Positional numbering uses a separate prefix and preserves positional values.

The command uses injected byte sources, sinks, codecs and VFS exclusively.
Runtime enrolls cleanup before acquisition, retains owned input bytes and awaits
every output write. Named close and reopen failures remain observable at their
source positions. No subprocess, Python fallback, inferred types, implicit
filesystem access or database/network/interactive capability is introduced.

## Explicit qualification limits

Shared runtime records currently reject numeric/null-producing reader quoting
modes `-u 2`, `-u 4`, and `-u 5` with status 78. These accepted source options
remain blockers, including Python float/None header-key identity semantics.
Verbose Python traceback frames require separately qualified deployment identity
and source-frame information; this work does not qualify every `-v` error path.
Other codecs and compression require their existing explicit injected providers;
the new exact differential matrix uses UTF-8 inputs. No full csvkit suite parity
claim follows from this executable's measured cases.
