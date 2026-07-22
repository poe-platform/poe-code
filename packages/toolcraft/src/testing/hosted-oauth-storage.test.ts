import { describe, expect, it } from "vitest";
import { createInMemoryHostedOAuthStorage } from "../http-hosted-oauth.js";
import { verifyHostedOAuthStorage } from "./hosted-oauth-storage.js";

describe("verifyHostedOAuthStorage", () => {
  it("accepts a conforming storage adapter", async () => {
    await expect(
      verifyHostedOAuthStorage({
        createStorage: () => createInMemoryHostedOAuthStorage<string>({ development: true }),
        credentials: ["first", "second"]
      })
    ).resolves.toBeUndefined();
  });

  it("reports non-atomic credential updates", async () => {
    const storage = createInMemoryHostedOAuthStorage<string>({ development: true });
    storage.credentials.update = async (subject, update) => {
      const current = await storage.credentials.get(subject);
      if (current === undefined) throw new Error("missing");
      return update(current);
    };

    await expect(
      verifyHostedOAuthStorage({
        createStorage: () => storage,
        credentials: ["first", "second"]
      })
    ).rejects.toThrow(/credential updates/i);
  });
});
