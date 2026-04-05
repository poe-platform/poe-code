import {
  runRalph as runWorkspaceRalph,
  type RalphRunOptions,
  type RalphRunResult
} from "@poe-code/ralph";
import { renderAcpStream, isActivityTimeoutError } from "@poe-code/agent-spawn";
import { spawn as sdkSpawn } from "./spawn.js";

export type {
  AgentRunInput,
  AgentRunResult,
  RalphRunOptions,
  RalphRunResult,
  RalphStopReason
} from "@poe-code/ralph";

const AUTONOMOUS_ACTIVITY_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const MAX_TIMEOUT_RETRIES = 3;

export async function runRalph(
  options: RalphRunOptions
): Promise<RalphRunResult> {
  return runWorkspaceRalph({
    ...options,
    runAgent: async (
      input: Parameters<NonNullable<RalphRunOptions["runAgent"]>>[0]
    ) => {
      for (let attempt = 1; attempt <= MAX_TIMEOUT_RETRIES; attempt++) {
        try {
          const { events, result } = sdkSpawn(input.agent, {
            prompt: input.prompt,
            cwd: input.cwd,
            model: input.model,
            mode: "yolo",
            activityTimeoutMs: AUTONOMOUS_ACTIVITY_TIMEOUT_MS,
            ...(input.signal ? { signal: input.signal } : {})
          });
          await renderAcpStream(events);
          return result;
        } catch (error) {
          if (!isActivityTimeoutError(error) || attempt === MAX_TIMEOUT_RETRIES) {
            throw error;
          }
        }
      }
      throw new Error("Unreachable");
    }
  });
}
