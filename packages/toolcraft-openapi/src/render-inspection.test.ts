import { afterEach, describe, expect, it } from "vitest";
import { resetOutputFormatCache, stripAnsi, withOutputFormat } from "toolcraft-design";
import { renderOpenApiInspection, type OpenApiInspectionReport } from "./render-inspection.js";
import { createForgeyardSpec } from "./mock.js";
import { inspectOpenApiDocument } from "./inspect.js";

const report: OpenApiInspectionReport = {
  title: "Northstar API",
  version: "1.0.0",
  operationCount: 3,
  supportedCount: 2,
  unsupportedCount: 1,
  operations: [
    {
      method: "GET",
      path: "/widgets",
      operationId: "listWidgets",
      status: "supported",
      commandPath: "widgets list"
    },
    {
      method: "POST",
      path: "/widgets",
      operationId: "createWidget",
      status: "unsupported",
      reason: "Nested objects are not supported."
    },
    {
      method: "GET",
      path: "/health",
      operationId: "getHealth",
      status: "supported",
      commandPath: "health get"
    }
  ]
};

afterEach(() => resetOutputFormatCache());

describe("renderOpenApiInspection", () => {
  it("renders operations grouped by generated noun or first path segment", () => {
    const originalNoColor = process.env.NO_COLOR;
    process.env.NO_COLOR = "1";

    try {
      expect(stripAnsi(renderOpenApiInspection(report))).toContain("widgets  2");
      expect(stripAnsi(renderOpenApiInspection(report))).toContain("health  1");
      expect(stripAnsi(renderOpenApiInspection(report))).toContain("67% compatible");
      expect(stripAnsi(renderOpenApiInspection(report))).toContain("ready");
      expect(stripAnsi(renderOpenApiInspection(report))).toContain("blocked");
    } finally {
      if (originalNoColor === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = originalNoColor;
    }
  });

  it("uses the shared json renderer", () => {
    const rendered = JSON.parse(withOutputFormat("json", () => renderOpenApiInspection(report)));
    expect(rendered).toEqual(report);
  });

  it("summarizes resource compatibility for massive APIs", () => {
    const rendered = stripAnsi(
      renderOpenApiInspection(inspectOpenApiDocument(createForgeyardSpec()))
    );

    expect(rendered).toContain("Forgeyard API  v1.0.0");
    expect(rendered).toContain("100% compatible · 538 operations · 538 supported · 0 unsupported");
    expect(rendered).toContain("resources  1");
    expect(rendered).toContain("538/538  all resources");
    expect(rendered).not.toContain("8/8  artifacts");
    expect(rendered).not.toContain("/v1/artifacts/{id}/archive");
  });

  it("summarizes the dominant incompatibilities for massive APIs", () => {
    const operations = Array.from({ length: 101 }, (_, index) => ({
      method: "POST" as const,
      path: `/widgets/${index}`,
      operationId: `createWidget${index}`,
      status: index < 3 ? ("unsupported" as const) : ("supported" as const),
      ...(index < 2
        ? { reason: "Cookie parameters are not supported." }
        : index === 2
          ? { reason: "Binary responses are not supported." }
          : { commandPath: `widgets create-${index}` })
    }));
    const rendered = stripAnsi(
      renderOpenApiInspection({
        title: "Massive API",
        operationCount: 101,
        supportedCount: 98,
        unsupportedCount: 3,
        operations
      })
    );

    expect(rendered).toContain("top incompatibilities  2");
    expect(rendered).toContain("2 routes  Cookie parameters are not supported.");
    expect(rendered).toContain("1 route   Binary responses are not supported.");
  });

  it("summarizes dense incompatible APIs before the route list overwhelms the terminal", () => {
    const operations = [
      ...Array.from({ length: 20 }, (_, index) => ({
        method: "PUT" as const,
        path: `/blocked/${index}`,
        operationId: `updateBlocked${index}`,
        status: "unsupported" as const,
        reason: "A JSON request body is required."
      })),
      ...Array.from({ length: 44 }, (_, index) => ({
        method: "GET" as const,
        path: `/ready/${index}`,
        operationId: `getReady${index}`,
        status: "supported" as const,
        commandPath: `ready get-${index}`
      }))
    ];
    const rendered = stripAnsi(
      renderOpenApiInspection({
        title: "Dense API",
        operationCount: 64,
        supportedCount: 44,
        unsupportedCount: 20,
        operations
      })
    );

    expect(rendered).toContain("Showing 1 of 2 command groups that need attention.");
    expect(rendered).toContain("0/20  blocked");
    expect(rendered).toContain("20 routes  A JSON request body is required.");
    expect(rendered).not.toContain("GET  /ready/0");
    expect(rendered).not.toContain("PUT  /blocked/0");
  });

  it("orders incompatible resource summaries by blocked route count", () => {
    const operations = [
      ...Array.from({ length: 2 }, (_, index) => ({
        method: "POST" as const,
        path: `/alpha/${index}`,
        operationId: `createAlpha${index}`,
        status: "unsupported" as const,
        reason: "Alpha is unsupported."
      })),
      ...Array.from({ length: 4 }, (_, index) => ({
        method: "POST" as const,
        path: `/zeta/${index}`,
        operationId: `createZeta${index}`,
        status: "unsupported" as const,
        reason: "Zeta is unsupported."
      })),
      ...Array.from({ length: 55 }, (_, index) => ({
        method: "GET" as const,
        path: `/ready/${index}`,
        operationId: `getReady${index}`,
        status: "supported" as const,
        commandPath: `ready get-${index}`
      }))
    ];
    const rendered = stripAnsi(
      renderOpenApiInspection({
        title: "Prioritized API",
        operationCount: operations.length,
        supportedCount: 55,
        unsupportedCount: 6,
        operations
      })
    );

    expect(rendered.indexOf("0/4  zeta")).toBeLessThan(rendered.indexOf("0/2  alpha"));
  });
});
