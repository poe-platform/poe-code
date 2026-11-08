# Version5 literal POSIX filename admission

Root authorizes only the transport correction for two committed backslash
filenames. Productf5, expectedc109, the full profile, native and cleanup inputs
remain unchanged. The dfcb version4 zero-build failure stays preserved.

`ARCHIVE_PATH_PROFILE` explicitly pins darwin/arm64, POSIX syntax and `/` as
the sole separator. Actual platform/architecture must match. An override with
Windows/Linux syntax/platform, another separator or architecture is refused
before extraction. This is not a portable Windows filename policy.

Within that profile, `back\slash` remains one literal filename. No backslash
is rewritten or interpreted as a separator, including in symlink targets.
NUL, absolute paths, slash traversal, non-normalized slash paths, .git, duplicate
members, symlink ancestors/escapes, modes, Git hashes and exact byte bounds keep
their existing rejection rules. The existing profile JSON is not rewritten.

The presealed five-group controls declare full frozen-member admission, unsafe
path/profile refusals, actual extraction of both exact candidate blobs, literal
backslash symlink resolution plus escape/hash/mode/size negatives, and the
unchanged four version4 groups (including real duplicate compiler invocations
and the read-only outer PID observer with target ps still denied). Cross-platform
profile rejection is tested on the pinned Mac, not by running other operating
systems. Tiny compiler control builds are not f5 production builds.

After source/control sealing, run these controls and exactly one new bounded
`review-build-types` attempt. No canonical/native/service gate is authorized.
The result must report actual production invocation count, declaration reuse,
type diagnostics and cleanup, not infer success from transport admission.
Version4 evidence and prior19/3→21/1 remain historical, not rescored.
