import { afterEach, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => (await import("memfs")).fs.promises);
vi.mock("node:fs", async () => (await import("memfs")).fs);
vi.mock("node:crypto", async original => ({ ...await original<object>(), randomBytes: () => Buffer.from([1, 2, 3]) }));
const native = await import("../dist/approval-tasks.js");
const reference = await import("../../toolcraft/src/human-in-loop/approval-tasks.js");
const { approvalStateMachine } = await import("../dist/approval-state-machine.js");
afterEach(() => vi.useRealTimers());

it("persists the exact approval record using native task-list storage", async () => {
  const run = async (lib: typeof reference) => {
    vol.reset(); vol.fromJSON({ "/repo/package.json": "{}" });
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-01T12:34:56.789Z"));
    const { tasks } = await lib.ensureApprovalList({ taskList: { dir: "/repo/approvals.yaml", format: "yaml-file" } });
    const approval = await lib.enqueueApproval({ tasks, payload: { commandPath: "group.run", params: { value: true }, message: "Approve?", plan: [1, 2], planHash: "sha256:fixture" } });
    const loaded = await lib.loadApproval({ tasks, approvalId: approval.approvalId });
    return { approval, loaded, files: vol.toJSON() };
  };
  expect(await run(native)).toEqual(await run(reference));
});

it("preserves runtime/dependency getter order and list validation cache behavior", async () => {
  const run = async (lib: typeof reference) => {
    const trace: string[] = [];
    const observe = (value: any, prefix: string): any => new Proxy(value, { get(target, key, receiver) {
      trace.push(`${prefix}.${String(key)}`); return Reflect.get(target, key, receiver);
    } });
    const machine = observe(structuredClone(approvalStateMachine), "machine");
    const tasks = observe({ stateMachine: machine }, "tasks");
    const list = observe({ list() { return tasks; } }, "list");
    const runtime = observe({ taskList: observe({ dir: "/repo", format: "yaml-file" }, "config") }, "runtime");
    const deps = observe({ openTaskList: async () => list }, "deps");
    await lib.ensureApprovalList(runtime, deps);
    await lib.ensureApprovalList(runtime, deps);
    return trace;
  };
  expect(await run(native)).toEqual(await run(reference));
});

it("matches exact state-machine comparison including reference initial-state behavior", async () => {
  for (const change of [
    (machine: any) => { machine.initial = "declined"; },
    (machine: any) => { machine.states.reverse(); },
    (machine: any) => { machine.events = Object.fromEntries(Object.entries(machine.events).reverse()); },
    (machine: any) => { machine.events.claim.from = "*"; },
    (machine: any) => { machine.events.claim.to = "declined"; },
    (machine: any) => { delete machine.events.claim; }
  ]) {
    const run = async (lib: typeof reference) => {
      const machine = structuredClone(approvalStateMachine); change(machine);
      try { await lib.ensureApprovalList({ taskList: { list: () => ({ stateMachine: machine }) } } as never); return "accepted"; }
      catch (error) { return [(error as Error).name, (error as Error).message]; }
    };
    expect(await run(native)).toEqual(await run(reference));
  }
});
