# DD command workspace

## Scope and ownership

Revalidated remote main `e862cd0569`: `safe-bash-command-dd` already owns
operand parsing, conversions, block I/O, descriptor handling, reporting and sync
execution. Safe Bash retains composition and the `./dd` and `./commands/dd`
public routes. This work completes regression ownership and distribution evidence;
it does not repeat the existing extraction or change command behavior.

The private workspace depends only on canonical contracts, Safe FS and the I/O
engine. Its implementation is bundled into the existing shipping Safe Bash
package. Consumers never install or import the private workspace. Existing
optional admission, inventories, hooks, limits and export conditions are preserved.

## Implementation

- Move command-only I/O, reporting and optional-limit regressions into the command
  workspace without changing assertions. Keep Shell/device/native integration in
  Safe Bash to avoid a dependency cycle. Exclude test helpers from emitted code.
- Correct the package README to explicitly register the optional command through
  its public API and provide its input using the VFS.
- Add maintained packed runtime and strict NodeNext consumers for both public
  routes, canonical argument/value/error identity, binary pipelines and VFS
  scripts, invalid UTF-8 operand rejection, cancellation, collision/replacement,
  injected errors and transfer limits.

## Verification

Run the selected workspace build closure, all command workspace tests, lint and
source/test typechecks; run the retained dd integration suites. Run package-lint
and packaging tests. Prepare safe-library artifacts with `package-safe.mjs`, pack
and install only public tarballs into an isolated consumer, and run the new runtime
and strict NodeNext fixtures. Verify browser/workerd command routes using isolated
bundles. Native oracle cases require the pinned executable and must be reported
as skipped when unavailable. CLI output is unchanged, so no screenshot is needed.

No new product implementation is introduced: the original migration predates this
checkout. Existing regression assertions are preserved rather than manufacturing
a failing behavior change for an already implemented extraction.

## Verified result

- Selected dd and Safe Bash workspace build closures passed.
- All 43 command workspace tests passed; source/test typechecks and ESLint passed.
- Retained Shell/native integration: 133 passed, 17 explicitly skipped for the
  unavailable pinned native oracle, zero failures.
- All 233 maintained packaging tests passed. Package-lint passed all 17
  source/package rules; its two root-CLI-metafile rules were not run because this
  focused change does not build the root CLI. Shipping bundle behavior was instead
  verified directly using the actual safe-library tarballs.
- Installed only the three public safe-library tarballs outside the checkout.
  Both dd routes passed runtime checks and strict NodeNext declarations. Private
  command/contracts/engine packages were confirmed unavailable to resolution.
- Browser and workerd bundles passed in isolated realms without host filesystem,
  process, network or Buffer globals, using the maintained Wasm asset adapter.
- Moved test bodies match their originals exactly apart from import routes.
  No runtime implementation, default registration or published package was added.
