# HTML writer byte-command integration

The opt-in safe-bash adapter in packages/pandoc remains byte stdin/stdout only.
All AST rendering, capability checks, metadata validation and limits belong to
the SDK. No packages/safe-bash source or root visual CLI is changed.

The HTML writer SDK options described in `html-writer.md` have these CLI forms:

| SDK | CLI |
| --- | --- |
| `standalone: true` | `--standalone` or `-s` |
| `metadata: {key: {t: "MetaString", c: value}}` | `--metadata KEY=VALUE`, `--metadata=KEY=VALUE`, `-M KEY=VALUE`, or `-MKEY=VALUE`; colon also separates key/value |
| `rawContent` | `--raw-content=reject`, `escape`, or `retain`; a separate value is also accepted |

Explicit metadata overrides input document metadata. Empty values are preserved;
keys must be nonempty ASCII letters/digits/hyphens/underscores. Duplicate metadata
keys and duplicate boolean/raw policy flags fail. CLI metadata is literal text,
never a template, executable expression or downloaded value. Formats remain
explicit (`-f/--from`, `-t/--to`); html writes through the html5 descriptor.

Templates, variables, CSS, include flags and all unlisted flags fail with E_OPTION
before stdin is acquired. SDK unknown options are likewise rejected. Writer-only
options on other descriptors fail instead of being silently ignored. The existing
adapter reports conversion errors with status 2 and no conversion stdout; it does
not claim the wider contract's future differentiated exit-status scheme.

Original safe-bash tests compare standalone JSON conversion directly with SDK
output, inspect title/lang/dir bytes, exercise aliases, colon metadata and raw
escaping, and prove template/malformed options do not acquire stdin. No filesystem
mutations or native subprocesses are used.

## Validation evidence

On 2026-09-16 the first nine writer tests failed against the old implementation.
Two additional ID/CR tests also reproduced failures before their fixes. The CLI
standalone parity and alias/raw-policy tests failed before argument support was
added. A malformed nested-table test declaration initially failed parsing and
was corrected; it is not counted as a behavioral reproduction.

The final maintained package test route passed **551 tests in 16 files**,
including 13 original HTML-writer tests and seven byte-adapter tests. Maintained
package lint passed ESLint plus source and test TypeScript checks. The maintained
selected build route passed the pandoc workspace build. Exact commands:

```
npm test --workspace=@poe-code/pandoc
npm run lint --workspace=@poe-code/pandoc
npm run build:workspaces -- --workspace=@poe-code/pandoc
```

Canonical byte expectations and independent complete DOM comparisons retain
security attributes and meaningful whitespace; no DOM normalization or external
oracle was used. This is package-scope verification, not a repository-wide gate,
native Pandoc parity claim, push or published release.
