import assert from "node:assert/strict";
import { test } from "node:test";
import { signalName as exportedSignalName } from "./index.js";
import { parseSignal, signalName } from "./signal.js";

test("the command export shares the virtual signal catalog used by jobs", () => {
  assert.equal(exportedSignalName, signalName);
  const names = [
    "HUP", "INT", "QUIT", "ILL", "TRAP", "ABRT", "BUS", "FPE", "KILL", "USR1", "SEGV",
    "USR2", "PIPE", "ALRM", "TERM", "STKFLT", "CHLD", "CONT", "STOP", "TSTP", "TTIN",
    "TTOU", "URG", "XCPU", "XFSZ", "VTALRM", "PROF", "WINCH", "IO", "PWR", "SYS",
  ];
  for (const [index, name] of names.entries()) {
    assert.equal(signalName(index + 1), name);
    assert.equal(parseSignal(`SIG${name}`), index + 1);
  }
});

test("unnamed virtual signals retain their numeric spelling", () => {
  for (const number of [0, 32, 33, 34, 64, 65, -1, 1.5, NaN, Infinity, -Infinity]) {
    assert.equal(signalName(number), String(number));
  }
});
