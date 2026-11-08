import { defineGroup } from "toolcraft";
import type { TerminalPilotCommandServices } from "./runtime.js";
import { closeSession } from "./close-session.js";
import { createSession } from "./create-session.js";
import { fill } from "./fill.js";
import { getSession } from "./get-session.js";
import { install } from "./install.js";
import { listSessions } from "./list-sessions.js";
import { pressKey } from "./press-key.js";
import { readHistory } from "./read-history.js";
import { readScreen } from "./read-screen.js";
import { resize } from "./resize.js";
import { screenshot } from "./screenshot.js";
import { sendSignal } from "./send-signal.js";
import { type } from "./type.js";
import { uninstall } from "./uninstall.js";
import { waitFor } from "./wait-for.js";
import { waitForExit } from "./wait-for-exit.js";

export { closeSession } from "./close-session.js";
export { createSession } from "./create-session.js";
export { fill } from "./fill.js";
export { getSession } from "./get-session.js";
export { install } from "./install.js";
export { listSessions } from "./list-sessions.js";
export { pressKey } from "./press-key.js";
export { readHistory } from "./read-history.js";
export { readScreen } from "./read-screen.js";
export { resize } from "./resize.js";
export { screenshot } from "./screenshot.js";
export { sendSignal } from "./send-signal.js";
export { type } from "./type.js";
export { uninstall } from "./uninstall.js";
export { waitFor } from "./wait-for.js";
export { waitForExit } from "./wait-for-exit.js";
export { createTerminalPilotRuntime, SESSION_ENV_VAR } from "./runtime.js";
export type { TerminalPilotCommandServices, TerminalPilotRuntime } from "./runtime.js";

const children = [
  createSession,
  fill,
  type,
  pressKey,
  sendSignal,
  waitFor,
  waitForExit,
  readScreen,
  screenshot,
  readHistory,
  resize,
  closeSession,
  getSession,
  listSessions,
  install,
  uninstall
] as const;

export function createTerminalPilotGroup() {
  return defineGroup<TerminalPilotCommandServices, "terminal-pilot", typeof children, readonly ["cli", "mcp", "sdk"]>({
    name: "terminal-pilot",
    scope: ["cli", "mcp", "sdk"],
    children: [...children] as unknown as typeof children
  });
}

export const terminalPilotGroup = Object.freeze(createTerminalPilotGroup());
