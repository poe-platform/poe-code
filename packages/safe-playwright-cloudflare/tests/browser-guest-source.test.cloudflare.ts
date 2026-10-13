import { expect, test } from "vitest";
import { createCompressedGuestSource } from "../src/browser-guest-source.js";
import { loadBrowserRunCodeGuestSource } from "../src/browser-run-code-guest.generated.js";

test("native Worker inflation restores the bundled browser guest and caches successful loads", async () => {
 const signal = new AbortController().signal;
 const source = await loadBrowserRunCodeGuestSource(signal);
 expect(source).toContain("export");
 expect(source).toContain("browser-user-code.js");
 expect(await loadBrowserRunCodeGuestSource(signal)).toBe(source);
 await expect(loadBrowserRunCodeGuestSource(AbortSignal.abort(new Error("cancelled")))).rejects.toThrow("cancelled");
});

test("native Worker inflation rejects output above the generated size", async () => {
 const signal = new AbortController().signal;
 const load = createCompressedGuestSource("H4sIAAAAAAAC/0utKMgvKlFISU1LLM0pUdDQVLC1U1BKKsovL04tslJ4NKNZyRoAsoMxHyQAAAA=", 1);
 await expect(load(signal)).rejects.toThrow("exceeds");
});
