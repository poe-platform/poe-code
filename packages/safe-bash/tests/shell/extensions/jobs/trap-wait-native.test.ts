import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { constants } from "node:os";
import { Duplex } from "node:stream";
import test from "node:test";
import { authenticateOracle, nativeOptions } from "../trap/oracle.js";

const profile = Object.freeze({
  sha256: "f5b331844c67482075aea7883153127668cc67f83a60a7b4362cc8469a9dc77d",
  timeoutMs: 2000,
  cleanupMs: 1000,
  maxOutputBytes: 65536,
  maxSignals: 1024,
  retryMs: 1,
});

interface SignalControlOptions {
  readonly send: () => void;
  readonly startWait: () => void;
  readonly releaseChild: () => void;
  readonly failed: (reason: unknown) => void;
  readonly schedule: (callback: () => void) => () => void;
  readonly maximum: number;
}

function signalController(options: SignalControlOptions) {
  const ready = new Set<string>();
  let stopped = false;
  let started = false;
  let signals = 0;
  let cancel: (() => void) | undefined;
  const close = () => {
    stopped = true;
    cancel?.();
    cancel = undefined;
  };
  const pulse = () => {
    if (stopped) return;
    try {
      if (signals >= options.maximum) throw new Error("native wait signal limit exceeded");
      signals++;
      options.send();
      cancel = options.schedule(() => { cancel = undefined; pulse(); });
    } catch (reason) {
      close();
      options.failed(reason);
    }
  };
  return {
    ready(owner: "waiter" | "child") {
      if (stopped || ready.has(owner)) return;
      ready.add(owner);
      if (ready.size === 2) pulse();
    },
    prewait() {
      if (stopped || started || signals === 0) return;
      started = true;
      options.startWait();
    },
    interrupted() {
      if (stopped || !started) return;
      close();
      options.releaseChild();
    },
    close,
  };
}

const waitForms = Object.freeze([
  { name: "all", source: "wait", destination: "old" },
  { name: "specific", source: 'wait "$token"', destination: "old" },
  { name: "specific-p", source: 'wait -p chosen "$token"', destination: "unset" },
  { name: "next", source: "wait -n", destination: "old" },
  { name: "next-specific-p", source: 'wait -n -p chosen "$token"', destination: "unset" },
  { name: "next-p", source: "wait -n -p chosen", destination: "unset" },
]);

function waiterSource(wait: string, signal: "USR1" | "USR2"): string {
  return `phase=prewait
seen=0
chosen=old
number=$(kill -l ${signal})
trap 'trap_status=$?
if [[ $phase == waiting && $trap_status == $((128 + number)) ]]; then
  seen=1
  printf "WAITTRAP\\n" >&4
else
  printf "PRETRAP\\n" >&4
fi' ${signal}
{
  trap '' ${signal}
  exec 5<&-
  printf 'CHILD\\n' >&4
  IFS= read -r gate
  [[ $gate == release-child ]] || exit 92
  exit 7
} <&0 &
token=$!
printf 'SIGNAL:%s\\nWAITER\\n' "$number" >&4
while [[ \${start-} != start ]]; do
  IFS= read -r -t 0.01 start <&5
  read_status=$?
  ((read_status == 0 || read_status > 128)) || exit 91
done
phase=waiting
seen=0
${wait}
first=$?
trap '' ${signal}
kill -0 "$token"
live=$?
printf 'wait-status:%s trap:%s live:%s p:%s\\n' "$first" "$seen" "$live" "\${chosen-unset}"
printf 'INTERRUPTED\\n' >&4
wait "$token"
later=$?
[[ $! == "$token" ]]
identity=$?
printf 'later:%s identity:%s\\n' "$later" "$identity"
`;
}

const supervisorSource = `trap ':' "$3"
"$2" --noprofile --norc -c "$1" shell 3<&- <&0 &
worker=$!
exec 1>&- 2>&- 5>&-
while [[ \${retire-} != R ]]; do
  IFS= read -r -N1 retire <&3
  read_status=$?
  ((read_status == 0 || read_status > 128)) || exit 93
done
trap '' "$3"
printf 'RETIRED\\n' >&4
wait "$worker"
status=$?
exec 4>&-
IFS= read -r release <&3
[[ $release == release ]] || exit 94
exit "$status"
`;

async function nativeInterruptedWait(source: string, signal: "USR1" | "USR2") {
  const env = { ...process.env };
  // The profile retains the historical build digest; this run binds its explicit oracle before and after execution.
  const executable = authenticateOracle(env);
  try {
    return await new Promise<{ stdout: Buffer; stderr: Buffer; protocol: Buffer }>((resolve, reject) => {
      const child = spawn(executable, ["--noprofile", "--norc", "-c", supervisorSource,
        "trap-wait-supervisor", source, executable, signal], {
        detached: true,
        env: { PATH: "/__safe_bash_oracle_no_path__", LC_ALL: "C" },
        stdio: ["pipe", "pipe", "pipe", "pipe", "pipe", "pipe"],
      });
      const pipes: readonly (typeof child.stdio[number])[] = child.stdio;
      const anchor = pipes[3] as Duplex;
      const report = pipes[4] as Duplex;
      const start = pipes[5] as Duplex;
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      const protocol: Buffer[] = [];
      const ended = new Set<string>();
      let protocolPending = "";
      let bytes = 0;
      let failure: unknown;
      let failed = false;
      let exited = false;
      let closed = false;
      let released = false;
      let interrupted = false;
      let retired = false;
      let signalPending = false;
      let waitTrap = false;
      let prewait = false;
      let signalNumber = false;
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
      const fail = (reason: unknown) => {
        if (closed || failed) return;
        failed = true;
        failure = reason;
        controller.close();
        clearTimeout(deadline);
        if (!exited && !released && child.pid !== undefined) {
          try { process.kill(-child.pid, "SIGKILL"); }
          catch (cleanupReason) { failure = new AggregateError([reason, cleanupReason], "native wait cleanup signal failed"); }
        }
        cleanupTimer = setTimeout(() => {
          for (const stream of child.stdio) stream?.destroy();
          reject(new AggregateError([failure], "native wait cleanup did not reach close"));
        }, profile.cleanupMs);
      };
      const controller = signalController({
        maximum: profile.maxSignals,
        send() {
          if (closed || exited || released || child.pid === undefined) throw new Error("native wait owner is not live");
          if (signalPending) return;
          signalPending = true;
          process.kill(-child.pid, `SIG${signal}`);
        },
        startWait() { prewait = true; start.end("start\n"); },
        releaseChild() {
          interrupted = true;
          anchor.write("R");
          child.stdin!.end("release-child\n");
        },
        failed: fail,
        schedule(callback) {
          const timer = setTimeout(callback, profile.retryMs);
          return () => { clearTimeout(timer); };
        },
      });
      const deadline = setTimeout(() => { fail(new Error("native wait handshake deadline exceeded")); }, profile.timeoutMs);
      const protocolLine = (line: string) => {
        if (line === "WAITER") controller.ready("waiter");
        else if (line === "CHILD") controller.ready("child");
        else if (line === "PRETRAP") {
          if (waitTrap) throw new Error("unexpected trap after signal retirement");
          signalPending = false;
          controller.prewait();
        } else if (line === "WAITTRAP") {
          if (!prewait || waitTrap) throw new Error("unexpected wait trap acknowledgement");
          waitTrap = true;
        }
        else if (line === "INTERRUPTED") {
          if (!prewait || interrupted) throw new Error("unexpected interruption handshake");
          controller.interrupted();
        } else if (line === "RETIRED") {
          if (!interrupted || retired) throw new Error("unexpected signal retirement handshake");
          retired = true;
        } else if (line === `SIGNAL:${constants.signals[`SIG${signal}`]}` && !signalNumber) signalNumber = true;
        else throw new Error(`unexpected native wait protocol: ${line}`);
      };
      for (const [name, stream, chunks] of [
        ["stdout", child.stdout!, stdout], ["stderr", child.stderr!, stderr], ["protocol", report, protocol],
      ] as const) {
        stream.on("data", (chunk: Buffer) => {
          if (failed) return;
          bytes += chunk.byteLength;
          if (bytes > profile.maxOutputBytes) { fail(new Error("native wait output limit exceeded")); return; }
          chunks.push(Buffer.from(chunk));
          if (name === "protocol") {
            protocolPending += chunk.toString("ascii");
            let boundary: number;
            try {
              while ((boundary = protocolPending.indexOf("\n")) !== -1) {
                const line = protocolPending.slice(0, boundary);
                protocolPending = protocolPending.slice(boundary + 1);
                protocolLine(line);
              }
              if (protocolPending.length > 256) throw new Error("native wait protocol line limit exceeded");
            } catch (reason) { fail(reason); }
          }
        });
        stream.once("end", () => {
          ended.add(name);
          if (!failed && !interrupted && ended.has("stdout") && ended.has("stderr")) {
            fail(new Error("incomplete native wait handshake before witness output EOF"));
            return;
          }
          if (ended.size !== 3 || failed) return;
          if (!interrupted || !signalNumber || protocolPending !== "") {
            fail(new Error(`incomplete native wait handshake: ${Buffer.concat(protocol).toString()}`));
            return;
          }
          controller.close();
          released = true;
          anchor.end("release\n");
        });
      }
      for (const stream of child.stdio) stream?.on("error", fail);
      child.once("error", fail);
      child.once("exit", () => {
        exited = true;
        controller.close();
        if (!released && !failed) fail(new Error("native wait anchor exited before release"));
      });
      child.once("close", (code, exitSignal) => {
        closed = true;
        controller.close();
        clearTimeout(deadline);
        clearTimeout(cleanupTimer);
        for (const stream of child.stdio) stream?.destroy();
        if (failed) { reject(failure); return; }
        if (code !== 0 || exitSignal !== null || !released) {
          reject(new Error(`native wait supervisor failed: ${code}/${exitSignal}`));
          return;
        }
        resolve({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), protocol: Buffer.concat(protocol) });
      });
    });
  } finally {
    assert.equal(authenticateOracle(env), executable);
  }
}

for (const signal of ["USR1", "USR2"] as const) {
  for (const form of waitForms) {
    test(`Bash 5.2.37 trapped ${signal} interrupts ${form.name} without consuming child status`, nativeOptions(), async context => {
      const source = waiterSource(form.source, signal);
      const result = await nativeInterruptedWait(source, signal);
      context.diagnostic(JSON.stringify({ source, stdout: result.stdout.toString("hex"),
        stderr: result.stderr.toString("hex"), protocol: result.protocol.toString("hex") }));
      assert.deepEqual(result.stderr, Buffer.alloc(0));
      assert.deepEqual(result.stdout, Buffer.from(
        `wait-status:${128 + constants.signals[`SIG${signal}`]} trap:1 live:0 p:${form.destination}\nlater:7 identity:0\n`,
      ));
    });
  }
}

test("signal controller waits for both owners, tolerates pre-wait signals, and stops before releasing child", () => {
  const events: string[] = [];
  const callbacks: (() => void)[] = [];
  const controller = signalController({
    send: () => { events.push("signal"); }, startWait: () => { events.push("start"); },
    releaseChild: () => { events.push("release"); }, failed: reason => { assert.fail(String(reason)); }, maximum: 4,
    schedule: callback => { callbacks.push(callback); return () => { events.push("cancel"); }; },
  });
  controller.ready("waiter");
  assert.deepEqual(events, []);
  controller.ready("child");
  assert.deepEqual(events, ["signal"]);
  controller.prewait();
  controller.prewait();
  callbacks[0]!();
  assert.deepEqual(events, ["signal", "start", "signal"]);
  controller.interrupted();
  assert.deepEqual(events, ["signal", "start", "signal", "cancel", "release"]);
  callbacks[1]!();
  controller.close();
  assert.equal(events.filter(event => event === "signal").length, 2);
  assert.equal(events.filter(event => event === "release").length, 1);
});

test("signal controller close forbids later signalling or input release", () => {
  const events: string[] = [];
  let retry!: () => void;
  const controller = signalController({
    send: () => { events.push("signal"); }, startWait: () => { events.push("start"); },
    releaseChild: () => { events.push("release"); }, failed: reason => { assert.fail(String(reason)); }, maximum: 4,
    schedule: callback => { retry = callback; return () => {}; },
  });
  controller.ready("child");
  controller.ready("waiter");
  controller.close();
  retry();
  controller.prewait();
  controller.interrupted();
  assert.deepEqual(events, ["signal"]);
});

test("signal controller exhaustion is a bounded failure, not successful qualification", () => {
  let signals = 0;
  let retry!: () => void;
  let failure: unknown;
  const controller = signalController({
    send: () => { signals++; }, startWait: assert.fail, releaseChild: assert.fail,
    failed: reason => { failure = reason; }, maximum: 2,
    schedule: callback => { retry = callback; return () => {}; },
  });
  controller.ready("child");
  controller.ready("waiter");
  retry();
  retry();
  retry();
  assert.equal(signals, 2);
  assert.match(String(failure), /signal limit/u);
});

test("signal controller retains permission errors and does not retry a lost target", () => {
  const denied = Object.assign(new Error("signal denied"), { code: "EPERM" });
  let attempts = 0;
  let failure: unknown;
  const controller = signalController({
    send: () => { attempts++; throw denied; }, startWait: assert.fail, releaseChild: assert.fail,
    failed: reason => { failure = reason; }, maximum: 2, schedule: () => { assert.fail("unexpected retry"); },
  });
  controller.ready("child");
  controller.ready("waiter");
  controller.ready("waiter");
  assert.equal(attempts, 1);
  assert.equal(failure, denied);
});

test("native wait runner joins owned group close on output overflow with a blocked descendant", nativeOptions(), async () => {
  await assert.rejects(nativeInterruptedWait(`{ IFS= read -r gate; } <&0 &
printf '%65537s' ''
wait
`, "USR1"), /native wait output limit exceeded/u);
});

test("native wait runner rejects incomplete protocol rather than claiming interruption", nativeOptions(), async () => {
  await assert.rejects(nativeInterruptedWait("printf 'not-an-interruption\\n'", "USR2"), /incomplete native wait handshake/u);
});

test("native supervisor acknowledges controller signal retirement before reporting child completion", nativeOptions(), async context => {
  const source = waiterSource("wait -n -p chosen", "USR1");
  const result = await nativeInterruptedWait(source, "USR1");
  context.diagnostic(JSON.stringify({ source, stdout: result.stdout.toString("hex"),
    stderr: result.stderr.toString("hex"), protocol: result.protocol.toString("hex") }));
  const records = result.protocol.toString("ascii").split("\n");
  assert.equal(records.filter(record => record === "RETIRED").length, 1);
  assert.equal(records.filter(record => record === "WAITTRAP").length, 1);
  assert.ok(records.indexOf("WAITTRAP") < records.indexOf("INTERRUPTED"));
  assert.ok(records.indexOf("INTERRUPTED") < records.indexOf("RETIRED"));
  assert.deepEqual(result.stderr, Buffer.alloc(0));
  assert.deepEqual(result.stdout, Buffer.from(
    `wait-status:${128 + constants.signals.SIGUSR1} trap:1 live:0 p:unset\nlater:7 identity:0\n`,
  ));
});
