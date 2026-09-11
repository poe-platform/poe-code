# Temporal root publication dependency

The merged main workspace builds pass, but `npm run build` fails during its
bundle publication check with:

`temporal-polyfill/full/implementation: undeclared-dependency`

SafeJS already declares `temporal-polyfill@1.0.4`. The root publication contains
an external import of its implementation, so the root package must declare the
same runtime dependency. Add the dependency and update the npm lockfile without
changing the bundle policy. Re-run the bundle stage and repository checks.
