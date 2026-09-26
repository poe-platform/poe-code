import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useNativeProcess } from "../tests/native-process.js";

const runNative = useNativeProcess([
  "--import", "tsx", "packages/docx/tests/fixtures/comment-style-live-xml-native.ts"
]);

for (const capacity of ["sufficient", "insufficient"] as const)
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["model", "sdk", "cli"] as const)
// Every route crosses the 16-bit fanout boundary; larger cases run through QA.
for (const count of capacity === "sufficient" ? [1024, 65536] : [65536]) {
  const title = capacity === "sufficient"
    ? "live comment style XML insertion retains admitted ignored physical fanout"
    : "live comment style complete workflow refuses insufficient original cumulative node capacity";
  describe(`${title}; strict=${strict}; kind=${kind}; count=${count}; route=${route}`, () => {
    const request = { strict, kind, count, route, capacity };
    async function checkPhase(phase: "prepare" | "execute" | "verify") {
      const result = await runNative({ ...request, phase }) as { error?: string; stack?: string };
      expect(result, result.stack ?? result.error).toEqual({ ok: true, phase, ...request });
    }
    // Fixture creation and independent archive/public-reader verification each
    // keep their own five-second bound; the test measures the actual workflow.
    beforeEach(() => checkPhase("prepare"), 5000);
    it("executes the complete source workflow", () => checkPhase("execute"));
    afterEach(() => checkPhase("verify"), 5000);
  });
}
