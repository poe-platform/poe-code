# Restore readable virtual device inputs for pr

While reviewing tsort, root reproduced a related pr defect against native GNU
8.30. `pr -t /dev/null` exits zero with empty output natively but the virtual
command exits one with `Operation not supported`. The reader rejects a character
device's stat before using the already-provided bounded VFS read API. The same
gap exists in the in-progress tsort reader. Preserve the native and actual-Shell
receipt in `out/issue681/null-input-red-v1.json`.

Issue #680 is reopened until this follow-up is verified on remote main. Add
memory-only regressions for the virtual null device, its symlink and merged pr
input with null/stdin; qualify the corresponding native bytes/statuses. Exercise
nonempty readable virtual character input and retain byte/work/cancellation
bounds. Allow legitimate VFS-readable device types, not a special-case path
bypass, host process, implicit host filesystem or fabricated provider guarantee.

The pr patch is limited to its reader, focused device tests and relevant command
documentation, with a separate atomic commit. Preserve pr's directory errors,
the independently pinned tsort directory behavior, and all stream ownership and
cleanup contracts. Add public packed canaries with explicit per-command status
checks so later successful commands cannot mask a failure. Run independent
review and maintained scoped/broad gates before pushing and closing #680 again.

## Focused validation

The new device suite first records 17 failures and one passing directory control
in `/tmp/issue680-pr-device-red-v1.log`. The bounded character-type admission
then passes all 134 author cases in
`/tmp/issue680-pr-device-combined-v1.log`. Independent review passes its unchanged
123 cases plus the 18 device regressions in
`/tmp/issue680-pr-device-independent-retest-v1.log`; its focused typecheck also
passes. Five captured native null/symlink/merge cases match stdout, stderr and
status. Broader integration and fresh packed checks remain separate requirements.
