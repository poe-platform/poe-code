# Installed artifact QA

Execute for each scoped publication observed during this task, independently of
other package publication status. Record actual versions, commands and outcomes.

1. Fetch each exact version document from registry.npmjs.org. If packument caches
   lag, request the exact version endpoint with a unique read-only query.
2. Download each advertised tarball, compute SHA-512 and compare with its registry
   integrity. Fetch the advertised attestations and inspect the SLSA statement's
   resolved git commit and invocation URL. Distinguish inspected statements from
   independent cryptographic signature validation.
3. Install all three verified tarballs into a fresh consumer directory using
   `npm install --ignore-scripts --no-audit --no-fund` and explicit tarball paths.
4. Copy the maintained `scripts/fixtures/safe-packages-*.mjs` fixtures into that
   consumer and execute `node safe-packages-smoke.mjs` and
   `bun safe-packages-smoke.mjs`. A package's result is not inferred from another
   package's registry availability. The maintained suite exercises all three.
5. For versions containing the subarray repair, execute a public `run` call with
   a length-tracking Uint8Array and a custom species that records arguments.length.
   Require two arguments. Do not require that result on the earlier test-only
   publication, which predates the fix.
6. For the final version, execute the foreign intrinsic Array test through the
   installed API: return Array from one run with a throwing species getter; use
   it in another realm's array slice. Require the local realm's Array prototype,
   while a proxy wrapping the foreign Array must still invoke the throwing getter.
7. Observe root Release conclusion and log. If semantic-release produces no
   version, record no-release explicitly. If it publishes, verify its exact npm
   version, gitHead/provenance and installed artifact with the same two repair
   probes using its maintained SafeJS export.

Do not infer successful releases from passing local builds, inferred version
increments, superseded run names or successful publication of only one package.
