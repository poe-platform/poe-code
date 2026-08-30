import { spawnReviewChild, guardSettings, holdClose } from "./control-observer.mjs";
export const binaryInput = Buffer.from("foo\n\0\nno\n");
export const binaryWarning = 'binary file matches (found "\\0" byte around offset 4)\n';
export class NativeHarnessError extends Error {
    evidence;
    constructor(message, evidence) {
        super(message);
        this.evidence = evidence;
    }
}
export async function nativeDelivery(options = {}) {
    const profile = options.profile ?? "observed-prefix";
    const argv = ["--no-config", ...(options.lineBuffered ? ["--line-buffered"] : []), "foo", "-"];
    const events = [];
    const started = performance.now();
    const mark = (event, detail) => events.push({ event, ms: performance.now() - started, ...(detail === undefined ? {} : { detail }) });
    const env = { ...process.env, LC_ALL: "C", LANG: "C", RIPGREP_CONFIG_PATH: "", NO_COLOR: "1" };
    mark("launch", { argv, profile, options });
    const child = spawnReviewChild(env);
    const output = [];
    const errors = [];
    let captured = 0;
    let ready = false;
    let actualClose = false;
    let closeObserved = false;
    let settled = false;
    let failure;
    let code = null;
    let signal = null;
    const timers = new Set();
    const timerIds = new Map();
    let timerSequence = 0;
    const registrations = [];
    const clear = (timer) => {
        if (timer && timers.has(timer)) {
            clearTimeout(timer);
            mark("timer-cleared", { timerId: timerIds.get(timer) });
            timers.delete(timer);
            timerIds.delete(timer);
        }
    };
    const later = (action, milliseconds, label) => {
        const timerId = ++timerSequence;
        const armedMs = performance.now() - started;
        const dueMs = armedMs + milliseconds;
        mark("timer-armed", { timerId, label, milliseconds, armedMs, dueMs });
        const timer = setTimeout(() => {
            timers.delete(timer);
            timerIds.delete(timer);
            const firedMs = performance.now() - started;
            mark("timer-fired", { timerId, label, armedMs, dueMs, firedMs, latenessMs: firedMs - dueMs });
            action();
        }, milliseconds);
        timers.add(timer);
        timerIds.set(timer, timerId);
        return timer;
    };
    let phaseTimer;
    let cleanupTimer;
    let producerTimer;
    return new Promise((resolve, reject) => {
        const finish = () => {
            for (const timer of timers)
                clear(timer);
            if (actualClose)
                for (const remove of registrations)
                    remove();
            if (settled)
                return;
            settled = true;
            const evidence = { argv, profile, pid: child.pid, code, signal, stdout: Buffer.concat(output).toString(), stderr: Buffer.concat(errors).toString(), events, ready, actualClose, closeObserved,
                ownedListenersRemaining: ownListeners.filter(({ target, event, handler }) => target.listeners(event).includes(handler)).length,
                streamsDestroyed: [child.stdin, child.stdout, child.stderr].map(stream => stream.destroyed), activeTimers: timers.size };
            if (failure)
                reject(new NativeHarnessError(failure, evidence));
            else
                resolve(evidence);
        };
        const ownListeners = [];
        const listen = (target, event, handler) => {
            if (target === child && event === "close" && guardSettings.holdClose) {
                const realHandler = handler;
                handler = (...args) => holdClose(child, realHandler, args);
            }
            target.on(event, handler);
            ownListeners.push({ target, event, handler });
            registrations.push(() => target.removeListener(event, handler));
        };
        const cleanupDeadline = () => {
            failure ??= "native cleanup deadline";
            mark("cleanup-deadline", { actualClose, closeObserved });
            if (!actualClose) {
                child.kill("SIGKILL");
                mark("cleanup-kill", { pid: child.pid });
            }
            finish();
        };
        const armCleanup = () => { cleanupTimer ??= later(cleanupDeadline, options.cleanupMs ?? 5000, "cleanup"); };
        const stop = (message) => {
            if (failure)
                return;
            failure = message;
            mark("failure", message);
            clear(phaseTimer);
            clear(producerTimer);
            child.stdin.destroy();
            child.kill("SIGKILL");
            mark("kill", { pid: child.pid });
            armCleanup();
        };
        const armPhase = (phase, milliseconds) => {
            clear(phaseTimer);
            phaseTimer = later(() => stop(`native ${phase} deadline`), milliseconds, phase);
        };
        const write = (bytes, end = false) => {
            if (guardSettings.withholdSuffix && end) {
                mark("review-suffix-withheld");
                return;
            }
            mark("write", { hex: bytes.toString("hex"), end });
            if (end)
                child.stdin.end(bytes);
            else
                child.stdin.write(bytes);
        };
        armPhase("readiness", options.readinessMs ?? 10000);
        listen(child, "spawn", () => {
            mark("spawn", { pid: child.pid });
            if (profile === "original-25ms") {
                let offset = 0;
                const produce = () => {
                    write(binaryInput.subarray(offset, ++offset), offset === binaryInput.length);
                    if (offset < binaryInput.length)
                        producerTimer = later(produce, 25, "original-producer");
                };
                producerTimer = later(produce, 25, "original-producer");
            }
            else if (options.mutation !== "withhold-delivery")
                write(binaryInput.subarray(0, 4));
        });
        for (const [label, stream, chunks] of [["stdout", child.stdout, output], ["stderr", child.stderr, errors]]) {
            listen(stream, "data", (chunk) => {
                mark(`${label}-data`, { hex: chunk.toString("hex") });
                captured += chunk.length;
                if (captured > 1024 * 1024) {
                    stop("native capture limit");
                    return;
                }
                chunks.push(Buffer.from(chunk));
                if (label === "stdout" && !ready && Buffer.concat(output).subarray(0, 4).equals(binaryInput.subarray(0, 4))) {
                    mark("prefix-consumption-evidenced", "stdout is evidence of prior read; not a read syscall timestamp");
                    if (guardSettings.suppressReadiness) {
                        mark("review-readiness-suppressed");
                        return;
                    }
                    if (options.mutation === "suppress-readiness")
                        return;
                    ready = true;
                    mark("ready");
                    armPhase("completion", options.completionMs ?? 10000);
                    if (profile === "observed-prefix" && options.mutation !== "stall-completion")
                        write(binaryInput.subarray(4), true);
                }
            });
            listen(stream, "end", () => mark(`${label}-end`));
            listen(stream, "close", () => mark(`${label}-close`));
            listen(stream, "error", (error) => stop(`${label}: ${error.message}`));
        }
        listen(child.stdin, "error", (error) => stop(`stdin: ${error.message}`));
        listen(child.stdin, "close", () => mark("stdin-close"));
        listen(child, "error", (error) => stop(`spawn: ${error.message}`));
        listen(child, "exit", (exitCode, exitSignal) => {
            code = exitCode;
            signal = exitSignal;
            mark("exit", { code, signal });
            clear(phaseTimer);
            clear(producerTimer);
            armCleanup();
        });
        listen(child, "close", (exitCode, exitSignal) => {
            code = exitCode;
            signal = exitSignal;
            actualClose = true;
            mark("close", { code, signal });
            if (settled) {
                finish();
                return;
            }
            if (options.mutation === "suppress-close-observation") {
                mark("close-observation-suppressed");
                armCleanup();
                return;
            }
            closeObserved = true;
            clear(phaseTimer);
            clear(producerTimer);
            if (!failure && profile === "observed-prefix" && !ready)
                failure = "native closed without readiness";
            if (!failure && (code !== 0 || signal))
                failure = `native exit ${code}/${signal}`;
            if (options.mutation === "suppress-cleanup") {
                mark("cleanup-acknowledgement-suppressed");
                armCleanup();
            }
            else {
                clear(cleanupTimer);
                finish();
            }
        });
    });
}
