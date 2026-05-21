import { describe, expect, it } from "vitest";
import * as providers from "./index.js";

describe("@poe-code/providers public surface", () => {
  it("exposes ProviderRegistry and the api-key auth strategy", () => {
    expect(typeof providers.ProviderRegistry).toBe("function");
    expect(typeof providers.resolveApiShape).toBe("function");
    expect(providers.apiKeyAuthStrategy).toMatchObject({
      login: expect.any(Function),
      logout: expect.any(Function),
      isLoggedIn: expect.any(Function),
      resolveCredential: expect.any(Function)
    });
  });
});
