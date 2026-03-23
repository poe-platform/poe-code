import { exec } from "node:child_process";
import readline from "node:readline";
import { createOAuthClient } from "poe-oauth";
import { text, log } from "@poe-code/design-system";

export async function resolveApiKeyViaOAuth(): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin
  });

  try {
    const client = createOAuthClient({
      clientId: "client_f520ee4d8ca84a13ba876a8731d264d0",
      openBrowser: (url) =>
        openInBrowser(url).catch(() => {
          log.warn("Could not open browser automatically.");
        }),
      readLine: () =>
        new Promise<string>((resolve) => {
          rl.once("line", (line) => resolve(line));
        })
    });

    const authorization = await client.authorize();

    log.message(`${text.muted("Authorize at")} ${text.link(authorization.authorizationUrl)}`);
    log.message(text.muted("Waiting for authorization. You can also paste the redirect URL here:"));

    const result = await authorization.waitForResult();

    return result.apiKey;
  } finally {
    rl.close();
  }
}

function openInBrowser(url: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const platform = process.platform;
    const command =
      platform === "darwin"
        ? `open "${url}"`
        : platform === "win32"
          ? `start "" "${url}"`
          : `xdg-open "${url}"`;

    exec(command, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}
