# Pandoc public bundle publication order

On September 17, 2026, scoped release runs `35237531799`, `35239330925` and
`35240150497` failed the root bundle policy with
`poe-code/safe-bash/commands/pandoc: workspace-not-inlined`. This prevented
publication of the already-delivered Python fixes #745 and #753.

The root SDK's optional converter import resolves through the root public export.
The build previously compiled that SDK before producing the export's Pandoc
target. The missing target left the guarded dynamic import external. Produce and
publish the Pandoc public bundle before compiling root consumers instead.

The regression uses real esbuild and in-memory publication: the cold target
reproduces the exact policy failure; publishing it admits the bundled result,
keeps converter code behind a dynamic import, and still rejects an unrelated
root self-import. The orchestration fixture also requires the target to exist
before the SDK build. No policy exemption or eager converter registration is
introduced.

Validation: 41 focused tests passed in independent review. The real root bundling
suffix then passed locally after installing the merged main lockfile and building
the selected Pandoc workspace closure. The initial local missing-dependency and
missing-built-workspace failures are prerequisite failures, not passing runs.
Publication must still be verified separately on GitHub and the registry.
