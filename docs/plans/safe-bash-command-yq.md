# Extract yq into a private command workspace

Issue: 975. Revalidated checkout: 5172753baf646ed9625f9e5a7758e8f8f7f80275.

Move both existing yq implementations from `packages/safe-bash/src/commands/yq`
into `safe-bash-command-yq`. Keep their restricted and optional Mike-yq public
imports, registration, limits, optional YAML peer and in-place publication.
Retain compatibility facades for internal integration imports.

The shared jq/yq parser, values and interpreter belong in a private query engine;
their shared regex algorithms belong in a private regex engine. Canonical
diagnostic, yield and filesystem-output accounting contracts belong in
safe-bash-contracts. All dependencies point toward these leaves, never back to
Safe Bash. No independent publication or new command registration is authorized.

The existing optional package loader must also accept explicitly admitted private
implementations. Its `optionalModules` map retains the existing optional-owned
output paths, while public contract aliases and the existing optional-host
exports preserve shared constructors and algorithms. Validate manifests, bounded
dist routes and input bytes before copying; reject source escapes, profile drift,
symlinks and unexported public aliases. Keep the YAML peer optional and unchanged.

Validation: fail the new package-boundary characterization before moving code;
move pure command tests without weakening assertions; run maintained builds,
workspace units, types, lint and package gates; verify isolated packed public
imports and strict NodeNext types with no private packages installed. Preserve
existing yq and shared-engine regression coverage, argv brands, constructor
identity, scripts, pipes, cancellation and publication budgets. Record fresh
completion evidence before committing and delivering to remote main.
