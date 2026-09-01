import { PassThrough } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { createFsFromVolume, Volume } from "memfs";

const entry = process.argv[4] ?? new URL("../src/supervisor/supervisor.ts", import.meta.url).href;
const { createSupervisor } = await import(entry);
const output = process.argv[2] ?? "stdout";
const withErrorHandler = process.argv[3] !== "no-handler";
const fs = createFsFromVolume(new Volume()).promises;
const appendFile = fs.appendFile.bind(fs);
const failure = Object.assign(new Error("Fixture: temporary full disk"), { code: "ENOSPC" });
let attempts = 0;
fs.appendFile = async (...args) => {
  attempts += 1;
  if (attempts === 1) throw failure;
  return await appendFile(...args);
};
const stdout = new PassThrough();
const stderr = new PassThrough();
let finish;
const result = new Promise(resolve => { finish = resolve; });
let kills = 0;
const errors = [];
const lines = [];
const supervisor = createSupervisor({
  fs,
  runner: {
    name: "fixture",
    exec: () => ({
      pid: 4242, stdin: null, stdout, stderr, result,
      kill() {
        kills += 1;
        stdout.end();
        stderr.end();
        finish({ exitCode: 0 });
      }
    })
  },
  spec: { id: "log-failure", command: "fixture-only", restart: "never" },
  stateDir: "/state",
  startSettleMs: 0,
  onLog: (line, stream) => lines.push({ line, stream }),
  ...(withErrorHandler ? { onError: error => errors.push({ same: error === failure, code: error.code }) } : {})
});

try {
  await supervisor.start();
  const stream = output === "stderr" ? stderr : stdout;
  stream.write("lost\n");
  await delay(25);
  const duringFailure = { status: supervisor.getState().status, errors: errors.length, kills };
  stream.write("saved\n");
  await supervisor.stop();
  const deadline = Date.now() + 1000;
  while (supervisor.getState().lastExitCode === null && Date.now() < deadline) await delay(5);
  let persisted = null;
  try {
    persisted = await fs.readFile(`/state/log-failure/logs/${output}.log`, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  console.log(JSON.stringify({ duringFailure, state: supervisor.getState(), errors, lines, attempts, kills, persisted }));
} finally {
  await supervisor.stop();
}
