import { beforeEach, describe, expect, it, vi } from "vitest";

describe("@poe-code/superintendent package exports", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("re-exports the public SDK surface", async () => {
    const [pkg, documentParse, documentWrite, documentTasks, runtimeLoop, runtimeBuilder, runtimeInspector, runtimeTemplates, stateMachine, commands] = await Promise.all([
      import("./index.js"),
      import("./document/parse.js"),
      import("./document/write.js"),
      import("./document/tasks.js"),
      import("./runtime/loop.js"),
      import("./runtime/run-builder.js"),
      import("./runtime/run-inspector.js"),
      import("./runtime/templates.js"),
      import("./state/machine.js"),
      import("./commands/index.js")
    ]);

    expect(pkg.parseSuperintendentDoc).toBe(documentParse.parseSuperintendentDoc);
    expect(pkg.updateStatus).toBe(documentWrite.updateStatus);
    expect(pkg.transitionState).toBe(documentWrite.transitionState);
    expect(pkg.incrementRound).toBe(documentWrite.incrementRound);
    expect(pkg.parseTaskBoard).toBe(documentTasks.parseTaskBoard);
    expect(pkg.hasTaskBoard).toBe(documentTasks.hasTaskBoard);
    expect(pkg.runLoop).toBe(runtimeLoop.runLoop);
    expect(pkg.runBuilder).toBe(runtimeBuilder.runBuilder);
    expect(pkg.runInspector).toBe(runtimeInspector.runInspector);
    expect(pkg.runAllInspectors).toBe(runtimeInspector.runAllInspectors);
    expect(pkg.resolveTemplate).toBe(runtimeTemplates.resolveTemplate);
    expect(pkg.createLoopState).toBe(stateMachine.createLoopState);
    expect(pkg.applyTransition).toBe(stateMachine.applyTransition);
    expect(pkg.isComplete).toBe(stateMachine.isComplete);
    expect(pkg.superintendentGroup).toBe(commands.superintendentGroup);
  });

  it("re-exports the testing helpers for external consumers", async () => {
    const pkg = await import("./index.js");

    expect(pkg).toMatchObject({
      createSuperintendentSimulation: expect.any(Function),
      successTurn: expect.any(Function),
      failTurn: expect.any(Function),
      builderTurn: expect.any(Function),
      inspectorTurn: expect.any(Function),
      superintendentTurn: expect.any(Function),
      ownerApproveTurn: expect.any(Function),
      ownerRejectTurn: expect.any(Function)
    });
  });

  it("does not expose legacy top-level command groups", async () => {
    const pkg = await import("./index.js");

    expect("builderGroup" in pkg).toBe(false);
    expect("inspectorGroup" in pkg).toBe(false);
    expect("superintendentMcpGroup" in pkg).toBe(false);
  });
});
