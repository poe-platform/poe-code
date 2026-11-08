import { expect, it } from "vitest";
import { TerminalBuffer } from "./terminal-buffer.js";

it.each(["38;2;0;102;153", "38:2::0:102:153", "38:2:0:0:102:153"])("preserves zero-red RGB in %s", code => {
  const buffer = new TerminalBuffer(10, 2);
  buffer.write(`\x1b[${code}mX`);
  expect(buffer.renderLine(0)).toContain("38;2;0;102;153");
});
