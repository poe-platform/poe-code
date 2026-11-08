# Prompt documents

Use the public `resolvePromptDocument` SDK helper to compose and inspect Markdown prompts without importing private workspace packages.

```ts
import { resolvePromptDocument } from "poe-code";

const resolved = await resolvePromptDocument({
  cwd: "/srv/checkouts/widgets",
  filePath: ".poe-code/prompts/review.md",
  optional: true,
  basePaths: ["/srv/automation/prompts"],
  variables: { repository: "acme/widgets" }
});

console.log(resolved.prompt);
console.log(resolved.chain);
```

With `optional: true`, a missing project prompt extends the matching packaged base document. For example, `.poe-code/prompts/review.md` resolves a base named `review.md` from `basePaths`. A project override can extend that base with normal Markdown frontmatter and `{{yield}}`:

```md
---
extends: true
owner: platform
---

Apply the repository-specific rules for {{repository}}.
```

The result exposes:

- `template`: the composed prompt after inheritance and Markdown partial expansion, before variable rendering;
- `prompt`: the final one-pass rendered prompt;
- `metadata` and `sources`: resolved frontmatter and its provenance;
- `source` and `chain`: the logical project document and every resolved document/partial path.

Document paths must stay inside `cwd`. Base paths must be absolute. Base documents and Markdown partials stay inside their explicitly configured roots, including after symlink resolution. Circular inheritance, recursive partials, missing bases/partials, and unresolved variables fail with actionable errors.

Prompt documents support Markdown partials such as `{{> shared-rules}}`. The separate pipeline-only `{{file "..."}}` syntax is not exposed by this API.
