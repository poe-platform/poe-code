# Table-text author checkpoint (paused)

The existing core already registers `cut`. This new family implements only
`paste`, `comm`, and `join`; it is not yet wired into root exports or the default
aggregate. `tableTextCommands(options?)` installs the family;
`createTableTextCommands(options?)` returns definitions. Options are
`{ replace?, limits? }`; limits are declared in `internal.ts`.

The user reprioritized copy/move compatibility before root integration or an
independent table-text review. No broad parity/completion claim is made.

Implemented: paste parallel/serial, delimiter lists/escapes, repeated stdin and
NUL records; comm column suppression, totals, output delimiters, order checking
and NUL records; join configurable fields, duplicate-key Cartesian products,
outer/unpaired output, output field lists/auto, headers, ASCII case folding,
single-byte/NUL/whole-record delimiters and order checking. Unknown flags,
including help/version and legacy join syntax, are rejected, not silently
implemented. comm/join require C/POSIX ordering; non-C locale requests fail
explicitly. Data is bytes, not decoded or locale-folded Unicode.

Byte-source reads and output writes are awaited; stdin has one shared record
cursor. VFS inputs receive linked cancellation, cancelled on downstream failure
or command exit. No native process, host filesystem or runtime dependency is
used. Limits bound input/output, individual producer chunks/records, file count,
join duplicate groups/fields and steps. A producer chunk exceeding maxChunkBytes
is rejected, even if it contains short records; tune the explicit limit or chunk
upstream. readFile fallback receives maxBytes. Already emitted stdout is not
rolled back on errors. Arbitrary noncooperative host promises cannot be stopped.

GNU reference is pinned **coreutils 9.7, LC_ALL=C**, not a newest-version claim.
Official archive `https://ftp.gnu.org/gnu/coreutils/coreutils-9.7.tar.xz` SHA-256:
`e8bb26ad0293f9b5a1fc43fb42ba970e312c66ce92c1b0b16713d7500db251bf`.
Primary manual `doc/coreutils.texi` SHA-256:
`39b126752866fff675e462bd44d76f3e034abafe462a069cebd53ef39fc53eca`.
Consult nodes `paste invocation`, `comm invocation`, `join invocation`, and
`General options in join`, with matching native source for order checking.
Existing isolated GNU binaries were reused; nothing was installed.

Author result before pause: **257 tests pass**, zero skip/TODO/cancel, including
**215/216 native observations matching**, one explicitly preserved disagreement,
a live recheck of the entire frozen native corpus, and 40 contract/integration
checks. The disagreement is GNU 9.7 Darwin `comm - -`: exact same output rows,
but native exits 1 with EBADF when its source closes stdin twice; the virtual
shared cursor closes once and exits 0. That characterization is not a parity
pass. Original first run was 203/204 (including native recheck), one failure;
expanded option probes exposed three real parsing divergences, fixed without
changing native expectations. Frozen observations remain in
`tests/commands/table-text/gnu-evidence.json`.

After that run a test-only invalid ShellExecOptions.timeoutMs property was
corrected to `signal: AbortSignal.timeout(2000)`; scoped strict types pass.
Different-agent independent stress/fix review and root integration are pending.
Run author tests with `GNU_TABLE_BIN=/path/to/coreutils-9.7/src node
--unhandled-rejections=strict --import tsx --test
'tests/commands/table-text/*.test.ts'`. Without that optional native path, only
the live oracle recheck is explicitly skipped; frozen product observations run.
