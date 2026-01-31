import { describe, it, expect, vi } from "vitest";
import {
  checkForUpdate,
  type VersionCheckResult
} from "./version.js";
import type { HttpClient } from "../cli/http.js";

function createMockHttpClient(
  response: { ok: boolean; status: number; json: () => Promise<unknown> } | Error
): HttpClient {
  return vi.fn(async () => {
    if (response instanceof Error) {
      throw response;
    }
    return response;
  });
}

describe("version service", () => {
  describe("checkForUpdate", () => {
    it("returns update available when registry version is newer", async () => {
      const httpClient = createMockHttpClient({
        ok: true,
        status: 200,
        json: async () => ({ "dist-tags": { latest: "2.0.0" } })
      });

      const result = await checkForUpdate({
        currentVersion: "1.0.0",
        httpClient
      });

      expect(result).toEqual<VersionCheckResult>({
        currentVersion: "1.0.0",
        latestVersion: "2.0.0",
        updateAvailable: true
      });
      expect(httpClient).toHaveBeenCalledWith(
        "https://registry.npmjs.org/poe-code",
        expect.objectContaining({ method: "GET" })
      );
    });

    it("returns no update when versions match", async () => {
      const httpClient = createMockHttpClient({
        ok: true,
        status: 200,
        json: async () => ({ "dist-tags": { latest: "1.0.0" } })
      });

      const result = await checkForUpdate({
        currentVersion: "1.0.0",
        httpClient
      });

      expect(result).toEqual<VersionCheckResult>({
        currentVersion: "1.0.0",
        latestVersion: "1.0.0",
        updateAvailable: false
      });
    });

    it("returns no update when current version is newer", async () => {
      const httpClient = createMockHttpClient({
        ok: true,
        status: 200,
        json: async () => ({ "dist-tags": { latest: "1.0.0" } })
      });

      const result = await checkForUpdate({
        currentVersion: "2.0.0",
        httpClient
      });

      expect(result).toEqual<VersionCheckResult>({
        currentVersion: "2.0.0",
        latestVersion: "1.0.0",
        updateAvailable: false
      });
    });

    it("returns null when http request fails", async () => {
      const httpClient = createMockHttpClient(new Error("Network error"));

      const result = await checkForUpdate({
        currentVersion: "1.0.0",
        httpClient
      });

      expect(result).toBeNull();
    });

    it("returns null when response is not ok", async () => {
      const httpClient = createMockHttpClient({
        ok: false,
        status: 404,
        json: async () => ({})
      });

      const result = await checkForUpdate({
        currentVersion: "1.0.0",
        httpClient
      });

      expect(result).toBeNull();
    });

    it("returns null when response has invalid structure", async () => {
      const httpClient = createMockHttpClient({
        ok: true,
        status: 200,
        json: async () => ({ unexpected: "structure" })
      });

      const result = await checkForUpdate({
        currentVersion: "1.0.0",
        httpClient
      });

      expect(result).toBeNull();
    });

    it("returns null when latest version is not valid semver", async () => {
      const httpClient = createMockHttpClient({
        ok: true,
        status: 200,
        json: async () => ({ "dist-tags": { latest: "not-a-version" } })
      });

      const result = await checkForUpdate({
        currentVersion: "1.0.0",
        httpClient
      });

      expect(result).toBeNull();
    });

    it("handles dev version correctly", async () => {
      const httpClient = createMockHttpClient({
        ok: true,
        status: 200,
        json: async () => ({ "dist-tags": { latest: "1.0.0" } })
      });

      const result = await checkForUpdate({
        currentVersion: "0.0.0-dev",
        httpClient
      });

      expect(result).toEqual<VersionCheckResult>({
        currentVersion: "0.0.0-dev",
        latestVersion: "1.0.0",
        updateAvailable: true
      });
    });
  });
});
