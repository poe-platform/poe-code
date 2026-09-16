# CommonMark and GFM writers

Scope: original TypeScript conversion in packages/pandoc, shared Markdown writer,
existing table geometry/projection policy, thin byte-only adapter. No native runtime,
root CLI changes, README additions, pushes or releases.

Completed implementation and verification procedure:

1. Read root AGENTS.md; no additional scoped instructions exist in packages/pandoc
   or docs. Preserve the existing shared-plan changes.
2. Add original failing writer tests before the initial implementation. Review
   upstream Writers.Markdown and the Tables inventory as behavior prompts, without
   copying upstream implementation, test bodies or golden strings.
3. Implement escaping, code spans/fences, lists, breaks, links/references and GFM
   task/table/strike syntax. Only wrap none is supported, including SDK/adapter
   validation. Reject incompatible tables in CommonMark even under lossy.
4. Run original expected-string oracles and supplementary parse-back checks.
   Normalize only reader text segmentation and URI escaping where explicitly
   identified; do not conceal structural changes.
5. Execute maintained package tests, lint/typecheck and selected workspace build.
6. Manual QA: screenshot actual built byte-command conversions for CommonMark,
   GFM, and rejected wrap mode; view the image and inspect output and errors.
7. Commit explicitly owned source/tests, this plan and docs/pandoc evidence on main.

Evidence and canonical formatting choices are in docs/pandoc/markdown-writers.md.
The shared TypeScript safe-bash plan remains owned by its prior editor.
