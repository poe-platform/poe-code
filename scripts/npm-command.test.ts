import { afterEach, describe, expect, it, vi } from "vitest";
import { runNpm } from "./npm-command.mjs";

const { execFileSync } = vi.hoisted(() => ({ execFileSync: vi.fn() }));
vi.mock("node:child_process", () => ({ execFileSync }));

afterEach(() => {
  execFileSync.mockReset();
  vi.unstubAllEnvs();
});

describe("runNpm", () => {
  it.each(["/compatible/npm-cli.js", "/manager with spaces/npm-cli.js", "/λ/npm-cli.js", undefined, ""])(
    "preserves manager selection and execution options (%s)",
    (npmExecPath) => {
      vi.stubEnv("npm_execpath", npmExecPath);
      const args = ["pack", "/package with spaces", "--json"];
      const options = { cwd: "/workspace", encoding: "utf8" };
      execFileSync.mockReturnValue("archive metadata");

      expect(runNpm(args, options)).toBe("archive metadata");

      expect(execFileSync).toHaveBeenCalledExactlyOnceWith(
        npmExecPath ? process.execPath : "npm",
        npmExecPath ? [npmExecPath, ...args] : args,
        options
      );
      expect(execFileSync.mock.calls[0][2]).toBe(options);
      expect(args).toEqual(["pack", "/package with spaces", "--json"]);
      expect(process.env.npm_execpath).toBe(npmExecPath);
    }
  );

  it.each(["/explicit/npm-cli.js", undefined, ""])(
    "uses an explicit child environment instead of ambient metadata (%s)",
    (npmExecPath) => {
      vi.stubEnv("npm_execpath", "/ambient/npm-cli.js");
      const env = { npm_execpath: npmExecPath, PATH: "/child/bin" };
      const options = { env, stdio: "inherit" };

      runNpm(["install"], options);

      expect(execFileSync).toHaveBeenCalledExactlyOnceWith(
        npmExecPath ? process.execPath : "npm",
        npmExecPath ? [npmExecPath, "install"] : ["install"],
        options
      );
      expect(env).toEqual({ npm_execpath: npmExecPath, PATH: "/child/bin" });
      expect(process.env.npm_execpath).toBe("/ambient/npm-cli.js");
    }
  );

  it("preserves raw output when no execution options are supplied", () => {
    vi.stubEnv("npm_execpath", "/compatible/npm-cli.js");
    const output = Buffer.from("archive metadata");
    execFileSync.mockReturnValue(output);

    expect(runNpm(["pack"])).toBe(output);
    expect(execFileSync.mock.calls[0][2]).toEqual({});
  });

  it("does not retry another manager after the selected manager fails", () => {
    vi.stubEnv("npm_execpath", "/compatible/npm-cli.js");
    const failure = new Error("pack failed");
    execFileSync.mockImplementation(() => { throw failure; });

    expect(() => runNpm(["pack"])).toThrow(failure);
    expect(execFileSync).toHaveBeenCalledTimes(1);
  });
});
