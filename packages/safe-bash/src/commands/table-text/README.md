# Table-text author delivery

The existing core already registers `cut`. This new family implements only
`paste`, `comm`, and `join`; root exports, `virtual-bash/commands/table-text` and
the default aggregate now include the family. `tableTextCommands(options?)` installs it;
`createTableTextCommands(options?)` returns definitions. Options are
`{ replace?, limits? }`; limits are declared in `internal.ts`.

The user previously paused this batch for copy/move compatibility, then resumed
it after the comparison-contract handoff. Backend positive38/guard closure and a
different agent's table-text review remain separate gates. No broad parity or
completion claim is made.

Implemented: paste parallel/serial, delimiter lists/escapes, repeated stdin and
NUL records; comm column suppression, totals, output delimiters, order checking
and NUL records; join configurable fields, duplicate-key Cartesian products,
outer/unpaired output, output field lists/auto, headers, ASCII case folding,
single-byte/NUL/whole-record delimiters and order checking. Unknown flags,
including help/version and legacy join syntax, are rejected, not silently
implemented. comm/join require C/POSIX ordering; non-C locale requests fail
explicitly. Data is bytes, not decoded or locale-folded Unicode.

Byte-source reads and output writes are awaited; stdin has one shared record
cursor. comm finalizes each operand in order before emitting totals. A repeated
operand referring to an already closed reader reports `Bad file descriptor`,
matching the pinned GNU 9.7 shared-stdin profile; it does not refuse to read the
input. Physical iterator cleanup remains idempotent, so the host source is not
closed twice. paste retains its successful shared-cursor behavior. VFS inputs
receive linked cancellation, cancelled on downstream failure
or command exit. No native process, host filesystem or runtime dependency is
used. Limits bound input/output, individual producer chunks/records, file count,
join duplicate groups/fields and steps. A producer chunk exceeding maxChunkBytes
is rejected, even if it contains short records; tune the explicit limit or chunk
upstream. readFile fallback receives maxBytes. Already emitted stdout is not
rolled back on errors. Arbitrary noncooperative host promises cannot be stopped.

Default limits (each command invocation owns its budget):

| Option | Default |
| --- | ---: |
| maxInputBytes / maxOutputBytes | 256 MiB each |
| maxRecordBytes / maxChunkBytes | 1 MiB each |
| maxGroupBytes / maxGroupRecords | 8 MiB / 100,000 |
| maxFields / maxFiles | 65,536 / 64 |
| maxSteps / maxArgumentBytes | 2,000,000 / 65,536 |

Every override must be a positive safe integer. A limit failure is explicit and
does not reset the invocation budget. Native differential checks assert exact
stdout bytes, exit status and unchanged input bytes; ordinary diagnostics are
checked for presence, not byte-for-byte GNU wording. The preserved duplicate
stdin close disagreement checks the native EBADF diagnostic separately.

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
Resume validation again passed257/257. Three new author probes then reproduced
Buffer fragment corruption across producer reuse in paste, comm and join.
Commit32513a4 fixes shared record ownership with an actual Uint8Array copy;
`tests/commands/table-text/buffer-ownership-regression.json` preserves all three
failing byte observations and unchanged expectations. The resumed author suite
passes260/260 with the pinned live oracle available. This still means215/216
native matches plus the explicitly characterized disagreement, not216 matches.
Different-agent independent stress/fix review remains pending.
Run author tests with `GNU_TABLE_BIN=/path/to/coreutils-9.7/src node
--unhandled-rejections=strict --import tsx --test
'tests/commands/table-text/*.test.ts'`. Without that optional native path, only
the live oracle recheck is explicitly skipped; frozen product observations run.

## Bounded shared-stdin correction

The historical 215/216 author observations above remain unchanged. The separate
`tests/commands/table-text-stress/shared-stdin-fix/` acceptance driver now matches
all 216 original inputs and native expectations, including shared stdin's status
1 and diagnostic. The original author test intentionally asserting status 0 is
preserved and now fails: unchanged current-helper311 is 310 pass/1 expectation
conflict; the separately identified same-input acceptance311 passes 311/311.
Focused cancellation/ownership/lifecycle checks pass 17/17. Exact native pins,
initial red bytes, final observations, launcher controls and limits are in that
subtree. These are author-fix results awaiting a different verifier, not an
upgrade of the earlier independent 104/311 or full GNU compatibility evidence.
