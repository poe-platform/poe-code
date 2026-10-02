/** Bind each handshake by its private endpoint, without ambient async state. */
const connecting = new Map<string, WebSocketTransport>();
export const transportZone = {
  async run<T>(transport: WebSocketTransport, connect: () => Promise<T>): Promise<T> {
    if (connecting.has(transport.endpoint)) throw new Error('Browser handshake already active');
    connecting.set(transport.endpoint, transport);
    try { return await connect(); }
    finally { connecting.delete(transport.endpoint); }
  },
};

export class WebSocketTransport {
  onmessage?: (message: object) => void;
  onclose?: () => void;
  readonly endpoint = 'ws://portable.invalid/' + crypto.randomUUID();
  static async connect(_progress: unknown, endpoint: string): Promise<WebSocketTransport> {
    const url = new URL(endpoint);
    const transport = connecting.get(url.origin + url.pathname);
    if (!transport) throw new Error('Browser transport is unavailable');
    return transport;
  }
  constructor(private readonly socket: WebSocket, readonly sessionId?: string) {
    socket.addEventListener('message', event => this.onmessage?.(JSON.parse(event.data as string)));
    socket.addEventListener('close', () => this.onclose?.());
  }
  send(message: object): void { this.socket.send(JSON.stringify(message)); }
  close(): void { this.socket.close(); this.onclose?.(); }
  async closeAndWait(): Promise<void> {
    if (this.socket.readyState !== WebSocket.CLOSED) this.close();
  }
  toString(): string { return this.sessionId ?? ''; }
}
