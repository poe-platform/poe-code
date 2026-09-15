# Packing VFS preflight correction

Scope: validated-docx-packing only. Later tasks and the pipeline's packing
completion statuses remain open. Preserve the prior resumption record and all
preexisting implementation, research and QA files.

## Validated defect and correction

The existing packing loop admitted and read each payload before checking the next
file's kind. Two original memfs integration regressions for a later symlink and
FIFO failed: three payload reads occurred before rejection, instead of zero.
The working-tree packing integration now invokes a complete VFS preflight before
reading any payload. It retains immediate per-read checks as well. No payload
scan, ambient host access, networking or XML whitespace cleanup is introduced.

The independently committable packages/docx/src/packing-vfs-admission.ts module
accepts already-admitted absolute VFS paths and exact lengths, with explicit
filesystem, budget and cancellation capabilities. It checks every declared
regular file and canonical directory ancestor without acquiring file bytes.
It preserves filesystem errors and maps cancellation to the existing neutral
cancellation category. The packing boundary retains its existing source-error
mapping. Seven original memfs tests exercise complete admission, later symlinks,
symlink ancestors, unsupported kinds, stale lengths/missing files and abort
before/during the final check.
They failed to load before the new module existed and then passed. A final-check
cancellation regression separately failed with a resolved promise before adding
the post-I/O signal check. No downloaded or disk-mutating unit fixture is used.

The original packing integration regressions and integration call remain in the
preexisting, untracked pack.test.ts and pack.ts. They are not staged: the scoped
instruction forbids committing existing user changes. The owned standalone module
has no runtime dependency on those uncommitted packing files.

## Verification

The selected maintained workspace build passed before this correction.
Maintained npm test --workspace=docx passed 155 files and 3,135 tests, including
the two integration regressions, but discovery preceded the standalone test file.
Supplemental actual Shell registration coverage passed 16/16 cases. The final
focused packing and standalone tests pass 35/35 cases after module isolation;
the negative-index regression additionally passed 3/3 in the earlier focused run.
The existing help screenshot was inspected: inventory/options are legible without
clipping. This correction changes admission, not CLI layout.

Final npm run build:workspaces -- --workspace=docx passed its selected dependency
closure. Final npm run lint --workspace=docx passed ESLint and both source/test
type checks with one existing type-only unused-variable warning.
No repository-wide or whole virtual-bash test pass is claimed.

## Ownership and delivery

Only the new module, its standalone tests and this plan are owned for commit.
The previous resumption record documents the preexisting implementation ownership
blocker. The full task cannot meet its verified atomic-commit gate while those
prerequisites remain uncommitted; no complete packing delivery is claimed.
The historical API inventory, neutral method spellings, public underscore-prefixed
owners and language/security dispositions remain unchanged. This utility
preflight does not implement or promote live model APIs.

No push, release, README edit, ignored QA commit, hook bypass or co-author.
