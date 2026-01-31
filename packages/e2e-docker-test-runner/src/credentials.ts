import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export function getApiKey(): string | null {
  // Check environment variables first
  const envKey = process.env.POE_API_KEY ?? process.env.POE_CODE_API_KEY;
  if (envKey) {
    return envKey;
  }

  // Check credentials file
  const credentialsPath = join(homedir(), '.poe-code', 'credentials.json');
  if (existsSync(credentialsPath)) {
    try {
      const content = readFileSync(credentialsPath, 'utf-8');
      const credentials = JSON.parse(content);
      if (credentials.apiKey) {
        return credentials.apiKey;
      }
    } catch {
      // Ignore parse errors
    }
  }

  return null;
}

export function hasApiKey(): boolean {
  return getApiKey() !== null;
}
