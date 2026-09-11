# Shared callback receiver validation

The shared callback envelope is the argument graph replay actually invokes.
The ordinary argument record already rejects `undefined` receivers when
`hasReceiver` is true, but the shared envelope only checked argument count.
An envelope containing `[undefined]` could therefore bypass that invariant.

Baseline 80461 reproduced acceptance of the contradictory receiver. Four other
malformed controls (arity, ordinary backing storage, duplicate blocks, missing
order) and a valid receiver control already passed. The validator now applies
the receiver invariant to the shared envelope as well. This is a schema repair,
not a claim that snapshot data is authenticated or immutable.

Verification: 44 focused tests pass in four files (80026), package TypeScript
passes (71522), and scoped ESLint passes (30882). No full-suite or release claim.
