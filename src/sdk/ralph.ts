import {
  runRalph as runWorkspaceRalph,
  type RalphRunOptions,
  type RalphRunResult
} from "@poe-code/ralph";
import { renderAcpStream } from "@poe-code/agent-spawn";
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
  return runWorkspaceRalph({
    ...options,
    runAgent: async (
      input: Parameters<NonNullable<RalphRunOptions["runAgent"]>>[0]
    ) => {
      const { events, result } = sdkSpawn(input.agent, {
        prompt: input.prompt,
        cwd: input.cwd,
        model: input.model,
        mode: "yolo",
        ...(input.signal ? { signal: input.signal } : {})
      });
      await renderAcpStream(events);
      return result;
    }
  });
}
