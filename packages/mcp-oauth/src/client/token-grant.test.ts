import { expect, it } from "vitest";
import { parseOAuthTokenGrant } from "../index.js";

const raw = { access_token: "private-access", refresh_token: "private-refresh", token_type: "bEaReR", scope: "read  write read" };
it("imports a raw Bearer response with normalized scopes and unknown expiry", () => {
  expect(parseOAuthTokenGrant(raw)).toEqual({ accessToken: "private-access", refreshToken: "private-refresh", tokenType: "Bearer", expiresAt: null, scope: "read write" });
});
it("anchors relative expiry at import or an explicit original issuance time", () => {
  expect(parseOAuthTokenGrant({ ...raw, expires_in: 3600 }, { now: () => 10_000 }).expiresAt).toBe(3_610_000);
  expect(parseOAuthTokenGrant({ ...raw, expires_in: 3600 }, { issuedAt: 1000, now: () => 10_000 }).expiresAt).toBe(3_601_000);
});
it("uses absolute milliseconds or upstream absolute seconds ahead of relative expiry", () => {
  expect(parseOAuthTokenGrant({ ...raw, expires_in: 3600 }, { expiresAt: 0, now: () => 10_000 }).expiresAt).toBe(0);
  expect(parseOAuthTokenGrant({ ...raw, expires_at: 5, expires_in: 3600 }).expiresAt).toBe(5000);
  expect(parseOAuthTokenGrant({ ...raw, expires_at: 5 }, { expiresAt: 7 }).expiresAt).toBe(7);
  expect(parseOAuthTokenGrant({ ...raw, expiresAt: 3, expires_at: 5, expires_in: 3600 }).expiresAt).toBe(3);
});
it("copies imported fields without retaining caller objects", () => {
  const input = { ...raw }; const result = parseOAuthTokenGrant(input);
  input.access_token = "mutated";
  expect(result.accessToken).toBe("private-access");
});
it.each([
  { access_token: "" }, { access_token: "secret\nvalue" }, { token_type: "Basic" },
  { refresh_token: false }, { refresh_token: "" }, { scope: "secret\nvalue" },
  { expires_in: -1 }, { expires_in: 0.1 }, { expires_in: Number.MAX_SAFE_INTEGER },
  { expiresAt: "5" }, { expiresAt: Infinity }, { expires_at: "5" }, { expires_at: Infinity }, { expires_at: Number.MAX_SAFE_INTEGER },
  { extension: () => "secret" }, { extension: new Date() }, { extension: "x".repeat(65_536) }
])("rejects malformed or oversized input without exposing credentials: %#", change => {
  expect(() => parseOAuthTokenGrant({ ...raw, ...change })).toThrow("Invalid OAuth token grant");
});
it.each([{ expiresAt: NaN }, { expiresAt: -8_640_000_000_000_001 }, { issuedAt: NaN }, { issuedAt: 8_640_000_000_000_001 }])("rejects malformed external expiry options: %#", options => {
  expect(() => parseOAuthTokenGrant({ ...raw, expires_in: 1 }, options)).toThrow("Invalid OAuth token grant");
});
it("does not run credential accessors or custom serialization", () => {
  let touched = false;
  const input = { ...raw, get extension() { touched = true; throw new Error("private-marker"); } };
  expect(() => parseOAuthTokenGrant(input)).toThrow("Invalid OAuth token grant");
  expect(touched).toBe(false);
});
it("bounds cyclic and excessively deep imported JSON", () => {
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  let deep: unknown = null;
  for (let index = 0; index < 70; index++) deep = { deep };
  for (const extension of [cyclic, deep]) expect(() => parseOAuthTokenGrant({ ...raw, extension })).toThrow("Invalid OAuth token grant");
});
it("permits explicit unlimited expiry while validating supplied relative data", () => {
  expect(parseOAuthTokenGrant(raw, { expiresAt: null })).toMatchObject({ expiresAt: null });
  expect(parseOAuthTokenGrant({ ...raw, expires_in: 0 }, { now: () => 10_000 })).toMatchObject({ expiresAt: 10_000 });
  expect(() => parseOAuthTokenGrant({ ...raw, expires_in: -1 }, { expiresAt: 0 })).toThrow("Invalid OAuth token grant");
});

it("captures timing options before its host clock can replace the validated absolute expiry", () => {
  const options = { expiresAt: undefined as number | undefined, now: () => { options.expiresAt = Infinity; return 1000; } };
  expect(parseOAuthTokenGrant({ access_token: "private-access", token_type: "Bearer", expires_in: 60 }, options))
    .toEqual({ accessToken: "private-access", tokenType: "Bearer", expiresAt: 61_000 });
});


it.each([undefined, 0])("rejects an out-of-range issuance clock even when its lifetime produces a valid date: absolute=%s", expiresAt => {
  expect(() => parseOAuthTokenGrant({ ...raw, expires_in: 1 }, { expiresAt, now: () => -8_640_000_000_001_000 }))
    .toThrow(new Error("Invalid OAuth token grant"));
});

it("retains the valid negative Date boundary as an issuance clock", () => {
  expect(parseOAuthTokenGrant({ ...raw, expires_in: 1 }, { now: () => -8_640_000_000_000_000 }).expiresAt)
    .toBe(-8_639_999_999_999_000);
});

it.each([undefined, null])("rejects a host clock's nonnumeric relative anchor: %s", timestamp => {
  expect(() => parseOAuthTokenGrant({ ...raw, expires_in: 1 }, { now: () => timestamp as unknown as number }))
    .toThrow(new Error("Invalid OAuth token grant"));
});

it.each(["expiresAt", "issuedAt", "now"] as const)("validates hidden native import timing option %s", field => {
  const options = { expiresAt: field === "expiresAt" ? Infinity : undefined, issuedAt: field === "issuedAt" ? Infinity : undefined,
    now: () => field === "now" ? NaN : 1000 };
  Object.defineProperty(options, field, { enumerable: false });
  expect(() => parseOAuthTokenGrant({ ...raw, expires_in: 1 }, options)).toThrow("Invalid OAuth token grant");
});
it.each(["expiresAt", "issuedAt"] as const)("retains valid hidden zero %s", field => {
  const options = { [field]: 0, now: () => 1000 };
  Object.defineProperty(options, field, { enumerable: false });
  expect(parseOAuthTokenGrant({ ...raw, expires_in: 1 }, options).expiresAt).toBe(field === "expiresAt" ? 0 : 1000);
});
it("retains the original private receiver for a native import clock", () => {
  class Host { #timestamp = 1000; now() { return this.#timestamp; } }
  expect(parseOAuthTokenGrant({ ...raw, expires_in: 1 }, new Host()).expiresAt).toBe(2000);
});
