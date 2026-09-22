# behavior-csvsort prerequisite verification

Status: open; behavior implementation and every product acceptance cell remain
unverified.

Inspected local main `35d01c57f8078d8afa916dc59929395d857e9c55` on
2026-09-20, including the current working tree. Searches of package source paths,
root and safe-bash manifests, and the maintained bundler found no csvsort
command workspace, public subpath, shared CSV parser/selector workspace or
admitted CSV inference engine. This confirms the missing implementation; it is
not a reproduced sorting defect.

The command plan, `safe-bash-csvsort.md`, states:

> Prerequisites: Depends on shared CSV parser and selector contract.

> Execution: tasks are ordered; prerequisite plans must pass their stated
> acceptance gates before dependent integration.

Its engine task is marked done in the working-tree plan, but
`safe-bash-csvsort-engine-prerequisites.md` explicitly reports that the engine
is not implemented and is blocked on shared parsing and selection. No executable
implementation or acceptance evidence was found to substantiate that status.
Existing task statuses were preserved; they do not establish readiness.

The requested package-pattern path is absent because of an unrelated move.
Its available `archive/safe-bash-command-package-pattern.md` requires shared
parsing in narrowly scoped private engine packages and prerequisite acceptance.
`packages/safe-bash/integration-boundaries.json` holds XAN's CSV, selector,
sort and writer sources. None of those held sources was read, extracted,
imported or admitted during this task.

Required next work is acceptance of an original shared byte-stream CSV parser,
selector and serialization contract, then the whole-column typed inference
engine. The parser must retain the distinction between QUOTE_NONNUMERIC float
cells and default Decimal input. Contracts must include explicit cancellation,
cleanup, owned fragments, structured failures and input/decoded/retained/output
byte and work accounting. Temporal, Decimal-context and Unicode profiles must
be explicit rather than delegated to ambient runtime behavior.

After these gates pass, begin behavior TDD with independent composite-key and
reverse-tie fixtures from `safe-bash-csvsort-acceptance.md`, then quota boundaries,
chunk ownership, cancellation and serialization. Keep unsupported cells open.
Implementation belongs in private `safe-bash-command-csvsort`; safe-bash owns
composition and the bundled `commands/csvsort` export. Installed runtime and
declaration consumers must prove no unpublished package is needed.

This verification added only this evidence document. No code, placeholder
test, export, manifest, admission policy or existing plan status was changed.
No runtime tests, native controls, screenshots, artifact checks, commits,
pushes or releases were executed. Unrelated edits were preserved.
