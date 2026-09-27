# Publication child execution native QA

Execute these controls through `runCommand` exported by
`scripts/verify-safe-publication.mjs` on the normal Node stack. No package
publication, network request, repository mutation or LLM call is involved. The
unit suite mocks the child execution port and verifies exact error identity,
caller timeout preservation, the one-MiB output cap and SIGKILL termination.

1. Run `/bin/sh -c 'exit 7'` with `timeout: 1000`. Require rejection with code 7.
2. Run `/bin/sh -c 'while :; do :; done'` with `timeout: 50`. Require rejection
   with signal SIGKILL and settlement after terminating the owned process.
3. Run `/bin/sh -c "printf '%2000000s' x"` with `timeout: 1000`. Require rejection
   with code ERR_CHILD_PROCESS_STDIO_MAXBUFFER.

A startup timeout in steps 1 or 3 fails the check. Never increase the deadlines
or terminate unrelated processes. These checks distinguish native scheduling
from the wrapper's exact error and resource-bound contract.
