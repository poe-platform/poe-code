# Package usage reconciliation

Documentation only. Inspected `b5dfced1605940c74c6567e1ac42514d3f62f492`
and the current workspace declarations without changing product code.

The package usage draft still described the initial byte-only milestone as current:
no runtime dependencies, model factory, command engine, schema or capabilities.
Current `packages/pptx/package.json`, `src/index.ts`, `src/presentation-model.ts`
and command engine tests contradict those statements. Update the draft to name
the bounded current surfaces, preserve the byte-specific transport documentation,
and apply the shared Office model/command language and safety contracts.
No README or published-package promise is added; whole-public-API coverage stays open.

Validation: the maintained Vitest route passed 140 tests across presentation-model,
presentation-public-exports, text-replacement, command-text-replace,
slide-merge-split and properties. Check Prettier and the explicit-file diff before
committing this document with `docs/pptx/package-usage.md` only. No push or release.
