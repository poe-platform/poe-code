import { isUint8Array } from "node:util/types";
import { describeReason, preserveReason } from "./data.mjs";

export const moduleUrl = import.meta.url;
export function observeChild(port, spec, record, persist, outputBudget, wholeDeadline, admit) {
  return new Promise(resolve => {
    let handle, terminal = false, starting = true, faultSignalled = false;
    const timers = new Set(), chunks = { stdout: [], stderr: [] };
    const began = port.now(), hardAt = Math.min(began + 3000, wholeDeadline);
    const admissionEnd = Math.min(began + 2500, wholeDeadline);
    Object.assign(record, { attemptRegistered: true, spawnCalled: false, submitted: false, spawnObserved: false, closeObserved: false, exitObserved: false, pid: null, code: null, signal: null, fault: null, groupAbsent: null, retainedBytes: 0, observedBytes: 0, signals: [], events: [] });
    const event = name => { if (record.events.length < 64) record.events.push({ name, at: port.now() - began }); };
    const schedule = (when, operation) => {
      const timer = port.timer(Math.max(0, when - port.now()), () => { timers.delete(timer); if (!terminal) operation(); });
      timers.add(timer); return timer;
    };
    const kill = signal => {
      if (!handle || record.pid === null || record.groupAbsent === true) return;
      try { handle.signalGroup(signal); record.signals.push(signal); }
      catch (reason) { preserveReason(record, reason); record.fault ??= `signal: ${describeReason(reason)}`; }
    };
    const finish = reason => {
      if (terminal) return; terminal = true;
      for (const timer of timers) port.clearTimer(timer);
      timers.clear();
      record.terminal = reason; record.elapsed = port.now() - began;
      record.stdoutBase64 = Buffer.concat(chunks.stdout).toString("base64");
      record.stderrBase64 = Buffer.concat(chunks.stderr).toString("base64");
      try { handle?.release(); } catch (reason) { preserveReason(record, reason); record.fault ??= `release: ${describeReason(reason)}`; }
      resolve(record);
    };
    const fault = message => {
      if (terminal) return;
      record.fault ??= message; event("fault");
      if (faultSignalled) return;
      faultSignalled = true; kill("SIGTERM");
      schedule(Math.min(port.now() + 250, hardAt), () => kill("SIGKILL"));
    };
    const poll = () => {
      if (terminal || !handle || record.pid === null) return;
      try { record.groupAbsent = !handle.groupExists(); }
      catch (reason) { preserveReason(record, reason); record.groupAbsent = null; fault(`group query: ${describeReason(reason)}`); }
      if (record.closeObserved && record.groupAbsent === true) {
        if (!record.submitted || !record.spawnObserved || !record.exitObserved) {
          fault("inconsistent driver completion: submitted/spawn/exit observation missing"); finish("inconsistent-driver-completion");
        } else finish("closed-and-group-absent");
      }
      else if (port.now() < hardAt) schedule(Math.min(port.now() + 25, hardAt), poll);
    };
    const callbacks = {
      spawn() {
        if (terminal) return; record.spawnObserved = true; event("spawn");
        try { persist(`spawn-${record.id}.json`, record); } catch (reason) { preserveReason(record, reason); fault(`persistence after spawn: ${describeReason(reason)}`); }
      },
      exit(code, signal) { if (terminal) return; record.exitObserved = true; record.code = code; record.signal = signal; event("exit"); },
      close(code, signal) { if (terminal) return; record.closeObserved = true; record.code = code; record.signal = signal; event("close"); if (!starting) poll(); },
      error(reason) { if (terminal) return; preserveReason(record, reason); fault(`spawn/stream: ${describeReason(reason)}`); if (!starting && record.pid === null) finish("no-process-error"); },
      data(stream, bytes) {
        if (terminal) return;
        if (!isUint8Array(bytes) || !Object.hasOwn(chunks, stream)) { fault("invalid output chunk"); return; }
        const remaining = Math.min(65536 - record.retainedBytes, outputBudget.limit - outputBudget.retained);
        const length = Math.min(bytes.byteLength, Math.max(0, remaining));
        if (length) { chunks[stream].push(Buffer.from(Uint8Array.prototype.subarray.call(bytes, 0, length))); record.retainedBytes += length; outputBudget.retained += length; }
        record.observedBytes = Math.min(65537, record.observedBytes + bytes.byteLength);
        if (bytes.byteLength > length) fault("output ceiling");
      },
    };
    schedule(Math.min(began + 2500, hardAt), () => fault("row deadline"));
    schedule(Math.min(began + 2750, hardAt), () => kill("SIGKILL"));
    schedule(hardAt, () => { record.fault ??= "terminal deadline"; kill("SIGKILL"); finish("terminal-cleanup-uncertain"); });
    try {
      if (port.now() >= admissionEnd) { record.fault = "row admission deadline before attempt"; finish("admission-refused"); return; }
      persist(`attempt-${record.id}.json`, record);
      if (port.now() >= admissionEnd) { record.fault = "row admission deadline after attempt persistence"; finish("admission-refused"); return; }
      admit();
      if (port.now() >= admissionEnd) { record.fault = "row admission deadline after final authentication"; finish("admission-refused"); return; }
      record.admittedAt = port.now();
      record.spawnCalled = true;
      handle = port.start(spec, callbacks);
      record.submitted = true; record.pid = Number.isSafeInteger(handle.pid) && handle.pid > 0 ? handle.pid : null;
      starting = false;
      if (port.now() >= admissionEnd) fault("admitted start returned after deadline");
      if (record.fault) kill("SIGTERM");
      if (record.pid !== null) poll();
      else if (record.fault) finish("no-process-error");
    } catch (reason) {
      starting = false; preserveReason(record, reason); record.fault ??= `admission/spawn call: ${describeReason(reason)}`;
      event(record.spawnCalled ? "spawn-call-threw" : "admission-threw");
      if (!handle) finish(record.spawnCalled ? "no-process-spawn-throw" : "admission-refused");
      else fault(record.fault);
    }
  });
}
