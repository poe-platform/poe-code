import type * as Native from "./command-platform.js";
function unavailable(): never { throw new Error("This operation requires a host terminal or process. Supply explicit execution capabilities in Workers."); }
export const host = {
  cwd: () => "/", env: {}, argv: [], stdin: { isTTY: false },
  stderr: { write: (value: string) => { console.error(value); return true; } },
  stdout: { write: (value: string) => { console.log(value); return true; } },
  exit: unavailable, on: () => undefined, off: () => undefined, exitCode: 0
};
export const nodeSpawn: typeof Native.nodeSpawn = unavailable;
export const nodeSpawnSync: typeof Native.nodeSpawnSync = unavailable;
export const execShell: typeof Native.execShell = unavailable;
export const applyMiddlewares: typeof Native.applyMiddlewares = unavailable;
export const getSpawnConfig: typeof Native.getSpawnConfig = unavailable;
export const renderAcpStream: typeof Native.renderAcpStream = unavailable;
export const sessionCapture: typeof Native.sessionCapture = unavailable;
export const spawn: typeof Native.spawn = Object.assign(unavailable, { retry: unavailable, parallel: unavailable });
export const spawnLog: typeof Native.spawnLog = unavailable;
export const spawnStreaming: typeof Native.spawnStreaming = unavailable;
export const usageCapture: typeof Native.usageCapture = unavailable;
export const streamAcpEventsToDashboard: typeof Native.streamAcpEventsToDashboard = unavailable;
export const acp = { withAcpWriter: unavailable };
export const cancel: typeof Native.cancel = unavailable;
export const createDashboard: typeof Native.createDashboard = unavailable;
type CancelValue = typeof Native.isCancel extends (value: unknown) => value is infer T ? T : never;
export const isCancel = (_value: unknown): _value is CancelValue => false;
export const resolveOutputFormat = () => "json" as const;
export const select: typeof Native.select = unavailable;
export const shouldUseInteractiveDashboard = () => false;
export const text = { section: (value: string) => value };
export const fsPromises = {
  readFile: unavailable, writeFile: unavailable, mkdir: unavailable, unlink: unavailable,
  rename: unavailable, stat: unavailable, lstat: unavailable, readdir: unavailable,
  rmdir: unavailable, realpath: unavailable, chmod: unavailable
} as unknown as typeof Native.fsPromises;
