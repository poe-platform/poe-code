import { expect, it, vi } from "vitest";

it("does not construct property descriptors to append private continuation frames", async () => {
  const define = vi.spyOn(Reflect, "defineProperty");
  try {
    vi.resetModules();
    const { measureSandboxData } = await import("./values.js");
    define.mockClear();
    expect(measureSandboxData([{ first: { text: "a" }, second: { text: "b" } }])).toBe(28);
    const frames = define.mock.calls.filter(([, , descriptor]) => {
      const frame: unknown = descriptor.value;
      return (
        frame !== null &&
        typeof frame === "object" &&
        Object.hasOwn(frame, "values") &&
        Object.hasOwn(frame, "index") &&
        Object.hasOwn(frame, "depth")
      );
    });
    expect(frames).toHaveLength(0);
  } finally {
    vi.restoreAllMocks();
    vi.resetModules();
  }
});
