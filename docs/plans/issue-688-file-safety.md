# Compression file-safety follow-up

## Validated failures

The September 10, 2026 remote implementation at
`52a76cc880cbcc6088ccd5dc65b70e0a86c24b90` failed nine concrete VFS controls:
cleanup could recursively remove foreign entries, non-atomic copying could
expose a partial destination, and named-file work lacked registered ownership
before acquisition. Additional actual Shell tests establish held planning,
source, write and cleanup settlement requirements.

The first correction passed 51 independent controls but failed two subsequent
snapshot-rmdir controls. A snapshot marker's successful removal was incorrectly
treated as strong directory cleanup. Keep that failed candidate and its passing
subset as predecessor evidence, not current qualification.

## Implementation

Track planning and named-file operations with synchronous registration and
closed admission. Drain admitted cooperative operations and retire acquired
sources even when acquisition closes the command. Preserve caller reasons and
propagate the existing CPU checkpoint through the new child signal.

Publish staged files with positive atomic rename capabilities, including
no-replace publication for missing destinations. Retain cleanup authority,
validate scoped identities, and use only nonrecursive directory removal. Query
the actual candidate staging path before acquisition and refuse its explicitly
weaker snapshot-only rmdir profile. Unknown identities fail closed and may leave
a staging artifact; neither identity checks nor capabilities create a namespace
lease or stronger provider guarantees.

## Evidence and delivery

The superseding ten-file patch at
`/tmp/issue688-remote-safety-v2-Te3r4X/safety.apply-v2.patch` has SHA256
`0b00c3046b766dd85de6244d631836a55c2564f2f0a8868822da6d2517dab269`.
Authenticated scratch replay passes 52 cases and strict NodeNext types.
Independent review passes 56 cases, including the unchanged two snapshot
regressions and seven actual Shell barrier cases; its types also pass.

The 131-case captured native comparison remains unchanged: 48 matching cases
and 83 mismatching cases, not 83 independently classified bugs. This safety fix
does not repair or conceal those separate native-policy differences. Existing
publication-race test hooks move from copy to rename to exercise the actual API;
the original fixtures and failures remain preserved.

Root admits exact payload hashes, registers all six new maintained test paths,
and runs focused and final merged gates before delivery. The earlier preliminary
merged full test was interrupted before these changes and is not a passing gate.
No push or successful publication is implied by source-only checks.

The first live complete compression/discovery check records 346 passing cases
and eight cancelled cases, exit 1 (`/tmp/issue688-safety-live-v2.log`). The first
cancelled case is the existing named-file source-cancellation test: it deliberately
settles an opaque late `next()` rejection only after command cancellation, while
its cooperative iterator return completes immediately. Tracking that raw next
promise indefinitely causes a hang. Seven subsequent tests are cancelled by the
runner, not seven independently reproduced defects. The safety candidate remains
uncommitted pending a correction and a repeat of the entire focused suite.

The opaque-next follow-up removes only raw iterator-next promises from the file
operation's unconditional pending ledger. Cooperative iterator return, admitted
filesystem calls, writers, and retained cleanup still drain. Late errors remain
observed and late results are not inspected after closure. The unchanged full
streaming suite passes 19/19; two new regressions fail before and pass after.

An independently checked fixture conflict required a narrow prospective root
approval: the new held-acquisition fixture delayed raw next before starting its
underlying generator, while return completed immediately. That was opaque work,
not a cooperative retirement barrier. Only its return now awaits the same release;
all existing assertions and other five cases remain unchanged. Preserve the old
56-case freeze and subsequent 5-pass/1-fail fixture evidence rather than relabeling
them as unchanged qualification. No original streaming test is modified.

Authenticated additive patch
`/tmp/issue688-opaque-next-v3-9rm0tn/opaque-next.apply-v3.patch`, SHA256
`d311aba1fdb8c640b537e0a7e6bbc129819915be7accf547e45ecf5227820fe7`,
passes 73 owner/replay cases and strict types. Root verifies all four target
preconditions before applying it and registers the new regression explicitly.
Independent final review passes 77/77 cases and strict types; root's repeated
complete compression and discovery check passes 356/356 with no cancellations
(`/tmp/issue688-safety-live-v3.log`). All four additive payload hashes match
authenticated replay. These focused checks do not replace final merged gates.

Final merged lint identifies one `prefer-const` finding in the source-retirement
holder. Its initially empty state is now explicit (`= undefined`) before the
later iterator assignment. Moving initialization to a later `const` declaration
would instead create a temporal-dead-zone risk if acquisition throws before
retirement. The correction preserves the existing runtime state and cleanup
checks. The concurrent full test is interrupted before this source adjustment;
it is not counted as a completed final gate.
