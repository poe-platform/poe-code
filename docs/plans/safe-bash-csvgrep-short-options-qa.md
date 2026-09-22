# csvgrep CLI/SDK and export verification

The existing private `safe-bash-command-csvgrep` workspace owns the command,
SDK and optional plugin. Safe-bash re-exports its API at
`@poe-platform/safe-bash/commands/csvgrep`; default registration is unchanged.
The package-pattern source is now in `archive/safe-bash-command-package-pattern.md`.
Existing work and unrelated edits were preserved.

## Validated repair

A new independent memory-VFS test failed before implementation because grouped
short flags and attached short values were rejected. The parser now walks
flag groups with an offset, without copying each remaining suffix, and admits
attached value storage/work through the invocation budget. Controls cover
`-ai`, `-aicx,y`, `-aim a`, `-cx,y`, `-ma`, `-m-a`, `-tcx`, `-d;`, missing
grouped values, unknown grouped flags and a literal dash-prefixed VFS operand
after `--`. Short-option `=` is part of its attached value. Aggregate output is
compared against equivalent typed SDK options, with deterministic empty stderr.

## Verification

- Command/matcher workspace: 31 tests passed; maintained lint and source/test
  TypeScript checks passed.
- Public Shell boundary: VFS scripts, pipes, redirection and SDK parity passed.
- Private artifact/publication routes: 224 tests passed across
  `package-safe`, `bundle-safe-bash-private`, `safe-command-publication` and
  `verify-safe-publication`. These include isolated public command graph
  execution, branded argv identity and declaration consumption without private
  workspace installation.
- Maintained selected build closure:
  `npm run build:workspaces -- --workspace=@poe-platform/safe-bash` passed,
  including the qualified safe-bash build and optional CLI postbuild.
- Manual built public-subpath QA executed grouped options through Shell and
  checked status 0/output, plus unknown-grouped-option status 2/stderr. The
  terminal screenshot was inspected. Temporary script/image were purged.
  Absolute `/out` is read-only; this evidence temporarily used workspace `out/`.

These checks verify the documented candidate profile, not full csvkit/Python
compatibility. The open CSV, regex grammar, range, codec and cancellation/replay
qualification cells in `safe-bash-csvgrep-acceptance.md` remain open. No native
executable was used by unit tests. No full repository gate, commit, push, remote
main delivery, release or private command publication is claimed for this turn.
