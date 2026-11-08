# Portable public consumer QA

Verify the generated public packages after `npm run build`, with the same
`packageSafeLibraries` publication route used for release. Install their output
in an isolated consumer under `out/`; do not resolve imports through workspace
source aliases.

1. Bundle the safe-bash root, network, image-ast, Sharp, optional YQ and restricted
   YQ entries, plus the safe-fs root, contracts and S3 entries. Repeat for the
   `browser` and `workerd` conditions, with browser platform resolution. Reject
   unresolved imports and reachable Node builtins.
2. Run each consumer in a standard-Web Node VM without Buffer, process, require
   or setImmediate. Exercise Shell execution, optional YQ staged file replacement,
   S3 operations with an injected mock transport, Sharp safe-fs file input/output
   and Web stream input/output. Require expected results and clean disposal.
3. Bundle and execute `scripts/fixtures/safe-packages-browser.mjs` against the
   installed packages under both conditions. This aggregate native check includes
   all of its imported and top-level workflows; await the entire fixture and fail
   on any rejection. It intentionally runs outside the unit test timeout because
   it combines many independent command and filesystem workflows. Keep its import
   graph assertions in the maintained unit suite.
4. Compile a public consumer with TypeScript `types: []` and browser/workerd custom
   conditions. Require all portable declarations to resolve without Node ambient
   types.
5. Record outcomes in `out/`, then remove the generated consumer and evidence.

A standard-Web VM qualifies the installed portable graph and workflows. It does
not substitute for execution in an actual Cloudflare deployment.
