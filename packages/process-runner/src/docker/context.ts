import { execSync } from "node:child_process";
import type { Engine } from "../types.js";

interface ColimaProfile {
  name?: string;
  profile?: string;
  status?: string;
  runtime?: string;
}

export function detectContext(): string | null {
  try {
    const output = execSync("colima list --json", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"]
    });
    const lines = output.trim().split("\n").filter(Boolean);

    for (const line of lines) {
      const profile = JSON.parse(line) as ColimaProfile;

      if (profile.status === "Running" && profile.runtime === "docker") {
        const name = profile.name ?? profile.profile;

        if (!name) {
          continue;
        }

        return name === "default" ? "colima" : `colima-${name}`;
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function buildContextArgs(engine: Engine, context: string | null): string[] {
  if (engine === "docker" && context) {
    return ["--context", context];
  }

  return [];
}
