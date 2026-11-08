import { isAbsolute } from "node:path";
import { native } from "./native.js";
import { AcpTransport } from "./acp-transport.js";
import { AcpError } from "./types.js";
const encode = (value) => JSON.stringify(value);
const toError = (reason) => (reason instanceof Error ? reason : new Error(String(reason)));
function checkIndex(value, oneBased, field) {
  try {
    native.acpValidateIndex(value, oneBased, field);
  } catch (error) {
    throw new AcpError(-32602, error.message);
  }
}
function checkPath(path) {
  if (!isAbsolute(path))
    throw new AcpError(-32602, 'Invalid params: "path" must be an absolute path');
}
function extension(method) {
  if (!method.startsWith("_")) throw new Error('Extension method must start with "_"');
}
class UpdateQueue {
  constructor() {
    this.native = new native.NativeAcpQueue();
    this.waiters = [];
    this.failure = undefined;
    this.values = new Map();
    this.token = 0;
  }
  push(value) {
    const token = ++this.token;
    if (this.native.push(encode(token))) {
      this.values.set(token, value);
      this.flush();
    }
  }
  complete() {
    this.native.complete();
    this.flush();
  }
  fail(error) {
    this.failure ??= error;
    this.native.fail(error.message);
    this.flush();
  }
  flush() {
    while (this.waiters.length) {
      const action = this.native.poll();
      if (action.type === "wait") return;
      const waiter = this.waiters.shift();
      this.settle(action, waiter);
    }
  }
  settle(action, { resolve, reject }) {
    if (action.type === "error") reject(this.failure ?? new Error(action.message));
    else {
      const value = this.values.get(action.value);
      this.values.delete(action.value);
      resolve({ done: action.type === "done", value });
    }
  }
  next() {
    const action = this.native.poll();
    return new Promise((resolve, reject) => {
      if (action.type === "wait") this.waiters.push({ resolve, reject });
      else this.settle(action, { resolve, reject });
    });
  }
  async return() {
    this.complete();
    return { done: true, value: undefined };
  }
  async throw(error) {
    const normalized = toError(error);
    this.fail(normalized);
    throw normalized;
  }
  [Symbol.asyncIterator]() {
    return this;
  }
}
export class AcpClient {
  constructor(options) {
    this.transport = Object.hasOwn(options, "transport")
      ? options.transport
      : new AcpTransport(options);
    this.version = options.protocolVersion ?? 1;
    this.native = new native.NativeAcpClient(this.version, options.skipAuth ?? false);
    this.capabilities = options.clientCapabilities;
    this.clientInfo = options.clientInfo;
    this.updates = new Map();
    this.transportDisposed = false;
    this.fs = options.handlers?.fs ?? options.fsHandler;
    this.terminal = options.handlers?.terminal ?? options.terminalHandler;
    const permission = options.handlers?.permission ?? options.permissionHandler;
    this.transport.onRequest("session/request_permission", async (params) => {
      if (permission)
        return {
          outcome: await permission({ toolCall: params.toolCall, options: params.options })
        };
      try {
        return native.acpPermission(encode(params.options), options.autoApprove === true);
      } catch (error) {
        throw new AcpError(-32602, error.message);
      }
    });
    this.registerCapabilities(this.capabilities);
    this.transport.onNotification("session/update", (params) => {
      if (this.native.accepts(params))
        this.updates
          .get(params.sessionId)
          ?.push({ jsonrpc: "2.0", method: "session/update", params });
    });
  }
  get state() {
    return this.native.state;
  }
  get negotiatedProtocolVersion() {
    return this.native.negotiatedVersion ?? null;
  }
  get authMethods() {
    return this.native.authMethods;
  }
  get agentCapabilities() {
    return this.native.capabilities ?? undefined;
  }
  get agentInfo() {
    return this.info;
  }
  get closed() {
    return this.transport.closed;
  }
  async initialize(capabilities) {
    this.native.beginInitialize();
    try {
      if (capabilities !== undefined) this.capabilities = capabilities;
      const response = await this.transport.sendRequest("initialize", {
        protocolVersion: this.version,
        clientInfo: this.clientInfo,
        clientCapabilities: this.capabilities
      });
      const result = this.native.finishInitialize(encode(response));
      this.info = response.agentInfo;
      if (capabilities !== undefined) this.registerCapabilities(capabilities);
      // Metadata is owned by the host API and may intentionally be null.
      if (response.agentInfo !== undefined) result.agentInfo = response.agentInfo;
      return result;
    } finally {
      this.native.endInitialize();
    }
  }
  async authenticate(methodId) {
    this.native.beginAuthenticate(methodId);
    let success = false;
    try {
      const response = await this.transport.sendRequest("authenticate", { methodId });
      success = true;
      return response;
    } finally {
      this.native.endAuthenticate(success);
    }
  }
  async newSession(cwd, mcpServers) {
    this.native.ready("session/new");
    this.native.mcp(encode(mcpServers));
    const response = await this.transport.sendRequest("session/new", { cwd, mcpServers });
    native.acpValidateResponse("session/new", encode(response));
    return response;
  }
  async loadSession(sessionId, cwd, mcpServers) {
    this.native.ready("session/load");
    this.native.loading();
    this.native.mcp(encode(mcpServers));
    return this.transport.sendRequest("session/load", { sessionId, cwd, mcpServers });
  }
  async cancelSession(sessionId) {
    this.native.ready("session/cancel");
    this.transport.sendNotification("session/cancel", { sessionId });
  }
  async setMode(sessionId, modeId) {
    this.native.ready("session/set_mode");
    return this.transport.sendRequest("session/set_mode", { sessionId, modeId });
  }
  async setConfigOption(sessionId, configId, value) {
    this.native.ready("session/set_config_option");
    const response = await this.transport.sendRequest("session/set_config_option", {
      sessionId,
      configId,
      value
    });
    native.acpValidateResponse("session/set_config_option", encode(response));
    return response.configOptions;
  }
  prompt(sessionId, content) {
    this.native.beginPrompt(sessionId, encode(content));
    const updates = new UpdateQueue();
    this.updates.set(sessionId, updates);
    let request;
    try {
      request = this.transport.sendRequest("session/prompt", { sessionId, prompt: content });
    } catch (reason) {
      const error = toError(reason);
      this.native.endPrompt(sessionId);
      this.updates.delete(sessionId);
      updates.fail(error);
      throw error;
    }
    const response = request
      .then((value) => {
        native.acpValidateResponse("session/prompt", encode(value));
        this.native.endPrompt(sessionId);
        this.updates.delete(sessionId);
        updates.complete();
        return value;
      })
      .catch((reason) => {
        const error = toError(reason);
        this.native.endPrompt(sessionId);
        this.updates.delete(sessionId);
        updates.fail(error);
        throw error;
      });
    return {
      response,
      [Symbol.asyncIterator]() {
        return updates;
      }
    };
  }
  async sendExtRequest(method, params, options = {}) {
    this.native.open();
    extension(method);
    return this.transport.sendRequest(method, params, options);
  }
  async sendExtNotification(method, params) {
    this.native.open();
    extension(method);
    this.transport.sendNotification(method, params);
  }
  onExtRequest(method, handler) {
    this.native.open();
    extension(method);
    this.transport.onRequest(method, handler);
  }
  onExtNotification(method, handler) {
    this.native.open();
    extension(method);
    this.transport.onNotification(method, handler);
  }
  async dispose() {
    this.native.dispose();
    for (const updates of this.updates.values()) updates.fail(new Error("ACP client disposed"));
    this.updates.clear();
    if (!this.transportDisposed) {
      this.transport.dispose?.(new Error("ACP client disposed"));
      this.transportDisposed = true;
    }
    if (this.transport.closed) await this.transport.closed;
  }
  assertReady(operation) {
    this.native.ready(operation);
  }
  registerCapabilities(capabilities) {
    const methods = this.native.registerHandlers(
      encode(capabilities ?? {}),
      Boolean(this.fs?.readTextFile),
      Boolean(this.fs?.writeTextFile),
      Boolean(this.terminal)
    );
    const fs = this.fs,
      terminal = this.terminal;
    for (const method of methods) {
      if (method === "fs/read_text_file") {
        const read = fs.readTextFile;
        this.transport.onRequest(method, async (params) => {
          checkPath(params.path);
          checkIndex(params.line, true, "line");
          checkIndex(params.limit, false, "limit");
          return {
            content: await read({
              sessionId: params.sessionId,
              path: params.path,
              line: params.line,
              limit: params.limit
            })
          };
        });
      } else if (method === "fs/write_text_file") {
        const write = fs.writeTextFile;
        this.transport.onRequest(method, async (params) => {
          checkPath(params.path);
          if (typeof params.content !== "string")
            throw new AcpError(-32602, 'Invalid params: "content" must be a string');
          await write({ sessionId: params.sessionId, path: params.path, content: params.content });
          return {};
        });
      } else if (method === "terminal/create") {
        this.transport.onRequest(method, async (params) => {
          checkIndex(params.outputByteLimit, false, "outputByteLimit");
          const terminalId = await terminal.create({
            sessionId: params.sessionId,
            command: params.command,
            args: params.args,
            cwd: params.cwd,
            env: params.env,
            outputByteLimit: params.outputByteLimit
          });
          if (typeof terminalId !== "string")
            throw new Error(
              'Invalid response from "terminal/create": "terminalId" must be a string.'
            );
          this.native.track(params.sessionId, terminalId);
          return { terminalId };
        });
      } else {
        const effect = {
          "terminal/output": "output",
          "terminal/wait_for_exit": "waitForExit",
          "terminal/kill": "kill",
          "terminal/release": "release"
        }[method];
        this.transport.onRequest(method, async (params) => {
          if (!this.native.known(params.sessionId, params.terminalId))
            throw new AcpError(-32002, `Resource not found: terminal "${params.terminalId}"`);
          const result = await terminal[effect]({
            sessionId: params.sessionId,
            terminalId: params.terminalId
          });
          if (effect === "release") this.native.untrack(params.sessionId, params.terminalId);
          return effect === "kill" || effect === "release" ? {} : result;
        });
      }
    }
  }
}
