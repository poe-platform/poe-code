/** Decode the first QuickTime timecode sample using its tmcd sample description. */
export function decodeMp4Timecode(configuration: Uint8Array | undefined, sample: Uint8Array): string | undefined {
  if (!configuration || configuration.length < 20 || sample.length < 4) return;
  const config = new DataView(configuration.buffer, configuration.byteOffset, configuration.byteLength);
  const timescale = config.getUint32(8), frameDuration = config.getUint32(12);
  let framesPerTick = configuration[16]!;
  if (!timescale || !frameDuration || !framesPerTick) return;
  const fps = Math.round(timescale / frameDuration);
  if (!fps) return;
  // Some writers truncate the nominal rate; high-rate tracks can count pairs of frames.
  if (framesPerTick === Math.floor(timescale / frameDuration)) framesPerTick = fps;
  const flags = config.getUint32(4), drop = (flags & 1) !== 0;
  let frames = Math.round(new DataView(sample.buffer, sample.byteOffset, sample.byteLength).getUint32(0) * fps / framesPerTick) | 0;
  if (drop) {
    // Drop two labels per minute at 30 fps (four at 60), except each tenth minute.
    if (fps % 30 !== 0) return;
    const dropped = fps / 30 * 2;
    const perMinute = fps * 60 - dropped;
    const perTenMinutes = fps * 600 - dropped * 9;
    frames = (frames + dropped * (9 * Math.trunc(frames / perTenMinutes) +
      Math.trunc((frames % perTenMinutes - dropped) / perMinute))) | 0;
  }
  const negative = frames < 0 && (flags & 4) !== 0;
  frames = Math.abs(frames);
  let hours = Math.floor(frames / (fps * 3600));
  if (flags & 2) hours %= 24;
  const minutes = Math.floor(frames / (fps * 60)) % 60;
  const seconds = Math.floor(frames / fps) % 60;
  return `${negative ? "-" : ""}${[hours, minutes, seconds].map(value => String(value).padStart(2, "0")).join(":")}${drop ? ";" : ":"}${String(frames % fps).padStart(String(fps - 1).length, "0")}`;
}
