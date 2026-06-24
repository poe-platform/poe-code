import type { Command } from "commander";
import { Option } from "commander";

export type RuntimeCliOptions = {
  runtime?: "host" | "docker" | "e2b";
  runtimeImage?: string;
  runtimeTemplate?: string;
  detach?: boolean;
  runnerSync?: "both" | "upload" | "none";
};

export function addRuntimeOptions<TCommand extends Command>(command: TCommand): TCommand {
  return command
    .addOption(
      new Option("--runtime <runtime>", "Override runtime backend: host | docker | e2b").choices([
        "host",
        "docker",
        "e2b"
      ])
    )
    .option("--runtime-image <ref>", "Override Docker runtime image")
    .option("--runtime-template <id>", "Override E2B runtime template id")
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
    ...(options.runtimeTemplate ? { runtimeTemplate: options.runtimeTemplate } : {}),
    ...(options.detach ? { detach: true } : {}),
    ...(options.runnerSync ? { runnerSync: options.runnerSync } : {})
  };
}
