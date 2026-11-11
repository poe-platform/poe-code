import { rgbToCmyk } from "./colorspace-cmyk.js";
import type { ImageByteStorage, RgbaColor, RgbaImage, StoredRgbaImage } from "@poe-code/image-ast";
import type { HueMetadata } from "./colorspace-hue.js";
import { yieldTurn } from "safe-bash-contracts/yield";
import { RasterBackingCache } from "./raster-backing.js";

export type ConnectedComponentsSort = "x" | "y" | "width" | "height" | "area";

type Region = "pixels" | "labels" | "queue";
type Request = { region: Region | "black"; index: number; value?: number };
interface Component { diameter?: number; id: number; area: number; x: number; y: number; left: number; top: number; right: number; bottom: number; color: number[]; reportAlpha: number; perimeter?: number; angle?: number; majorAxis?: number; minorAxis?: number; eccentricity?: number; circularity?: number }

function* pixelSteps(index: number, cmyk: boolean): Generator<Request, number[], number> {
 const channels: number[] = [];
 for (let channel = 0; channel < 4; channel++) channels.push(yield { region: "pixels", index: index * 4 + channel });
 if (cmyk) channels.push(yield { region: "black", index });
 return channels;
}

// Labels and the flood-fill queue live in caller storage in retained mode.
// Q16 labels, like native ImageMagick, allow at most 65536 objects.
function* labelSteps(width: number, height: number, connectivity: number, fuzz: number, areaThreshold: number[] | undefined, keep: number[][] | undefined, remove: number[][] | undefined, removeColors: RgbaColor[] | undefined, keepTop: number | undefined, angleThreshold: number[] | undefined, perimeterThreshold: number[] | undefined, backgroundId: number | undefined, majorAxisThreshold: number[] | undefined, minorAxisThreshold: number[] | undefined, eccentricityThreshold: number[] | undefined, diameterThreshold: number[] | undefined, circularityThreshold: number[] | undefined, keepColors: RgbaColor[] | undefined, cmyk: boolean): Generator<Request | undefined, Component[], number> {
 const components: Component[] = [];
 for (let seed = 0; seed < width * height; seed++) {
  if (seed % 1024 === 0) yield;
  if (yield { region: "labels", index: seed }) continue;
  if (components.length === 65536) throw new Error("connected-components: too many objects (maximum 65536)");
  const id = components.length;
  const component: Component = { id, area: 0, x: 0, y: 0, left: width, top: height, right: 0, bottom: 0, color: cmyk ? [0, 0, 0, 0, 0] : [0, 0, 0, 0], reportAlpha: 0 };
  let xx = 0, yy = 0, xy = 0;
  let head = 0, tail = 1;
  yield { region: "labels", index: seed, value: id + 1 };
  yield { region: "queue", index: 0, value: seed };
  while (head < tail) {
   if (head % 1024 === 0) yield;
   const current = yield { region: "queue", index: head++ }, x = current % width, y = Math.floor(current / width);
   const pixel = yield* pixelSteps(current, cmyk);
   component.area++; component.x += x; component.y += y;
   if (majorAxisThreshold || minorAxisThreshold || eccentricityThreshold || angleThreshold) { xx += x * x; yy += y * y; xy += x * y; }
   component.left = Math.min(component.left, x); component.right = Math.max(component.right, x);
   component.top = Math.min(component.top, y); component.bottom = Math.max(component.bottom, y);
   for (let channel = 0; channel < pixel.length; channel++) component.color[channel]! += pixel[channel]!;
   for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if ((!dx && !dy) || (connectivity === 4 && dx && dy) || x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
    const next = (y + dy) * width + x + dx;
    if (yield { region: "labels", index: next }) continue;
    const neighbor = yield* pixelSteps(next, cmyk);
    // Match adjacent pixels so similarity remains transitive across a region.
    const distance = (neighbor[3]! - pixel[3]!) ** 2
     + ((neighbor[0]! - pixel[0]!) ** 2 + (neighbor[1]! - pixel[1]!) ** 2 + (neighbor[2]! - pixel[2]!) ** 2)
      * (neighbor[3]! / 255) * (pixel[3]! / 255) / 3;
    // Native pixel equivalence adds the squared fuzz of both pixels.
    if (distance + (cmyk ? (neighbor[4]! - pixel[4]!) ** 2 : 0) > 2 * fuzz ** 2) continue;
    yield { region: "labels", index: next, value: id + 1 };
    yield { region: "queue", index: tail++, value: next };
   }
  }
  // Q16-HDRI starts the report alpha sum at QuantumRange, then adds normalized alpha.
  component.reportAlpha = (65535 + component.color[3]! / 255) / component.area;
  if (angleThreshold) {
   const mu20 = xx - component.x * component.x / component.area;
   const mu02 = yy - component.y * component.y / component.area;
   const mu11 = xy - component.x * component.y / component.area;
   component.angle = Math.atan2(2 * mu11, mu20 - mu02) * 90 / Math.PI;
   if (component.angle < 0) component.angle += 180;
  }
  if (majorAxisThreshold || minorAxisThreshold || eccentricityThreshold) {
   const meanX = component.x / component.area, meanY = component.y / component.area;
   const varianceX = xx / component.area - meanX * meanX, varianceY = yy / component.area - meanY * meanY;
   const covariance = xy / component.area - meanX * meanY;
   // Twice the standard deviation along the principal axis, as in ImageMagick.
   const difference = Math.hypot(varianceX - varianceY, 2 * covariance);
   if (eccentricityThreshold) component.eccentricity = varianceX + varianceY + difference > 0 ? Math.sqrt(Math.min(1, 2 * difference / (varianceX + varianceY + difference))) : 1;
   if (majorAxisThreshold) component.majorAxis = Math.sqrt(2 * (varianceX + varianceY + difference));
   if (minorAxisThreshold) component.minorAxis = Math.sqrt(Math.max(0, 2 * (varianceX + varianceY - difference)));
  }
  if (diameterThreshold) component.diameter = Math.round(2 * Math.sqrt(component.area / Math.PI));
  components.push(component);
 }
 if (perimeterThreshold || circularityThreshold) {
  // Native He/Chao 2x2 pattern metric, with edge-clamped virtual pixels.
  // Scan once for all labels rather than scanning overlapping bounding boxes.
  const patterns = new Float64Array(components.length * 4);
  let visited = 0;
  for (let y = -1; y < height; y++) for (let x = -1; x < width; x++) {
   if (visited++ % 1024 === 0) yield;
   const pixels: number[] = [];
   for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const index = Math.max(0, Math.min(height - 1, y + dy)) * width + Math.max(0, Math.min(width - 1, x + dx));
    pixels.push((yield { region: "labels", index }) - 1);
   }
   for (let i = 0; i < 4; i++) {
    const id = pixels[i]!;
    if (pixels.indexOf(id) !== i) continue;
    let mask = 0, count = 0;
    for (let bit = 0; bit < 4; bit++) if (pixels[bit] === id) { mask |= 1 << bit; count++; }
    if (count === 4) continue;
    const pattern = mask === 9 || mask === 6 ? 0 : count;
    patterns[id * 4 + pattern]!++;
   }
  }
  for (const component of components) {
   if (component.id % 1024 === 0) yield;
   const offset = component.id * 4;
   const perimeter = Math.ceil(Math.SQRT1_2 * patterns[offset + 1]! + patterns[offset + 2]! + Math.SQRT1_2 * patterns[offset + 3]! + Math.SQRT2 * (patterns[offset]! + 1) - 0.5);
   if (perimeterThreshold) component.perimeter = perimeter;
   if (circularityThreshold) component.circularity = 4 * Math.PI * component.area / (perimeter * perimeter);
  }
 }
 if (diameterThreshold || areaThreshold || keep || remove || removeColors || keepColors || keepTop !== undefined || perimeterThreshold || angleThreshold || majorAxisThreshold || minorAxisThreshold || eccentricityThreshold || circularityThreshold) {
  const top = keepTop === undefined ? undefined : new Set((yield* sortSteps(components)).slice(0, keepTop + 1).map(component => component.id));
  const selected = (ranges: number[][] | undefined, id: number) => ranges?.some(range => {
   const start = range[0]! < 0 ? components.length + range[0]! : range[0]!;
   const last = range[1] ?? range[0]!;
   const end = last < 0 ? components.length + last : last;
   return id >= Math.min(start, end) && id <= Math.max(start, end);
  });
  const background = components[backgroundId ?? -1] ?? components.reduce((largest, component) => component.area > largest.area ? component : largest);
  // Native merging visits original IDs, samples preceding neighbors with tiled
  // edges, and keeps the destination's original mean color.
  const offsets = connectivity === 4 ? [[0, -1], [-1, 0]] : [[-1, -1], [0, -1], [1, -1], [-1, 0]];
  for (const component of components) {
   const matchesColor = (color: RgbaColor) => {
    const [r, g, b, a] = component.color.map(channel => channel / component.area);
    const distance = (a! - color.a) ** 2 + ((r! - color.r) ** 2 + (g! - color.g) ** 2 + (b! - color.b) ** 2) * (a! / 255) * (color.a / 255) / 3;
    return distance <= 2 * fuzz ** 2;
   };
   if (component === background || ((!areaThreshold || (component.area >= areaThreshold[0]! && component.area < areaThreshold[1]!)) && (!diameterThreshold || (component.diameter! >= diameterThreshold[0]! && component.diameter! < diameterThreshold[1]!)) && (!angleThreshold || (component.angle! >= angleThreshold[0]! && component.angle! < angleThreshold[1]!)) && (!perimeterThreshold || (component.perimeter! >= perimeterThreshold[0]! && component.perimeter! < perimeterThreshold[1]!)) && (!majorAxisThreshold || (component.majorAxis! >= majorAxisThreshold[0]! && component.majorAxis! < majorAxisThreshold[1]!)) && (!minorAxisThreshold || (component.minorAxis! >= minorAxisThreshold[0]! && component.minorAxis! < minorAxisThreshold[1]!)) && (!circularityThreshold || (component.circularity! >= circularityThreshold[0]! && component.circularity! < circularityThreshold[1]!)) && (!eccentricityThreshold || (component.eccentricity! >= eccentricityThreshold[0]! && component.eccentricity! < eccentricityThreshold[1]!)) && (!keep || selected(keep, component.id)) && !selected(remove, component.id) && !removeColors?.some(matchesColor) && (!keepColors || keepColors.some(matchesColor)) && (!top || top.has(component.id)))) continue;
   const census = new Map<number, number>();
   let visited = 0;
   for (let y = component.top; y <= component.bottom; y++) for (let x = component.left; x <= component.right; x++) {
    if (visited++ % 1024 === 0) yield;
    if ((yield { region: "labels", index: y * width + x }) !== component.id + 1) continue;
    for (const [dx, dy] of offsets) {
     const index = ((y + dy! + height) % height) * width + (x + dx! + width) % width;
     const id = (yield { region: "labels", index }) - 1;
     if (id !== component.id) census.set(id, (census.get(id) ?? 0) + 1);
    }
   }
   let destination = 0, maximum = 0;
   for (const [id, count] of census) if (count > maximum || (count === maximum && id < destination)) { destination = id; maximum = count; }
   for (let y = component.top; y <= component.bottom; y++) for (let x = component.left; x <= component.right; x++) {
    if (visited++ % 1024 === 0) yield;
    const index = y * width + x;
    if ((yield { region: "labels", index }) === component.id + 1) yield { region: "labels", index, value: destination + 1 };
   }
  }
  for (const component of components) {
   component.color = component.color.map(channel => channel / component.area);
   component.area = component.x = component.y = 0;
   component.left = width; component.top = height; component.right = component.bottom = 0;
  }
  for (let index = 0; index < width * height; index++) {
   if (index % 1024 === 0) yield;
   const component = components[(yield { region: "labels", index }) - 1]!, x = index % width, y = Math.floor(index / width);
   component.area++; component.x += x; component.y += y;
   component.left = Math.min(component.left, x); component.right = Math.max(component.right, x);
   component.top = Math.min(component.top, y); component.bottom = Math.max(component.bottom, y);
  }
  for (const component of components) component.color = component.color.map(channel => channel * component.area);
 }
 return components;
}

function* sortSteps(components: Component[], sort?: ConnectedComponentsSort, order?: "increasing" | "decreasing"): Generator<undefined, Component[], unknown> {
 const increasing = order === undefined ? sort !== undefined : order === "increasing";
 const value = (component: Component) => sort === "x" ? component.left : sort === "y" ? component.top
  : sort === "width" ? component.right - component.left + 1 : sort === "height" ? component.bottom - component.top + 1 : component.area;
 // Iterative merge sort keeps ordering cooperative, including checkerboards.
 let sorted = components.filter(component => component.area > 0);
 for (let span = 1; span < sorted.length; span *= 2) {
  const next: Component[] = [];
  for (let start = 0; start < sorted.length; start += span * 2) {
   let left = start, right = Math.min(start + span, sorted.length);
   const middle = right, end = Math.min(start + span * 2, sorted.length);
   while (left < middle || right < end) {
    if (next.length % 1024 === 0) yield;
    next.push(right === end || (left < middle && (increasing
     ? value(sorted[left]!) <= value(sorted[right]!)
     : value(sorted[left]!) >= value(sorted[right]!))) ? sorted[left++]! : sorted[right++]!);
   }
  }
  sorted = next;
 }
 return sorted;
}

function formatMeasurement(value: number, precision: number): string {
 const [mantissa, exponent] = value.toExponential(precision - 1).split("e");
 const power = Number(exponent);
 if (power < -4 || power >= precision) return `${Number(mantissa)}e${exponent![0]}${exponent!.slice(1).padStart(2, "0")}`;
 return String(Number(value.toPrecision(precision)));
}

function* reportSteps(components: Component[], sort: ConnectedComponentsSort | undefined, excludeHeader: boolean, excludeIds: boolean, image: (RgbaImage | StoredRgbaImage) & HueMetadata, order?: "increasing" | "decreasing", precision = 6): Generator<void, string, void> {
 const sorted = yield* sortSteps(components, sort, order);
 let text = excludeHeader ? "" : `Objects (${excludeIds ? "" : "id: "}bounding-box centroid area mean-color${components[0]?.perimeter === undefined ? "" : " perimeter"}${components[0]?.circularity === undefined ? "" : " circularity"}${components[0]?.diameter === undefined ? "" : " diameter"}${components[0]?.majorAxis === undefined ? "" : " major-axis"}${components[0]?.minorAxis === undefined ? "" : " minor-axis"}${components[0]?.eccentricity === undefined ? "" : " eccentricity"}${components[0]?.angle === undefined ? "" : " angle"}):\n`;
 for (const c of sorted) {
  if (c.id % 1024 === 0) yield;
  // Only odd quarters are exact binary ties at one decimal place. Native uses ties-to-even.
  const centroid = [c.x / c.area, c.y / c.area].map(value =>
   (value % 0.5 === 0.25 ? Math.round(value * 5) / 5 : value).toFixed(1)).join(",");
  const space = image.magickColorspace ?? (image.space === "b-w" || image.space === "grey16" ? "Gray" : image.space === "cmyk" ? "CMYK" : "sRGB");
  const hue = space === "HCL" || space === "HCLp" || space === "HSL" || space === "HSB" || space === "HSV";
  const channels = (space === "CMYK" ? [c.color[0]!, c.color[1]!, c.color[2]!, c.color[4]!] : c.color.slice(0, space === "Gray" ? 1 : 3)).map((value, index) => {
   if (space === "CIELab") return formatMeasurement(index === 0 ? value / c.area * 100 / 255 : value / c.area - 127.5, precision);
   const grayPercent = space === "Gray" && !Number.isInteger(value / c.area);
   const scale = grayPercent ? 100 / 255 : hue ? (index === 0 ? 360 : 100) / 255 : space === "XYZ" ? 100 / 255 : 1;
   return `${formatMeasurement(value / c.area * scale, precision)}${grayPercent || (hue && index > 0) ? "%" : ""}`;
  });
  const color = `${space.toLowerCase()}${image.hasAlpha ? "a" : ""}(${channels.join(",")}${image.hasAlpha ? `,${formatMeasurement(c.reportAlpha, precision)}` : ""})`;
  text += `  ${excludeIds ? "" : `${c.id}: `}${c.right - c.left + 1}x${c.bottom - c.top + 1}+${c.left}+${c.top} ${centroid} ${c.area} ${color}${c.perimeter === undefined ? "" : ` ${c.perimeter}`}${c.circularity === undefined ? "" : ` ${formatMeasurement(c.circularity, precision)}`}${c.diameter === undefined ? "" : ` ${c.diameter}`}${c.majorAxis === undefined ? "" : ` ${formatMeasurement(c.majorAxis, precision)}`}${c.minorAxis === undefined ? "" : ` ${formatMeasurement(c.minorAxis, precision)}`}${c.eccentricity === undefined ? "" : ` ${formatMeasurement(c.eccentricity, precision)}`}${c.angle === undefined ? "" : ` ${formatMeasurement(c.angle, precision)}`}\n`;
 }
 return text;
}

export function* connectedComponentsSteps(image: RgbaImage & HueMetadata, connectivity: number, fuzz: number, verbose: boolean, meanColor = false, areaThreshold?: number[], keep?: number[][], remove?: number[][], removeColors?: RgbaColor[], keepTop?: number, sort?: ConnectedComponentsSort, angleThreshold?: number[], perimeterThreshold?: number[], excludeHeader = false, excludeIds = false, backgroundId?: number, sortOrder?: "increasing" | "decreasing", majorAxisThreshold?: number[], minorAxisThreshold?: number[], eccentricityThreshold?: number[], diameterThreshold?: number[], circularityThreshold?: number[], keepColors?: RgbaColor[], precision = 6): Generator<void, { image: RgbaImage; text: string }, void> {
 const count = image.width * image.height, labels = new Uint32Array(count), queue = new Uint32Array(count);
 const steps = labelSteps(image.width, image.height, connectivity, fuzz, areaThreshold, keep, remove, removeColors, keepTop, angleThreshold, perimeterThreshold, backgroundId, majorAxisThreshold, minorAxisThreshold, eccentricityThreshold, diameterThreshold, circularityThreshold, keepColors, image.space === "cmyk");
 let next = steps.next();
 while (!next.done) {
  const request = next.value;
  if (!request) { yield; next = steps.next(0); continue; }
  const { region, index, value } = request;
  if (region === "black") next = steps.next(image.hueSamples ? image.hueSamples[index * 4 + 3]! * 255 : rgbToCmyk(image.data[index * 4]! / 255, image.data[index * 4 + 1]! / 255, image.data[index * 4 + 2]! / 255)[3]! * 255);
  else if (region === "pixels" && index % 4 === 3 && !image.hasAlpha) next = steps.next(255);
  else if (region === "pixels" && image.space === "cmyk" && index % 4 === 3) next = steps.next(image.data16 ? image.data16[index]! / 257 : image.data[index]!);
  else if (region === "pixels") next = steps.next(image.hueSamples ? image.hueSamples[index]! * 255 : image.data16 ? image.data16[index]! / 257 : image.data[index]!);
  else { const data = region === "labels" ? labels : queue; if (value !== undefined) data[index] = value; next = steps.next(data[index]!); }
 }
 const text = verbose ? yield* reportSteps(next.value, sort, excludeHeader, excludeIds, image, sortOrder, precision) : "", data = new Uint8Array(count * 4), data16 = new Uint16Array(count * 4);
 for (let i = 0; i < count; i++) {
  if (i % 1024 === 0) yield;
  const id = labels[i]! - 1, value = Math.round(id / 257);
  const component = next.value[id]!;
  const color = component.color.map(channel => channel / component.area);
  if (image.space === "cmyk") for (let channel = 0; channel < 3; channel++) color[channel] = (1 - color[channel]! / 255) * (255 - color[4]!);
  color.length = 4;
  data16.set(meanColor ? color.map(channel => Math.round(channel * 257)) : [id, id, id, 65535], i * 4);
  data.set(meanColor ? color.map(channel => Math.round(channel)) : [value, value, value, 255], i * 4);
 }
 const { hueSamples: ignoredSamples, storedHueSamples: ignoredStored, ...metadata } = image;
 return { image: { ...(image.space === "cmyk" ? metadata : image), data, data16, depth: "ushort", bitsPerSample: 16, hasAlpha: meanColor && image.hasAlpha, space: "srgb" }, text };
}

export async function connectedComponentsStored(image: StoredRgbaImage & HueMetadata, storage: ImageByteStorage, connectivity: number, fuzz: number, verbose: boolean, signal: AbortSignal, meanColor = false, areaThreshold?: number[], keep?: number[][], remove?: number[][], removeColors?: RgbaColor[], keepTop?: number, sort?: ConnectedComponentsSort, angleThreshold?: number[], perimeterThreshold?: number[], excludeHeader = false, excludeIds = false, backgroundId?: number, sortOrder?: "increasing" | "decreasing", majorAxisThreshold?: number[], minorAxisThreshold?: number[], eccentricityThreshold?: number[], diameterThreshold?: number[], circularityThreshold?: number[], keepColors?: RgbaColor[], precision = 6): Promise<{ image: StoredRgbaImage; text: string }> {
 const size = image.width * image.height * 4, cache = new RasterBackingCache(storage, signal);
 const regions = { pixels: image.storedHueSamples !== undefined ? { position: image.storedHueSamples, length: size * 8 } : image.storedData16 ? { position: image.storedData16.position, length: size * 2 } : { position: image.position, length: size }, labels: await cache.allocate(size), queue: await cache.allocate(size) };
 const steps = labelSteps(image.width, image.height, connectivity, fuzz, areaThreshold, keep, remove, removeColors, keepTop, angleThreshold, perimeterThreshold, backgroundId, majorAxisThreshold, minorAxisThreshold, eccentricityThreshold, diameterThreshold, circularityThreshold, keepColors, image.space === "cmyk");
 let next = steps.next();
 while (!next.done) {
  const request = next.value;
  if (!request) { await yieldTurn(signal); next = steps.next(0); continue; }
  if (request.region === "black") {
   next = steps.next(image.storedHueSamples !== undefined ? await cache.float64(regions.pixels, (request.index * 4 + 3) * 8) * 255 : 255 - Math.max(...await storage.read(image.position + request.index * 4, 3, { signal })));
   continue;
  }
  const region = regions[request.region], offset = request.index * 4;
  if (request.region === "pixels") {
   const index = request.index;
   if (index % 4 === 3 && !image.hasAlpha) next = steps.next(255);
   else if (image.space === "cmyk" && index % 4 === 3) next = steps.next(await cache.byte({ position: image.position, length: size }, index));
   else if (image.storedHueSamples !== undefined) next = steps.next(await cache.float64(region, index * 8) * 255);
   else if (image.storedData16) {
    const pair = await cache.uint32(region, Math.floor(index / 2) * 4);
    next = steps.next(((pair >>> ((index % 2) * 16)) & 65535) / 257);
   } else next = steps.next(await cache.byte(region, index));
  }
  else if (request.value !== undefined) { await cache.setUint32(region, offset, request.value); next = steps.next(0); }
  else next = steps.next(await cache.uint32(region, offset));
 }
 let text = "";
 if (verbose) {
  const report = reportSteps(next.value, sort, excludeHeader, excludeIds, image, sortOrder, precision);
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
   const component = next.value[id]!;
   const color = component.color.map(channel => channel / component.area);
   if (image.space === "cmyk") for (let channel = 0; channel < 3; channel++) color[channel] = (1 - color[channel]! / 255) * (255 - color[4]!);
   color.length = 4;
   data16.set(meanColor ? color.map(channel => Math.round(channel * 257)) : [id, id, id, 65535], i);
   bytes.set(meanColor ? color.map(channel => Math.round(channel)) : [value, value, value, 255], i);
  }
  await storage.write(position + offset, bytes, { signal });
  await storage.write(storedData16.position + offset * 2, new Uint8Array(data16.buffer), { signal });
 }
 const { hueSamples: ignoredSamples, storedHueSamples: ignoredStored, ...metadata } = image;
 return { image: { ...(image.space === "cmyk" ? metadata : image), position, storedData16, depth: "ushort", bitsPerSample: 16, hasAlpha: meanColor && image.hasAlpha, space: "srgb" }, text };
}
