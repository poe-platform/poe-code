# Build-runtime-independent Node built-in classification

## Scope and provenance

This release ports five package-lint production/test paths onto current main,
starting at `c29d1074cdda3963617aeb25946bb9315630fb4d`. The package README and
this plan document the change. Root metadata, lockfile, workflows, public
exports, engines and the released SafeJS implementation remain unchanged.
No unfinished browser, language, snapshot-format or build-recipe changes are
part of this release.

The frozen independent port has SHA256
`a434913037d129de929d0fae571f81ec7211bef49ca04f5461f44beb1734d753`.
Its 140-name internal catalogue was captured from Node24.14.0 and has source
SHA256 `0c6ce12a2ee031ffac0a807a93d8a07123bfbed973d9329dd4f3e303ecbeb4dc`.
Only the three existing publication-policy classifier calls and their import
change. No candidate-only fourth classifier call is introduced.

Node18.18.2 reports `module.isBuiltin("node:sqlite")` as false. Using that
runtime-specific answer for publication policy makes a genuine cold root
build reject a lazily imported Node built-in. The checked catalogue makes
classification independent of the builder without changing runtime support.
It does not load SQLite or any other newly recognised module.

## Invariants

- Unknown externals, unknown `node:` names and invalid bare aliases remain
  denied; a dependency declaration cannot authorise an unknown Node built-in.
- Workspace, dependency and browser host-denial policies remain enforced.
- All six currently Node-only SafeJS browser routes remain unsupported.
- No dependency upgrades, configuration switches or engine-floor changes.
- Historical errors and original negative assertions remain represented by
  regression tests; no timeout increase or test exclusion is introduced.

## Reproduction and qualification

Use a clean isolated checkout with the exact lockfile and private dependencies.
Run the three owned test files under unflagged Node18.18.2 before and after
the policy change: `bundle-policy.builtins.test.ts`,
`bundle-policy.browser.test.ts`, and `scripts/bundle.test.ts`. The release
operator reproduced eleven genuine classification failures with unchanged c29
policy and the complete new tests before applying the classifier replacement.

For actual cold-build verification, start without root/workspace build outputs
or a populated Turbo cache, then run the unchanged root build command under
Node18.18.2 with cache reads disabled:

```sh
TURBO_CACHE=local:w TURBO_FORCE=true npm run build
```

The release gate also requires the configured Node22 build, lint, package lint,
full forced tests and ordinary isolated smoke. Smoke must use an explicit
private npm prefix, HOME and cache, verify npm resolution before installation,
retain logs before rotation, and check the real global boundary afterwards.
Verify actual packed runtime/types, unknown-external and browser denials; a
focused in-memory policy result is not a replacement for a root cold build.

The leaf's unchanged expanded-test type diagnostic in `packlist.test.ts`
(required PackageInfo fields missing from an old fixture) is disclosed, not
labelled strict-green. The configured root type gate is independently required.
No assertion about full browser SDK or unfinished runtime integration follows
from this build-policy fix.

## Publication

Use the ordinary commit/push hooks on main. Publication occurs only in GitHub
Actions. Monitor release and schema jobs, then verify the registry version,
gitHead and tarball integrity against the released commit (or an audited
descendant). Final versions and workflow IDs belong to the verified release
receipt; they must not be predicted from this plan.
