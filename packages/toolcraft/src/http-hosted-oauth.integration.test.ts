import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
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

function expectLoginPageSecurity(response: Response, html: string): string {
  const policy = response.headers.get("content-security-policy") ?? "";
  expect(policy).toContain("default-src 'none'");
  expect(policy).toContain("form-action 'self' https://client.example");
  expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  const nonce = /script-src 'nonce-([^']+)'/.exec(policy)?.[1] ?? "";
  expect(nonce).not.toBe("");
  expect(html).toContain(`<script nonce="${nonce}">`);
  return nonce;
}

function expectLoginProgressBehavior(html: string): void {
  const source = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
  expect(source).not.toBe("");

  class FakeElement {}
  class FakeForm extends FakeElement {
    readonly attributes = new Set<string>();
    readonly listeners = new Map<string, () => void>();
    setAttribute(name: string): void {
      this.attributes.add(name);
    }
    removeAttribute(name: string): void {
      this.attributes.delete(name);
    }
    addEventListener(name: string, listener: () => void): void {
      this.listeners.set(name, listener);
    }
  }
  class FakeButton extends FakeElement {
    readonly dataset = { idleLabel: "Connect Skylight" };
    disabled = false;
    textContent = "Connect Skylight";
  }
  class FakeStatus extends FakeElement {
    hidden = true;
  }

  const form = new FakeForm();
  const button = new FakeButton();
  const status = new FakeStatus();
  const pageListeners = new Map<string, () => void>();
  const elements = new Map<string, FakeElement>([
    ["oauth-connect-form", form],
    ["oauth-connect-button", button],
    ["oauth-connect-status", status]
  ]);
  runInNewContext(source, {
    document: { getElementById: (id: string) => elements.get(id) ?? null },
    HTMLFormElement: FakeForm,
    HTMLButtonElement: FakeButton,
    HTMLElement: FakeElement,
    addEventListener: (name: string, listener: () => void) => pageListeners.set(name, listener)
  });

  form.listeners.get("submit")?.();
  expect(form.attributes.has("aria-busy")).toBe(true);
  expect(button.disabled).toBe(true);
  expect(button.textContent).toBe("Connecting…");
  expect(status.hidden).toBe(false);

  pageListeners.get("pageshow")?.();
  expect(form.attributes.has("aria-busy")).toBe(false);
  expect(button.disabled).toBe(false);
  expect(button.textContent).toBe("Connect Skylight");
  expect(status.hidden).toBe(true);
}

async function beginAuthorization(input: {
  base: string;
  resource: string;
  state: string;
}): Promise<{
  clientId: string;
  verifier: string;
  response: Response;
}> {
  const registration = await nodeFetch(`${input.base}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      redirect_uris: ["https://client.example/callback"],
      token_endpoint_auth_method: "none"
    })
  });
  expect(registration.status).toBe(201);
  const { client_id: clientId } = (await registration.json()) as { client_id: string };
  const verifier = "a".repeat(43);
  const authorize = new URL(`${input.base}/authorize`);
  authorize.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: "https://client.example/callback",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    resource: input.resource,
    state: input.state
  }).toString();
  return { clientId, verifier, response: await nodeFetch(authorize) };
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
    const html = await login.text();
    const loginNonce = expectLoginPageSecurity(login, html);
    expect(html).toContain('autocomplete="username"');
    expect(html).toContain('autocomplete="current-password"');
    expect(html).toContain('data-idle-label="Connect Skylight"');
    expect(html).toContain('role="status" aria-live="polite" hidden');
    expect(html).toContain("Signing in… This may take a moment.");
    expectLoginProgressBehavior(html);
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
        password: "not-echoed-secret"
      })
    });
    expect(retry.status).toBe(400);
    const retryHtml = await retry.text();
    const retryNonce = expectLoginPageSecurity(retry, retryHtml);
    expect(retryNonce).not.toBe(loginNonce);
    expect(retryHtml).toContain("Check your credentials and try again.");
    expect(retryHtml).toContain('class="error" role="alert"');
    expect(retryHtml).toContain('value="wrong@example.com"');
    expect(retryHtml).not.toContain("not-echoed-secret");
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

    const expired = await nodeFetch(`${base}/oauth/connect`, {
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
    expect(expired.status).toBe(400);
    expect(expired.headers.get("content-type")).toContain("text/html");
    expect(expired.headers.get("content-security-policy")).toContain("default-src 'none'");
    const expiredHtml = await expired.text();
    expect(expiredHtml).toContain("Connection expired");
    expect(expiredHtml).toContain("return to the app that started the connection");
    expect(expiredHtml).toContain("click Connect again");

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

  it("keeps built-in authorization retryable when credential persistence fails", async () => {
    const resource = "http://127.0.0.1:43210/mcp";
    const storage = createInMemoryHostedOAuthStorage<string>({ development: true });
    const credentialSet = vi
      .spyOn(storage.credentials, "set")
      .mockRejectedValueOnce(new Error("credential write failed"));
    const takeTransaction = vi.spyOn(
      storage.authorizationServer,
      "takeAuthorizationTransaction"
    );
    const putGrant = vi.spyOn(storage.authorizationServer, "putGrant");
    const putCode = vi.spyOn(storage.authorizationServer, "putAuthorizationCode");
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
      name: "credential-failure-test",
      version: "1.0.0",
      oauth: hostedOAuth({
        publicUrl: resource,
        storage,
        provider: {
          name: "Skylight",
          login: { fields: ["email", "password"] },
          async connect() {
            return { accountId: "account-1", credential: "credential-1" };
          },
          services: () => ({})
        }
      })
    });
    const handle = await server.listenHttp({ port: 0 });
    cleanups.push(handle.close);
    const base = new URL(handle.url).origin;
    const authorization = await beginAuthorization({
      base,
      resource,
      state: "credential-failure-state"
    });
    const html = await authorization.response.text();
    const cookie = authorization.response.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
    const transactionId = hiddenValue(html, "transaction");
    const form = new URLSearchParams({
      transaction: transactionId,
      csrf: hiddenValue(html, "csrf"),
      email: "user@example.com",
      password: "secret"
    });

    const failed = await nodeFetch(`${base}/oauth/connect`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie },
      body: form
    });
    expect(failed.status).toBe(400);
    expect(await storage.interactions.get(transactionId)).toBeDefined();
    expect(takeTransaction).not.toHaveBeenCalled();
    expect(putGrant).not.toHaveBeenCalled();
    expect(putCode).not.toHaveBeenCalled();
    const subject = await storage.resolveSubject("Skylight", "account-1");
    expect(await storage.credentials.get(subject)).toBeUndefined();

    const retry = await nodeFetch(`${base}/oauth/connect`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie },
      body: form
    });
    expect(retry.status).toBe(303);
    expect(new URL(retry.headers.get("location") ?? "").searchParams.get("state")).toBe(
      "credential-failure-state"
    );
    expect(credentialSet).toHaveBeenCalledTimes(2);
    expect(takeTransaction).toHaveBeenCalledTimes(1);
    expect(putGrant).toHaveBeenCalledTimes(1);
    expect(putCode).toHaveBeenCalledTimes(1);
    expect(await storage.credentials.get(subject)).toBe("credential-1");
  });

  it("keeps custom-interaction authorization retryable when credential persistence fails", async () => {
    const resource = "http://127.0.0.1:43210/mcp";
    const storage = createInMemoryHostedOAuthStorage<string>({ development: true });
    const credentialSet = vi
      .spyOn(storage.credentials, "set")
      .mockRejectedValueOnce(new Error("credential write failed"));
    const takeTransaction = vi.spyOn(
      storage.authorizationServer,
      "takeAuthorizationTransaction"
    );
    const putGrant = vi.spyOn(storage.authorizationServer, "putGrant");
    const putCode = vi.spyOn(storage.authorizationServer, "putAuthorizationCode");
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
      name: "custom-credential-failure-test",
      version: "1.0.0",
      oauth: hostedOAuth({
        publicUrl: resource,
        storage,
        provider: {
          name: "Skylight",
          services: () => ({})
        },
        advanced: {
          interaction: {
            paths: ["/oauth/provider/callback"],
            start: ({ transaction }) => Response.json({ transactionId: transaction.id }),
            async handle({ request, complete }) {
              const { transactionId } = (await request.json()) as { transactionId: string };
              return complete({
                transactionId,
                accountId: "account-1",
                credential: "credential-1"
              });
            }
          }
        }
      })
    });
    const handle = await server.listenHttp({ port: 0 });
    cleanups.push(handle.close);
    const base = new URL(handle.url).origin;
    const authorization = await beginAuthorization({
      base,
      resource,
      state: "custom-credential-failure-state"
    });
    const { transactionId } = (await authorization.response.json()) as {
      transactionId: string;
    };
    const callbackRequest = {
      method: "POST",
      redirect: "manual" as const,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transactionId })
    };

    const failed = await nodeFetch(`${base}/oauth/provider/callback`, callbackRequest);
    expect(failed.status).toBe(500);
    expect(await storage.interactions.get(transactionId)).toBeDefined();
    expect(takeTransaction).not.toHaveBeenCalled();
    expect(putGrant).not.toHaveBeenCalled();
    expect(putCode).not.toHaveBeenCalled();
    const subject = await storage.resolveSubject("Skylight", "account-1");
    expect(await storage.credentials.get(subject)).toBeUndefined();

    const retry = await nodeFetch(`${base}/oauth/provider/callback`, callbackRequest);
    expect(retry.status).toBe(303);
    expect(new URL(retry.headers.get("location") ?? "").searchParams.get("state")).toBe(
      "custom-credential-failure-state"
    );
    expect(credentialSet).toHaveBeenCalledTimes(2);
    expect(takeTransaction).toHaveBeenCalledTimes(1);
    expect(putGrant).toHaveBeenCalledTimes(1);
    expect(putCode).toHaveBeenCalledTimes(1);
    expect(await storage.credentials.get(subject)).toBe("credential-1");
  });

  it("reports hosted storage health without exposing failure details", async () => {
    const resource = "http://127.0.0.1:43210/mcp";
    const health = { failure: undefined as Error | undefined };
    const healthCheck = vi.fn(async () => {
      if (health.failure !== undefined) throw health.failure;
    });
    const storage = {
      ...createInMemoryHostedOAuthStorage<string>({ development: true }),
      healthCheck
    };
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
      name: "storage-health-test",
      version: "1.0.0",
      oauth: hostedOAuth({
        publicUrl: resource,
        storage,
        provider: {
          name: "Skylight",
          login: { fields: ["apiKey"] },
          async connect() {
            return { accountId: "account-1", credential: "credential-1" };
          },
          services: () => ({})
        }
      })
    });
    const handle = await server.listenHttp({ port: 0 });
    cleanups.push(handle.close);
    const healthUrl = new URL("/healthz", handle.url);

    const healthy = await nodeFetch(healthUrl);
    expect(healthy.status).toBe(200);
    await expect(healthy.json()).resolves.toEqual({ ok: true });
    expect(healthCheck).toHaveBeenCalledTimes(1);

    health.failure = new Error("redis password must never appear");
    const unhealthy = await nodeFetch(healthUrl);
    expect(unhealthy.status).toBe(503);
    const unhealthyBody = await unhealthy.text();
    expect(JSON.parse(unhealthyBody)).toEqual({ ok: false });
    expect(unhealthyBody).not.toContain(health.failure.message);
    expect(healthCheck).toHaveBeenCalledTimes(2);
  });
});
