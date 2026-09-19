# csvstack user edge QA

Run the literal executable through the safe-bash Shell and csvkit plugin with
injected UTF-8 codecs, C/UTC locale, fixed clock and noninteractive terminal.
The canonical cases use MemoryFileSystem and cooperative stdin generators;
they create no host files and run no native utilities, network or databases.

1. Run `node --import tsx --test packages/safe-bash/tests/commands/csvstack-user-edge.test.ts`.
2. Compare exact stdout, stderr and status for all thirteen cases. Verify each
   borrowed stdin generator is returned once and the virtual root stays empty.
3. Distinguish a blank no-header first record from a quoted empty cell. The
   blank cached record is omitted; the quoted empty cell is emitted without a
   grouping cell and consumes a line number. Later positional rows retain their
   widths even when the inferred first-file width is zero.
4. Verify empty explicit groups remain empty, empty group names use `group`,
   and an empty input still emits the requested grouping header. A blank
   dictionary header must not become the next data row's header; later extra
   fields fail after the grouping header is already emitted.
5. Verify repeated stdin distinguishes completed EOF from a terminated header.
   Empty input and an unterminated one-cell header permit the second preflight
   reconfigure and fail only when the second output pass reaches closed stdin.
   A terminated blank header forbids the second preflight reconfigure before
   any output. Repeated no-header stdin preserves preceding grouped output.
6. Verify negative `-K` is a no-op, `-S` affects both header and cells without
   inferring types, and `-t` overrides a conflicting `-d`.
7. Root integration owner registers the literal canonical file in maintained
   discovery, then runs the selected maintained build/test/lint routes and
   inspects actual visual CLI output with an ad hoc screenshot.

Thirteen independent development observations were compared against the cached
CPython 3.14.2, csvkit 2.2.0, Agate 1.14.2 reference with locale C and timezone
UTC. Source review used the cached PyPI source associated with the required
archive SHA-256 `147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`.
Those observations are literal inputs and expected bytes in the canonical test,
which does not invoke that reference. All thirteen cases passed the existing
engine; no product change or bug fix was warranted by this independent review.

This focused matrix does not establish exhaustive edge coverage. Numeric and
nullable reader quoting modes 2/4/5 and exhaustive verbose traceback matching
remain explicit blockers. Deployed VFS providers, other codecs/compression,
opaque uncooperative host work and full csvkit compatibility remain unmeasured
by this matrix. No Git or release action was performed.
