# Foreign-realm native Promise import

## Validated gap

Two tests using `node:vm` native promises reproduced rejection of both fulfilled
and rejected foreign-realm promises at the data import boundary (e9da67).
The implementation used `instanceof Promise`, which checks the local realm's
prototype chain rather than the native Promise brand.

Use the already imported `nodeTypes.isPromise` directly and remove the obsolete
one-line wrapper. Preserve the existing settlement-copy and alias handling.
This does not admit own properties: host-private async-context state must remain
outside the sandbox. It also does not admit forged Promise prototype objects.

## Checks and scope

The regression suite covers fulfillment, rejection, aliases, an unrelated own
getter plus host-context symbol remaining hidden, and a foreign prototype
forgery. Check it with existing Promise own-property/prototype-graph and value
copy tests, minimum Node 18, focused ESLint and package typecheck.

Node 22: four selected files passed all 51 tests (e49258). Node 18.18.2:
all four regression cases passed (301115). Package TypeScript no-emit checking
passed; values.ts lint and the final expanded regression-file lint both passed.

This is separate from the still-failing native Promise own-property policy
tests. Their admission-policy question and the full integration gate remain
open. No CLI appearance changes. Stage only the two Promise-specific values.ts
hunks: the substantial unrelated Temporal/weak integration in that file must
not be included in this atomic repair. Preserve unrelated staged changes.
Local commit only under the release hold; no push, release or issue closure.
