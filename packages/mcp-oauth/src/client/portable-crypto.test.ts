import { build } from "esbuild";
import { createContext, runInContext } from "node:vm";
import { webcrypto } from "node:crypto";
import { expect, it } from "vitest";

it("runs shared OAuth helpers without Node imports or globals", async () => {
  const result = await build({
    stdin: { contents: 'export * from "./pkce.js"; export * from "./authorization-state.js";', resolveDir: new URL(".", import.meta.url).pathname },
    bundle: true, platform: "browser", format: "iife", globalName: "oauth", write: false, logLevel: "silent"
  });
  const context = createContext({ crypto: webcrypto, TextEncoder, TextDecoder, btoa, atob });
  runInContext(result.outputFiles[0]!.text, context);
  expect(runInContext('oauth.generateCodeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")', context))
    .toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  expect(runInContext('oauth.generateCodeVerifier().length', context)).toBe(43);
  expect(runInContext('oauth.generateCodeVerifier() !== oauth.generateCodeVerifier()', context)).toBe(true);
  expect(runInContext('oauth.parseAuthorizationState(oauth.createAuthorizationState({issuer: "https://example.com/é", requireIssuer: true}))', context))
    .toEqual({ issuer: "https://example.com/é", requireIssuer: true });
  expect(runInContext('oauth.parseAuthorizationState("invalid!")', context)).toBeNull();
});
