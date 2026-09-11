# Number method metadata and snapshot state

## Evidence

toExponential, toFixed, toPrecision and toString expose prefixed names and zero
length instead of their standard names and length one. Their mutated properties
also fail snapshot restoration. Eight regression tests fail before the change;
toLocaleString provides two already-passing controls.

## Change and verification

Mark all five methods as guest functions, set the native names, and use length
zero for toLocaleString and one for the remaining methods. Keep receiver checks,
numeric coercion, formatting and budgets unchanged.

Run metadata/snapshot regressions, focused Number and boxed-primitive tests,
legacy-checkpoint checks, scoped lint and the maintained SafeJS build. Commit and
push separately, monitoring publication without blocking subsequent work.
