import { spawn } from "node:child_process";
import type { SecretStore } from "./types.js";

const SECURITY_CLI = "security";
const KEYCHAIN_ITEM_NOT_FOUND_EXIT_CODE = 44;

export interface KeychainCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface KeychainCommandOptions {
  stdin?: string;
}

export type KeychainCommandRunner = (
  command: string,
  args: string[],
  options?: KeychainCommandOptions
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

    if (getCommandExitCode(result) === 0) {
      return stripTrailingLineBreak(getCommandOutput(result, "stdout"));
    }

    if (isKeychainEntryNotFound(result)) {
      return null;
    }

    throw createSecurityCliFailure("read secret from macOS Keychain", result);
  }

  async set(value: string): Promise<void> {
    if (value.includes("\n") || value.includes("\r")) {
      throw new Error("Keychain secrets cannot contain line breaks");
    }

    const result = await this.executeSecurityCommand(
      [
        "add-generic-password",
        "-s",
        this.service,
        "-a",
        this.account,
        "-U",
        "-w"
      ],
      "store secret in macOS Keychain",
      { stdin: value }
    );

    if (getCommandExitCode(result) !== 0) {
      throw createSecurityCliFailure("store secret in macOS Keychain", result);
    }
  }

  async delete(): Promise<void> {
    const result = await this.executeSecurityCommand(
      ["delete-generic-password", "-s", this.service, "-a", this.account],
      "delete secret from macOS Keychain"
    );

    if (getCommandExitCode(result) === 0 || isKeychainEntryNotFound(result)) {
      return;
    }

    throw createSecurityCliFailure("delete secret from macOS Keychain", result);
  }

  private async executeSecurityCommand(
    args: string[],
    operation: string,
    options?: KeychainCommandOptions
  ): Promise<KeychainCommandResult> {
    try {
      if (options === undefined) {
        return await this.runCommand(SECURITY_CLI, args);
      }
      return await this.runCommand(SECURITY_CLI, args, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to ${operation}: ${message}`);
    }
  }
}

function runSecurityCommand(
  command: string,
  args: string[],
  options?: KeychainCommandOptions
): Promise<KeychainCommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: [options?.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let stdinErrorMessage: string | undefined;
    const appendStderr = (message: string): void => {
      stderr = stderr.length === 0
        ? message
        : `${stderr}${stderr.endsWith("\n") ? "" : "\n"}${message}`;
    };
    const appendStdinError = (): void => {
      if (stdinErrorMessage === undefined) {
        return;
      }

      appendStderr(stdinErrorMessage);
      stdinErrorMessage = undefined;
    };

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string | Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string | Buffer) => {
      stderr += chunk.toString();
    });

    if (options?.stdin !== undefined) {
      child.stdin?.once("error", (error) => {
        stdinErrorMessage = error instanceof Error ? error.message : String(error);
      });
      child.stdin?.end(options.stdin);
    }

    child.on("error", (error: NodeJS.ErrnoException) => {
      const message =
        error instanceof Error ? error.message : String(error ?? "Unknown error");
      appendStdinError();
      appendStderr(message);
      resolve({
        stdout,
        stderr,
        exitCode: 127
      });
    });

    child.on("close", (code) => {
      appendStdinError();
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1
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
  return getCommandExitCode(result) === KEYCHAIN_ITEM_NOT_FOUND_EXIT_CODE;
}

function createSecurityCliFailure(
  operation: string,
  result: KeychainCommandResult
): Error {
  const exitCode = getCommandExitCode(result);
  const details =
    getCommandOutput(result, "stderr").trim()
    || getCommandOutput(result, "stdout").trim();
  if (details) {
    return new Error(
      `Failed to ${operation}: security exited with code ${exitCode}: ${details}`
    );
  }

  return new Error(`Failed to ${operation}: security exited with code ${exitCode}`);
}

function getCommandExitCode(result: KeychainCommandResult): number {
  const value = getOwnEntry(result, "exitCode");
  return typeof value === "number" && Number.isInteger(value) ? value : 1;
}

function getCommandOutput(
  result: KeychainCommandResult,
  key: "stdout" | "stderr"
): string {
  const value = getOwnEntry(result, key);
  return typeof value === "string" ? value : "";
}

function getOwnEntry(record: object, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key)
    ? (record as Record<string, unknown>)[key]
    : undefined;
}
