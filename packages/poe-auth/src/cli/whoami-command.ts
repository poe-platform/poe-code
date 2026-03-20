import type { Command } from "commander";
import { checkAuth } from "../check-auth.js";

interface WhoamiCommandOptions {
  json?: boolean;
}

export function registerWhoamiCommand(program: Command): void {
  program
    .command("whoami")
    .description("Show the authenticated Poe account.")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: WhoamiCommandOptions) => {
      const identity = await checkAuth();

      if (!identity) {
        process.stderr.write("Error: Not logged in. Run `poe-auth login` first.\n");
        process.exitCode = 1;
        return;
      }

      if (options.json) {
        process.stdout.write(`${JSON.stringify(identity)}\n`);
        return;
      }

      process.stdout.write(`Email: ${identity.email}\n`);
      process.stdout.write(`Balance: ${formatBalance(identity.balance)}\n`);
    });
}

function formatBalance(balance: number | null): string {
  if (balance === null) {
    return "unavailable";
  }

  return String(balance);
}
