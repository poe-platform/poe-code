import { describe, expect, it } from "vitest";
import { fakeService } from "./fakes.js";

describe("fakeService promise protocol", () => {
  it.each([{}, { then: undefined }])("preserves an absent then method for %j", (stubs) => {
    const service = fakeService<{ then?: undefined }>(stubs);

    expect(service.then).toBeUndefined();
    expect(service.calls).toEqual([]);
  });

  it.each(["await", "resolve", "async factory", "promise all"])(
    "preserves service identity through %s",
    async (mode) => {
      const service = fakeService({ read: () => "ready" });
      let result: unknown;

      if (mode === "await") result = await service;
      if (mode === "resolve") result = await Promise.resolve(service);
      if (mode === "async factory") result = await (async () => service)();
      if (mode === "promise all") [result] = await Promise.all([service]);

      expect(result).toBe(service);
      expect(service.calls).toEqual([]);
      expect(service.read()).toBe("ready");
      expect(service.calls).toEqual([{ method: "read", args: [], result: "ready" }]);
    }
  );

  it.each([false, true])("records nested service returns with async=%s", async (asynchronous) => {
    const child = fakeService({ read: () => "ready" });
    const parent = fakeService({
      child: asynchronous ? async () => child : () => child
    });

    const returned = parent.child();
    const result = await returned;

    expect(result).toBe(child);
    if (asynchronous) expect(returned).toBeInstanceOf(Promise);
    else expect(returned).toBe(child);
    expect(child.calls).toEqual([]);
    expect(parent.calls).toHaveLength(1);
    expect(parent.calls[0]).toMatchObject({ method: "child", args: [] });
    expect(parent.calls[0]?.result).toBe(child);
    expect(parent.calls[0]).not.toHaveProperty("error");
  });

  it("preserves synchronous fluent methods returning their receiver", async () => {
    interface FluentService {
      name: string;
      rename(name: string): FluentService;
    }
    const service = fakeService<FluentService>({
      name: "before",
      rename(name) {
        this.name = name;
        return this;
      }
    });

    const returned = service.rename("after");
    await returned;

    expect(returned).toBe(service);
    expect(service.name).toBe("after");
    expect(service.calls).toHaveLength(1);
    expect(service.calls[0]).toMatchObject({ method: "rename", args: ["after"] });
    expect(service.calls[0]?.result).toBe(service);
  });

  it.each([null, false, 0, "ordinary data"])("retains a non-callable then value %j", async (then) => {
    const service = fakeService({ then });

    expect(service.then).toBe(then);
    expect(await Promise.resolve(service)).toBe(service);
    expect(service.calls).toEqual([]);
  });

  it("honors an explicitly stubbed then method and its receiver", async () => {
    interface ThenableService {
      value: string;
      then(resolve: (value: string) => void): void;
    }
    const service = fakeService<ThenableService>({
      value: "ready",
      then(resolve) {
        resolve(this.value);
      }
    });

    expect(await Promise.resolve(service)).toBe("ready");
    expect(service.calls).toHaveLength(1);
    expect(service.calls[0]).toMatchObject({ method: "then", result: undefined });
    expect(service.calls[0]?.args).toEqual([expect.any(Function), expect.any(Function)]);
  });

  it("still rejects and records ordinary unstubbed methods", () => {
    const service = fakeService<{ missing(): void }>();

    expect(() => service.missing()).toThrow('Unstubbed service method "missing" was called.');
    expect(service.calls).toEqual([
      { method: "missing", args: [], error: expect.any(Error) }
    ]);
  });
});
