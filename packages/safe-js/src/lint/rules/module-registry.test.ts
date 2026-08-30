import { describe, expect, it } from "vitest";

import {
  hasTypedModuleRegistrations,
  normalizeModuleRegistrations,
  type Modules
} from "./module-registry.js";

describe("module registry", () => {
  it("normalizes typed export maps", () => {
    const modules = new Map([
      [
        "agent",
        {
          exports: new Map([
            ["spawn", "(task: string) => Promise<unknown>"],
            ["default", "unknown"]
          ]),
          filename: "agent.ajs",
          source: "export const spawn = () => {};"
        }
      ]
    ]) satisfies Modules;

    const registration = normalizeModuleRegistrations(modules).get("agent");

    expect(registration).toEqual({
      asyncExports: new Set(),
      exports: ["default", "spawn"],
      exportTypes: new Map([
        ["default", "unknown"],
        ["spawn", "(task: string) => Promise<unknown>"]
      ]),
      filename: "agent.ajs",
      source: "export const spawn = () => {};"
    });
    expect(hasTypedModuleRegistrations(modules)).toBe(true);
  });

  it("normalizes async export metadata while preserving type metadata", () => {
    const modules = {
      agent: {
        exports: {
          spawn: {
            async: true,
            type: "(task: string) => Promise<unknown>"
          },
          default: "unknown"
        }
      }
    } satisfies Modules;

    const registration = normalizeModuleRegistrations(modules).get("agent");

    expect(registration).toEqual({
      exports: ["default", "spawn"],
      exportTypes: new Map([
        ["default", "unknown"],
        ["spawn", "(task: string) => Promise<unknown>"]
      ]),
      asyncExports: new Set(["spawn"])
    });
    expect(hasTypedModuleRegistrations(modules)).toBe(true);
  });
});
