import type { Command } from "commander";
import { getToken } from "../get-token.js";

export function registerTokenCommand(program: Command): void {
  program
    .command("token")
    .description("Print the stored Poe API key.")
    .action(async () => {
      const token = await getToken();

      if (!token) {
        process.stderr.write("Error: No API key stored. Run `poe-auth login` first.\n");
        process.exitCode = 1;
        return;
      }

      process.stdout.write(`${token}\n`);
    });
}
