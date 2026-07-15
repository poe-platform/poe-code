import type { Command } from "commander";
import { Option } from "commander";

export type RuntimeCliOptions = {
  runtime?: "host" | "docker";
  runtimeImage?: string;
  detach?: boolean;
  runnerSync?: "both" | "upload" | "none";
};

export function addRuntimeOptions<TCommand extends Command>(command: TCommand): TCommand {
  return command
    .addOption(
      new Option("--runtime <runtime>", "Override runtime backend: host | docker").choices([
        "host",
        "docker"
      ])
    )
    .option("--runtime-image <ref>", "Override Docker runtime image")
    .option("--detach", "Run as a detached runtime job")
    .addOption(
      new Option("--runner-sync <mode>", "Override runner workspace sync: both | upload | none")
        .choices(["both", "upload", "none"])
    );
}

export function pickRuntimeOptions(options: RuntimeCliOptions): RuntimeCliOptions {
  return {
    ...(options.runtime ? { runtime: options.runtime } : {}),
    ...(options.runtimeImage ? { runtimeImage: options.runtimeImage } : {}),
    ...(options.detach ? { detach: true } : {}),
    ...(options.runnerSync ? { runnerSync: options.runnerSync } : {})
  };
}
