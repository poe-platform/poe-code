import { webcrypto as crypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { run } from "../run.js";
import { makeTimeModule } from "./time.js";

describe("makeTimeModule", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("uses host time and uuid generation", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    vi.spyOn(crypto, "randomUUID").mockReturnValue("123e4567-e89b-42d3-a456-426614174000");

    const time = makeTimeModule();

    expect(time.now()).toBe(1_700_000_000_000);
    expect(time.uuid()).toBe("123e4567-e89b-42d3-a456-426614174000");
  });

  it("generates unseeded UUIDs without Math.random", () => {
    const randomSpy = vi.spyOn(Math, "random");
    const uuid = makeTimeModule().uuid();

    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(randomSpy).not.toHaveBeenCalled();
  });

  it("propagates host UUID failures without falling back to Math.random", () => {
    const failure = new Error("Host UUID generation failed");
    vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
      throw failure;
    });
    const randomSpy = vi.spyOn(Math, "random");

    expect(() => makeTimeModule().uuid()).toThrow(failure);
    expect(randomSpy).not.toHaveBeenCalled();
  });

  it("returns a number within 5ms of Date.now at call time by default", () => {
    const time = makeTimeModule();
    const observed = time.now();

    expect(typeof observed).toBe("number");
    expect(Math.abs(observed - Date.now())).toBeLessThanOrEqual(5);
  });

  it("uses an injected now function deterministically", () => {
    const time = makeTimeModule({ now: () => 1_000 });

    expect(time.now()).toBe(1_000);
    expect(time.now()).toBe(1_000);
  });

  it("returns non-decreasing values with the default clock", () => {
    const time = makeTimeModule();

    expect(time.now()).toBeLessThanOrEqual(time.now());
  });

  it("uses host randomness when no seed is provided", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.25);

    const time = makeTimeModule();

    expect(time.random()).toBe(0.25);
  });

  it("produces deterministic random sequences for the same seed", () => {
    const first = makeTimeModule({ seed: 123 });
    const second = makeTimeModule({ seed: 123 });
    const third = makeTimeModule({ seed: 456 });

    const firstSequence = [first.random(), first.random(), first.random()];
    const secondSequence = [second.random(), second.random(), second.random()];
    const thirdSequence = [third.random(), third.random(), third.random()];

    expect(firstSequence).toEqual(secondSequence);
    expect(firstSequence).not.toEqual(thirdSequence);
    expect(firstSequence[0]).toBeGreaterThanOrEqual(0);
    expect(firstSequence[0]).toBeLessThan(1);
  });

  it("normalizes integer-equivalent seeds deterministically", () => {
    const zero = makeTimeModule({ seed: 0 });
    const negative = makeTimeModule({ seed: -1.9 });
    const wrapped = makeTimeModule({ seed: 4_294_967_295 });

    expect([zero.random(), zero.random()]).toEqual([0.23606797284446657, 0.278566908556968]);
    expect([negative.random(), negative.random()]).toEqual([wrapped.random(), wrapped.random()]);
  });

  it("generates deterministic uuid sequences when seeded", () => {
    const first = makeTimeModule({ seed: 123 });
    const second = makeTimeModule({ seed: 123 });
    const third = makeTimeModule({ seed: 456 });

    const firstSequence = [first.uuid(), first.uuid()];
    const secondSequence = [second.uuid(), second.uuid()];
    const thirdSequence = [third.uuid(), third.uuid()];

    expect(firstSequence).toEqual(secondSequence);
    expect(firstSequence).not.toEqual(thirdSequence);
    expect(firstSequence[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it("validates seeded randomness input", () => {
    expect(() => makeTimeModule({ seed: Number.NaN })).toThrow(
      new TypeError("Seeded random requires a finite numeric seed.")
    );
    expect(() => makeTimeModule({ seed: Number.POSITIVE_INFINITY })).toThrow(
      new TypeError("Seeded random requires a finite numeric seed.")
    );
  });

  it("reads host functions at call time when unseeded", () => {
    const time = makeTimeModule();

    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_001);
    const uuidSpy = vi
      .spyOn(crypto, "randomUUID")
      .mockReturnValue("123e4567-e89b-42d3-a456-426614174001");

    expect(time.random()).toBe(0.5);
    expect(time.now()).toBe(1_700_000_000_001);
    expect(time.uuid()).toBe("123e4567-e89b-42d3-a456-426614174001");
    expect(randomSpy).toHaveBeenCalledTimes(1);
    expect(nowSpy).toHaveBeenCalledTimes(1);
    expect(uuidSpy).toHaveBeenCalledTimes(1);
  });

  it("resolves sleep after at least the requested milliseconds", async () => {
    const time = makeTimeModule();
    const start = performance.now();

    await time.sleep(50);

    expect(performance.now() - start).toBeGreaterThanOrEqual(50);
  });

  it("resolves sleep(0) asynchronously", async () => {
    const time = makeTimeModule();
    let resolved = false;

    const sleep = time.sleep(0).then(() => {
      resolved = true;
    });

    expect(resolved).toBe(false);
    await sleep;
    expect(resolved).toBe(true);
  });

  it("rejects negative sleep input with a RangeError", async () => {
    const time = makeTimeModule();

    await expect(time.sleep(-1)).rejects.toThrow(
      new RangeError("time.sleep(ms) requires a non-negative finite millisecond delay.")
    );
  });

  it("surfaces negative sleep input as a RangeError-shaped sandbox error", async () => {
    const result = await run(
      [
        'import * as time from "time";',
        "try {",
        "  await time.sleep(-1);",
        "} catch ({ name, message }) {",
        "  return JSON.stringify(Array.of(name, message));",
        "}"
      ].join("\n"),
      {
        modules: {
          time: makeTimeModule()
        }
      }
    );

    expect(result).toMatchObject({
      ok: true,
      returnValue: JSON.stringify([
        "RangeError",
        "time.sleep(ms) requires a non-negative finite millisecond delay."
      ])
    });
  });

  it("rejects immediately when sleep is called after abort", async () => {
    const controller = new AbortController();
    controller.abort();
    const time = makeTimeModule({ signal: controller.signal });
    const start = performance.now();

    await expect(time.sleep(1_000)).rejects.toThrow(new Error("time.sleep aborted."));

    expect(performance.now() - start).toBeLessThan(20);
  });

  it("rejects promptly when sleep is aborted during the wait", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const time = makeTimeModule({ signal: controller.signal });
    const sleep = time.sleep(1_000);

    await vi.advanceTimersByTimeAsync(20);
    controller.abort();

    await expect(sleep).rejects.toThrow(new Error("time.sleep aborted."));
  });

  it("resolves concurrent sleeps independently", async () => {
    const time = makeTimeModule();
    const completed: string[] = [];

    await Promise.all([
      time.sleep(5).then(() => completed.push("short")),
      time.sleep(15).then(() => completed.push("medium")),
      time.sleep(25).then(() => completed.push("long"))
    ]);

    expect(completed.sort()).toEqual(["long", "medium", "short"]);
  });
});
