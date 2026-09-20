import type{MockRunBehavior,Runner}from'./types.js';
export function createMockRunner(behaviors:MockRunBehavior[]):Runner;
export function createMockRunnerByCommand(behaviorsByCommand:Record<string,MockRunBehavior>):Runner;
