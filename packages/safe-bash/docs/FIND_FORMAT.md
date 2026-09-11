# Formatted find output

`find /photos -type f -printf '%f %s bytes\n'` prints each file's basename
and byte size. `-printf` is an explicit action: it returns true, suppresses
implicit `-print`, and adds no newline of its own. Normal expression ordering,
short-circuiting, pruning and depth controls still apply.

| Directive | Value |
| --- | --- |
| `%%` | Literal percent |
| `%p` | Encountered pathname, including its starting argument |
| `%f` | Basename, with trailing slashes removed; `/` remains `/` |
| `%h` | Leading directory part; `.` when no slash exists, empty for `/` and `/name` |
| `%H` | Starting argument for this traversal |
| `%P` | Path relative to that starting argument; empty at the starting entry |
| `%s` | FileStat size in bytes |
| `%d` | Depth below the starting entry, which has depth zero |
| `%y` | Type selected by the same physical/logical stat behavior as `-type`: `f`, `d`, `l`, or `c` |

`-L` follows resolvable symbolic links for `%y`; unresolved dangling links
remain `l`. `%Y` is unsupported. This behavior follows the existing VFS
`-type` contract; no GNU executable qualification is claimed for that interaction.

Escapes are `\a`, `\b`, `\f`, `\n`, `\r`, `\t`, `\v`, `\\`, and one to
three octal digits (`\0` includes NUL). `\c` stops the current format, including
its remaining directives, but does not stop traversal or subsequent actions.
Formats and output retain their bytes; there is no terminal-specific filename
quoting. Width, precision, other directives, unknown escapes and trailing `%`
are refused with status 2 before traversal. In particular, GNU's warning-and-
literal-output behavior for unknown escapes is outside this supported subset.

Each find invocation admits at most 65,536 format bytes across all actions,
8 MiB of formatted output, and 32 Mi work units shared by format scans,
pathname scans/copies, directives and emitted bytes. Format admission precedes
byte materialization. The format scanner and pathname processing yield after
at most 4,096 charged units; output writes are at most 4,096 bytes and await
backpressure. Formatting exhaustion stops traversal with a diagnostic rather
than emitting a separate failure for every remaining entry. Host shell output
and time budgets may impose tighter limits. These are logical bounds, not a
process-memory or uncooperative-host preemption guarantee.

The implementation follows GNU's documented
[name directives](https://www.gnu.org/software/findutils/manual/html_node/find_html/Name-Directives.html)
and [escapes](https://www.gnu.org/software/findutils/manual/html_node/find_html/Escapes.html)
within this explicit subset. A format operand beginning with an option name,
such as `-printf '-depth'`, is literal format data.
