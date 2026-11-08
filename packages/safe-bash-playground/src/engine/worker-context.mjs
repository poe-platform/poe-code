export const isMainThread = false;
export const workerData = globalThis.__safeBashWorkerData;
export const parentPort = {
  on(event, listener) {
    if (event !== "message") throw new Error(`Unsupported worker port event: ${event}`);
    globalThis.addEventListener("message", (message) => listener(message.data));
    return this;
  },
  postMessage: globalThis.postMessage.bind(globalThis)
};
