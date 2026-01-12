import semver from "semver";
import type { HttpClient } from "../cli/http.js";

export interface VersionCheckResult {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
}

export interface CheckForUpdateOptions {
  currentVersion: string;
  httpClient: HttpClient;
}

interface NpmRegistryResponse {
  "dist-tags"?: {
    latest?: string;
  };
}

export async function checkForUpdate(
  options: CheckForUpdateOptions
): Promise<VersionCheckResult | null> {
  const { currentVersion, httpClient } = options;

  try {
    const response = await httpClient("https://registry.npmjs.org/poe-code", {
      method: "GET",
      headers: { Accept: "application/json" }
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as NpmRegistryResponse;
    const latestVersion = data?.["dist-tags"]?.latest;

    if (typeof latestVersion !== "string" || !semver.valid(latestVersion)) {
      return null;
    }

    const updateAvailable = semver.gt(latestVersion, currentVersion);

    return {
      currentVersion,
      latestVersion,
      updateAvailable
    };
  } catch {
    return null;
  }
}
