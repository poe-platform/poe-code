import path from "node:path";
import { isNotFound } from "@poe-code/config-mutations";
import type { DoctorCheck, DoctorContext, CheckResult } from "../types.js";

function homeDirCheck(): DoctorCheck {
  return {
    id: "system.home-dir",
    category: "system",
    description: "Home directory writable",
    async run(ctx: DoctorContext): Promise<CheckResult> {
      const poeCodeDir = path.join(ctx.env.homeDir, ".poe-code");
      try {
        await ctx.fs.stat(poeCodeDir);
        return { status: "pass", message: `${poeCodeDir} exists` };
      } catch (error) {
        if (isNotFound(error)) {
          return {
            status: "fail",
            message: `${poeCodeDir} does not exist`,
            fix: 'Run "poe-code configure" to create it.'
          };
        }
        return {
          status: "fail",
          message: `Cannot access ${poeCodeDir}: ${(error as Error).message}`,
          fix: "Check directory permissions."
        };
      }
    }
  };
}

function configValidCheck(): DoctorCheck {
  return {
    id: "system.config-valid",
    category: "system",
    description: "Config file parseable",
    async run(ctx: DoctorContext): Promise<CheckResult> {
      try {
        const raw = await ctx.fs.readFile(ctx.env.configPath, "utf8");
        JSON.parse(raw);
        return { status: "pass", message: "config.json is valid JSON" };
      } catch (error) {
        if (isNotFound(error)) {
          return {
            status: "skip",
            message: "config.json not found"
          };
        }
        return {
          status: "fail",
          message: "config.json contains invalid JSON",
          fix: 'Delete the file and run "poe-code configure" to recreate it.',
          detail: (error as Error).message
        };
      }
    }
  };
}

function configBackupsCheck(): DoctorCheck {
  return {
    id: "system.config-backups",
    category: "system",
    description: "No corruption backups",
    async run(ctx: DoctorContext): Promise<CheckResult> {
      const poeCodeDir = path.join(ctx.env.homeDir, ".poe-code");
      let entries: string[];
      try {
        entries = await ctx.fs.readdir(poeCodeDir);
      } catch (error) {
        if (isNotFound(error)) {
          return { status: "skip", message: ".poe-code directory not found" };
        }
        throw error;
      }
      const backups = entries.filter((name) => name.includes(".invalid-"));
      if (backups.length === 0) {
        return { status: "pass", message: "No corruption backups found" };
      }
      return {
        status: "warn",
        message: `Found ${backups.length} corruption backup(s)`,
        detail: backups.join(", ")
      };
    }
  };
}

export function systemChecks(): DoctorCheck[] {
  return [homeDirCheck(), configValidCheck(), configBackupsCheck()];
}
