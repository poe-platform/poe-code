import {
  runRalph as runWorkspaceRalph,
  type RalphRunOptions,
  type RalphRunResult
} from "@poe-code/ralph";
import { spawn as sdkSpawn } from "./spawn.js";

export type {
  AgentRunInput,
  AgentRunResult,
  RalphRunOptions,
  RalphRunResult,
  RalphStopReason
} from "@poe-code/ralph";

export async function runRalph(
  options: RalphRunOptions
): Promise<RalphRunResult> {
  const runAgent = options.runAgent ?? (async (
    input: Parameters<NonNullable<RalphRunOptions["runAgent"]>>[0]
  ) => {
    return await sdkSpawn.autonomous(input.agent, {
      prompt: input.prompt,
      cwd: input.cwd,
      model: input.model,
      mode: "yolo",
      ...(options.runtime ? { runtime: options.runtime } : {}),
      ...(options.runtimeImage ? { runtimeImage: options.runtimeImage } : {}),
      ...(options.runtimeTemplate ? { runtimeTemplate: options.runtimeTemplate } : {}),
      ...(options.detach ? { detach: options.detach } : {}),
      ...(options.mountPoeCode ? { mountPoeCode: options.mountPoeCode } : {}),
      ...(input.signal ? { signal: input.signal } : {})
    });
  });

  return runWorkspaceRalph({
    ...options,
    runAgent
  });
}
