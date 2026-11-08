import { createInflateRaw as portableInflateRaw } from "@jspm/core/nodelibs/zlib";

export { createGzip, createGunzip } from "@jspm/core/nodelibs/zlib";

export function createInflateRaw(options) {
  const stream = portableInflateRaw(options);
  if (typeof stream._handle?.strm?.total_in !== "number")
    throw new Error("Browser inflater no longer exposes consumed input bytes");
  let consumed = 0;
  Object.defineProperty(stream, "bytesWritten", {
    get() {
      consumed = stream._handle?.strm?.total_in ?? consumed;
      return consumed;
    }
  });
  return stream;
}
