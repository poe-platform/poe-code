import { exec } from "node:child_process";
import readline from "node:readline";
import type { Readable } from "node:stream";
import { createOAuthClient } from "poe-oauth";
import { text, log, spinner } from "toolcraft-design";

export interface OAuthLoginOptions {
  tokenEndpoint?: string;
}

interface OAuthLoginDependencies {
  input?: Readable;
  openBrowser?: (url: string) => Promise<void>;
}

export async function resolveApiKeyViaOAuth(
  options: OAuthLoginOptions = {},
  dependencies: OAuthLoginDependencies = {}
): Promise<string> {
  const rl = readline.createInterface({
    input: dependencies.input ?? process.stdin
  });
  let inputClosed = false;
  let browserFailed = false;
  let channelFailureReject: ((error: Error) => void) | undefined;
  const channelFailure = new Promise<never>((_, reject) => {
    channelFailureReject = reject;
  });
  const failIfUnavailable = () => {
    if (inputClosed && browserFailed) {
      channelFailureReject?.(
        new Error("No OAuth authorization channel is available: browser launch failed and stdin is closed.")
      );
    }
  };
  rl.once("close", () => {
    inputClosed = true;
    failIfUnavailable();
  });

  try {
    const client = createOAuthClient({
      clientId: "client_f520ee4d8ca84a13ba876a8731d264d0",
      tokenEndpoint: options.tokenEndpoint,
      openBrowser: (url) =>
        (dependencies.openBrowser ?? openInBrowser)(url).catch(() => {
          browserFailed = true;
          log.warn("Could not open browser automatically.");
          failIfUnavailable();
        }),
      readLine: () =>
        new Promise<string>((resolve) => {
          rl.once("line", (line) => resolve(line));
        })
    });

    const authorization = await client.authorize();

    log.message(`${text.muted("Authorize at")} ${text.link(authorization.authorizationUrl)}`);

    const s = spinner();
    s.start("Waiting for authorization. You can also paste the redirect URL here:");

    const result = await Promise.race([authorization.waitForResult(), channelFailure]);

    s.stop("Authenticated");

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
