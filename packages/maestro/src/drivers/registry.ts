import type { WorkflowDriver } from "./types.js";

const drivers = new Map<string, WorkflowDriver>();

export function registerDriver(driver: WorkflowDriver): void {
  const existing = drivers.get(driver.kind);

  if (existing === driver) {
    return;
  }

  if (existing !== undefined) {
    throw new Error(`Workflow driver kind already registered: "${driver.kind}"`);
  }

  drivers.set(driver.kind, driver);
}

export function getDriver(kind: string): WorkflowDriver | undefined {
  return drivers.get(kind);
}

export function listDrivers(): readonly string[] {
  return [...drivers.keys()].sort();
}
