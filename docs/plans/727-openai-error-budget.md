# Issue 727: OpenAI HTTP error response budget

## Validated defect

The live issue from `kamilio` reports that `maxResponseBytes` below 64 KiB is
ignored for non-2xx OpenAI responses. Current code confirmed the cause:
`openAiResponse` passed a fixed 64 KiB bound to `openAiJson`, while the provider's
shared request helper did not pass its configured response limit.

Before changing product code, mocked transports reproduced consumption of all
53 one-byte chunks with a configured limit of one byte. The same failure occurred
for chat, image and video requests. The expanded existing OpenAI test file had
82 cases: 74 passed and eight failed. No real service calls, credentials or host
filesystem fixtures were used.

## Implementation

- Pass the validated `limits.maxResponseBytes` through the existing shared
  request helper to `openAiResponse`.
- Use `Math.min(64 * 1024, maxResponseBytes)` for HTTP error JSON parsing.
- Reuse the existing bounded byte reader, error formatting and cleanup. A body
  that exceeds the limit retains the useful HTTP status without an unvalidated
  body detail. A complete JSON body within the limit retains its bounded detail.
- Preserve cancellation reasons, iterator closure, response disposal and the
  default 64 KiB diagnostic ceiling. The reader may receive one transport chunk
  to detect overflow, but does not retain/parse the over-budget chunk or continue
  pulling subsequent chunks.

## Verification and delivery

Seventeen cases were added to the existing
`packages/safe-bash/tests/commands/llm/openai.test.ts`: small limits across all
three endpoints, exact UTF-8 byte boundaries, default/equal/larger diagnostic
ceilings, secondary cleanup failures and falsey cancellation reasons. There are
no new test files or test-inventory changes.

The nine focused LLM test files pass all 290 cases with zero skips. The maintained
source/tests typecheck exits zero. Validation runs outside the execution sandbox
so Node reports actual subtest results. No build or dist mutation was performed.

- Red log: `/tmp/poe-727-openai-red.log`.
- Focused regression log: `/tmp/poe-727-llm-green.log`.
- Maintained source/tests typecheck log: `/tmp/poe-727-source-typecheck.log`, from
  `node scripts/historical-type-models.mjs --noEmit` in `packages/safe-bash`.

Only `openai-http.ts`, `openai.ts`, the existing OpenAI test file and this plan
are in the implementation scope. No README changes, new protocol behavior,
dependencies, Git actions or root release/full-test duplication. Root owns the
remaining integration checks, commits, issue closure and release verification.
