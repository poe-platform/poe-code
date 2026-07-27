import * as fsPromises from "node:fs/promises";
import { discoverPlans, type DiscoverPlansOptions } from "@poe-code/agent-harness-tools";
import { runGaslight } from "./run.js";
import type { GaslightFileSystem, GaslightOptions, GaslightResult } from "./types.js";

const DEFAULT_POLL_INTERVAL_MS = 5_000;

export type GaslightDaemonEvent =
  | { type: "scan.finished"; readyPlans: number }
  | { type: "plan.started"; planPath: string }
  | { type: "plan.finished"; planPath: string }
  | { type: "plan.failed"; planPath: string; error: string };

export interface GaslightDaemonOptions
  extends Omit<GaslightOptions, "planPaths" | "archive" | "onEvent"> {
  planDirectory: string;
  pollIntervalMs?: number;
  onEvent?: (event: GaslightDaemonEvent) => void;
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  run?: (options: GaslightOptions) => Promise<GaslightResult>;
}

export interface GaslightDaemonResult {
  completedPlans: number;
}

function waitForNextScan(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();

  return new Promise((resolve) => {
    const timeout = setTimeout(finish, milliseconds);
    function finish(): void {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", finish);
      resolve();
    }
    signal?.addEventListener("abort", finish, { once: true });
  });
}

export async function runGaslightDaemon(
  options: GaslightDaemonOptions
): Promise<GaslightDaemonResult> {
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? process.env.HOME ?? cwd;
  const fs = options.fs ?? (fsPromises as unknown as GaslightFileSystem);
  const run = options.run ?? runGaslight;
  const wait = options.wait ?? waitForNextScan;
  const completed = new Set<string>();
  let completedPlans = 0;

  while (!options.signal?.aborted) {
    const plans = await discoverPlans({
      cwd,
      homeDir,
      planDirectory: options.planDirectory,
      kinds: ["plan"],
      fs: fs as unknown as DiscoverPlansOptions["fs"]
    });
    const readyPlans = plans.filter(
      (plan) => plan.readiness === "ready" && !completed.has(plan.absolutePath)
    );
    options.onEvent?.({ type: "scan.finished", readyPlans: readyPlans.length });

    for (const plan of readyPlans) {
      if (options.signal?.aborted) break;
      options.onEvent?.({ type: "plan.started", planPath: plan.displayPath });
      const {
        run: ignoredRun,
        wait: ignoredWait,
        pollIntervalMs: ignoredPollIntervalMs,
        planDirectory: ignoredPlanDirectory,
        onEvent: ignoredOnEvent,
        ...gaslightOptions
      } = options;
      try {
        await run({
          ...gaslightOptions,
          planPaths: [plan.displayPath],
          archive: true,
          fs
        });
        completed.add(plan.absolutePath);
        completedPlans += 1;
        options.onEvent?.({ type: "plan.finished", planPath: plan.displayPath });
      } catch (error) {
        options.onEvent?.({
          type: "plan.failed",
          planPath: plan.displayPath,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    if (!options.signal?.aborted) {
      await wait(options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS, options.signal);
    }
  }

  return { completedPlans };
}
