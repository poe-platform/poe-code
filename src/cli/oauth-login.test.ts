import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveApiKeyViaOAuth } from "./oauth-login.js";

const createOAuthClientMock = vi.hoisted(() => vi.fn());

vi.unmock("./oauth-login.js");

vi.mock("poe-oauth", () => ({
  createOAuthClient: createOAuthClientMock
}));

vi.mock("@poe-code/design-system", () => ({
  text: { muted: (value: string) => value, link: (value: string) => value },
  log: { message: vi.fn(), warn: vi.fn() },
  spinner: () => ({ start: vi.fn(), stop: vi.fn() })
}));

describe("resolveApiKeyViaOAuth", () => {
  beforeEach(() => {
    createOAuthClientMock.mockReset();
    createOAuthClientMock.mockImplementation((config: {
      openBrowser?: (url: string) => Promise<void>;
      readLine?: () => Promise<string>;
    }) => ({
      async authorize() {
        return {
          authorizationUrl: "https://poe.example.test/oauth",
          waitForResult: () => Promise.race([
            config.openBrowser!("https://poe.example.test/oauth").then(() => new Promise(() => undefined)),
            config.readLine!().then(() => new Promise(() => undefined))
          ])
        };
      }
    }));
  });

  it("rejects promptly when stdin closes and browser launch fails", async () => {
    const input = new PassThrough();
    input.end();

    const result = resolveApiKeyViaOAuth({}, {
      input,
      openBrowser: async () => {
        throw new Error("browser unavailable");
      }
    });

    await expect(Promise.race([
      result,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), 50))
    ])).rejects.toThrow("No OAuth authorization channel is available");
  });

  it("continues when stdin closes but browser authorization succeeds", async () => {
    createOAuthClientMock.mockImplementation((config: {
      openBrowser?: (url: string) => Promise<void>;
    }) => ({
      async authorize() {
        return {
          authorizationUrl: "https://poe.example.test/oauth",
          async waitForResult() {
            await config.openBrowser!("https://poe.example.test/oauth");
            return { apiKey: "oauth-key" };
          }
        };
      }
    }));
    const input = new PassThrough();
    input.end();

    await expect(resolveApiKeyViaOAuth({}, {
      input,
      openBrowser: async () => undefined
    })).resolves.toBe("oauth-key");
  });
});
