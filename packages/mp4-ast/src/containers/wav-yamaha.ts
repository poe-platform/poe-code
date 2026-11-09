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

export function encodeYamahaWav(channelData: readonly (Float32Array | Float64Array)[]): Uint8Array {
  const channels = channelData.length;
  if (channels !== 1 && channels !== 2) throw new Error("Yamaha ADPCM WAV requires mono or stereo audio");
  const frames = channelData[0]!.length;
  const data = new Uint8Array(Math.ceil(frames * channels / 2048) * 1024);
  for (let channel = 0; channel < channels; channel++) {
    let predictor = 0, step = 127;
    for (let frame = 0; frame < data.length * 2 / channels; frame++) {
      const sample = Math.max(-32768, Math.min(32767, Math.round((channelData[channel]![frame] ?? 0) * 32768)));
      const difference = sample - predictor;
      const magnitude = Math.min(7, Math.floor(Math.abs(difference) * 4 / step));
      const nibble = magnitude | (difference < 0 ? 8 : 0);
      const index = frame * channels + channel;
      data[index >>> 1] = data[index >>> 1]! | (nibble << ((index & 1) * 4));
      const delta = Math.floor(step * (magnitude * 2 + 1) / 8);
      predictor = Math.max(-32768, Math.min(32767, predictor + (nibble & 8 ? -delta : delta)));
      step = Math.max(127, Math.min(24576, Math.floor(step * stepScale[magnitude]! / 256)));
    }
  }
  return data;
}
