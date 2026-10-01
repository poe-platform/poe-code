import { afterEach, expect, test, vi } from "vitest";
import {
  beginBrowserOwnerShutdown,
  closeBrowserSocket,
  finalizeBrowserOwnerTermination,
  registerBrowserSocketClose
} from "../src/browser-socket-closure";

afterEach(() => vi.unstubAllGlobals());

// Model runtime-delivered events without making synthetic DOM events trusted.
function upstream() {
  vi.stubGlobal("WebSocket", { CLOSED: 3 });
  let onClose: ((event: CloseEvent) => void) | undefined;
  const socket = {
    readyState: 1,
    accept() {},
    close() {
      socket.readyState = 2;
    },
    addEventListener(type: string, listener: (event: CloseEvent) => void) {
      if (type === "close") onClose = listener;
    },
    removeEventListener() {}
  };
  return {
    socket: socket as unknown as WebSocket,
    closed: registerBrowserSocketClose(socket as unknown as WebSocket),
    disconnect({ code = 1006, trusted = true, state = 3 } = {}) {
      socket.readyState = state;
      onClose!({
        code,
        reason: "WebSocket disconnected without sending Close frame.",
        isTrusted: trusted
      } as CloseEvent);
    }
  };
}

test.each(["before", "after"])(
  "owner deletion %s native 1006 confirms a shutdown disconnect",
  async (order) => {
    const peer = upstream();
    beginBrowserOwnerShutdown([peer.socket]);
    if (order === "before") finalizeBrowserOwnerTermination([peer.socket], true);
    peer.disconnect();
    if (order === "after") {
      let settled = false;
      void peer.closed.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        }
      );
      await Promise.resolve();
      expect(settled).toBe(false);
      finalizeBrowserOwnerTermination([peer.socket], true);
    }
    await expect(peer.closed).resolves.toBeUndefined();
  }
);

test("client close preceding owner release can be confirmed by successful deletion", async () => {
  const peer = upstream();
  closeBrowserSocket(peer.socket);
  peer.disconnect();
  beginBrowserOwnerShutdown([peer.socket]);
  finalizeBrowserOwnerTermination([peer.socket], true);
  await expect(peer.closed).resolves.toBeUndefined();
});

test.each(["before", "after"])(
  "failed deletion %s native 1006 retains the upstream diagnostic",
  async (order) => {
    const peer = upstream();
    beginBrowserOwnerShutdown([peer.socket]);
    if (order === "before") finalizeBrowserOwnerTermination([peer.socket], false);
    peer.disconnect();
    if (order === "after") finalizeBrowserOwnerTermination([peer.socket], false);
    await expect(peer.closed).rejects.toThrow(
      "1006 WebSocket disconnected without sending Close frame."
    );
  }
);

test("active native 1006 cannot be excused by later shutdown and deletion", async () => {
  const peer = upstream();
  peer.disconnect();
  beginBrowserOwnerShutdown([peer.socket]);
  finalizeBrowserOwnerTermination([peer.socket], true);
  await expect(peer.closed).rejects.toThrow("1006");
});

test.each([{ code: 1008 }, { trusted: false }, { state: 2 }])(
  "successful deletion cannot excuse an unconfirmed or unrelated close: %j",
  async (event) => {
    const peer = upstream();
    beginBrowserOwnerShutdown([peer.socket]);
    peer.disconnect(event);
    finalizeBrowserOwnerTermination([peer.socket], true);
    await expect(peer.closed).rejects.toThrow("Owned browser upstream closed");
  }
);
