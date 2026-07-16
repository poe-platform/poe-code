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

/**
 * Local builds (0.0.0-dev and friends) have no meaningful relationship to the
 * published versions, so comparing them only produces noise for contributors.
 */
export function isLocalBuildVersion(version: string): boolean {
  const parsed = semver.parse(version);
  if (!parsed) {
    return true;
  }
  return parsed.prerelease.some((part) => String(part).startsWith("dev"));
}

export async function checkForUpdate(
  options: CheckForUpdateOptions
): Promise<VersionCheckResult | null> {
  const { currentVersion, httpClient } = options;

  if (isLocalBuildVersion(currentVersion)) {
    return null;
  }

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
