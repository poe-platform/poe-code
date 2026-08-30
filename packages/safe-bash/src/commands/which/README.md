# Internal which command module

`createWhichCommand`, `createWhichCommands` and `whichCommands` are implemented
in this internal module. The plugin is named `which-commands`; it preflights a
`which` collision unless constructed with `replace: true`. This change adds no
root export, package subpath export, default registration or agent-command wiring.

The authoritative behavior is `DESIGN.md` plus `ACCESS-POLICY-v2.md`; the latter
replaces only the permission/order/probe/error portions described there. Their
historical pre-release status text remains unchanged. The author received explicit
implementation authorization after the independent preimplementation freeze.

Lookup uses only invocation PATH/cwd and literal virtual paths. A candidate must
pass followed `stat` as a regular file, then the same VFS's `access(X_OK)`.
Readonly wrappers are not excluded; mode bits are not an alternative authority.
Absent PATH silently misses even slash operands. Leading bundled/repeated `-a`
and `-s`, `--`, and stop-at-first-operand parsing follow the sealed virtual profile.

Each invocation applies all seven configured logical admission limits. Default
values are 4096 arguments, 65536 aggregate argument bytes, 65536 PATH bytes,
4096 PATH components, 16384 bytes per cwd/display/lookup, 65536 logical probes,
and 8388608 stdout bytes including LF. Terminal stderr has a separate allowance
of `maxPathBytes + 256`. Unknown limit keys and invalid values throw RangeError
at factory construction. Limits do not bound RSS or backend-internal RPCs.

The command never consumes stdin, invokes another command, reads file contents,
creates output ownership scopes, closes borrowed sinks or accesses host files,
processes or environment. Provider calls and byte writes are awaited with the
invocation signal. Cancellation retains direct-handler reason identity but cannot
preempt opaque provider work. Success is not an atomicity or future execution
guarantee, native parity certification or deployed-provider acceptance.

Author regressions and explicit isolated build/moved-module verification are in
`tests/commands/which/`. They are not the independently owned frozen cohort.
