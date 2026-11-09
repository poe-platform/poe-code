import { scaleVideoPicture, type MediaBudgetTracker, type MediaVideoFrame } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";

export function parseFeedbackGraph(graph: string, maps: string[]) {
  const chains: { inputs: string[]; outputs: string[]; expression: string }[] = [];
  let start = 0;
  let quoted = false;
  for (let i = 0; i <= graph.length; i++) {
    const char = graph[i];
    if (char === "'") quoted = !quoted;
    else if (!quoted && char === "\\") i++;
    else if (i === graph.length || (!quoted && char === ";")) {
      let expression = graph.slice(start, i).trim();
      start = i + 1;
      const inputs: string[] = [];
      const outputs: string[] = [];
      while (expression.startsWith("[")) {
        const end = expression.indexOf("]");
        if (end < 0) break;
        inputs.push(expression.slice(1, end));
        expression = expression.slice(end + 1).trim();
      }
      while (expression.endsWith("]")) {
        const begin = expression.lastIndexOf("[");
        if (begin < 0) break;
        outputs.unshift(expression.slice(begin + 1, -1));
        expression = expression.slice(0, begin).trim();
      }
      chains.push({ inputs, outputs, expression });
    }
  }
  const feedback = chains.filter(chain => chain.expression.split("=", 1)[0]!.split("@", 1)[0] === "feedback");
  if (!feedback.length) return undefined;
  const node = feedback[0]!;
  if (feedback.length !== 1 || node.inputs.length !== 2 || node.outputs.length !== 2) {
    throw new Error("feedback: expected two inputs and two outputs for one feedback filter");
  }
  if (maps.length !== 1 || maps[0] !== `[${node.outputs[0]}]`) {
    throw new Error("feedback: the main output must be mapped exactly once");
  }
  const outputs = new Set<string>();
  for (const chain of chains) for (const output of chain.outputs) {
    if (!output || outputs.has(output)) throw new Error("feedback: duplicate or empty output label");
    outputs.add(output);
  }
  const [input, selector, ordinal = "0", ...extra] = node.inputs[0]!.split(":");
  if (selector !== "v" || extra.length || ![input, ordinal].every(value =>
    value && [...value].every(char => char >= "0" && char <= "9") && Number.isSafeInteger(Number(value)))) {
    throw new Error("feedback: expected a video input label such as 0:v:0");
  }
  const filters: string[] = [];
  const visited = new Set([node]);
  let label = node.inputs[1]!;
  while (label !== node.outputs[1]) {
    const chain = chains.find(chain => chain.outputs.includes(label));
    if (!chain || visited.has(chain) || chain.inputs.length !== 1 || chain.outputs.length !== 1 || !chain.expression) {
      throw new Error("feedback: return branch must connect the cropped output to the second input");
    }
    visited.add(chain);
    filters.unshift(chain.expression);
    label = chain.inputs[0]!;
  }
  if (visited.size !== chains.length) throw new Error("feedback: unconnected filter chain");
  const rectangle = { x: 0, y: 0, w: 0, h: 0 };
  const equals = node.expression.indexOf("=");
  let named = false;
  for (const [index, part] of (equals < 0 ? [] : node.expression.slice(equals + 1).split(":")).entries()) {
    const separator = part.indexOf("=");
    const key = separator < 0 ? ["x", "y", "w", "h"][index] : part.slice(0, separator).trim();
    const raw = (separator < 0 ? part : part.slice(separator + 1)).trim();
    const value = Number(raw);
    if ((key !== "x" && key !== "y" && key !== "w" && key !== "h") ||
        (separator < 0 && named) || !raw || !Number.isInteger(value) || value < 0 || value > 2147483647) {
      throw new Error(`feedback: invalid rectangle option ${part}`);
    }
    named ||= separator >= 0;
    rectangle[key] = value;
  }
  return { input: Number(input), ordinal: Number(ordinal), rectangle, filter: filters.join(",") || "null" };
}

export async function applyFeedback(
  frames: MediaVideoFrame[],
  rectangle: { x: number; y: number; w: number; h: number },
  filter: (tiles: MediaVideoFrame[]) => Promise<MediaVideoFrame[]>,
  budget: MediaBudgetTracker,
  signal?: AbortSignal
): Promise<MediaVideoFrame[]> {
  if (!frames.length) return frames;
  const first = frames[0]!;
  let { x, y, w, h } = rectangle;
  if (x >= first.width) x = 0;
  if (y >= first.height) y = 0;
  w = Math.min(w || first.width - x, first.width);
  h = Math.min(h || first.height - y, first.height);
  x = Math.min(x, first.width - w);
  y = Math.min(y, first.height - h);
  const tiles: MediaVideoFrame[] = [];
  for (const frame of frames) {
    await yieldTurn(signal);
    signal?.throwIfAborted();
    budget.checkCpu();
    if (frame.width !== first.width || frame.height !== first.height) throw new Error("feedback: changing frame dimensions are unsupported");
    budget.allocateMemory(w * h * 4);
    const data = new Uint8Array(w * h * 4);
    for (let row = 0; row < h; row++) {
      if (row % 32 === 0) {
        await yieldTurn(signal);
        signal?.throwIfAborted();
        budget.checkCpu();
      }
      const offset = ((y + row) * frame.width + x) * 4;
      data.set(frame.data.subarray(offset, offset + w * 4), row * w * 4);
    }
    const { native: ignoredNative, ...properties } = frame;
    let tile: MediaVideoFrame = { ...properties, width: w, height: h, data };
    const source = frame.native;
    if (source && source.rgba === frame.data && source.width === frame.width && source.height === frame.height &&
        [0, 4, 5, 12, 13, 14].includes(source.format)) {
      const hsub = [5, 14].includes(source.format) ? 1 : 2;
      const vsub = [0, 12].includes(source.format) ? 2 : 1;
      const length = w * h + 2 * Math.ceil(w / hsub) * Math.ceil(h / vsub);
      budget.allocateMemory(length);
      const pixels = new Uint8Array(length);
      let sourceOffset = 0;
      let targetOffset = 0;
      for (let plane = 0; plane < 3; plane++) {
        const sx = plane ? hsub : 1, sy = plane ? vsub : 1;
        const width = Math.ceil(frame.width / sx), height = Math.ceil(frame.height / sy);
        const tw = Math.ceil(w / sx), th = Math.ceil(h / sy);
        for (let row = 0; row < th; row++) {
          if (row % 32 === 0) {
            await yieldTurn(signal);
            signal?.throwIfAborted();
            budget.checkCpu();
          }
          const offset = sourceOffset + (Math.floor(y / sy) + row) * width + Math.floor(x / sx);
          pixels.set(source.pixels.subarray(offset, offset + tw), targetOffset + row * tw);
        }
        sourceOffset += width * height;
        targetOffset += tw * th;
      }
      const native = { ...source, width: w, height: h, pixels, rgba: data };
      const rgba = scaleVideoPicture({ ...tile, native }, w, h)!;
      budget.allocateMemory(rgba.length);
      tile = { ...tile, data: rgba, native: { ...native, rgba } };
    }
    tiles.push(tile);
  }
  const filtered = await filter(tiles);
  if (filtered.length !== frames.length || filtered.some(tile => tile.width !== w || tile.height !== h)) {
    throw new Error("feedback: return branch must preserve rectangle dimensions and frame count");
  }
  const result: MediaVideoFrame[] = [];
  for (const [index, frame] of frames.entries()) {
    await yieldTurn(signal);
    signal?.throwIfAborted();
    budget.checkCpu();
    const tile = filtered[index]!;
    const source = frame.native;
    const patch = tile.native;
    if (source && patch && source.rgba === frame.data && patch.rgba === tile.data && source.format === patch.format &&
        source.width === frame.width && source.height === frame.height && patch.width === w && patch.height === h &&
        [0, 4, 5, 12, 13, 14].includes(source.format)) {
      budget.allocateMemory(source.pixels.length + frame.data.length);
      const pixels = new Uint8Array(source.pixels);
      const hsub = [5, 14].includes(source.format) ? 1 : 2;
      const vsub = [0, 12].includes(source.format) ? 2 : 1;
      let sourceOffset = 0;
      let targetOffset = 0;
      for (let plane = 0; plane < 3; plane++) {
        const sx = plane ? hsub : 1, sy = plane ? vsub : 1;
        const width = Math.ceil(frame.width / sx), height = Math.ceil(frame.height / sy);
        const tw = Math.ceil(w / sx), th = Math.ceil(h / sy);
        // Native feedback floors chroma copy widths and shifts each luma row's destination.
        for (let row = 0; row < h; row++) {
          if (row % 32 === 0) {
            await yieldTurn(signal);
            signal?.throwIfAborted();
            budget.checkCpu();
          }
          const offset = sourceOffset + Math.floor(row / sy) * tw;
          pixels.set(patch.pixels.subarray(offset, offset + Math.floor(w / sx)),
            targetOffset + Math.floor((y + row) / sy) * width + Math.floor(x / sx));
        }
        sourceOffset += tw * th;
        targetOffset += width * height;
      }
      const native = { ...source, pixels };
      const data = scaleVideoPicture({ ...frame, native }, frame.width, frame.height)!;
      result.push({ ...frame, data, native: { ...native, rgba: data } });
    } else {
      budget.allocateMemory(frame.data.length);
      const data = new Uint8Array(frame.data);
      for (let row = 0; row < h; row++) {
        if (row % 32 === 0) {
          await yieldTurn(signal);
          signal?.throwIfAborted();
          budget.checkCpu();
        }
        data.set(tile.data.subarray(row * w * 4, (row + 1) * w * 4), ((y + row) * frame.width + x) * 4);
      }
      const { native: ignoredNative, ...properties } = frame;
      result.push({ ...properties, data });
    }
  }
  return result;
}
