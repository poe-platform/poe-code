import { promisify } from "node:util";
import { expect, it, vi } from "vitest";
const execute = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile: Object.assign(vi.fn(), { [promisify.custom]: execute }) }));
const native = await import("../dist/osascript.js");
const reference = await import("../../agent-human-in-loop/dist/providers/osascript.js");

it("preserves process arguments, failure classification and promise settlement", async () => {
  async function run(api: typeof reference, outcome: unknown, reject: boolean) {
    const trace: unknown[] = [];
    execute.mockImplementation((...args) => { trace.push(args); return reject ? Promise.reject(outcome) : Promise.resolve({ stdout: outcome }); });
    const provider = api.osascriptProvider({ binary: "/mock/osascript", title: 'Review "plan"' });
    const pending = provider.requestApproval({ message: "Proceed?", declineInputPrompt: "Reason?" }).then(
      value => { trace.push("resolved"); return value; },
      error => { trace.push("rejected"); return { error: error instanceof Error ? [error.name, error.message] : error }; }
    );
    for (let i = 0; i < 8; i++) { trace.push(`tick:${i}`); await Promise.resolve(); }
    return { result: await pending, trace };
  }
  for (const output of ["APPROVED\n", "DECLINED:later\r\n", "???\n", "User canceled. (-128)", null])
    expect(await run(native, output, false)).toEqual(await run(reference, output, false));
  for (const error of [undefined, null, false, 42, "offline", "User canceled. (-128)", { code: "ENOENT" },
    Object.create({ code: "ENOENT" }), { stderr: "offline\n" }, { stderr: "User canceled. (-128)" },
    new Error("User canceled. (-128)"), { stderr: 12 }])
    expect(await run(native, error, true)).toEqual(await run(reference, error, true));
});

it("keeps option and failure getters in their reference order and preserves arbitrary throws", async () => {
  async function run(api: typeof reference) {
    const trace: string[] = [];
    const failure = { get code() { trace.push("code"); return "EACCES"; },
      get stderr() { trace.push("stderr"); return "denied"; },
      toString() { trace.push("toString"); return "error"; } };
    execute.mockRejectedValue(failure);
    const provider = api.osascriptProvider({ get title() { trace.push("title"); return undefined; }, get binary() { trace.push("binary"); return undefined; } });
    await expect(provider.requestApproval({ message: "Proceed?" })).rejects.toThrow("osascript failed: denied");
    for (const thrown of [undefined, null, 0, Symbol("thrown")]) {
      execute.mockRejectedValue({ get code() { throw thrown; } });
      await expect(provider.requestApproval({ message: "Proceed?" })).rejects.toBe(thrown);
    }
    return trace;
  }
  expect(await run(native)).toEqual(await run(reference));
});
