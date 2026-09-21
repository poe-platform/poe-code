import { expect, it } from "vitest";
import { nodeFetch } from "tiny-http-mcp-server/testing";
import { installInMemoryHttp } from "tiny-http-mcp-server/test-support";
import { createLoopbackAuthorizationSession, extractCodeFromInput } from "../index.js";

installInMemoryHttp();

it.each(["code", "state", "iss", "error", "error_description", "error_uri"]
  .flatMap(parameter => ["http", "manual"].map(mode => ({ parameter, mode }))))(
  "rejects repeated OAuth callback $parameter in $mode input without echoing values", async ({ parameter, mode }) => {
    const callback = new URL("http://127.0.0.1/callback?state=expected-state");
    if (parameter.startsWith("error")) {
      callback.searchParams.set("error", "access_denied");
      callback.searchParams.set("error_description", "original description");
      callback.searchParams.set("error_uri", "https://auth.example/original");
    } else callback.searchParams.set("code", "005930");
    if (parameter === "iss") callback.searchParams.set("iss", "https://auth.example");
    callback.searchParams.append(parameter, "private-reflected-second-value");
    const session = await createLoopbackAuthorizationSession(mode === "manual" ? { readLine: async () => callback.href } : {});
    const pending = session.waitForCode("https://auth.example/authorize?state=expected-state").catch(error => error);
    const message = `OAuth callback parameter '${parameter}' must occur only once`;
    try {
      if (mode === "http") {
        const incoming = new URL(session.redirectUri); incoming.search = callback.search;
        const response = await nodeFetch(incoming.href);
        expect(response.status).toBe(400);
        expect(await response.text()).toBe(message);
      }
      expect((await pending).message).toBe(message);
      expect(message).not.toContain("private-");
    } finally { session.close(); await pending; }
  }
);

it("returns null when extracting a code from an ambiguous callback URL", () => {
  expect(extractCodeFromInput("http://127.0.0.1/callback?code=005930&code=005931")).toBeNull();
});

it("ignores repeated unrecognized callback extension fields", async () => {
  const callback = "http://127.0.0.1/callback?state=expected-state&code=005930&extension=one&extension=two";
  const session = await createLoopbackAuthorizationSession({ readLine: async () => callback });
  try {
    expect(await session.waitForCode("https://auth.example/authorize?state=expected-state")).toBe("005930");
    expect(extractCodeFromInput(callback)).toBe("005930");
  } finally { session.close(); }
});
