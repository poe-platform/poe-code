# Staged supervisor controls only

This leaf owns only this new directory. The parent coordinates subsequent work.
No product imports, regex evaluation, native utility probes, user-data reads,
network access, dynamic source, or new dependencies belong to this stage.
The scripts load only their checked-in modules and Node builtins; they do not
perform application filesystem reads or writes. Node's own startup/module
loading is not an OS filesystem sandbox. Inspection/Git/evidence collection
are separate from these control executions.

Commit these scripts before executing them. Run exactly one allowlisted control
per invocation, and wait for its reported close/cleanup before starting another:

```sh
node --unhandled-rejections=strict --max-old-space-size=32 --max-semi-space-size=1 --stack-size=256 tests/stress/regex-execution/staged-controls/run.mjs benign
node --unhandled-rejections=strict --max-old-space-size=32 --max-semi-space-size=1 --stack-size=256 tests/stress/regex-execution/staged-controls/run.mjs waiting
```

`NODE_OPTIONS` must be unset or empty. The reusable parent function accepts only
`benign` or `waiting`, not executable paths, shell commands, source, or data.
It refuses overlapping owned children. It spawns the current Node executable
directly with `shell:false`, `detached:false`, closed stdin, clean fixed child
environment, strict unhandled rejections, and fixed child filenames/flags.
The waiting control only leaves its IPC message listener connected after its
`started` acknowledgment; it does not busy-loop, allocate continuously, or
exercise product cancellation. The benign control prints exactly ten bytes.

The 1,000 ms startup watchdog begins separately from the 200 ms execution
watchdog. The parent receives `ready`, arms the execution watchdog, then sends
the sole `start` message. The watchdog remains armed until `close`, including
after a completion acknowledgment. On failure/deadline/parent interruption,
only the exact owned child's `kill('SIGKILL')` handle is used. No PID lookup,
process-group kill, descendants, or arbitrary targets exist. Success requires
`exit`, IPC disconnect, both output streams closed, and child `close`; a kill
request alone is not cleanup evidence. A 1,000 ms cleanup warning fails the
result and retains the owned handle while still awaiting close; it does not
assert that an OS must reap a process within a guaranteed duration.

Output retention is capped at 1,024 bytes per stream; overflow terminates the
child. Child IPC is at most two messages, each an exact phase-appropriate
allowlisted string of at most 16 UTF-8 bytes, and parent IPC is one fixed string.
The protocol is checked after Node deserialization. These caps are not hard
kernel-buffer/IPC-allocation bounds against replacement hostile scripts.
Only the reviewed static controls are permitted. Overflow, malformed IPC,
startup failure, spawn failure, interrupt and overdue cleanup branches are
implemented guards, not dynamically verified by these two controls.

The child V8 old-space limit is 16 MiB, semi-space 1 MiB, stack 256 KiB; parent
old-space is 32 MiB with the same semi-space/stack flags. These are heap/stack
settings, not total RSS or external/native-memory caps. Peak RSS is unmeasured.
Timer scheduling and OS termination are not real-time guarantees. The waiting
control passes only when the measured parent callback occurs 150–250 ms after
start, requests SIGKILL successfully, and subsequently observes SIGKILL/close.
One success is not a latency distribution or proof of CPU-bound isolation.

Historical static audit `0d625f3` remains immutable: zero dynamic executions,
zero verified dynamic probes, zero proven violations. The prior broader task
was refused twice by a service with this exact output (not an OS error or proof):

> ERROR: This content was flagged for possible cybersecurity risk. If this seems wrong, try rephrasing your request. To get authorized for security work, join the Trusted Access for Cyber program: https://chatgpt.com/cyber

This explicitly narrowed controls-only stage does not retry the broad task.
If any further execution is denied, stop and preserve the exact tool output;
do not disguise, escalate, or retry the denied action. Reports and full captured
outputs are added only after the script commit, using a separate owned commit.
