# Chart font operation bridge

Owner: drawing delegation. Owned new chart-font-operations.ts/test and narrow
shared drawing-format.ts + FillFormat.apply additions. Root embeds the schema
under chart objects target=font and routes SDK/CLI operations.

1. Enumerate Font's documented bold/color/fill/italic/language_id/name/size/
   underline members. Retain model names; command JSON uses languageId.
2. Write original memfs cases for nine explicit chart owners, all writable fields,
   nullable removals, invalid selector combinations, enum and accessor rejection.
3. Reuse Font assignments and shared drawing fill serializer rather than duplicate
   theme/gradient/pattern logic. Add a typed FillFormat.apply extension for this.
4. Run focused tests, existing drawing regressions, TypeScript and ESLint.
5. Root performs maintained package checks and command screenshot QA before commit.

Agent QA: inspect in-memory persisted XML for selected owner, b/i/sz/u/lang/typeface,
retained theme references and exact gradient stop count. Check no model nodes are
created by invalid arguments. No native renderer, external fixture or network.
