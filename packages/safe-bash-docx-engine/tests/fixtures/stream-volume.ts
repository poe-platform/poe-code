import type { Volume } from "memfs";

/** Bounded fixture input; retained descriptor closes on early consumer exit. */
export async function* streamVolume(volume: Volume, path: string) {
  const fd = volume.openSync(path, "r");
  const buffer = new Uint8Array(65536);
  try {
    let position = 0;
    while (true) {
      const count = volume.readSync(fd, buffer, 0, buffer.length, position);
      if (!count) return;
      position += count;
      yield buffer.subarray(0, count);
    }
  } finally { volume.closeSync(fd); }
}
