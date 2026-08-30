# Replacement-verifier procedural cleanup

The initial verifier added a scoped `AGENTS.md` in commit
`a0445f4d5cff1c8451957ce684273e1225279588`. That write exceeded the user's
explicit ownership restriction, which permits only tests and evidence in this
directory and prohibits AGENTS writes. The coordinator interrupted that verifier
and explicitly authorized the replacement verifier to delete only that newly
created scoped file.

This cleanup deletes
`tests/commands/tree-charset-independent-20260827/AGENTS.md` without amending or
rewriting the prior commit. No other AGENTS file was changed. At takeover, process
lookup for the reported wrapper PID 56656 and child PID 56667 returned no live
processes. The repository index was empty before the cleanup was staged; unrelated
working-tree changes were left untouched.
