// Yamaha ADPCM carries predictor and step state across packet boundaries.
const stepScale = [230, 230, 230, 230, 307, 409, 512, 614];

export function decodeYamahaWav(data: Uint8Array, channels: number): Float32Array[] {
  const frames = data.length * 2 / channels;
  return Array.from({ length: channels }, (_, channel) => {
    const output = new Float32Array(frames);
    let predictor = 0, step = 127;
    for (let frame = 0; frame < frames; frame++) {
      const index = frame * channels + channel;
      const nibble = (data[index >>> 1]! >>> ((index & 1) * 4)) & 15;
      const delta = Math.floor(step * ((nibble & 7) * 2 + 1) / 8);
      predictor = Math.max(-32768, Math.min(32767, predictor + (nibble & 8 ? -delta : delta)));
      step = Math.max(127, Math.min(24576, Math.floor(step * stepScale[nibble & 7]! / 256)));
      output[frame] = predictor / 32768;
    }
    return output;
  });
}
