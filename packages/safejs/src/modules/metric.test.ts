import { describe, expect, it, vi } from "vitest";

import { makeMetricModule } from "./metric.js";

describe("makeMetricModule", () => {
  it("runs metric scripts by npm script name and parses the last non-empty stdout line", async () => {
    const npmRunner = vi.fn(async () => "progress\n41\n\n42\n");
    const metric = makeMetricModule(npmRunner);

    await expect(metric.run("tests")).resolves.toBe(42);
    expect(npmRunner).toHaveBeenCalledWith("metric:tests");
  });

  it("trims the metric name before resolving the npm script", async () => {
    const npmRunner = vi.fn(async () => "\n  7.5 \n");
    const metric = makeMetricModule(npmRunner);

    await expect(metric.run("  tests  ")).resolves.toBe(7.5);
    expect(npmRunner).toHaveBeenCalledWith("metric:tests");
  });

  it("throws when the metric output does not end with a numeric score", async () => {
    const metric = makeMetricModule(async () => "score: great");

    await expect(metric.run("tests")).rejects.toThrow(
      'Metric script "metric:tests" must print a numeric score.'
    );
  });

  it("throws when the metric runner resolves to a non-string stdout value", async () => {
    const metric = makeMetricModule(async () => 42 as unknown as string);

    await expect(metric.run("tests")).rejects.toThrow(
      'Metric runner for "metric:tests" must resolve to a stdout string.'
    );
  });

  it.each(["", "   \n\t  ", "Infinity\n", "-Infinity\n", "NaN\n"])(
    "rejects invalid metric stdout: %j",
    async (stdout) => {
      const metric = makeMetricModule(async () => stdout);

      await expect(metric.run("tests")).rejects.toThrow(
        'Metric script "metric:tests" must print a numeric score.'
      );
    }
  );

  it("rejects blank metric names before invoking the npm runner", async () => {
    const npmRunner = vi.fn(async () => "1");
    const metric = makeMetricModule(npmRunner);

    await expect(metric.run("   ")).rejects.toThrow("Metric name must be a non-empty string.");
    expect(npmRunner).not.toHaveBeenCalled();
  });
});
