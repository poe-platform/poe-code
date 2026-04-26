import http from "node:http";
import { describe, expect, it } from "vitest";
import { createLoopbackAuthorizationSession } from "../index.js";

async function requestUrl(
  url: string
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      const chunks: Buffer[] = [];

      response.on("data", (chunk) => {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      });
      response.once("end", () => {
        resolve({
          status: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });

    request.once("error", reject);
  });
}

describe("createLoopbackAuthorizationSession", () => {
  it("uses an http://127.0.0.1:<random>/callback redirect URI by default", async () => {
    const session = await createLoopbackAuthorizationSession();

    try {
      const redirectUri = new URL(session.redirectUri);

      expect(redirectUri.protocol).toBe("http:");
      expect(redirectUri.hostname).toBe("127.0.0.1");
      expect(redirectUri.port).toMatch(/^\d+$/);
      expect(redirectUri.pathname).toBe("/callback");
    } finally {
      session.close();
    }
  });

  it("keeps the configured callback path fixed while using a random loopback port", async () => {
    const session = await createLoopbackAuthorizationSession({
      callbackPath: "/oauth/callback",
    });
    const waitForCode = session.waitForCode("https://auth.example.com/authorize");

    try {
      const redirectUri = new URL(session.redirectUri);
      expect(redirectUri.protocol).toBe("http:");
      expect(redirectUri.hostname).toBe("127.0.0.1");
      expect(redirectUri.pathname).toBe("/oauth/callback");

      const wrongPath = new URL(session.redirectUri);
      wrongPath.pathname = "/other";

      await expect(requestUrl(`${wrongPath.toString()}?code=ignored`)).resolves.toMatchObject({
        status: 404,
      });

      const successResponsePromise = requestUrl(
        `${session.redirectUri}?code=${encodeURIComponent("code-123")}`
      );

      await expect(waitForCode).resolves.toBe("code-123");
      await expect(successResponsePromise).resolves.toMatchObject({
        status: 200,
      });
    } finally {
      session.close();
    }
  });
});
