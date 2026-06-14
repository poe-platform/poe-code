import { describe, expect, it } from "vitest";

import { AS009 } from "./AS009.js";

describe("AS009", () => {
  const reportedCalls = (source: string) =>
    AS009(source).map((diagnostic) =>
      source.slice(diagnostic.span.start.offset, diagnostic.span.end.offset)
    );

  it("reports async arrows that return a direct host call without awaiting it", () => {
    const source = ['import { request } from "api";', "const run = async () => request();"].join(
      "\n"
    );

    expect(AS009(source, { filename: "rule.js" })).toEqual([
      {
        code: "AS009",
        severity: "error",
        message:
          "Async arrow returns a host call without awaiting it. Add 'await' or document that this function intentionally returns a Promise.",
        filename: "rule.js",
        line: 2,
        column: 25,
        span: {
          start: { line: 2, column: 25, offset: source.indexOf("request()") },
          end: { line: 2, column: 34, offset: source.indexOf("request()") + "request()".length }
        }
      }
    ]);
  });

  it("reports async arrows that return a namespace host call without awaiting it", () => {
    const source = [
      'import * as agent from "agent";',
      "const run = async () => agent.spawn();"
    ].join("\n");

    expect(AS009(source)).toEqual([
      {
        code: "AS009",
        severity: "error",
        message:
          "Async arrow returns a host call without awaiting it. Add 'await' or document that this function intentionally returns a Promise.",
        filename: "<input>",
        line: 2,
        column: 25,
        span: {
          start: { line: 2, column: 25, offset: source.indexOf("agent.spawn()") },
          end: {
            line: 2,
            column: 38,
            offset: source.indexOf("agent.spawn()") + "agent.spawn()".length
          }
        }
      }
    ]);
  });

  it("allows explicit awaits and non-host returns", () => {
    const source = [
      'import { request } from "api";',
      'import * as agent from "agent";',
      "const awaited = async () => await request();",
      "const block = async () => {",
      "  return await agent.spawn();",
      "};",
      "const passthrough = async (request) => request();"
    ].join("\n");

    expect(AS009(source, { filename: "rule.js" })).toEqual([]);
  });

  it("ignores shadowed imports, sync arrows, and nested expression usage", () => {
    const source = [
      'import { request } from "api";',
      'import * as agent from "agent";',
      "const syncRun = () => request();",
      "const shadowedParam = async (request) => request();",
      "const shadowedBlock = async () => {",
      "  const request = () => Promise.resolve('ok');",
      "  return request();",
      "};",
      "const namespaceShadow = async (agent) => agent.spawn();",
      "const wrapped = async () => other(request());"
    ].join("\n");

    expect(AS009(source, { filename: "rule.js" })).toEqual([]);
  });

  it("reports only the nested async arrow that forgets to await a host call", () => {
    const source = [
      'import { request } from "api";',
      "const outer = async () => {",
      "  return async () => request();",
      "};"
    ].join("\n");

    expect(AS009(source, { filename: "rule.js" })).toEqual([
      {
        code: "AS009",
        severity: "error",
        message:
          "Async arrow returns a host call without awaiting it. Add 'await' or document that this function intentionally returns a Promise.",
        filename: "rule.js",
        line: 3,
        column: 22,
        span: {
          start: { line: 3, column: 22, offset: source.indexOf("request()") },
          end: { line: 3, column: 31, offset: source.indexOf("request()") + "request()".length }
        }
      }
    ]);
  });

  it("allows host calls nested inside conditional return expressions", () => {
    const source = [
      'import { request } from "api";',
      "const run = async () => ready ? request() : 'skip';"
    ].join("\n");

    expect(reportedCalls(source)).toEqual([]);
  });

  it("reports host calls returned from default-exported async arrows", () => {
    const source = ['import { request } from "api";', "export default async () => request();"].join(
      "\n"
    );

    expect(reportedCalls(source)).toEqual(["request()"]);
  });

  it("reports host calls returned from inner async arrows that are exported handlers", () => {
    const source = [
      'import * as agent from "agent";',
      "export default () => async () => agent.spawn();"
    ].join("\n");

    expect(reportedCalls(source)).toEqual(["agent.spawn()"]);
  });

  it("allows host calls nested inside template-literal interpolation because they are not directly returned", () => {
    const source = [
      'import { request } from "api";',
      "const run = async () => `${request()}`;"
    ].join("\n");

    expect(AS009(source)).toEqual([]);
  });

  it("reports direct host calls returned from async block bodies", () => {
    const source = [
      'import { request } from "api";',
      "const run = async () => {",
      "  return request();",
      "};"
    ].join("\n");

    expect(reportedCalls(source)).toEqual(["request()"]);
  });

  it("reports computed namespace host calls returned by async arrows", () => {
    const source = [
      'import * as agent from "agent";',
      'const run = async () => agent["spawn"]();'
    ].join("\n");

    expect(reportedCalls(source)).toEqual(['agent["spawn"]()']);
  });

  it("ignores host calls inside async arrow parameter defaults", () => {
    const source = [
      'import { request } from "api";',
      "const run = async (value = request()) => value;"
    ].join("\n");

    expect(AS009(source)).toEqual([]);
  });
});
