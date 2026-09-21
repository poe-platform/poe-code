import { expect, it } from "vitest";
import { analysisTools } from "./catalog.js";
import { prepareToolTest } from "./protocol.js";
import type { CapabilityContext } from "../contracts.js";

const context: CapabilityContext = { signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 1000, sheets: 10, operations: 10000 }, own() {} };

it("inventories every released run_tool_test name independently of the GUI", () => {
  expect(Object.keys(analysisTools).sort()).toEqual([
    "regression", "moving-average", "anova", "anova2", "chi-squared-test", "descriptive-statistics", "correlation", "covariance", "fourier-analysis", "sampling", "ranking", "exponential-smoothing", "histogram", "sign-test", "frequency-tables", "principal-components", "auto-expression", "normality-test", "one-mean-test", "wilcoxon-signed-rank-test", "wilcoxon-signed-rank-test-two-samples", "advanced-filter", "wilcoxon-mann-whitney", "sign-test-two-samples", "f-test", "t-test-paired", "t-test-equal-variances", "t-test-unequal-variances", "kaplan-meier", "z-test", "fill-series",
  ].sort());
});

it.each(["consolidate", "random-generator", "random-generator-cor"])("explicitly rejects GUI-only %s", async tool => {
  await expect(prepareToolTest({ sheets: [{ id: "s", name: "Input", cells: [] }] }, [tool], context))
    .rejects.toMatchObject({ code: "invalid-request", message: `no test for tool "${tool}"` });
});
