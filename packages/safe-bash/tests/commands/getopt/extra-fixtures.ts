import type { NativeCase } from "./fixtures.js";

export const extraNativeCases: readonly NativeCase[] = [
  { name: "ff-after-operand", argsHex: ["2d6f", "ff", "2d2d", "707265", "2dff", "7461696c"], env: { LC_ALL: "C", TZ: "UTC" }, stdinHex: "", status: 0, stdoutHex: "202d2d20277461696c270a", stderrHex: "" },
  { name: "ff-cluster-after-operand", argsHex: ["2d6f", "ff61", "2d2d", "707265", "2dff61", "7461696c"], env: { LC_ALL: "C", TZ: "UTC" }, stdinHex: "", status: 0, stdoutHex: "202d2d20272dff612720277461696c270a", stderrHex: "" },
];
