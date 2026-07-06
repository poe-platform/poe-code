import { describe, expect, it, vi } from "vitest";
import { configureTheme, resetTheme, withOutputFormat } from "toolcraft-design";
import {
  ApprovalDeclinedError,
  NotFoundError,
  UserError,
  defineCommand,
  defineGroup,
  defineStreamCommand,
  S
} from "../index.js";
import { fakeService } from "./fakes.js";
import { createHarnessFixtureGroup, type FixtureService } from "./fixtures.js";
import { createCommandTestHarness, type RunResult } from "./harness.js";
import { createMemoryFs, type MemoryFs } from "./memory-fs.js";

class PrototypeMemoryFs implements MemoryFs {
  readonly #delegate = createMemoryFs();

  readFile(...args: Parameters<MemoryFs["readFile"]>) {
    return this.#delegate.readFile(...args);
  }

  writeFile(...args: Parameters<MemoryFs["writeFile"]>) {
    return this.#delegate.writeFile(...args);
  }

  exists(...args: Parameters<MemoryFs["exists"]>) {
    return this.#delegate.exists(...args);
  }

  lstat(...args: Parameters<MemoryFs["lstat"]>) {
    return this.#delegate.lstat(...args);
  }

  rename(...args: Parameters<MemoryFs["rename"]>) {
    return this.#delegate.rename(...args);
  }

  unlink(...args: Parameters<MemoryFs["unlink"]>) {
    return this.#delegate.unlink(...args);
  }

  snapshot() {
    return this.#delegate.snapshot();
  }

  changes() {
    return this.#delegate.changes();
  }
}

function createFixtureHarness(options: Parameters<typeof createCommandTestHarness>[1] = {}) {
  const service = fakeService<FixtureService>({
    execute: async (value) => `service:${value}`
  });
  const harness = createCommandTestHarness(createHarnessFixtureGroup(), {
    ...options,
    services: { fakeService: service }
  });
  return { harness, service };
}

function expectPreHandlerFailure(result: RunResult<unknown>, serviceCalls: unknown[]): void {
  expect(result.ok).toBe(false);
  expect(result.timeline).toEqual([]);
  expect(serviceCalls).toEqual([]);
}

describe("createCommandTestHarness resolve stage", () => {
  it("returns a UserError for unknown paths without effects", async () => {
    const { harness, service } = createFixtureHarness();
    const result = await harness.run(["missing"]);

    expect(result.failedAt).toBe("resolve");
    expect(result.error).toBeInstanceOf(UserError);
    expectPreHandlerFailure(result, service.calls);
  });

  it("resolves aliases, hidden commands, and group defaults", async () => {
    const { harness } = createFixtureHarness();

    await expect(harness.run<string>(["alias"])).resolves.toMatchObject({
      ok: true,
      value: "alias"
    });
    await expect(harness.run<string>(["hidden"])).resolves.toMatchObject({
      ok: true,
      value: "hidden"
    });
    await expect(harness.run<string>(["nested"])).resolves.toMatchObject({
      ok: true,
      value: "default"
    });
  });

  it("rejects paths under deferred MCP groups", async () => {
    const { harness } = createFixtureHarness();
    const result = await harness.run(["deferred", "anything"]);

    expect(result.failedAt).toBe("resolve");
    expect(result.error).toBeInstanceOf(UserError);
    expect(result.error).toHaveProperty("message", expect.stringContaining("live server"));
  });
});

describe("createCommandTestHarness secrets stage", () => {
  it("returns missing-secret errors before effects", async () => {
    const { harness, service } = createFixtureHarness();
    const result = await harness.run(["secrets"]);

    expect(result.failedAt).toBe("secrets");
    expect(result.error).toBeInstanceOf(UserError);
    expectPreHandlerFailure(result, service.calls);
  });

  it("reverse maps named secrets into the sealed env and wins conflicts", async () => {
    const { harness } = createFixtureHarness({
      env: { FIXTURE_REQUIRED_SECRET: "env" },
      secrets: { required: "option", optional: "optional" }
    });

    await expect(harness.run(["secrets"])).resolves.toMatchObject({
      ok: true,
      value: { required: "option", optional: "optional" }
    });
  });

  it("maps duplicate secret names using the resolved command declaration", async () => {
    const { harness } = createFixtureHarness({
      secrets: { required: "command-secret" }
    });

    await expect(harness.run(["secrets"])).resolves.toMatchObject({
      ok: true,
      value: { required: "command-secret" }
    });
    await expect(harness.run(["other-secrets"])).resolves.toMatchObject({
      ok: true,
      value: { required: "command-secret" }
    });
  });
});

describe("createCommandTestHarness requirements stage", () => {
  it.each([["auth"], ["check"]])("fails %s requirements before effects", async (name) => {
    const { harness, service } = createFixtureHarness();
    const result = await harness.run([name]);

    expect(result.failedAt).toBe("requirements");
    expect(result.error).toBeInstanceOf(UserError);
    expectPreHandlerFailure(result, service.calls);
  });
});

describe("createCommandTestHarness params stage", () => {
  it("uses SDK validation and applies defaults", async () => {
    const { harness } = createFixtureHarness();

    await expect(harness.run(["params"], { name: "Ada" })).resolves.toMatchObject({
      ok: true,
      value: { name: "Ada", count: 2 }
    });
  });

  it("returns validation errors before effects", async () => {
    const { harness, service } = createFixtureHarness();
    const result = await harness.run(["params"], {});

    expect(result.failedAt).toBe("params");
    expect(result.error).toBeInstanceOf(UserError);
    expectPreHandlerFailure(result, service.calls);
  });
});

describe("createCommandTestHarness streams", () => {
  it("captures a finite prefix and cancels the stream exactly once", async () => {
    const cleanup = vi.fn();
    const watch = defineStreamCommand({
      name: "watch",
      params: S.Object({}),
      event: S.Object({ value: S.Number() }),
      async *handler({ status }) {
        try {
          status({ type: "connected" });
          let value = 0;
          while (true) {
            yield { value: value++ };
          }
        } finally {
          cleanup();
        }
      }
    });
    const harness = createCommandTestHarness(
      defineGroup({ name: "fixture", children: [watch] })
    );

    await expect(harness.stream(["watch"], {}, { limit: 3 })).resolves.toMatchObject({
      ok: true,
      events: [{ value: 0 }, { value: 1 }, { value: 2 }],
      statuses: [{ type: "connected" }]
    });
    expect(cleanup).toHaveBeenCalledOnce();
  });
});

describe("createCommandTestHarness confirm stage", () => {
  it("captures command confirmation declines", async () => {
    const { harness, service } = createFixtureHarness({ confirmations: "decline" });
    const result = await harness.run(["confirm"]);

    expect(result.failedAt).toBe("confirm");
    expect(result.error).toBeInstanceOf(ApprovalDeclinedError);
    expect(result.confirmations).toEqual([{ message: "Proceed?" }]);
    expect(service.calls).toEqual([]);
  });

  it("uses invokeWithHumanInLoop for approval", async () => {
    const { harness } = createFixtureHarness({ confirmations: "approve" });
    const result = await harness.run(["human-in-loop"], { target: "prod" });

    expect(result).toMatchObject({ ok: true, value: "deployed" });
    expect(result.confirmations).toEqual([
      { message: "Deploy prod?", declineInputPrompt: undefined }
    ]);
    expect(result.timeline).toEqual([
      { seq: 1, kind: "confirm", message: "Deploy prod?", approved: true }
    ]);
  });

  it("passes the SDK-style canonical path without the root group", async () => {
    const { harness } = createFixtureHarness();
    const result = await harness.run(["human-in-loop-path"]);

    expect(result.confirmations).toEqual([
      { message: "Approve human-in-loop-path?", declineInputPrompt: undefined }
    ]);
  });

  it("returns async human-in-loop work as pending without running the handler", async () => {
    const { harness, service } = createFixtureHarness();
    const result = await harness.run(["async-human-in-loop"], { target: "prod" });

    expect(result.ok).toBe(true);
    expect(result.pending).toBe(true);
    expect(result.value).toMatchObject({
      status: "pending-approval",
      message: "Queue prod?"
    });
    expect(service.calls).toEqual([]);
  });
});

describe("createCommandTestHarness handler stage", () => {
  it.each([
    ["user-error", UserError],
    ["not-found", NotFoundError],
    ["plain-error", Error]
  ])("preserves raw %s handler errors", async (name, ErrorType) => {
    const { harness } = createFixtureHarness();
    const result = await harness.run([name]);

    expect(result.failedAt).toBe("handler");
    expect(result.error).toBeInstanceOf(ErrorType);
  });
});

describe("createCommandTestHarness render stage", () => {
  it("keeps the handler value when a renderer fails", async () => {
    const { harness } = createFixtureHarness();
    const result = await harness.run(["render-error"]);

    expect(result.ok).toBe(false);
    expect(result.value).toBe("handled");
    expect(result.rendered).toEqual({ rich: "rendered before failure" });
    expect(result.failedAt).toBe("render");
    expect(result.error).toBeInstanceOf(Error);
  });

  it("captures rich renderer output", async () => {
    const { harness } = createFixtureHarness();
    const result = await harness.run(["rich"]);

    expect(result.ok).toBe(true);
    expect(result.rendered.rich.split("\n")).toEqual([
      "rich",
      " Poe - intro ",
      "Description  A deterministic renderer wraps this detail using a fixed",
      "             eighty-column width.",
      "Capture",
      "captured note"
    ]);
    expect(Object.keys(result.rendered)).toEqual(["rich"]);
  });

  it("captures rich output independently from the ambient output format", async () => {
    const { harness } = createFixtureHarness();
    const result = await withOutputFormat("markdown", () => harness.run(["rich"]));

    expect(result.rendered.rich).toContain(
      "Description  A deterministic renderer wraps this detail using a fixed"
    );
    expect(result.rendered.rich).not.toContain("| Description |");
  });

  it("captures rich output independently from global theme configuration", async () => {
    configureTheme({ label: "Custom" });
    try {
      const { harness } = createFixtureHarness();
      const result = await harness.run(["rich"]);

      expect(result.rendered.rich).toContain(" Poe - intro ");
      expect(result.rendered.rich).not.toContain("Custom");
    } finally {
      resetTheme();
    }
  });

  it("captures markdown renderer output", async () => {
    const { harness } = createFixtureHarness();
    const result = await harness.run(["markdown"]);

    expect(result).toMatchObject({
      ok: true,
      rendered: { markdown: "# markdown" }
    });
    expect(Object.keys(result.rendered)).toEqual(["markdown"]);
  });

  it("captures json renderer output", async () => {
    const { harness } = createFixtureHarness();
    const result = await harness.run(["json"]);

    expect(result).toMatchObject({
      ok: true,
      rendered: { json: { value: "json" } }
    });
    expect(Object.keys(result.rendered)).toEqual(["json"]);
  });

  it("isolates capture theme mutations between runs", async () => {
    const command = defineCommand({
      name: "mutate-theme",
      params: S.Object({}),
      handler: async () => "handled",
      render: {
        rich: (_result, primitives) => {
          const theme = primitives.getTheme();
          primitives.logger.info(theme.intro("intro"));
          theme.intro = () => "mutated";
        }
      }
    });
    const harness = createCommandTestHarness(defineGroup({ name: "fixture", children: [command] }));

    const first = await harness.run(["mutate-theme"]);
    const second = await harness.run(["mutate-theme"]);

    expect(first.rendered.rich).toBe(" Poe - intro ");
    expect(second.rendered.rich).toBe(" Poe - intro ");
  });
});

describe("createCommandTestHarness successes", () => {
  it("supports MemoryFs implementations with prototype methods", async () => {
    const { harness } = createFixtureHarness({ fs: new PrototypeMemoryFs() });

    await expect(harness.run(["fs-roundtrip"])).resolves.toMatchObject({
      ok: true,
      value: "written"
    });
  });

  it("supports primitive service values without changing command execution", async () => {
    const command = defineCommand({
      name: "region",
      params: S.Object({}),
      handler: async ({ region }: { region: string }) => region
    });
    const root = defineGroup({ name: "fixture", children: [command] });
    const harness = createCommandTestHarness(root, { services: { region: "us-east-1" } });

    await expect(harness.run(["region"])).resolves.toMatchObject({
      ok: true,
      value: "us-east-1"
    });
  });

  it("captures values, logs, progress, effects, and fs changes in order", async () => {
    const { harness } = createFixtureHarness({
      env: { FIXTURE_VALUE: "env" },
      fetch: [{ method: "POST", url: "https://fixture.test/value", text: "response" }]
    });
    const result = await harness.run<string>(["effects"]);

    expect(result).toMatchObject({
      ok: true,
      value: "service:env",
      logs: [{ level: "debug", message: "starting effects" }],
      progress: ["halfway"],
      fsChanges: [{ op: "writeFile", path: "/effects.txt" }]
    });
    expect(result.timeline).toEqual([
      { seq: 1, kind: "env", key: "FIXTURE_VALUE" },
      { seq: 2, kind: "progress", message: "halfway" },
      { seq: 3, kind: "service", service: "fakeService", method: "execute", args: ["env"] },
      { seq: 4, kind: "fetch", method: "POST", url: "https://fixture.test/value" },
      { seq: 5, kind: "fs", op: "writeFile", path: "/effects.txt" }
    ]);
    expect(harness.timeline).toEqual(result.timeline);
    await expect(harness.fs.readFile("/effects.txt")).resolves.toBe("response");
  });

  it("keeps cumulative timeline sequence monotonic across runs", async () => {
    const { harness } = createFixtureHarness({
      env: { FIXTURE_VALUE: "env" },
      fetch: [{ method: "POST", url: "https://fixture.test/value", text: "response" }]
    });

    const first = await harness.run(["effects"]);
    const second = await harness.run(["effects"]);

    expect(first.timeline[0]?.seq).toBe(1);
    expect(second.timeline[0]?.seq).toBe(6);
    expect(harness.timeline).toHaveLength(10);
  });
});
