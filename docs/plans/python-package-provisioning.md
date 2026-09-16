# Pyodide package provisioning

Implement explicit package provisioning for the optional safe-bash Python plugin.
Use Pyodide 314.0.6 and the package matrix in
`packages/safe-bash/docs/pyodide.md`. Keep provisioning implementation in
`packages/safe-bash`; root SDK/CLI code forwards configuration only. Do not edit
READMEs or change ordinary non-Python startup.

## Required behavior

- Use matching Pyodide native builds and micropip-compatible wheels with their
  declared dependencies; reject desktop native wheels and installation options
  that the supported installer cannot honor.
- Accept SDK package/version configuration, canonical requirements files and
  local compatible wheels, with equivalent CLI options and a truthful shell
  installation workflow.
- Persist installed package artifacts separately from fresh interpreter state.
  Define environment/cache identity, conflicts, integrity, cancellation/retry,
  transport authorization, progress, and offline preprovisioning.
- Offer the exact version-pinned document profile as an explicit opt-in.
- Test transport/storage behavior with mocks and memory storage before product
  changes. Verify actual installation/imports, package data, local modules,
  offline reuse, malformed/incompatible wheels, missing distributions and
  dependency conflicts separately in the pinned runtime.

## Ownership and validation

Provisioning worker owns the package manager and runtime installer helpers.
Integration worker owns Python command lifecycle and shell installation parsing.
Runtime reviewer owns the opt-in real-runtime cases and independent review.
Root owns thin CLI wiring, public integration inventory, documentation and final
verification. No branches, commits or pushes are part of this request.

Run focused unit tests, maintained package build and typechecks, root forwarding
tests, and the separate real-runtime suite. Inspect the CLI help screenshot.
Record executed checks and limitations in the package provisioning contract and
manual QA record; unit results do not establish runtime qualification.
