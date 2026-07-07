import "../vitest.setup.js";
import http from "node:http";
import { describe, expect, it } from "vitest";
import { createInMemoryTokenVerifier, nodeFetch } from "./testing.js";

const VERIFY_INPUT = {
  token: "token",
  resource: "https://resource.example/mcp",
  authorizationServers: ["https://issuer.example"],
  requiredScopes: ["mcp.read"]
};

describe("testing helpers", () => {
  it("does not let custom claims override verified standard claims", async () => {
    const issued = createInMemoryTokenVerifier({ now: () => 10 });
    issued.issueToken({
      token: "token",
      issuer: "https://issuer.example",
      audience: ["https://resource.example/mcp"],
      scopes: ["mcp.read"],
      expiresAt: 100,
      claims: {
        iss: "https://forged.example",
        aud: "https://forged.example/resource",
        scope: "admin",
        exp: 1
      }
    });

    await expect(issued.verifier.verify(VERIFY_INPUT)).resolves.toMatchObject({
      claims: {
        iss: "https://issuer.example",
        aud: "https://resource.example/mcp",
        scope: "mcp.read",
        exp: 100
      }
    });
  });

  it("rejects duplicate explicit token identifiers", () => {
    const issued = createInMemoryTokenVerifier({ now: () => 10 });
    issued.issueToken({
      token: "token",
      issuer: "https://issuer.example",
      audience: ["https://resource.example/mcp"],
      scopes: ["mcp.read"],
      expiresAt: 100
    });

    expect(() =>
      issued.issueToken({
        token: "token",
        issuer: "https://issuer.example",
        audience: ["https://resource.example/mcp"],
        scopes: ["mcp.write"],
        expiresAt: 100
      })
    ).toThrow("Token has already been issued: token");
  });

  it("returns isolated nested verified claims", async () => {
    const issued = createInMemoryTokenVerifier({ now: () => 10 });
    issued.issueToken({
      token: "token",
      issuer: "https://issuer.example",
      audience: ["https://resource.example/mcp"],
      scopes: ["mcp.read"],
      expiresAt: 100,
      claims: { profile: { role: "reader" } }
    });

    const first = await issued.verifier.verify(VERIFY_INPUT);
    (first.claims.profile as { role: string }).role = "admin";
    const second = await issued.verifier.verify(VERIFY_INPUT);

    expect(second.claims.profile).toEqual({ role: "reader" });
  });

  it("sends URLSearchParams request bodies", async () => {
    let body = "";
    const server = http.createServer((request, response) => {
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        response.writeHead(204);
        response.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Missing address");

    try {
      await nodeFetch(`http://127.0.0.1:${address.port}/submit`, {
        method: "POST",
        body: new URLSearchParams({ code: "expected" })
      });
      expect(body).toBe("code=expected");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });

  it("preserves multiple Set-Cookie response headers", async () => {
    const server = http.createServer((_request, response) => {
      response.setHeader("Set-Cookie", ["first=one; Path=/", "second=two; Path=/"]);
      response.end("ok");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Missing address");

    try {
      const response = await nodeFetch(`http://127.0.0.1:${address.port}/cookies`);
      expect(response.headers.getSetCookie()).toEqual(["first=one; Path=/", "second=two; Path=/"]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});
