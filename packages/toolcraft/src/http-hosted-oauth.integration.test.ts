import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { S } from "toolcraft-schema";
import { HttpTransport, McpClient } from "tiny-mcp-client";
import { nodeFetch } from "tiny-http-mcp-server/test-support";
import { defineCommand, defineGroup } from "./index.js";
import { createHTTPMCPServer, runHTTPMCP } from "./http.js";
import {
  createInMemoryHostedOAuthStorage,
  hostedOAuth,
  HostedOAuthLoginError
} from "./http-hosted-oauth.js";

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
  it("rejects a listen path that conflicts with the canonical public URL", async () => {
    const root = defineGroup({
      name: "calendar",
      children: [
        defineCommand({
          name: "ping",
          scope: ["mcp"],
          params: S.Object({}),
          handler: () => "pong"
        })
      ]
    });
    const server = await createHTTPMCPServer(root, {
      name: "calendar-test",
      version: "1.0.0",
      oauth: hostedOAuth({
        publicUrl: "http://127.0.0.1:43210/tenant/mcp",
        storage: createInMemoryHostedOAuthStorage({ development: true }),
        provider: {
          name: "Skylight",
          login: { fields: ["apiKey"] },
          async connect() {
            return { accountId: "account", credential: "credential" };
          },
          services() {
            return {};
          }
        }
      })
    });

    await expect(server.listenHttp({ port: 0, path: "/other" })).rejects.toThrow(
      /conflicts with publicUrl path/i
    );
  });

  it("completes login and resolves services for the verified subject", async () => {
    const publicResource = "http://127.0.0.1:43210/tenant/mcp";
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
    const connect = vi.fn(async ({ email }: { email: string }) => {
      if (email === "wrong@example.com") {
        throw new HostedOAuthLoginError("Check your credentials and try again.");
      }
      return {
        accountId: "stable-account-1",
        credential: `session:${email}`
      };
    });
    const storage = createInMemoryHostedOAuthStorage<string>({ development: true });
    const serviceIdentities: unknown[] = [];
    const handle = await runHTTPMCP(root, {
      name: "calendar-test",
      version: "1.0.0",
      port: 0,
      oauth: hostedOAuth<string, Services>({
        publicUrl: publicResource,
        storage,
        provider: {
          name: "Skylight",
          login: { fields: ["email", "password"] },
          connect,
          async services({ credentials, identity }) {
            serviceIdentities.push(identity);
            return { calendarSession: await credentials.read() };
          }
        }
      })
    });
    cleanups.push(handle.close);
    expect(new URL(handle.url).pathname).toBe("/tenant/mcp");
    const base = new URL(handle.url).origin;

    const health = await nodeFetch(`${base}/healthz`);
    expect(health.status).toBe(200);

    const rootResourceMetadata = await nodeFetch(`${base}/.well-known/oauth-protected-resource`);
    const pathResourceMetadata = await nodeFetch(
      `${base}/.well-known/oauth-protected-resource/tenant/mcp`
    );
    expect(rootResourceMetadata.status).toBe(200);
    expect(pathResourceMetadata.status).toBe(200);
    await expect(rootResourceMetadata.json()).resolves.toEqual(await pathResourceMetadata.json());

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
      resource: publicResource,
      state: "client-state"
    }).toString();
    const login = await nodeFetch(authorize);
    expect(login.headers.get("content-security-policy")).toContain(
      "form-action 'self' https://client.example"
    );
    const html = await login.text();
    const cookie = login.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
    const secondAuthorize = new URL(authorize);
    secondAuthorize.searchParams.set("state", "second-state");
    const secondLogin = await nodeFetch(secondAuthorize);
    const secondHtml = await secondLogin.text();
    const secondCookie = secondLogin.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
    expect(secondCookie.split("=", 1)[0]).not.toBe(cookie.split("=", 1)[0]);
    const browserCookies = `${secondCookie}; ${cookie}`;
    const retry = await nodeFetch(`${base}/oauth/connect`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: browserCookies },
      body: new URLSearchParams({
        transaction: hiddenValue(html, "transaction"),
        csrf: hiddenValue(html, "csrf"),
        email: "wrong@example.com",
        password: "wrong"
      })
    });
    expect(retry.status).toBe(400);
    expect(retry.headers.get("content-security-policy")).toContain(
      "form-action 'self' https://client.example"
    );
    const retryHtml = await retry.text();
    expect(retryHtml).toContain("Check your credentials and try again.");
    const callback = await nodeFetch(`${base}/oauth/connect`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: browserCookies },
      body: new URLSearchParams({
        transaction: hiddenValue(retryHtml, "transaction"),
        csrf: hiddenValue(retryHtml, "csrf"),
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
        resource: publicResource
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
    expect(serviceIdentities[0]).toMatchObject({
      issuer: "http://127.0.0.1:43210",
      clientId: registration.client_id,
      scopes: ["mcp", "offline_access"],
      resource: publicResource
    });
    expect(connect).toHaveBeenCalledTimes(2);

    const subject = await storage.resolveSubject("Skylight", "stable-account-1");
    await storage.credentials.delete(subject);
    await expect(client.callTool({ name: "calendar__whoami", arguments: {} })).rejects.toThrow();

    const secondCallback = await nodeFetch(`${base}/oauth/connect`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: browserCookies },
      body: new URLSearchParams({
        transaction: hiddenValue(secondHtml, "transaction"),
        csrf: hiddenValue(secondHtml, "csrf"),
        email: "second@example.com",
        password: "secret"
      })
    });
    expect(secondCallback.status).toBe(303);
    expect(new URL(secondCallback.headers.get("location") ?? "").searchParams.get("state")).toBe(
      "second-state"
    );
    expect(connect).toHaveBeenCalledTimes(3);
  });
});
