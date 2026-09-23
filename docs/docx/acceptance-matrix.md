# DOCX test index

The [specification](../specs/docx.md) defines the proposed contract. These are
maintained tests, not a claim of complete conformance. Remaining work lives in
the [deferred backlog](../plans/docx-deferred-audit.md).

| Behavior | Maintained tests |
| --- | --- |
| Operation discovery, feature joins, closed CLI/SDK schemas | [discovery-map-contract.test.ts](../../packages/docx/src/discovery-map-contract.test.ts) |
| Comment ownership and exact source preservation | [comments.test.ts](../../packages/docx/src/comments.test.ts), [comments-exact-source-witnesses.test.ts](../../packages/docx/src/comments-exact-source-witnesses.test.ts) |
| Revision decisions and overlapping structural history | [revisions.test.ts](../../packages/docx/src/revisions.test.ts), [review-complex-complete-variants-public.test.ts](../../packages/docx/src/review-complex-complete-variants-public.test.ts) |
| Native revision depth through SDK, CLI, and batches | [revision-decision-selected-native-depth-public.test.ts](../../packages/docx/src/revision-decision-selected-native-depth-public.test.ts) |
| Settings and protection | [settings.test.ts](../../packages/docx/src/settings.test.ts), [protection-carriers.test.ts](../../packages/docx/src/protection-carriers.test.ts) |
| Batch failure indexing and publication | [batch-schema-failure-index-public.test.ts](../../packages/docx/src/batch-schema-failure-index-public.test.ts), [ordered-batch-boundaries-public.test.ts](../../packages/docx/src/ordered-batch-boundaries-public.test.ts) |
| XML replacement and package retention | [raw-custom-xml-boundaries-public.test.ts](../../packages/docx/src/raw-custom-xml-boundaries-public.test.ts) |
| Image insertion and scalar removal | [images.test.ts](../../packages/docx/src/images.test.ts), [removal.test.ts](../../packages/docx/src/removal.test.ts) |

Run a focused selection through the maintained runner:

```sh
npm test -- --workspace=docx --test-file=packages/docx/src/discovery-map-contract.test.ts
npm run lint --workspace=docx
```

Add regression cases as small XML fragments and assertions in unit tests. Build
archives in memory with the existing fixtures and `memfs`. Do not commit copied
DOCX files, renderer output, test transcripts, timing dumps, or generated reports.
Temporary manual QA outputs belong in `/out` and should be removed after use.
Optional external schema checks use `DOCX_SCHEMA_ROOT` and the pinned validator;
they are separate from the unit suite and from document-rendering QA.
