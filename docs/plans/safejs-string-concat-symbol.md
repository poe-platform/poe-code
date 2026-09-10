# Primitive Symbol arguments to concat

## Validation

The unchanged primitive-only path failed four of eight regressions (01f997).
Explicit String(Symbol) produced text, whereas the implicit ToString required
by concat must throw TypeError. Mixed guest-object/Symbol cases already passed
through the guest conversion implementation, including conversion ordering and
stopping before subsequent arguments. A direct-call regression checks that
primitive Symbol rejection remains synchronous.

## Repair

Removed args.map(String) from the primitive-only native concat call. Native
concat now performs its own implicit conversion; the guest-object path remains
unchanged. Output allocation stays budgeted. No Unicode or snapshot format
change, CLI visual change, push or release.

The regressions and existing concat/string/coercion/retention selection passed
79 tests in five files (e6fb05). Targeted ESLint and the maintained package
TypeScript configuration passed (beeeb1).

The preceding full-package result predates this repair; its 14 remaining
ISO/Temporal and Promise admission failures remain unresolved.
