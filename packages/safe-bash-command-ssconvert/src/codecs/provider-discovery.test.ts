import { expect, it, vi } from "vitest";

vi.mock("./providers.generated.js", () => ({ sourceProviders: [{ id: "Original", source: "original fixture", services: [
  { id: "format", direction: "read", description: "Original opener", extensions: ["fixture"],
    probeContent: () => true, read: async () => ({ sheets: [] }) },
  { id: "format", direction: "write", description: "Original saver", extensions: ["fixture"],
    write: async () => new Uint8Array([7]) }
] }] }));

import { createRegistry } from "./registry.js";

it("automatically installs implementations declared in one generated provider module", () => {
  const registry = createRegistry([]);
  expect(registry.list("read").map((service) => service.id)).toEqual(["Original:format"]);
  expect(registry.list("write").map((service) => service.id)).toEqual(["Original:format"]);
  expect(registry.select("write", undefined, "file.fixture")?.description).toBe("Original saver");
  expect(registry.coverage().every((service) => service.installed)).toBe(true);
});
