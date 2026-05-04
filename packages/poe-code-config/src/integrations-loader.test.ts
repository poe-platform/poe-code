import { describe, expect, it, vi } from "vitest";
import type { ConfigDocument } from "./types.js";

describe("loadIntegrations", () => {
  it("returns null without importing Braintrust when disabled", async () => {
    let imported = false;
    vi.doMock("@poe-code/braintrust", () => {
      imported = true;
      return {
        bootstrap: vi.fn()
      };
    });

    const { loadIntegrations } = await import("./integrations-loader.js");
    const result = await loadIntegrations({
      integrations: {
        braintrust: {
          enabled: false
        }
      }
    } as ConfigDocument);

    expect(result).toBeNull();
    expect(imported).toBe(false);

    vi.doUnmock("@poe-code/braintrust");
  });
});
