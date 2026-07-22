import { describe, expect, it, vi } from "vitest";
import { hostedOAuth, createInMemoryHostedOAuthStorage } from "./http-hosted-oauth.js";

describe("hostedOAuth", () => {
  it("creates a discriminated configuration with safe protocol defaults", () => {
    const storage = createInMemoryHostedOAuthStorage({ development: true });
    const config = hostedOAuth({
      publicUrl: "https://calendar.example/mcp",
      storage,
      provider: {
        name: "Skylight",
        login: { fields: ["email", "password"] },
        connect: vi.fn(),
        services: vi.fn()
      }
    });

    expect(config.kind).toBe("hosted");
    expect(config.publicUrl).toBe("https://calendar.example/mcp");
    expect(config.advanced?.scopes).toBeUndefined();
  });

  it("rejects insecure production URLs and development storage", async () => {
    const storage = createInMemoryHostedOAuthStorage({ development: true });
    const config = hostedOAuth({
      publicUrl: "http://calendar.example/mcp",
      storage,
      provider: {
        name: "Skylight",
        login: { fields: ["apiKey"] },
        connect: vi.fn(),
        services: vi.fn()
      }
    });

    await expect(config.prepare({ production: true })).rejects.toThrow(
      /HTTPS publicUrl.*durable storage/i
    );
  });

  it("keeps credentials isolated by opaque subject", async () => {
    const storage = createInMemoryHostedOAuthStorage({ development: true });
    const first = await storage.resolveSubject("Skylight", "account-a");
    const second = await storage.resolveSubject("Skylight", "account-b");
    await storage.credentials.set(first, "session-a");
    await storage.credentials.set(second, "session-b");

    expect(first).not.toContain("account-a");
    expect(second).not.toBe(first);
    expect(await storage.credentials.get(first)).toBe("session-a");
    expect(await storage.credentials.get(second)).toBe("session-b");
  });

  it("retains a stable signing key in the development adapter", async () => {
    const storage = createInMemoryHostedOAuthStorage({ development: true });
    const [first, second] = await Promise.all([storage.signingKey(), storage.signingKey()]);
    expect(first).toBe(second);
    expect(first.publicJwk).toMatchObject({ kty: "EC", crv: "P-256" });
  });

  it("accepts an advanced redirect interaction without form boilerplate", () => {
    const storage = createInMemoryHostedOAuthStorage<string>({ development: true });
    expect(() =>
      hostedOAuth({
        publicUrl: "https://calendar.example/mcp",
        storage,
        provider: {
          name: "Skylight",
          services: vi.fn()
        },
        advanced: {
          interaction: {
            paths: ["/oauth/provider-callback"],
            start: vi.fn(() => Response.redirect("https://login.example/authorize")),
            handle: vi.fn(() => new Response(null, { status: 303 }))
          }
        }
      })
    ).not.toThrow();
  });
});
