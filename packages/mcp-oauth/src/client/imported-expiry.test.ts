import { expect, it, vi } from "vitest";
import { createDefaultOAuthClientProvider } from "./default-oauth-client-provider.js";
import type { DefaultOAuthClientProviderOptions } from "./types.js";
const resource = "https://resource.example/mcp";
function fixture(expiry: Record<string, unknown>, current = 1000) {
  let now = current;
  const fetch = vi.fn(async () => Response.json({}));
  const provider = createDefaultOAuthClientProvider({ client: { mode: "static", clientId: "original" }, browser: {},
    now: () => now, initialGrant: { resource, tokens: { accessToken: "private-access", refreshToken: "private-refresh", tokenType: "Bearer", ...expiry } } as
      DefaultOAuthClientProviderOptions["initialGrant"], sessionStore: { load: async () => null, save: async () => {}, clear: async () => {} } });
  return { fetch, clock: (value: number) => { now = value; }, authorize: async () => {
    const headers = new Headers(); const grant = await provider.authorizeRequest!({ requestUrl: new URL(resource), headers, fetch }); return { headers, grant };
  } };
}
it("anchors a relative lifetime at import instead of immediately redeeming a fresh refresh token", async () => {
  const f = fixture({ expiresIn: 3600 });
  expect((await f.authorize()).grant).toMatchObject({ expiresAt: 3_601_000 });
  f.clock(2_000_000);
  expect((await f.authorize()).grant).toMatchObject({ expiresAt: 3_601_000 });
  f.clock(3_601_000);
  expect((await f.authorize()).headers.has("Authorization")).toBe(false);
  expect(f.fetch).not.toHaveBeenCalled();
});
it("uses original issuance time for a delayed relative-only import", async () => {
  const f = fixture({ expiresIn: 3600, issuedAt: 1000 }, 3_301_000);
  expect((await f.authorize()).grant).toMatchObject({ expiresAt: 3_601_000 });
});
it("retains a delayed import's absolute expiry despite a relative lifetime", async () => {
  const f = fixture({ expiresAt: 301_000, expiresIn: 3600 });
  expect((await f.authorize()).grant).toMatchObject({ expiresAt: 301_000 });
  f.clock(301_000); expect((await f.authorize()).headers.has("Authorization")).toBe(false);
});
it("accepts omitted expiry as unknown without inventing a lifetime", async () => {
  expect((await fixture({}).authorize()).grant).toMatchObject({ expiresAt: null });
});
it("derives an absolute expiry when an unknown expiry accompanies a relative lifetime", async () => {
  expect((await fixture({ expiresAt: null, expiresIn: 3600 }).authorize()).grant).toMatchObject({ expiresAt: 3_601_000 });
});
it("never revives an already expired absolute grant using its old lifetime", async () => {
  expect((await fixture({ expiresAt: 0, expiresIn: 3600 }).authorize()).headers.has("Authorization")).toBe(false);
});
it.each([
  { expiresIn: -1 }, { expiresIn: 1.5 }, { expiresIn: "3600" }, { expiresIn: Infinity },
  { expiresIn: 8_640_000_000_001 }, { expiresIn: 3600, issuedAt: NaN }, { expiresIn: 3600, issuedAt: null }
])("rejects unsafe relative import expiry before provider creation: %#", invalid => {
  expect(() => fixture({ expiresAt: null, ...invalid })).toThrow("initial grant");
});
