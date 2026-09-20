import { createRequire } from "node:module";
import { PassThrough } from "node:stream";
import { readLines } from "./layer.js";
import { createInMemoryTransportPair } from "./transports.js";
const { sdkMessageToLine, parseSdkMessage } = createRequire(import.meta.url)("./tiny-mcp-client-rust.node");
class SdkTransportAdapter {
  #sdk;
  #finish;
  constructor(sdk) {
    this.#sdk = sdk;
    this.readable = new PassThrough();
    this.writable = new PassThrough();
    this.closed = new Promise(resolve => { this.#finish = resolve; });
    sdk.onmessage = message => { this.readable.write(sdkMessageToLine(message)); };
    sdk.onclose = () => { this.dispose(new Error("SDK transport closed")); };
    sdk.onerror = error => { this.dispose(error instanceof Error ? error : new Error(String(error))); };
    for (const stream of [this.readable, this.writable]) stream.once("error", error => { this.dispose(error); });
    this.#consume().catch(error => { this.dispose(error); });
    sdk.start().catch(error => { this.dispose(error); });
  }
  async #consume() {
    for await (const line of readLines(this.writable)) {
      if (this.#finish === undefined || line.length === 0) continue;
      const parsed = parseSdkMessage(line);
      if (parsed.error !== undefined) throw new Error(parsed.error);
      await this.#sdk.send(parsed.message);
    }
  }
  dispose(reason = new Error("SDK transport adapter disposed")) {
    if (this.#finish === undefined) return;
    const finish = this.#finish;
    this.#finish = undefined;
    for (const stream of [this.readable, this.writable]) if (!stream.destroyed && !stream.writableEnded) stream.end();
    finish({ reason });
    this.#sdk.close().catch(() => undefined);
  }
}
class LinkedTransport {
  peer;
  #queue = [];
  #closed = false;
  async start() {
    for (const { message, extra } of this.#queue.splice(0)) this.onmessage?.(message, extra);
  }
  async send(message, options) {
    if (this.#closed || this.peer?.#closed) throw new Error("Not connected");
    const extra = { authInfo: options?.authInfo };
    if (this.peer.onmessage !== undefined) this.peer.onmessage(message, extra);
    else {
      if (this.peer.#queue.length >= 128) throw new Error("SDK transport message capacity exceeded");
      this.peer.#queue.push({ message, extra });
    }
  }
  async close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#queue = [];
    await this.peer?.close();
    this.onclose?.();
  }
}
export async function createSdkTestPair(server, createClient) {
  const clientSdk = new LinkedTransport(); const serverSdk = new LinkedTransport();
  clientSdk.peer = serverSdk; serverSdk.peer = clientSdk;
  const transport = new SdkTransportAdapter(clientSdk);
  const connected = server.connect(serverSdk);
  const client = createClient();
  try { await client.connect(transport); }
  catch (error) {
    transport.dispose(new Error("SDK test pair setup failed"));
    await clientSdk.close(); await serverSdk.close(); await connected;
    throw error;
  }
  return { client, async cleanup() {
    await client.close(); transport.dispose(new Error("SDK test pair cleanup"));
    await clientSdk.close(); await serverSdk.close(); await connected;
  } };
}
export async function createTestPair(server, createClient) {
  const pair = createInMemoryTransportPair();
  const connected = server.connect(pair.serverTransport);
  const client = createClient();
  try { await client.connect(pair.clientTransport); }
  catch (error) {
    pair.clientTransport.dispose(new Error("tiny-stdio-mcp-server test pair setup failed"));
    await connected; throw error;
  }
  return { client, async cleanup() {
    await client.close(); pair.clientTransport.dispose(new Error("tiny-stdio-mcp-server test pair cleanup")); await connected;
  } };
}
