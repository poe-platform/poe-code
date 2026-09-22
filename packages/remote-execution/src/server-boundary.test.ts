import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const specifier = "@poe-code/remote-execution/server";
function resolveServer(condition?: string) {
  const program = `try { console.log(JSON.stringify({url: import.meta.resolve(${JSON.stringify(specifier)})})); } catch (error) { console.log(JSON.stringify({code: error.code})); }`;
  return JSON.parse(execFileSync(process.execPath, [
    ...(condition ? [`--conditions=${condition}`] : []), "--input-type=module", "-e", program
  ], { encoding: "utf8" }));
}

describe("Node-only server export", () => {
  it.each(["browser", "workerd"])("rejects %s even when Node is also active", condition => {
    expect(resolveServer(condition)).toEqual({ code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
  });
  it("resolves the explicit Node server entrypoint", () => {
    expect(resolveServer().url.endsWith("/dist/server.js")).toBe(true);
  });
});
