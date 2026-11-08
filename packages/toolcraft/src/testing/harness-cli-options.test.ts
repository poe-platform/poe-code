import { expect, it } from "vitest";
import { defineCommand, defineGroup, defineStreamCommand, S } from "../index.js";
import { createCommandTestHarness } from "./harness.js";

const versions = [
  { label: "missing", apiVersion: undefined, compatible: false },
  { label: "older", apiVersion: "1.2.2", compatible: false },
  { label: "minimum", apiVersion: "1.2.3", compatible: true },
  { label: "newer", apiVersion: "2.0.0", compatible: true },
  { label: "invalid", apiVersion: "invalid", compatible: false }
];

const cases = [false, true].flatMap((stream) =>
  (["command", "group", "none"] as const).flatMap((placement) =>
    versions.map((version) => ({ stream, placement, ...version }))
  )
);

it.each(cases)(
  "forwards $label API version with $placement requirements, stream: $stream",
  async ({ apiVersion, compatible, placement, stream }) => {
    let calls = 0;
    const config = {
      name: "read",
      params: S.Object({}),
      requires: placement === "command" ? { apiVersion: ">=1.2.3" } : undefined
    };
    const command = stream
      ? defineStreamCommand({
          ...config,
          event: S.String(),
          async *handler() {
            calls++;
            yield "ready";
          }
        })
      : defineCommand({
          ...config,
          handler() {
            calls++;
            return "ready";
          }
        });
    const harness = createCommandTestHarness(
      defineGroup({
        name: "audit",
        requires: placement === "group" ? { apiVersion: ">=1.2.3" } : undefined,
        children: [command]
      }),
      { apiVersion }
    );
    const accepted = placement === "none" || compatible;
    const reference = stream
      ? await harness.stream(["read"])
      : await harness.run(["read"]);

    expect(reference.ok).toBe(accepted);
    expect(calls).toBe(accepted ? 1 : 0);

    const result = await harness.cli(["read", "--output", "json"]);

    expect(result.exitCode).toBe(accepted ? 0 : 1);
    expect(calls).toBe(accepted ? 2 : 0);
    if (accepted) {
      expect(result.stdout).toContain('"ready"');
    } else {
      expect(reference.error).toBeInstanceOf(Error);
      expect(result.stdout).toContain((reference.error as Error).message);
    }
  }
);
