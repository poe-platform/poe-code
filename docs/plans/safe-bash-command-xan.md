# Xan command workspace

## Ownership and compatibility

Revalidated remote main at 86f5800734. The extraction already landed in
b9634cd075, with later behavior and portable packaging fixes. Real dispatch,
CSV parsing, selectors, sorting, readers, writers and synchronous execution live
in private `safe-bash-command-xan`. Safe Bash retains a static compatibility
facade. Canonical contracts come from `safe-bash-contracts`; no dependency points
back to Safe Bash. Existing command tests remain with the private owner.

Preserve the current public root and `commands/xan` exports, agent inventory,
standalone registration, collision/replacement policy, synchronous execution,
unbounded default limits and explicit resource bounds. This verification does
not alter command behavior or help. Historical design and oracle evidence stays
held by integration-boundaries.json. No held source is admitted by this work.

The package and its engines stay private. Existing generic packaging bundles
them into the parent shipping artifact. Consumers use public Safe Bash exports;
no standalone publication or external runtime dependency is introduced.

## Verification plan

- Run the maintained selected Safe Bash build closure and xan workspace unit,
  lint and strict source/test type checks.
- Run maintained command boundary and packaging tests and package-lint gates.
- Extend installed-consumer fixtures for xan public root/subpath factory identity,
  canonical byte argv/value identity, filesystem errors, VFS scripts, pipelines,
  stable numeric sorting, default/explicit limits, standalone registration,
  collision/replacement and cancellation.
- Pack parent artifacts and install in an isolated consumer without repository
  sources or private workspace packages. Execute xan fixtures and strict
  NodeNext declarations; verify portable browser/workerd export conditions.
- Record actual results here before delivery. Keep temporary artifacts under out
  and remove them after verification. Commit, push to main and verify ancestry.

## Verified results

- Maintained Safe Bash build closure passed (208 declared builds); the optional
  Cloudflare closure also passed to prepare the complete parent artifact.
- Xan workspace unit suite: 57 passed. Workspace lint and strict source/test
  typechecks passed. Existing shell parity suites: 43 passed.
- Maintained memfs package-safe suite and command boundaries: 260 passed.
  Xan root-export characterization passed. Changed-file ESLint passed.
- Parent packaging succeeded. Only the three parent tarballs were installed in
  an external consumer; private xan/contracts/column imports fail as absent.
  The new runtime fixture passed under Node default, browser and workerd export
  conditions. Strict NodeNext declarations passed without repository type roots.
- Browser and workerd bundles executed VFS scripts and CSV pipelines in actual
  Miniflare Workers with outbound network denied and no external bundle imports.
- Package-lint privacy, dependency resolution, cross-package imports, public
  exports, transitive bundling and collocated-asset gates passed. The repository
  asset-packaging audit reports five unrelated missing build assets in
  github-workflows, terminal-pilot, tokenfill and toolcraft; no xan violation.
  Root CLI bundle lint requires the unrelated full root build and was skipped;
  actual isolated parent packaging/bundling was verified instead.
- A broad root-export scan reported two unrelated command failures; the selected
  xan contract passed. No full-repository green result is claimed.
- No runtime, output, help, inventory, publication or held-evidence changes were
  necessary. The new coverage characterizes the already-delivered extraction,
  so there is no new runtime fix requiring a pre-fix failing regression.
