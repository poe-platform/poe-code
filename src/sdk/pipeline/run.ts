import type {
  AcpEvent,
  AgentMessageEvent
} from "@poe-code/agent-spawn";
import { renderAcpStream } from "@poe-code/agent-spawn";
import { spawn } from "../spawn.js";
import type { SpawnOptions } from "../types.js";
import { interpolate } from "./interpolate.js";
import { validatePipeline } from "./validate.js";
import {
  isParallelGroup,
  type PipelineDefinition,
  type PipelineResult,
  type PipelineStep,
  type PipelineStepResult
} from "./types.js";

export interface RunPipelineOptions {
  cwd: string;
}

export async function runPipeline(
  pipeline: PipelineDefinition,
  options: RunPipelineOptions
): Promise<PipelineResult> {
  validatePipeline(pipeline);

  const stepResults: Record<string, PipelineStepResult> = {};
  const totalSteps = countSteps(pipeline);
  let completedSteps = 0;
  let success = true;
  const startTime = Date.now();

  for (const entry of pipeline.steps) {
    if (!success) break;

    if (isParallelGroup(entry)) {
      const results = await runParallelGroup(
        entry.parallel,
        pipeline,
        stepResults,
        options
      );

      for (const [name, result] of Object.entries(results)) {
        stepResults[name] = result;
        if (result.exitCode === 0) {
          completedSteps += 1;
        } else {
          success = false;
        }
      }
    } else {
      const result = await runStep(entry, pipeline, stepResults, options);
      stepResults[entry.name] = result;

      if (result.exitCode === 0) {
        completedSteps += 1;
      } else {
        success = false;
      }
    }
  }

  return {
    steps: stepResults,
    summary: {
      totalSteps,
      completedSteps,
      totalDuration: Date.now() - startTime,
      success
    }
  };
}

async function runStep(
  step: PipelineStep,
  pipeline: PipelineDefinition,
  completedSteps: Record<string, PipelineStepResult>,
  options: RunPipelineOptions
): Promise<PipelineStepResult> {
  const agent = step.agent ?? pipeline.defaults?.agent;
  if (!agent) {
    throw new Error(`Step "${step.name}" has no agent`);
  }

  const prompt = interpolate(step.prompt, completedSteps, {
    name: pipeline.name,
    cwd: options.cwd
  });

  const mode = step.mode ?? pipeline.defaults?.mode ?? "yolo";
  const model = step.model ?? pipeline.defaults?.model;
  const cwd = step.cwd ?? options.cwd;

  const spawnOptions: SpawnOptions = {
    prompt,
    cwd,
    mode,
    ...(model ? { model } : {}),
    ...(step.args ? { args: step.args } : {})
  };

  const startTime = Date.now();
  const { events, result } = spawn(agent, spawnOptions);
  const { teed, getOutput, done } = teeAcpStream(events);

  await renderAcpStream(teed);
  const final = await result;
  await done;

  return {
    output: getOutput(),
    exitCode: final.exitCode,
    duration: Date.now() - startTime
  };
}

async function runParallelGroup(
  steps: PipelineStep[],
  pipeline: PipelineDefinition,
  completedSteps: Record<string, PipelineStepResult>,
  options: RunPipelineOptions
): Promise<Record<string, PipelineStepResult>> {
  const promises = steps.map((step) =>
    runStep(step, pipeline, completedSteps, options).then(
      (result) => ({ name: step.name, result })
    )
  );

  const settled = await Promise.all(promises);
  const results: Record<string, PipelineStepResult> = {};

  for (const { name, result } of settled) {
    results[name] = result;
  }

  return results;
}

function countSteps(pipeline: PipelineDefinition): number {
  let count = 0;
  for (const entry of pipeline.steps) {
    if (isParallelGroup(entry)) {
      count += entry.parallel.length;
    } else {
      count += 1;
    }
  }
  return count;
}

function teeAcpStream(events: AsyncIterable<AcpEvent>): {
  teed: AsyncIterable<AcpEvent>;
  getOutput: () => string;
  done: Promise<void>;
} {
  const chunks: string[] = [];
  let resolveDone: (() => void) | undefined;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  const teed = (async function* () {
    try {
      for await (const event of events) {
        if (event.event === "agent_message") {
          chunks.push((event as AgentMessageEvent).text);
        }
        yield event;
      }
    } finally {
      resolveDone?.();
    }
  })();

  return {
    teed,
    getOutput: () => chunks.join(""),
    done
  };
}
