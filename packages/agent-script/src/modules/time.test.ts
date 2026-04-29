import { afterEach, describe, expect, it, vi } from "vitest";

import { makeTimeModule } from "./time.js";

describe("makeTimeModule", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses host time and uuid generation", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    vi.spyOn(crypto, "randomUUID").mockReturnValue("123e4567-e89b-42d3-a456-426614174000");

    const time = makeTimeModule();

    expect(time.now()).toBe(1_700_000_000_000);
    expect(time.uuid()).toBe("123e4567-e89b-42d3-a456-426614174000");
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
    const uuidSpy = vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "123e4567-e89b-42d3-a456-426614174001"
    );

    expect(time.random()).toBe(0.5);
    expect(time.now()).toBe(1_700_000_000_001);
    expect(time.uuid()).toBe("123e4567-e89b-42d3-a456-426614174001");
    expect(randomSpy).toHaveBeenCalledTimes(1);
    expect(nowSpy).toHaveBeenCalledTimes(1);
    expect(uuidSpy).toHaveBeenCalledTimes(1);
  });
});
