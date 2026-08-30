# Additive stored-commit authentication detail, before any execution

The five stored-commit roles in6e2588b0 are strengthened, not increased:
use `git cat-file commit FULL_ID` instead of merely `git cat-file -t FULL_ID`.
Verify the actual body against canonical `commit SIZE\0` SHA1 and extract its
tree header. This authenticates object kind/body/identity as well as existence;
it prevents a type-only lookup from being mistaken for byte authentication.
The base commit header must name the frozen48e5 tree. The separate stored-base
rev-parse/tree check remains, so282 metadata/283 future Git counts do not change.

C10 therefore returns a tag-shaped raw object instead of a valid commit body;
the bound commit hash/type reconstruction must reject it. All other frozen
inputs/refusal/effect conditions remain unchanged. Raw commit metadata is DATA,
not an AGENTS blob; no instruction-file content is fetched. This additive detail
precedes all executable sealing and metadata/synthetic execution.
