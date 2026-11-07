import type { ImageByteStorage, RgbaImage, StoredRgbaImage } from "@poe-code/image-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { RasterBackingCache } from "./raster-backing.js";

type Region = "pixels" | "labels" | "queue";
type Request = { region: Region; index: number; value?: number };
interface Component { id: number; area: number; x: number; y: number; left: number; top: number; right: number; bottom: number; color: number[] }

// Labels and the flood-fill queue live in caller storage in retained mode.
// Q16 labels, like native ImageMagick, allow at most 65536 objects.
function* labelSteps(width: number, height: number, connectivity: number): Generator<Request | undefined, Component[], number> {
 const components: Component[] = [];
 for (let seed = 0; seed < width * height; seed++) {
  if (seed % 1024 === 0) yield;
  if (yield { region: "labels", index: seed }) continue;
  if (components.length === 65536) throw new Error("connected-components: too many objects (maximum 65536)");
  const id = components.length, color = yield { region: "pixels", index: seed };
  const component: Component = { id, area: 0, x: 0, y: 0, left: width, top: height, right: 0, bottom: 0, color: [0, 0, 0, 0] };
  let head = 0, tail = 1;
  yield { region: "labels", index: seed, value: id + 1 };
  yield { region: "queue", index: 0, value: seed };
  while (head < tail) {
   if (head % 1024 === 0) yield;
   const current = yield { region: "queue", index: head++ }, x = current % width, y = Math.floor(current / width);
   const pixel = yield { region: "pixels", index: current };
   component.area++; component.x += x; component.y += y;
   component.left = Math.min(component.left, x); component.right = Math.max(component.right, x);
   component.top = Math.min(component.top, y); component.bottom = Math.max(component.bottom, y);
   for (let channel = 0; channel < 4; channel++) component.color[channel]! += pixel >>> (channel * 8) & 255;
   for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if ((!dx && !dy) || (connectivity === 4 && dx && dy) || x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
    const next = (y + dy) * width + x + dx;
    if (yield { region: "labels", index: next }) continue;
    const neighbor = yield { region: "pixels", index: next };
    if (neighbor !== color && (neighbor >>> 24 !== 0 || color >>> 24 !== 0)) continue;
    yield { region: "labels", index: next, value: id + 1 };
    yield { region: "queue", index: tail++, value: next };
   }
  }
  components.push(component);
 }
 return components;
}

function* reportSteps(components: Component[]): Generator<void, string, void> {
 // Iterative merge sort keeps ordering cooperative, including checkerboards.
 let sorted = components.slice();
 for (let span = 1; span < sorted.length; span *= 2) {
  const next: Component[] = [];
  for (let start = 0; start < sorted.length; start += span * 2) {
   let left = start, right = Math.min(start + span, sorted.length);
   const middle = right, end = Math.min(start + span * 2, sorted.length);
   while (left < middle || right < end) {
    if (next.length % 1024 === 0) yield;
    next.push(right === end || (left < middle && sorted[left]!.area >= sorted[right]!.area) ? sorted[left++]! : sorted[right++]!);
   }
  }
  sorted = next;
 }
 let text = "Objects (id: bounding-box centroid area mean-color):\n";
 for (const c of sorted) {
  if (c.id % 1024 === 0) yield;
  const channels = c.color.slice(0, 3).map(value => Number((value / c.area).toPrecision(6)));
  const color = c.color[3]! < c.area * 255 ? `srgba(${channels.join(",")},${Number((c.color[3]! / c.area / 255).toPrecision(6))})` : `srgb(${channels.join(",")})`;
  text += `  ${c.id}: ${c.right - c.left + 1}x${c.bottom - c.top + 1}+${c.left}+${c.top} ${(c.x / c.area).toFixed(1)},${(c.y / c.area).toFixed(1)} ${c.area} ${color}\n`;
 }
 return text;
}

export function* connectedComponentsSteps(image: RgbaImage, connectivity: number, verbose: boolean): Generator<void, { image: RgbaImage; text: string }, void> {
 const count = image.width * image.height, labels = new Uint32Array(count), queue = new Uint32Array(count), pixels = new DataView(image.data.buffer, image.data.byteOffset, image.data.byteLength);
 const steps = labelSteps(image.width, image.height, connectivity);
 let next = steps.next();
 while (!next.done) {
  const request = next.value;
  if (!request) { yield; next = steps.next(0); continue; }
  const { region, index, value } = request;
  if (region === "pixels") next = steps.next(pixels.getUint32(index * 4, true));
  else { const data = region === "labels" ? labels : queue; if (value !== undefined) data[index] = value; next = steps.next(data[index]!); }
 }
 const text = verbose ? yield* reportSteps(next.value) : "", data = new Uint8Array(count * 4), data16 = new Uint16Array(count * 4);
 for (let i = 0; i < count; i++) {
  if (i % 1024 === 0) yield;
  const id = labels[i]! - 1, value = Math.round(id / 257);
  data16.set([id, id, id, 65535], i * 4);
  data.set([value, value, value, 255], i * 4);
 }
 return { image: { ...image, data, data16, depth: "ushort", bitsPerSample: 16, hasAlpha: false, space: "srgb" }, text };
}

export async function connectedComponentsStored(image: StoredRgbaImage, storage: ImageByteStorage, connectivity: number, verbose: boolean, signal: AbortSignal): Promise<{ image: StoredRgbaImage; text: string }> {
 const size = image.width * image.height * 4, cache = new RasterBackingCache(storage, signal);
 const regions = { pixels: { position: image.position, length: size }, labels: await cache.allocate(size), queue: await cache.allocate(size) };
 const steps = labelSteps(image.width, image.height, connectivity);
 let next = steps.next();
 while (!next.done) {
  const request = next.value;
  if (!request) { await yieldTurn(signal); next = steps.next(0); continue; }
  const region = regions[request.region], offset = request.index * 4;
  if (request.value !== undefined) { await cache.setUint32(region, offset, request.value); next = steps.next(0); }
  else next = steps.next(await cache.uint32(region, offset));
 }
 let text = "";
 if (verbose) {
  const report = reportSteps(next.value);
  let part = report.next();
  while (!part.done) { await yieldTurn(signal); part = report.next(); }
  text = part.value;
 }
 await cache.flush();
 const position = storage.allocate(size), storedData16 = { position: storage.allocate(size * 2), length: size };
 for (let offset = 0; offset < size; offset += 4096) {
  await yieldTurn(signal);
  const bytes = new Uint8Array(await storage.read(regions.labels.position + offset, Math.min(4096, size - offset), { signal })), view = new DataView(bytes.buffer);
  const data16 = new Uint16Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 4) {
   const id = view.getUint32(i, true) - 1, value = Math.round(id / 257);
   data16.set([id, id, id, 65535], i);
   bytes.set([value, value, value, 255], i);
  }
  await storage.write(position + offset, bytes, { signal });
  await storage.write(storedData16.position + offset * 2, new Uint8Array(data16.buffer), { signal });
 }
 return { image: { ...image, position, storedData16, depth: "ushort", bitsPerSample: 16, hasAlpha: false, space: "srgb" }, text };
}
