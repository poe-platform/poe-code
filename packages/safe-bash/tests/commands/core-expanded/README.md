# Expanded core failure regressions

The immutable224-case comparison is unchanged. This author patch implements
realpath relative-base rendering and fixes GNU wc column width and explicit
C/POSIX character counts. Native24 vectors (36 wc chunked checks +12 paths)
are frozen with GNU9.7 executable hashes. The original streams.test assertion
`1 3 17 18` is corrected to the independently captured seven-column stream
format; that is a stale author assertion, not a benchmark expectation change.

Capture a new native cohort only under a new filename/directory; capture.mjs
refuses to overwrite native.json. `COREUTILS_ORACLE_ROOT` selects the existing
GNU9.7 binaries. Product code never launches these binaries or uses host paths.

The historical env order mismatch remains recorded. Subsequent investigation in
`../core-env/README.md` identifies the pinned GNU9.7 build's gnulib putenv rule:
prepend new names, replace existing slots in place. Product env now implements
that actual profile rather than reversing final output or normalizing benchmark
bytes. POSIX.1-2017 section8.1 gives environment string order no portable meaning.
Exact values, parent isolation and NUL/literal behavior remain tested. Approved
replaceEnv contract/core forwarding is committed in84fc742; the genuinely wrong
nested clearing still requires Sagan runtime integration and actual-shell proof.

References:
- https://raw.githubusercontent.com/coreutils/coreutils/v9.7/src/wc.c
- https://raw.githubusercontent.com/coreutils/coreutils/v9.7/src/realpath.c
- https://pubs.opengroup.org/onlinepubs/9699919799/basedefs/V1_chap08.html

Scope limits: no full wc Unicode word/invalid-sequence/terminal-width parity;
opaque stdin lacks native descriptor-type metadata. No new provider identity,
permission or realpath namespace-security guarantee. A distinct verifier follows.
