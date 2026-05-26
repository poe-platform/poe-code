# Poe Agent Web `fetch_url` Pagination Buffers Complete Response Body

## Summary

The built-in Poe Agent `fetch_url` tool advertises pagination and returns at most 20,000 content characters per call, but it first reads and formats the entire HTTP response body in memory. A caller requesting only the first page of a very large URL therefore still downloads and allocates the full response before receiving its bounded tool output.

## Reproduction

Create a disposable Vitest probe at `packages/poe-agent/src/plugins/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../runtime/types.js";
import webPlugin from "./poe-agent-plugin-web.js";

describe("web fetch pagination buffering", () => {
  it("reads the complete body before returning the first bounded page", async () => {
    const body = "x".repeat(1_000_000);
    const text = vi.fn(async () => body);
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "text/plain" }),
      text,
    }) as Response);
    const plugin = webPlugin({ fetch });
    const tool = plugin.tools?.find(candidate => candidate.name === "fetch_url");
    if (!tool) throw new Error("fetch_url tool missing");

    const output = await tool.call(
      { url: "https://example.com/large" },
      { signal: new AbortController().signal } as ToolContext,
    ) as string;

    console.log(JSON.stringify({ bodyCharacters: body.length, outputCharacters: output.length, textCalls: text.mock.calls.length }));
    expect(text).toHaveBeenCalledTimes(1);
    expect(output).toContain("Showing characters 0-20000 of 1000000.");
    expect(output.length).toBeLessThan(21_000);
  });
});
```

Run:

```sh
npm exec -- vitest run packages/poe-agent/src/plugins/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"bodyCharacters":1000000,"outputCharacters":20136,"textCalls":1}
✓ packages/poe-agent/src/plugins/__probe__.test.ts > web fetch pagination buffering > reads the complete body before returning the first bounded page
```

Remove the disposable probe after validation.

## Observed Behavior

`fetch_url` describes paginated, offset-based retrieval at `packages/poe-agent/src/plugins/poe-agent-plugin-web.ts:62`, but `defaultFetchUrl()` awaits `response.text()` for the full remote body at `packages/poe-agent/src/plugins/poe-agent-plugin-web.ts:159`, formats the full content, and only slices the requested 20,000-character page afterward at `packages/poe-agent/src/plugins/poe-agent-plugin-web.ts:161`. In the probe, a request returning roughly 20,000 output characters consumes a one-million-character response first.

## Expected Behavior

The paginated URL tool should bound resource consumption as well as returned text, by streaming or enforcing a maximum readable body size before materializing remote content. Oversized responses should be truncated safely or rejected with a clear limit error.

## Impact

An agent instructed to fetch a large or untrusted URL can be forced to download, parse, and retain an arbitrarily large body despite asking for a small page. This permits avoidable memory and bandwidth exhaustion during tool execution, and HTML responses also incur full-document conversion work before any bounded output is returned.
