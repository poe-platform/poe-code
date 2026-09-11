# Issue 690: getopts declaration discovery follow-up

Stable release run 34418864865 failed the getopts state test because its final
assertion still expected `type -t declare` to fail. Issue 690 intentionally added
the limited `declare -A` builtin. The preceding invalid-octal status, empty
stdout, and exact diagnostic assertions still passed.

The failure reproduces locally in `/tmp/poe-690-getopts-red.log`: 33 tests pass
and only the obsolete declaration-discovery expectation fails. Current public
behavior reports `builtin` with status zero; unsupported `declare -i` returns
status two.

Update that expectation and retain the unsupported-mode check. No runtime
behavior changes. All 124 getopts runtime and associative-array tests pass in
`/tmp/poe-690-getopts-green.log`.

The final integration build and lint are coordinated with issue 689. This test
correction is delivered as its own atomic commit, separately from wget support.

The complete safe-bash suite also passed this corrected test; the sole full-run
failure was a separate committed-package metadata guard while issue 689's export
manifest edits remained uncommitted. The local commits precede its rerun so that
qualification targets a concrete revision; remote delivery still waits for gates.
