import { spawn as spawnChildProcess } from "node:child_process";
import { native } from "./native.js";
import { JsonRpcMessageLayer } from "./jsonrpc-message-layer.js";
function extension(method) {
  if (!method.startsWith("_")) throw new Error('Extension method must start with "_"');
}
export class AcpTransport {
  constructor({ command, args = [], cwd, env, firstRequestId, spawn = spawnChildProcess }) {
    this.command = command;
    this.native = new native.NativeAcpTransport();
    this.closed = new Promise((resolve) => {
      this.resolveClosed = resolve;
    });
    this.child = spawn(command, [...args], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => this.native.appendStderr(String(chunk)));
    this.child.stdin.on("error", (error) => {
      const reason = error instanceof Error ? error : new Error(String(error));
      if (this.native.disposing) {
        this.closeReason ??= reason;
        return;
      }
      this.close(reason, this.child.exitCode ?? null, this.child.signalCode ?? null);
    });
    this.layer = new JsonRpcMessageLayer({
      input: this.child.stdout,
      output: this.child.stdin,
      firstRequestId
    });
    for (const method of [
      "sendRequest",
      "sendNotification",
      "onRequest",
      "onNotification",
      "pendingRequestCount"
    ])
      this[method] = this.layer[method].bind(this.layer);
    this.child.once("error", (error) =>
      this.close(
        error instanceof Error ? error : new Error(String(error)),
        this.child.exitCode ?? null,
        this.child.signalCode ?? null
      )
    );
    this.child.once("close", (code, signal) => {
      const reason =
        this.closeReason ??
        new Error(
          `ACP transport closed (command "${this.command}", code: ${code ?? "null"}${signal ? `, signal: ${signal}` : ""})`
        );
      this.close(reason, code ?? null, signal ?? null);
    });
  }
  sendExtRequest(method, params, options = {}) {
    extension(method);
    return this.layer.sendRequest(method, params, options);
  }
  sendExtNotification(method, params) {
    extension(method);
    this.layer.sendNotification(method, params);
  }
  onExtRequest(method, handler) {
    extension(method);
    this.layer.onRequest(method, handler);
  }
  onExtNotification(method, handler) {
    extension(method);
    this.layer.onNotification(method, handler);
  }
  getStderrOutput() {
    return this.native.stderr;
  }
  dispose(reason = new Error("ACP transport disposed")) {
    if (!this.native.beginDispose()) return;
    this.closeReason = reason;
    this.layer.dispose(reason);
    if (!this.child.stdin.destroyed && !this.child.stdin.writableEnded) this.child.stdin.end();
    if (this.child.exitCode !== null || this.child.signalCode !== null) {
      this.close(reason, this.child.exitCode, this.child.signalCode);
      return;
    }
    this.applyStep(this.native.signalResult(this.child.kill("SIGTERM"), Date.now()));
  }
  applyStep(step) {
    if (step.kind === "wait") {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.applyStep(this.native.step(Date.now()));
      }, step.ms);
      this.timer.unref();
    } else if (step.kind === "kill")
      this.applyStep(this.native.signalResult(this.child.kill("SIGKILL"), Date.now()));
    else if (step.kind === "close")
      this.close(
        this.closeReason,
        this.child.exitCode,
        this.child.signalCode ?? step.fallbackSignal
      );
  }
  close(reason, code, signal) {
    if (!this.native.close()) return;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.layer.dispose(reason);
    this.resolveClosed({ code, signal, reason, stderr: this.getStderrOutput() });
    this.resolveClosed = undefined;
  }
}
