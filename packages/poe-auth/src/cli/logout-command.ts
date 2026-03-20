import type { Command } from "commander";
import { logout } from "../logout.js";

export function registerLogoutCommand(program: Command): void {
  program
    .command("logout")
    .description("Remove the stored Poe API key.")
    .action(async () => {
      await logout();
      process.stdout.write("Logged out.\n");
    });
}
