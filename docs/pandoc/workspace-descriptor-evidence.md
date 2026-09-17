# Engine workspace revalidation evidence

The requested engine workspace and conversion seam were already implemented on
main. Package declarations expose readDocument, writeDocument and convert through
explicit typed ESM exports. Their shared Session validates options and lowerable
limits; convert performs input acquisition, ordered document aggregation, writer
invocation and output publication. No new parser or runtime fallback was added.

## Validated issue and fix

An original test importing createFormatRegistry through @poe-code/pandoc failed:
changing the caller's alias map replaced the aliases shown in public capability
descriptors, even though registry lookup retained the original aliases. The fix
copies the alias map and direction arrays and freezes the copies. Published
capabilities and parsed descriptors now retain the same owned alias snapshot.

Failing-first evidence: workspace-descriptor-red.log (focused original failure).
workspace-alias-red.log also records the package route: 1 failure and 1,043 passes.

## Checks

- npm run test:unit --workspace=@poe-code/pandoc: 47 files, 1,044 tests passed.
  Evidence: workspace-descriptor-unit.log.
- npm run lint --workspace=@poe-code/pandoc: ESLint and production/test TypeScript
  checks passed. Evidence: workspace-descriptor-lint.log.
- npm run build:workspaces -- --workspace=@poe-code/pandoc: maintained declared
  dependency closure passed, with five builds. Evidence: workspace-descriptor-build.log.
- Built Node ESM consumer imported package exports and exercised real CommonMark
  read, plain write and conversion; all three operations rejected raised SDK
  ceilings with E_OPTION. It verified alias ownership and maintained workspace
  build/unit declaration discovery. Evidence: workspace-descriptor-public.log.

The first ad hoc built-consumer attempts used incorrect assertions about the
ceiling diagnostic and the runner's test-stage property. Correcting those probe
assertions required no product changes; the final consumer check passed.
No browser/workerd or full repository check is claimed for this focused fix.
No CLI behavior changed; screenshots are not applicable to this descriptor fix.

## Publication gate

README permission remains unresolved. The exact existing proposal is
package-readme-draft.md; no README was edited. Package delivery remains incomplete.
Changes are local only: no push, verified remote-main delivery or release.
