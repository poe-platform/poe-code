# Portable op declarations for safe-bash consumers

The maintained safe-bash typecheck exposed two declaration errors while preparing
background-job integration. Keep this correction in a separate commit.

`createOpTextCodec` inferred an external decoder class and DOM ambient option
types. An ES-only consumer could not compile the public declarations. Define the
codec's structural public interface using ES buffer types and isolate runtime
encoding registrations from the exported declaration surface. Runtime encoding
behavior remains covered by its existing tests.

The guarded safe-bash build also emitted references to a private sibling op
checkout. A relocated consumer had no such directory. Copy the compiler-reached
op declaration closure into the package output and rewrite declaration references
with the TypeScript AST, using the actual emitted path so `--declarationDir`
continues to work. Do not add an exclusion or require consumers to reconstruct
the development checkout.

Both regressions were observed failing before the changes. Focused validation
passed: 13 codec and ES-only declaration tests, 136 guarded build tests including
relocated consumers and nested declarationDir, op lint/typecheck and build-script
lint. Independent review accepted the explicit codec interface and corrected
emitted-path handling. Full integration validation remains to be recorded with
the background-job integration result.

The maintained public-cleanup snapshot helper also required the newly existing
op prerequisite. It now captures op source/configuration and declared dependency
bytes, compiles them in the isolated snapshot, and bundles the private command
inside authenticated dist before executing the unchanged public probe. It never
borrows shared op build output or widens the public worker import guard. A memfs
regression checks source binding and refusal of symlinks. The missing-prerequisite
failure was reproduced before the fix; the full canonical public-cleanup suite then passed 20/20, including ten real
retirement cases and ten tamper rejection controls. All five census tests passed. Historical snapshots remain unchanged.

Final affected-package validation passed all 851 op tests and all 320 safe-bash
build/discovery tests. Main's maintained workspace build, root type/contract
checks, safe-bash consumer typecheck, and all 17 package rules passed. Repository-
wide gate limitations are recorded in [the integration plan](background-jobs-integration.md).

The complete safe-bash unit run exposed two additional current fixture paths
that omitted op: committed S3 HTTP export snapshots and local writer-isolation
fixtures. The committed verifier now admits op metadata/configuration/source
from the selected Git revision, builds it in the snapshot and binds generated
output explicitly. It does not overlay live product source or exclude op dist
from integrity checks. Local writer fixtures explicitly link their validated
declared op prerequisite, following their existing local peer model; all six
writer-fixture tests pass, including refusal when the prerequisite is removed.

All 198 current archive controls pass, including real bundled codec input and
refusal of dependency additions, symlinks, source case aliases and generated
output tampering. The actual committed-export probe must use the integration
commit after it exists; its result is recorded separately from these controls.
