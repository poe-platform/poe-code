export const candidate = "f44958bf48778737a58535e2bc9b37c292ac28c4";

export const inspectGuest = `
function surface(value) {
  const callable = typeof value === "function";
  const spread = callable ? null : { ...value };
  const assigned = Object.assign({}, value);
  return {
    callable,
    keys: Object.keys(value).sort(),
    entries: Object.entries(value).map(entry => [entry[0], typeof entry[1]]).sort(),
    spreadKeys: callable ? null : Object.keys(spread).sort(),
    assignedKeys: Object.keys(assigned).sort(),
    cleanup: typeof value.registerCleanup,
    ownCleanup: Object.hasOwn(value, "registerCleanup"),
    spreadCleanup: callable ? "unsupported-function-spread" : typeof spread.registerCleanup,
    assignedCleanup: typeof assigned.registerCleanup,
    context: typeof value.context,
    invoke: typeof value.invoke,
    prototype: typeof value.prototype,
    proto: typeof value.__proto__,
    constructor: typeof value.constructor
  };
}
`;

const commandImports = 'import * as command from "command"; import * as stdio from "stdio"; import * as fs from "fs";';

export const cases = [
  {
    name: "command-facades",
    route: "command",
    source: commandImports + inspectGuest + `
return [
  ["command", surface(command)], ["stdio", surface(stdio)], ["fs", surface(fs)],
  ["command.args", surface(command.args)], ["command.env", surface(command.env)],
  ["command.setExitCode", surface(command.setExitCode)],
  ["command.setExitCode.call", surface(command.setExitCode.call)],
  ["command.setExitCode.apply", surface(command.setExitCode.apply)],
  ["stdio.readText", surface(stdio.readText)], ["stdio.write", surface(stdio.write)],
  ["fs.readFile", surface(fs.readFile)], ["fs.writeFile", surface(fs.writeFile)]
];`,
    assertion: "surfaces",
  },
  {
    name: "reflection-availability",
    route: "command",
    source: commandImports + `
const probes = [
  ["getOwnPropertyDescriptor", typeof Object.getOwnPropertyDescriptor],
  ["getOwnPropertyDescriptors", typeof Object.getOwnPropertyDescriptors],
  ["getOwnPropertyNames", typeof Object.getOwnPropertyNames],
  ["getOwnPropertySymbols", typeof Object.getOwnPropertySymbols],
  ["getPrototypeOf", typeof Object.getPrototypeOf], ["Reflect", typeof Reflect]
];
return probes;`,
    negativeSources: [
      { source: 'import * as command from "command"; return Object.getOwnPropertyDescriptor(command, "registerCleanup");', stderr: "safejs: Attempted to call a non-function value.\n" },
      { source: 'import * as command from "command"; return Object.getPrototypeOf(command);', stderr: "safejs: Attempted to call a non-function value.\n" },
      { source: 'import * as command from "command"; return Reflect.ownKeys(command);', stderr: "safejs: Identifier 'Reflect' is not defined.\n" },
      { source: 'import { setExitCode } from "command"; return { ...setExitCode };', stderr: "safejs: Cannot spread function into object literal.\n" },
    ],
    assertion: "reflection",
  },
  {
    name: "closure-and-context-paths",
    route: "command",
    source: commandImports + `
return [typeof command.registerCleanup, typeof command.context, typeof command.invoke,
  typeof command.signal, typeof command.stdin, typeof command.stdout, typeof command.fs,
  typeof context, typeof registerCleanup,
  typeof command.setExitCode.call, typeof command.setExitCode.apply,
  typeof command.setExitCode.bind, typeof command.setExitCode.caller,
  typeof command.setExitCode.arguments, typeof command.setExitCode.closure,
  typeof stdio.write.context, typeof fs.readFile.context];`,
    assertion: "undefined-list",
  },
  {
    name: "missing-cleanup-export",
    route: "command",
    source: 'import { registerCleanup } from "command"; return typeof registerCleanup;',
    assertion: "missing-export",
  },
  {
    name: "no-effect-absent-cleanup-call",
    route: "command",
    source: 'import * as command from "command"; if (typeof command.registerCleanup !== "undefined") throw new Error("unexpected cleanup exposure: stop before effect"); command.registerCleanup(() => "bounded-unused-marker");',
    assertion: "absent-call",
  },
  {
    name: "guest-local-lookalike-and-fresh-invocation",
    route: "command",
    source: 'import * as command from "command"; command.registerCleanup = () => "guest-only"; return [command.registerCleanup(), typeof command.env.registerCleanup, command.env.registerCleanup];',
    followup: 'import * as command from "command"; return [typeof command.registerCleanup, command.env.registerCleanup];',
    assertion: "local-only",
  },
  {
    name: "bounded-step-budget-no-cleanup-authority",
    route: "command",
    source: 'import * as command from "command"; if (typeof command.registerCleanup !== "undefined") throw new Error("unexpected cleanup exposure: stop before effect"); let total = 0; for (let index = 0; index < 1000; index++) total += index; return total;',
    limits: { maxSteps: 100 },
    assertion: "step-budget",
  },
  {
    name: "pre-abort-no-runner-admission",
    route: "command",
    source: 'import * as command from "command"; return typeof command.registerCleanup;',
    preAbort: true,
    assertion: "cancel",
  },
  {
    name: "live-abort-after-property-probe",
    route: "command",
    source: 'import * as command from "command"; import { write } from "stdio"; if (typeof command.registerCleanup !== "undefined") throw new Error("unexpected cleanup exposure: stop before effect"); await write("surface-probed"); return "must-not-print";',
    abortOnWrite: true,
    assertion: "cancel",
  },
  {
    name: "standalone-shell-facade-no-dispatch",
    route: "bridge",
    source: 'import * as shell from "shell";' + inspectGuest + 'return [["shell", surface(shell)], ["shell.exec", surface(shell.exec)]];',
    assertion: "surfaces",
  },
  {
    name: "shell-option-cleanup-rejected-before-dispatch",
    route: "bridge",
    source: 'import { exec } from "shell"; return await exec("true", { registerCleanup: "not-authority" });',
    assertion: "bad-option",
  },
  {
    name: "shell-result-facade",
    route: "bridge",
    source: 'import { exec } from "shell";' + inspectGuest + 'const result = await exec("true"); return [["shell.result", surface(result)]];',
    assertion: "surfaces",
    dispatches: 1,
  },
  {
    name: "fs-stat-result-facade",
    route: "command",
    source: 'import { stat } from "fs";' + inspectGuest + 'const info = await stat("/work/sentinel"); return [["fs.stat.result", surface(info)], ["fs.stat.isFile", surface(info.isFile)]];',
    assertion: "surfaces",
    reads: 1,
  },
];
