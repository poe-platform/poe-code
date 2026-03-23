import { spawn } from "node:child_process";
import type { SecretStore } from "./types.js";

const SECURITY_CLI = "security";
const KEYCHAIN_ITEM_NOT_FOUND_EXIT_CODE = 44;

export interface KeychainCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type KeychainCommandRunner = (
  command: string,
  args: string[]
) => Promise<KeychainCommandResult>;

export interface KeychainStoreInput {
  runCommand?: KeychainCommandRunner;
  service: string;
  account: string;
}

export class KeychainStore implements SecretStore {
  private readonly runCommand: KeychainCommandRunner;
  private readonly service: string;
  private readonly account: string;

  constructor(input: KeychainStoreInput) {
    this.runCommand = input.runCommand ?? runSecurityCommand;
    this.service = input.service;
    this.account = input.account;
  }

  async get(): Promise<string | null> {
    const result = await this.executeSecurityCommand(
      ["find-generic-password", "-s", this.service, "-a", this.account, "-w"],
      "read secret from macOS Keychain"
    );

    if (result.exitCode === 0) {
      return stripTrailingLineBreak(result.stdout);
    }

    if (isKeychainEntryNotFound(result)) {
      return null;
    }

    throw createSecurityCliFailure("read secret from macOS Keychain", result);
  }

  async set(value: string): Promise<void> {
    const result = await this.executeSecurityCommand(
      [
        "add-generic-password",
        "-s",
        this.service,
        "-a",
        this.account,
        "-w",
        value,
        "-U"
      ],
      "store secret in macOS Keychain"
    );

    if (result.exitCode !== 0) {
      throw createSecurityCliFailure("store secret in macOS Keychain", result);
    }
  }

  async delete(): Promise<void> {
    const result = await this.executeSecurityCommand(
      ["delete-generic-password", "-s", this.service, "-a", this.account],
      "delete secret from macOS Keychain"
    );

    if (result.exitCode === 0 || isKeychainEntryNotFound(result)) {
      return;
    }

    throw createSecurityCliFailure("delete secret from macOS Keychain", result);
  }

  private async executeSecurityCommand(
    args: string[],
    operation: string
  ): Promise<KeychainCommandResult> {
    try {
      return await this.runCommand(SECURITY_CLI, args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to ${operation}: ${message}`);
    }
  }
}

function runSecurityCommand(
  command: string,
  args: string[]
): Promise<KeychainCommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string | Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string | Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      const message =
        error instanceof Error ? error.message : String(error ?? "Unknown error");
      resolve({
        stdout,
        stderr: stderr ? `${stderr}${message}` : message,
        exitCode: 127
      });
    });

    child.on("close", (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 0
      });
    });
  });
}

function stripTrailingLineBreak(value: string): string {
  if (value.endsWith("\r\n")) {
    return value.slice(0, -2);
  }

  if (value.endsWith("\n") || value.endsWith("\r")) {
    return value.slice(0, -1);
  }

  return value;
}

function isKeychainEntryNotFound(result: KeychainCommandResult): boolean {
  if (result.exitCode === KEYCHAIN_ITEM_NOT_FOUND_EXIT_CODE) {
    return true;
  }

  const output = `${result.stderr}\n${result.stdout}`.toLowerCase();

  return (
    output.includes("could not be found") ||
    output.includes("item not found") ||
    output.includes("errsecitemnotfound")
  );
}

function createSecurityCliFailure(
  operation: string,
  result: KeychainCommandResult
): Error {
  const details = result.stderr.trim() || result.stdout.trim();
  if (details) {
    return new Error(
      `Failed to ${operation}: security exited with code ${result.exitCode}: ${details}`
    );
  }

  return new Error(`Failed to ${operation}: security exited with code ${result.exitCode}`);
}
