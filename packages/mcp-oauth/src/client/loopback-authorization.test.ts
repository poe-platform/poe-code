import http from "node:http";
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { nodeFetch } from "tiny-http-mcp-server/testing";
import { createLoopbackAuthorizationSession } from "../index.js";

async function requestUrl(url: string): Promise<{ status: number; body: string }> {
  const response = await nodeFetch(url);
  return {
    status: response.status,
    body: await response.text()
  };
}

describe("createLoopbackAuthorizationSession", () => {
  it("rejects when the loopback listener cannot start", async () => {
    class FailingServer extends EventEmitter {
      listen(): this {
        queueMicrotask(() => this.emit("error", new Error("address in use")));
        return this;
      }
    }

    await expect(
      createLoopbackAuthorizationSession({
        createServer: () => new FailingServer() as unknown as http.Server
      })
    ).rejects.toThrow("address in use");
  });

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
      callbackPath: "/oauth/callback"
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
        status: 404
      });

      const successResponsePromise = requestUrl(
        `${session.redirectUri}?code=${encodeURIComponent("code-123")}`
      );

      await expect(waitForCode).resolves.toBe("code-123");
      await expect(successResponsePromise).resolves.toMatchObject({
        status: 200
      });
    } finally {
      session.close();
    }
  });

  it("rejects a state-bound authorization for an error callback without matching state", async () => {
    const session = await createLoopbackAuthorizationSession();
    const waitForCode = session.waitForCode(
      "https://auth.example.com/authorize?state=expected-state"
    );

    try {
      await expect(
        requestUrl(`${session.redirectUri}?error=access_denied&error_description=forged`)
      ).resolves.toMatchObject({
        status: 400,
        body: "OAuth callback missing state"
      });

      await expect(waitForCode).rejects.toThrow("OAuth callback missing state");
    } finally {
      session.close();
    }
  });

  it("reports an authorization denial pasted through manual input", async () => {
    const session = await createLoopbackAuthorizationSession({
      readLine: async () =>
        "http://127.0.0.1/callback?error=access_denied&error_description=User%20declined&state=expected-state"
    });

    try {
      await expect(
        session.waitForCode("https://auth.example.com/authorize?state=expected-state")
      ).rejects.toThrow("OAuth authorization failed: access_denied — User declined");
    } finally {
      session.close();
    }
  });

  it("rejects when manual callback input fails", async () => {
    const session = await createLoopbackAuthorizationSession({
      readLine: async () => {
        throw new Error("stdin failed");
      }
    });

    try {
      await expect(session.waitForCode("https://auth.example.com/authorize")).rejects.toThrow(
        "stdin failed"
      );
    } finally {
      session.close();
    }
  });
});
