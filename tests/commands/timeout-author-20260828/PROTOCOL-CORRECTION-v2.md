# Reconstruction protocol correction v2

The presealed first protocol materialized no dependency tree, then invoked the
repository compiler without telling it where to resolve the permitted Node
development declarations. Its build stopped with `TS2688` before product code
was checked. `evidence-v1` preserves that exact failed attempt.

Version 2 passes the repository's existing `node_modules/@types` directory as
an explicit compiler `typeRoots` input for the isolated build and typecheck. It
does not copy dependencies into the reconstruction, archive, package, or
consumer. The capture also records the Node declaration package and a sorted
per-file manifest hash. Candidate source bytes and test expectations are
unchanged.
