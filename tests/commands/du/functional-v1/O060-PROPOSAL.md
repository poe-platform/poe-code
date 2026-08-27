# O060: proposal only; no implementation approval

The preserved case is the same unchanged Memory namespace with `tree tree`, not
two different mount views. Current DU's extra zero directory rows are a real GNU
compatibility gap. The functional environment patch does not change that policy.

## Narrow candidate policy

1. Consider only repeated explicit directory operands within one invocation, with
   `--count-links` disabled. Key by the same command namespace binding and the
   exact resolved normalized operand, including trailing-directory/follow syntax.
   Different aliases, mount paths or views are not equivalent keys.
2. Require complete trustworthy root `identityScope/dev/ino` at both encounters,
   compared by reference and safe integer equality. Unknown identity disables
   the optimization. Equal backing identity is necessary, never sufficient.
3. Require a complete successful first traversal. Do not globally prune any
   directory by inode. Always perform the later traversal, preserving metadata
   authorization, cancellation, budgets and newly discovered errors.
4. A reporting-only suppression decision would require bounded comparison of
   complete pre-dedup observations: relative paths, types, trusted identities,
   selected accounting values and directory child lists. Any changed/unknown
   observation or failure must keep the normal reporting/error behavior. Error
   diagnostics must never be suppressed as a duplicate.
5. Charge comparison state to entry/metadata/work budgets; any delayed output
   must be bounded by the output budget. Do not add an unbounded cache or silently
   discard results on exhaustion. First and later subtree accounting must remain
   correct for `-c`, overlapping operands and intervening operands.

## Unresolved trust and concurrency

A `context.fs` reference plus a normalized path does not prove a stable command
namespace. A mount table can change while retaining the same wrapper object;
overlay visibility can change without changing the root backing inode. Root
timestamps are neither complete descendant revision markers nor topology leases.
Revalidation can observe equal metadata despite intervening changes, inode reuse,
or mutations after a directory listing. Comparing finite observations is not an
atomic subtree snapshot and cannot prove that an unobserved error/change did not
occur.

Therefore the current FS contract is insufficient to promise safe suppression
under arbitrary concurrent namespace/tree changes. A strict implementation would
need an explicitly trusted stable-snapshot/revision/namespace guarantee, or root
approval of a clearly weaker observation-only reporting policy. No such public
API/provider guarantee is invented or added here. Until resolved, keep current
conservative reporting. This proposal is not permission for path-only shortcuts,
global directory-inode deduplication, or skipping a second traversal.
