import { describe, expect, it, vi } from "vitest";
import type { HttpClient } from "../cli/http.js";
import { checkForUpdate } from "./version.js";

function createHttpClient(latestVersion: string): HttpClient {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ "dist-tags": { latest: latestVersion } })
  }));
}

describe("checkForUpdate", () => {
  it("reports an available update for a published version", async () => {
    await expect(
      checkForUpdate({ currentVersion: "3.9.0", httpClient: createHttpClient("4.0.0") })
    ).resolves.toEqual({
      currentVersion: "3.9.0",
      latestVersion: "4.0.0",
      updateAvailable: true
    });
  });

  it("reports no update when the current version is latest", async () => {
    await expect(
      checkForUpdate({ currentVersion: "4.0.0", httpClient: createHttpClient("4.0.0") })
    ).resolves.toMatchObject({ updateAvailable: false });
  });

  it.each(["0.0.0-dev", "0.0.0-dev.3", "4.1.0-dev.a1b2c3d"])(
    "skips the check for the %s build without querying the registry",
    async (currentVersion) => {
      const httpClient = createHttpClient("4.0.0");

      await expect(checkForUpdate({ currentVersion, httpClient })).resolves.toBeNull();
      expect(httpClient).not.toHaveBeenCalled();
    }
  );

  it("skips the check for an unparseable local version", async () => {
    const httpClient = createHttpClient("4.0.0");

    await expect(
      checkForUpdate({ currentVersion: "local build", httpClient })
    ).resolves.toBeNull();
    expect(httpClient).not.toHaveBeenCalled();
  });

  it("returns null when the registry response is not ok", async () => {
    const httpClient: HttpClient = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({})
    }));

    await expect(checkForUpdate({ currentVersion: "4.0.0", httpClient })).resolves.toBeNull();
  });
});
