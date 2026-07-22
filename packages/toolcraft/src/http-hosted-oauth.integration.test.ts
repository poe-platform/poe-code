import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { S } from "toolcraft-schema";
import { HttpTransport, McpClient } from "tiny-mcp-client";
import { nodeFetch } from "tiny-http-mcp-server/test-support";
import { defineCommand, defineGroup } from "./index.js";
import { createHTTPMCPServer } from "./http.js";
import { createInMemoryHostedOAuthStorage, hostedOAuth } from "./http-hosted-oauth.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

function hiddenValue(html: string, name: string): string {
  const marker = `name="${name}" value="`;
  const start = html.indexOf(marker);
  if (start < 0) throw new Error(`Missing ${name} field`);
  const valueStart = start + marker.length;
  const end = html.indexOf('"', valueStart);
  return html.slice(valueStart, end);
}

describe("hosted OAuth HTTP composition", () => {
  it("completes login and resolves services for the verified subject", async () => {
    type Services = { calendarSession: string };
    const root = defineGroup<Services>({
      name: "calendar",
      children: [
        defineCommand<Services>({
          name: "whoami",
          scope: ["mcp"],
          params: S.Object({}),
          handler: async ({ calendarSession }) => calendarSession
        })
      ]
    });
    const connect = vi.fn(async ({ email }: { email: string }) => ({
      accountId: "stable-account-1",
      credential: `session:${email}`
    }));
    const storage = createInMemoryHostedOAuthStorage<string>({ development: true });
    const server = await createHTTPMCPServer(root, {
      name: "calendar-test",
      version: "1.0.0",
      oauth: hostedOAuth<string, Services>({
        publicUrl: "http://127.0.0.1:43210/mcp",
        storage,
        provider: {
          name: "Skylight",
          login: { fields: ["email", "password"] },
          connect,
          async services({ credentials }) {
            return { calendarSession: await credentials.read() };
          }
        }
      })
    });
    const handle = await server.listenHttp({ port: 0 });
    cleanups.push(handle.close);
    const base = new URL(handle.url).origin;

    const health = await nodeFetch(`${base}/healthz`);
    expect(health.status).toBe(200);

    const metadata = await nodeFetch(`${base}/.well-known/oauth-authorization-server`).then(
      (response) => response.json() as Promise<Record<string, string>>
    );
    expect(metadata).toMatchObject({
      issuer: "http://127.0.0.1:43210",
      code_challenge_methods_supported: ["S256"]
    });

    const registration = await nodeFetch(`${base}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redirect_uris: ["https://client.example/callback"],
        token_endpoint_auth_method: "none"
      })
    }).then((response) => response.json() as Promise<{ client_id: string }>);
    const verifier = "a".repeat(43);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const authorize = new URL(`${base}/authorize`);
    authorize.search = new URLSearchParams({
      response_type: "code",
      client_id: registration.client_id,
      redirect_uri: "https://client.example/callback",
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource: "http://127.0.0.1:43210/mcp",
      scope: "mcp offline_access",
      state: "client-state"
    }).toString();
    const login = await nodeFetch(authorize);
    const html = await login.text();
    const cookie = login.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
    const callback = await nodeFetch(`${base}/oauth/connect`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie },
      body: new URLSearchParams({
        transaction: hiddenValue(html, "transaction"),
        csrf: hiddenValue(html, "csrf"),
        email: "user@example.com",
        password: "secret"
      })
    });
    expect(callback.status).toBe(303);
    const callbackUrl = new URL(callback.headers.get("location") ?? "");
    expect(callbackUrl.searchParams.get("state")).toBe("client-state");
    expect(callbackUrl.searchParams.get("iss")).toBe("http://127.0.0.1:43210");

    const tokens = await nodeFetch(`${base}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: callbackUrl.searchParams.get("code") ?? "",
        client_id: registration.client_id,
        redirect_uri: "https://client.example/callback",
        code_verifier: verifier,
        resource: "http://127.0.0.1:43210/mcp"
      })
    }).then(
      (response) => response.json() as Promise<{ access_token: string; refresh_token: string }>
    );
    expect(tokens.refresh_token).toBeTypeOf("string");

    const client = new McpClient({ name: "oauth-client", version: "1.0.0" });
    await client.connect(
      new HttpTransport({
        url: handle.url,
        headers: { authorization: `Bearer ${tokens.access_token}` },
        fetch: nodeFetch
      })
    );
    cleanups.push(() => client.close());
    await expect(
      client.callTool({ name: "calendar__whoami", arguments: {} })
    ).resolves.toMatchObject({
      content: [{ type: "text", text: "session:user@example.com" }]
    });
    expect(connect).toHaveBeenCalledOnce();

    const subject = await storage.resolveSubject("Skylight", "stable-account-1");
    await storage.credentials.delete(subject);
    await expect(client.callTool({ name: "calendar__whoami", arguments: {} })).rejects.toThrow();
  });
});
