import http from "node:http";
import { describe, expect, it, vi } from "vitest";

describe("test support import isolation", () => {
  it.each([
    ["root entry", "./index.js", "VITEST", "1"],
    ["test-support entry", "./test-support.js", "VITEST", "1"],
    ["root entry", "./index.js", "NODE_ENV", "test"],
    ["test-support entry", "./test-support.js", "NODE_ENV", "test"]
  ])(
    "does not patch globals when importing the %s with %s set",
    async (_name, entry, environmentVariable, environmentValue) => {
      const listen = http.Server.prototype.listen;
      const address = http.Server.prototype.address;
      const close = http.Server.prototype.close;
      const fetch = globalThis.fetch;
      const originalValue = process.env[environmentVariable];
      process.env[environmentVariable] = environmentValue;
      vi.resetModules();

      try {
        const imported = await import(entry);

        expect(http.Server.prototype.listen).toBe(listen);
        expect(http.Server.prototype.address).toBe(address);
        expect(http.Server.prototype.close).toBe(close);
        expect(globalThis.fetch).toBe(fetch);
        if (entry === "./index.js") {
          expect(imported).not.toHaveProperty("createTestMcpServer");
          expect(imported).not.toHaveProperty("nodeFetch");
        }
      } finally {
        if (originalValue === undefined) {
          delete process.env[environmentVariable];
        } else {
          process.env[environmentVariable] = originalValue;
        }
      }
    }
  );
});
