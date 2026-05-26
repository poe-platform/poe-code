# Cached resource fetch timeout does not normalize Node-style abort errors

## Summary

`@poe-code/cached-resource` documents and implements a configured `fetchTimeout`, but converts a timed-out request into its `Request timed out after <ms>ms` diagnostic only when the rejected value is a `DOMException`. A valid injected or runtime fetch implementation that rejects with a standard `Error` whose `name` is `AbortError` after the supplied abort signal fires leaks its low-level abort message instead of the cache API's timeout error.

## Reproduction

From the repository root, run this isolated passing probe using the exported fetch dependency seam with a Node-style abort rejection:

```sh
cat > /tmp/cached-resource-node-abort-timeout-probe.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { fetchFromApi } from "./api-fetch.js";

describe("cached-resource timeout normalization", () => {
  it("does not normalize a Node-style AbortError thrown after fetch timeout", async () => {
    const outcome = await fetchFromApi({ apiEndpoint: "https://api.example.test/models", fetchTimeout: 1 }, {
      fetch: async (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted by signal"), { name: "AbortError" })));
      })
    }).then(
      () => ({ resolved: true }),
      (error: unknown) => ({ rejected: error instanceof Error ? error.message : String(error) })
    );
    console.log(JSON.stringify({ outcome }));
    expect(outcome).toEqual({ rejected: "aborted by signal" });
  });
});
EOF
cp /tmp/cached-resource-node-abort-timeout-probe.test.ts packages/cached-resource/src/__probe__.test.ts
trap 'rm -f packages/cached-resource/src/__probe__.test.ts /tmp/cached-resource-node-abort-timeout-probe.test.ts' EXIT
./node_modules/.bin/vitest run packages/cached-resource/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

The timeout aborts the fetch, but the exported helper rejects with the underlying abort implementation's message:

```text
{"outcome":{"rejected":"aborted by signal"}}
✓ packages/cached-resource/src/__probe__.test.ts > cached-resource timeout normalization > does not normalize a Node-style AbortError thrown after fetch timeout
```

`packages/cached-resource/src/api-fetch.ts:10` through `packages/cached-resource/src/api-fetch.ts:17` create and apply an abort controller for `config.fetchTimeout`. In the catch path at `packages/cached-resource/src/api-fetch.ts:25` through `packages/cached-resource/src/api-fetch.ts:29`, timeout normalization occurs only for `error instanceof DOMException && error.name === "AbortError"`; an `Error` with the equally standard abort name falls through unchanged.

## Expected Behavior

When the helper's own timeout abort signal causes a fetch failure, callers should receive the documented timeout diagnostic consistently across compatible fetch implementations, regardless of whether the abort error is represented as a `DOMException` or an `Error` named `AbortError`.

## Impact

Applications using injected fetch implementations, polyfills, or runtimes with different abort error classes can receive inconsistent and less actionable failures for the same configured timeout. Timeout handling, logging, retries, and user messages may misclassify network cancellation as an arbitrary fetch error instead of a bounded cache request timeout.
