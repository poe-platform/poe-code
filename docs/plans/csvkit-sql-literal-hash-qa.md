# SQL literal hash diagnostics continuation

Preserve the existing csvkit implementation and unrelated worktree changes.
No README, staging, commits, pushes or publication are authorized.

1. Authenticate the available CPython 3.14.2 reference's csvkit 2.2.0,
   Agate 1.14.2 and SQLAlchemy 2.0.54 versions. Capture original `parse_list`
   observations for direct/nested unhashable list/dict/set/tuple keys and
   elements, syntax precedence and conversion-order behavior in docs/csvkit.
2. Add original failing in-memory regressions for those observations. Test the
   actual parser independently of injected transport contracts; exercise both
   argv and SDK SQL routes with explicit fake driver effects.
3. Separate literal parsing from ordered conversion where reproduced cases
   require it. Preserve budgets, cancellation and nonexecuting expression
   fallback. Retain unmeasured syntax/verbose/service profiles as blockers.
4. Have the independently assigned agent stress/fix safe-bash bindings. Root
   owns integration, public exports and Git; neither worker stages changes.
5. Run maintained uncached domain tests/lint and selected workspace build
   closure, affected safe-bash tests/types and appropriate integration gates.
   Inspect rendered CLI output when output changes. Reduce temporary evidence
   from out into qualification records and purge only this continuation's files.

These focused checks are not full csvkit or repository/release qualification.
