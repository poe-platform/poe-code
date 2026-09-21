import { setTimeout as delay } from "node:timers/promises";
import { native } from "./native.js";

export class APIError extends Error {
  constructor(status, error, message, headers) {
    const detail = error?.message
      ? typeof error.message === "string"
        ? error.message
        : JSON.stringify(error.message)
      : error
        ? JSON.stringify(error)
        : message;
    super(
      status
        ? detail
          ? `${status} ${detail}`
          : `${status} status code (no body)`
        : detail || "(no status code or body)"
    );
    this.status = status;
    this.headers = headers;
    this.requestID = headers?.get("x-request-id");
    this.error = error;
    this.code = error?.code;
    this.param = error?.param;
    this.type = error?.type;
  }
}

// Internal provider transport. It implements the two streaming operations used by
// these plugins; it is not intended to be a complete replacement for the SDK.
export default class OpenAI {
  #options;
  chat;
  responses;
  constructor(options = {}) {
    this.#options = {
      baseURL: "https://api.openai.com/v1",
      timeout: 600000,
      maxRetries: 2,
      ...options,
      apiKey: options.apiKey ?? process.env.OPENAI_API_KEY
    };
    if (!this.#options.apiKey)
      throw new Error(
        "Missing credentials. Please pass an apiKey or set the OPENAI_API_KEY environment variable."
      );
    for (const name of ["timeout", "maxRetries"]) {
      const value = this.#options[name];
      if (!Number.isSafeInteger(value) || value < 0)
        throw new Error(`${name} must be a non-negative safe integer`);
    }
    // Timeout scheduling has the same host limit as MCP request deadlines.
    native.validateRequestTimeout(this.#options.timeout, "timeout");
    this.chat = {
      completions: { create: (body, request) => this.#request("chat/completions", body, request) }
    };
    this.responses = { stream: (body, request) => this.#responses(body, request) };
  }
  async *#responses(body, request) {
    yield* await this.#request("responses", { ...body, stream: true }, request);
  }
  async #request(path, body, { signal } = {}) {
    const options = this.#options;
    const headers = new Headers({
      "content-type": "application/json",
      authorization: `Bearer ${options.apiKey}`
    });
    if (options.organization !== undefined)
      headers.set("openai-organization", options.organization);
    for (const [name, value] of Object.entries(options.defaultHeaders ?? {})) {
      if (value === null) headers.delete(name);
      else if (value !== undefined) headers.set(name, value);
    }
    const url = `${options.baseURL.endsWith("/") ? options.baseURL.slice(0, -1) : options.baseURL}/${path}`;
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      const controller = new AbortController();
      let response;
      const forward = () => {
        controller.abort(signal.reason);
        if (response?.body && !response.body.locked)
          void response.body.cancel(signal.reason).catch(() => {});
      };
      signal?.addEventListener("abort", forward, { once: true });
      const timer = setTimeout(
        () => controller.abort(new Error("Request timed out.")),
        options.timeout
      );
      try {
        response = await (options.fetch ?? globalThis.fetch)(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: controller.signal
        });
      } catch (cause) {
        signal?.removeEventListener("abort", forward);
        signal?.throwIfAborted();
        if (attempt >= options.maxRetries) {
          const error = new APIError(
            undefined,
            undefined,
            controller.signal.aborted ? "Request timed out." : "Connection error."
          );
          error.cause = cause;
          throw error;
        }
        await delay(native.agentOpenaiRetryDelay(attempt, Math.random()), undefined, { signal });
        continue;
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) {
        signal?.removeEventListener("abort", forward);
        if (
          attempt < options.maxRetries &&
          native.agentOpenaiRetryable(response.status, response.headers.get("x-should-retry"))
        ) {
          await response.body?.cancel();
          await delay(this.#retryDelay(response.headers, attempt), undefined, { signal });
          continue;
        }
        const text = await readErrorBody(response, signal);
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch {
          /* Preserve a non-JSON error body. */
        }
        throw new APIError(response.status, parsed?.error, text, response.headers);
      }
      return this.#events(response, controller, signal, forward);
    }
  }
  #retryDelay(headers, attempt) {
    let value;
    const milliseconds = headers.get("retry-after-ms");
    if (milliseconds) {
      const parsed = Number.parseFloat(milliseconds);
      if (!Number.isNaN(parsed)) value = parsed;
    }
    const after = headers.get("retry-after");
    if (after && !value) {
      const seconds = Number.parseFloat(after);
      value = Number.isNaN(seconds) ? Date.parse(after) - Date.now() : seconds * 1000;
    }
    const result =
      value === undefined ? native.agentOpenaiRetryDelay(attempt, Math.random()) : value;
    // Oversized server delays must not silently become a one-millisecond timer.
    if (!Number.isFinite(result) || result > 2147483647)
      throw new Error("Invalid provider retry delay");
    return Math.max(0, result);
  }
  async *#events(response, controller, signal, forward) {
    let reader;
    let complete = false;
    const cancel = () => {
      void reader?.cancel(controller.signal.reason).catch(() => {});
    };
    controller.signal.addEventListener("abort", cancel, { once: true });
    try {
      signal?.throwIfAborted();
      if (!response.body) throw new Error("Attempted to iterate over a response with no body");
      reader = response.body.getReader();
      const parser = new native.NativeSseParser(undefined, false, true);
      const decoder = new TextDecoder();
      let done = false;
      while (true) {
        const chunk = await reader.read();
        signal?.throwIfAborted();
        if (chunk.done) {
          complete = true;
          return;
        }
        const frames = parser.push(decoder.decode(chunk.value, { stream: true }));
        for (const frame of frames) {
          if (done) continue;
          if (frame.data.startsWith("[DONE]")) {
            done = true;
            continue;
          }
          const data = JSON.parse(frame.data);
          if (data?.error) throw new APIError(undefined, data.error, undefined, response.headers);
          yield frame.event?.startsWith("thread.") ? { event: frame.event, data } : data;
        }
      }
    } finally {
      signal?.removeEventListener("abort", forward);
      controller.signal.removeEventListener("abort", cancel);
      if (!complete) {
        controller.abort();
        if (reader) await reader.cancel().catch(() => {});
        else await response.body?.cancel().catch(() => {});
      }
      reader?.releaseLock();
    }
  }
}

async function readErrorBody(response, signal) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0,
    text = "";
  const cancel = () => {
    void reader.cancel(signal.reason).catch(() => {});
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const chunk = await reader.read();
      signal?.throwIfAborted();
      if (chunk.done) return text + decoder.decode();
      bytes += chunk.value.byteLength;
      if (bytes > 1024 * 1024) throw new Error("Provider error response exceeds 1048576 bytes");
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    signal?.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
