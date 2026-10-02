# caller

Inspect the calling function or sourced script in Safe Bash. `caller` prints the
call site's line and filename; `caller 0` also prints the calling subroutine.
Higher indices select outer frames. Missing frames return status 1.

Safe Bash supplies the active stack automatically. Hosts can also register
`callerCommands({ frames })`, or use `createCallerCommand` / `createCallerCommands`,
with explicit frames and argument/output byte limits.
