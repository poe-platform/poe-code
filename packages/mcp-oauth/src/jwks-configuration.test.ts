import { expect, it } from "vitest";
import { createJwksTokenVerifier, type JwksTokenVerifierOptions } from "./index.js";

it.each(["ftp://127.0.0.1/keys", "file:///keys", "https://user:secret@auth.example/keys", "http://user:secret@127.0.0.1/keys"])("rejects unsafe JWKS endpoint %s", (jwksUrl) => {
  expect(() => createJwksTokenVerifier({ jwksUrl, allowInsecureJwks: true })).toThrow("jwksUrl must be an HTTP or HTTPS URL without credentials");
});

it.each(["jwksCacheTtlMs", "jwksRefreshCooldownMs"] as const)("rejects invalid %s", (key) => {
  for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => createJwksTokenVerifier({ jwksUrl: "https://auth.example/keys", [key]: value })).toThrow(`${key} must be a non-negative safe integer`);
  }
});

it("rejects timeouts that cannot provide the configured deadline", () => {
  for (const value of [0, -1, 0.5, NaN, Infinity, 2_147_483_648]) {
    expect(() => createJwksTokenVerifier({ jwksUrl: "https://auth.example/keys", jwksFetchTimeoutMs: value })).toThrow("jwksFetchTimeoutMs must be a positive integer");
  }
});

it("rejects clock skew that disables token expiration checks", () => {
  for (const value of [-1, NaN, Infinity]) {
    expect(() => createJwksTokenVerifier({ jwksUrl: "https://auth.example/keys", clockSkewSeconds: value })).toThrow("clockSkewSeconds must be a finite non-negative number");
  }
});

it("accepts zero cache/cooldown/skew and fractional finite clock tolerance", () => {
  const options: JwksTokenVerifierOptions = { jwksUrl: "https://auth.example/keys", jwksCacheTtlMs: 0, jwksRefreshCooldownMs: 0, clockSkewSeconds: 0 };
  expect(() => createJwksTokenVerifier(options)).not.toThrow();
  expect(() => createJwksTokenVerifier({ ...options, clockSkewSeconds: 0.5 })).not.toThrow();
});
