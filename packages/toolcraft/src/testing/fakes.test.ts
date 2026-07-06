import { describe, expect, it } from "vitest";
import { fakeFetch, fakeService } from "./fakes.js";

describe("fakeService", () => {
  interface CalculatorService {
    name: string;
    add(left: number, right: number): number;
    fail(): never;
    load(): Promise<string>;
    missing(): void;
  }

  it("returns stubbed properties and records successful calls in order", async () => {
    const service = fakeService<CalculatorService>({
      name: "calculator",
      add: (left, right) => left + right,
      load: async () => "loaded"
    });

    expect(service.name).toBe("calculator");
    expect(service.add(2, 3)).toBe(5);
    await expect(service.load()).resolves.toBe("loaded");
    expect(service.calls).toEqual([
      { method: "add", args: [2, 3], result: 5 },
      { method: "load", args: [], result: "loaded" }
    ]);
  });

  it("records thrown and rejected errors", async () => {
    const thrown = new Error("thrown");
    const rejected = new Error("rejected");
    const service = fakeService<CalculatorService>({
      fail: () => {
        throw thrown;
      },
      load: async () => {
        throw rejected;
      }
    });

    expect(() => service.fail()).toThrow(thrown);
    await expect(service.load()).rejects.toBe(rejected);
    expect(service.calls).toEqual([
      { method: "fail", args: [], error: thrown },
      { method: "load", args: [], error: rejected }
    ]);
  });

  it("throws and records an error for unstubbed methods", () => {
    const service = fakeService<CalculatorService>();

    expect(() => service.missing()).toThrow('Unstubbed service method "missing" was called.');
    expect(service.calls).toMatchObject([
      { method: "missing", args: [], error: expect.any(Error) }
    ]);
  });

  it("preserves the fake as this and records undefined results", () => {
    interface StatefulService {
      value: number;
      read(): number;
      reset(): void;
    }
    const service = fakeService<StatefulService>({
      value: 4,
      read() {
        return this.value;
      },
      reset() {}
    });

    expect(service.read()).toBe(4);
    expect(service.reset()).toBeUndefined();
    expect(service.calls).toEqual([
      { method: "read", args: [], result: 4 },
      { method: "reset", args: [], result: undefined }
    ]);
  });
});

describe("fakeFetch", () => {
  it("uses the first matching route and records requests", async () => {
    const fetch = fakeFetch([
      { url: (url) => url.endsWith("/items"), json: { route: "first" } },
      { url: "https://example.com/items", json: { route: "second" } }
    ]);

    const response = await fetch("https://example.com/items");

    await expect(response.json()).resolves.toEqual({ route: "first" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(fetch.calls).toHaveLength(1);
    expect(fetch.calls[0]?.url).toBe("https://example.com/items");
    expect(fetch.calls[0]?.method).toBe("GET");
  });

  it("matches methods case-insensitively and returns text responses", async () => {
    const fetch = fakeFetch([
      { method: "post", url: "https://example.com/items", status: 201, text: "created" }
    ]);

    const response = await fetch("https://example.com/items", { method: "POST" });

    expect(response.status).toBe(201);
    await expect(response.text()).resolves.toBe("created");
  });

  it("treats an omitted route method as unconstrained", async () => {
    const fetch = fakeFetch([{ url: "https://example.com/items", text: "matched" }]);

    const response = await fetch("https://example.com/items", { method: "DELETE" });

    await expect(response.text()).resolves.toBe("matched");
  });

  it("throws route errors after recording the request", async () => {
    const routeError = new Error("offline");
    const fetch = fakeFetch([{ url: "https://example.com/items", error: routeError }]);

    await expect(fetch("https://example.com/items")).rejects.toBe(routeError);
    expect(fetch.calls).toHaveLength(1);
  });

  it("throws for unmatched requests and lists configured routes", async () => {
    const fetch = fakeFetch([
      { method: "POST", url: "https://example.com/items" },
      { url: (url) => url.endsWith("/users") }
    ]);

    await expect(fetch("https://example.com/missing")).rejects.toThrow(
      "No fake fetch route matched GET https://example.com/missing. Configured routes: POST https://example.com/items, * <predicate>."
    );
    expect(fetch.calls).toHaveLength(1);
  });

  it.each([204, 205, 304])("supports bodyless response status %s", async (status) => {
    const fetch = fakeFetch([{ method: "DELETE", url: "https://example.com/items/1", status }]);

    const response = await fetch("https://example.com/items/1", { method: "DELETE" });

    expect(response.status).toBe(status);
    await expect(response.text()).resolves.toBe("");
  });

  it("records a normalized Request including init overrides", async () => {
    const fetch = fakeFetch([{ method: "PATCH", url: "https://example.com/items/1", json: null }]);
    const input = new Request("https://example.com/items/1", {
      method: "POST",
      headers: { "x-source": "input" }
    });

    const response = await fetch(input, {
      method: "PATCH",
      headers: { "x-source": "override" }
    });

    await expect(response.json()).resolves.toBeNull();
    expect(fetch.calls[0]?.method).toBe("PATCH");
    expect(fetch.calls[0]?.headers.get("x-source")).toBe("override");
  });
});
