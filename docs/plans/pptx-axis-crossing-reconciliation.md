# Axis crossing reconciliation

Scope: review the retained chart crossing parameter payloads, preserve the neutral
SDK properties and validate the shared `charts set --objects` command behavior.
This is one atomic improvement within the broader reconciliation; family-level
test links do not certify all source variants or whole-public-API coverage.

1. Read pinned axis crossing fixture definitions and BDD example values.
2. Write original memory-only regression cases with independent XML assertions
   for missing/custom/automatic/minimum/maximum crossing, numeric replacement,
   null removal, crossed-axis ownership and Strict namespaces.
3. Observe failing tests before correcting the domain implementation.
4. Verify the SDK and delegated safe-bash command path, then package lint/tests.
5. Record exact case mappings and remaining reconciliation obligations in research.
6. Commit only owned paths on main; do not push or run the whole pipeline.

No corpus inputs are needed for this small structural regression. The disposable
corpus manifest remains QA provenance; no binary assets are added or downloaded.
The existing standalone legal notices remain in place. Tests use original XML,
labels and assertions, with source identities confined to research.

## Verification receipt

- TDD: corrected fixture setup/serialization expectations first; eight failures
  then independently reproduced the two crossing defects before product changes.
  Final original table covers 58 cases, including all 14 retained unit variants
  and 17 BDD examples. The prior model test expectation for null was corrected.
- `npm run test --workspace=pptx`: 6,740 passed across 254 files.
- `npm run lint --workspace=pptx`: ESLint and production/test TypeScript passed.
- `npm run build:workspaces -- --workspace=pptx`: declared selected build closure passed.
- Delegated safe-bash maintained reporter: all three original CLI cases passed.
- Registration's live check failed on an unrelated already-modified entry for
  the absent sanitization test. Preserved that entry. The exact committed
  registration baseline plus only the owned chart-crossing entry passed the same
  maintained test via a temporary sibling module, removed after execution. This
  is selected-change evidence, not a passing live registration-suite claim.
- No help, output text or CLI layout changed; no visual screenshot was taken for
  this binary XML mutation. No renderer or corpus fixture was required.

The central case ledger promotes exactly these 31 reviewed rows; every other row
retains its prior disposition. Whole chart/deck/notes/media/action/property and
public API reconciliation remains unfinished. Local commit uses only explicitly
owned files and the single owned registration hunk, preserving unrelated edits.
