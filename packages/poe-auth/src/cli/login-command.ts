import type { Command } from "commander";
import { login } from "../login.js";

interface LoginCommandOptions {
  apiKey?: string;
}

export function registerLoginCommand(program: Command): void {
  program
    .command("login")
    .description("Store a Poe API key.")
    .option("--api-key <key>", "Poe API key")
    .action(async (options: LoginCommandOptions) => {
      await login({ apiKey: options.apiKey });
      process.stdout.write("Logged in.\n");
    });
}
