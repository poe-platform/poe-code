import type { AutonomousInput, AutonomousOutput, AutonomousRunner } from "./agent-runner.js";

export async function runHostAgent(_input: AutonomousInput): Promise<AutonomousOutput> {
  throw new Error("Superintendent requires an explicit agent runner in this runtime.");
}

export async function withAutonomousAgentRunner<T>(_runner: AutonomousRunner, _operation: () => Promise<T>): Promise<T> {
  throw new Error("Ambient runner scopes require Node.js; pass the runner explicitly in this runtime.");
}
