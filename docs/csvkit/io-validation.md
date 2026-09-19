# Injected csvkit I/O validation

This change implements the domain I/O layer and updates the existing shared
CLI/SDK engine and explicit safe-bash plugin. It does not complete the remaining
csvkit command, inference, format or driver compatibility gaps in
implementation-status.md.

`src/io` owns delayed text opening, the shared stdin cursor, physical-line versus
bulk-read behavior, virtual path resolution and text ownership. UTF-8 decoding
streams across byte boundaries. Named rt inputs translate CR/LF universally and
strip NUL only during iteration; POSIX stdin retains CR/NUL and iterates on LF.
CSV streaming preserves quoted input newlines before Agate-style output
normalization and rejects embedded unquoted newline content within one physical
stdin line. Skip-lines runs before parsing using the source's physical iteration.

csvstack uses its original header pass, closes named readers and reopens them
for output. Shared stdin follows the measured reconfiguration and closed-stream
errors, including empty-EOF differences and the original headerless first-row
grouping quirk. Completed output survives later failures. Injected filesystem
streams are forwarded by safe-bash; POSIX paths receive no wildcard, home,
environment or URI expansion. Filesystem authority remains the host's explicitly
bound VFS, with no native process or implicit network access.

Regression tests reproduced the defects before fixes. An independent agent
stressed and fixed closed reads, LF-only stdin iteration and decoder state after
EOF, and identified the early-return raw-producer cleanup defect fixed by root.
Canonical tests use in-memory files/byte streams; native research is kept separate.
`io-reference.json` freezes 19 exact command cases plus LazyFile, stdin and
reconfiguration measurements against the authenticated 2.2.0 source archive,
CPython 3.14.2 executable and hash-locked Agate/SQLAlchemy dependency profile.
Temporary native reference files were purged after reduction.

Validated routes:

- csvkit workspace unit tests: 345 tests; workspace lint passes (production/test
  TypeScript included). 38 tests specifically exercise primary/independent I/O.
- Maintained uncached safe-bash build dependency closure: 10 workspace builds.
- Actual safe-bash csvkit invocation suites: 70 tests, including all 19 frozen
  I/O command cases and unchanged in-memory input-file contents.
- Maintained discovery assertion confirms both integration test paths remain
  active; an earlier filter matching zero tests was not credited as validation.
- Maintained safe-bash source/test and 26 consumer-group typecheck route.
- Repository guarded `npm run lint:eslint`: completed, exit 0, 15,808 configured
  inputs linted, zero errors, two warnings outside this change. The warnings are
  unused type-only `operation` in packages/docx/src/operation-types.test.ts and
  unused `w` in packages/safe-bash/tests/commands/docx/table-model.test.ts.
- Ad hoc screenshot of actual built shell csvcut/csvstack output, inspected for
  ordering, grouping quirk and error/status rendering; temporary image purged
  after inspection. No screenshot test was added.

Explicit blockers: native late-I/O/SIGPIPE/buffering timing and PTY transport,
Windows expansion/newline profile, non-streaming injected codec timing, workbook
multi-pass/side files, compression-provider internals and database-driver effects.
Cancellation preserves completed effects and awaits enrolled cooperative cleanup;
it cannot forcibly stop opaque host work. Full repository test coverage and full
csvkit compatibility are not claimed. No README, staging, commit, push or release
changes are authorized or performed.
