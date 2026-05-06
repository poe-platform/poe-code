import { describe, expect, it, vi } from "vitest";
import type { ConfigDocument } from "./types.js";

describe("loadIntegrations", () => {
  it("returns null without calling bootstrap when disabled", async () => {
    const bootstrap = vi.fn();
    vi.doMock("@poe-code/braintrust", () => ({ bootstrap }));

    const { loadIntegrations } = await import("./integrations-loader.js");
    const result = await loadIntegrations({
      integrations: {
        braintrust: {
          enabled: false
        }
      }
    } as ConfigDocument);

    expect(result).toBeNull();
    expect(bootstrap).not.toHaveBeenCalled();

    vi.doUnmock("@poe-code/braintrust");
  });
});
