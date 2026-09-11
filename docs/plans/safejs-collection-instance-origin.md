# Preserve collection instance prototype origin

Mixed-realm restoration exposed a separate live-runtime defect: Map and Set
constructors skipped storing the selected prototype when it matched the
current budget's default. Foreign inspection then used the inspecting realm's
default instead of the instance's originating prototype.

Two direct run/native-VM regressions fail before the correction (ae6cbd).
Collection construction now always stores a non-null selected prototype.
The existing same-prototype branch of setSandboxPrototype records the default
link without treating it as a custom prototype mutation.

The two live controls and mixed-realm/prototype selection pass 53 tests
(1ce1fc). The broader collection selection passes 487 tests across 14 files
(fc2e25), including iteration, subclassing, own properties, method receivers
and collection snapshots. No timeout, resource budget or assertion was relaxed.

This atomic collection correction is separate from the pending mixed-realm
snapshot format changes. Releases remain on hold.

Node 18.20.8 passes 51 tests across the new origin checks and existing subclass
and same-prototype controls (6dd8df). Focused ESLint passes (beb1ec).
