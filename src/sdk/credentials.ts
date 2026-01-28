import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const CREDENTIALS_RELATIVE_PATH = ".poe-code/credentials.json";

/**
 * Reads the Poe API key with the following priority:
 * 1. `POE_API_KEY` environment variable (if set)
 * 2. Credentials file (`~/.poe-code/credentials.json`)
 *
 * @returns The API key
 * @throws Error if no credentials found
 */
export async function getPoeApiKey(): Promise<string> {
  const envKey = process.env.POE_API_KEY;
  if (typeof envKey === "string" && envKey.trim().length > 0) {
    return envKey.trim();
  }

  const homeDir = os.homedir();
  const credentialsPath = path.join(homeDir, CREDENTIALS_RELATIVE_PATH);

  try {
    const content = await fs.readFile(credentialsPath, "utf8");
    const parsed = JSON.parse(content);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.apiKey === "string" &&
      parsed.apiKey.length > 0
    ) {
      return parsed.apiKey;
    }
  } catch {
    // File doesn't exist or is invalid
  }

  throw new Error(
    "No API key found. Set POE_API_KEY or run 'poe-code login'."
  );
}
