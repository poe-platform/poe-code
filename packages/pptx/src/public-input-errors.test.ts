import { Volume } from "memfs";
import { expect, it } from "vitest";
import * as api from "./index.js";
import { readBinary } from "./bytes.js";

const context = { limits: { maxBytes: 1000, maxReads: 10, chunkBytes: 100 } };

it("exposes malformed XML as a typed public parse failure", () => {
  expect(api.InvalidXmlError).toBeTypeOf("function");
  try {
    api.parseXmlPart(new TextEncoder().encode("<slide>"), {
      maxBytes: 1000, maxNodes: 10, maxDepth: 10
    });
    expect.fail("Malformed XML must fail");
  } catch (error) {
    expect(error).toBeInstanceOf(api.InvalidXmlError);
    expect(error).toMatchObject({ code: "invalid-xml", phase: "parse" });
  }
});

it("reports missing capability paths without leaking the supplied path", async () => {
  const volume = new Volume();
  const result = readBinary({ path: "/private/missing.pptx", capability: {
    async openRead(path) {
      volume.readFileSync(path);
      return { async read() { return null; } };
    }
  } }, context);
  expect(result).toBeInstanceOf(Promise);
  await expect(result).rejects.toBeInstanceOf(api.PackageNotFoundError);
  await expect(result).rejects.toMatchObject({ code: "io-failure", phase: "admit" });
  await expect(result).rejects.not.toHaveProperty("message", expect.stringContaining("/private"));
});

it("keeps permission failures distinct from missing packages and cancellation wins", async () => {
  const controller = new AbortController();
  const input = { path: "/restricted.pptx", capability: {
    async openRead(): Promise<never> { throw { code: "EACCES" }; }
  } };
  await expect(readBinary(input, context)).rejects.toMatchObject({ name: "OfficeError", code: "io-failure" });
  controller.abort();
  await expect(readBinary(input, { ...context, signal: controller.signal })).rejects.toMatchObject({ code: "cancelled" });
});
