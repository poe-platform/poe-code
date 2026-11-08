# Bzip2 command workspace

## Scope and ownership

Revalidated main at `69faed6207`: the private command workspace, manifests,
lockfile, codec assets and public exports already exist. Finish the extraction
by moving the remaining default-executor policy from the public adapter to the
command owner and retaining the canonical contracts WeakSet. Safe Bash keeps a
static re-export and aggregate composition. No default inventory, limit, option,
help text, runtime profile, dependency or publication change is intended.

The private compression engine owns shared parsing, codec assets, concatenated
streams, memory/work accounting and filesystem publication. The bzip2 workspace
owns all three command handlers, registration, limits and direct command tests.
Shell pipeline and truncated-output integration regressions remain in Safe Bash.
Neither private workspace depends back on Safe Bash or is independently published.

## Verification plan

1. Characterize the public default-executor policy in the private workspace;
   confirm failure before moving the policy, then pass it without changing which
   explicit limits disable direct execution.
2. Move existing bzip2 option/data-error tests without weakening assertions.
   Run workspace unit tests, lint/typechecks, shared compression tests and the
   remaining Shell regressions through maintained build prerequisites.
3. Extend the maintained packed-consumer and strict NodeNext fixtures. Exercise
   public root/subpath exports, aliases, pipes, VFS scripts, concatenated streams,
   corruption, limits, collision/replacement, cancellation and canonical argv,
   byte-value and error identities without private workspaces installed.
4. Run packaging tests and package-lint gates, and execute the packed fixture
   with browser/workerd resolution. Inspect the diff and verify remote main
   contains the final commit before closing the work. Release publication is
   tracked separately; this task does not wait for a full release.

No CLI output or help text changes; screenshot validation is not applicable.

## Verification results

The default-executor characterization failed before the policy move and passed
afterward. All 24 command tests, 60 shared-engine tests and 365 selected Shell
compression tests passed. The final Shell run used the maintained `--test-file`
selector for all 23 active compression files; earlier unintended broad runs were
stopped after discovering the environment filter was ignored. Workspace strict source/test typechecks and changed-file
ESLint passed. Packaging/workspace tests passed (248 existing cases plus the new
bzip2 memfs case).

The maintained parent and companion build closures and real packaging route
passed. Installed public tarballs in a separate consumer with no private packages
or symlinks passed the runtime fixture and strict NodeNext compilation using
consumer-local TypeScript and Node types. Both browser and workerd condition
bundles passed with ambient Buffer, process and network denied; workerd's graph
requires the static WASM loader. This is bundle execution qualification, not a
Cloudflare deployment claim.

Package-lint passed privacy, dependency, cross-package, export resolution and
asset-collocation gates. Its repository-wide packaged-asset check reported five
findings outside this command's dependency scope (github-workflows, terminal-pilot,
tokenfill and toolcraft). The root-CLI bundle gate had no root metafile and was
skipped; actual public tarball preparation and isolated portable bundle execution
verified the changed shipping graph instead. No release publication is claimed.
