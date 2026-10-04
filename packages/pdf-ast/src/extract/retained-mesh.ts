import { readBytes } from "@poe-code/safe-fs/contracts";
import type { PdfCosDict } from "../ast.js";
import { createMeshRaster, meshShadingParameters } from "../content/evaluator.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import type { ParsedCosDocument } from "../cos/parser.js";
import { PdfError } from "../errors.js";
import { PdfFileSource } from "../source.js";
import { MeshPatchDecoder, MeshStreamReader, Stream } from "../vendor/pdfjs-fonts.mjs";
import type { PdfRetainedColorOptions, PdfRetainedShadingSettings } from "./retained-color.js";

/** Free-form meshes retain one triangle. Lattices stage fixed-size vertex
 * records in caller storage, so even a single very wide row stays bounded. */
export async function renderRetainedMesh(context: ParsedCosDocument, dict: PdfCosDict, type: 4 | 5 | 6 | 7,
  input: AsyncIterable<Uint8Array>, settings: PdfRetainedShadingSettings, storage: PdfIndexStorage,
  options: PdfRetainedColorOptions, charge: (bytes: number) => void) {
  const chunkBytes = options.chunkBytes ?? 4096;
  async function readRecord(source: PdfFileSource, position: number, length: number) {
    const bytes = new Uint8Array(length);
    for (let offset = 0; offset < length; offset += chunkBytes) bytes.set(await source.read(position + offset, Math.min(chunkBytes, length - offset), options.signal), offset);
    return bytes;
  }
  const parameters = meshShadingParameters(context, dict);
  if (!parameters) return undefined;
  const {bitsPerCoordinate, bitsPerComponent, bitsPerFlag, numComps} = parameters.context;
  for (const bits of [bitsPerCoordinate, bitsPerComponent, ...(type !== 5 ? [bitsPerFlag] : [])]) {
    if (!Number.isInteger(bits) || bits < 1 || bits > 32) throw new PdfError("E_PARSE", "Invalid mesh bit width");
  }
  const rowVertices = parameters.verticesPerRow | 0;
  if (type === 5 && rowVertices < 2) throw new PdfError("E_PARSE", "Invalid VerticesPerRow");
  const vertexBits = bitsPerCoordinate * 2 + bitsPerComponent * numComps + (type === 4 ? bitsPerFlag : 0);
  const recordBits = type >= 6 ? 32 * bitsPerCoordinate + 4 * numComps * bitsPerComponent + bitsPerFlag : vertexBits;
  charge(Math.ceil(recordBits / 8) + numComps * 4 + 512);
  const record = new Uint8Array(Math.ceil(recordBits / 8));
  const reader = new MeshStreamReader(new Stream(new Uint8Array()), parameters.context);
  const chunks = readBytes(input, options.signal)[Symbol.asyncIterator]();
  let chunk: Uint8Array = new Uint8Array(), offset = 0, ended = false;
  async function refill() {
    while (offset === chunk.length && !ended) {
      options.signal?.throwIfAborted();
      const next = await chunks.next();
      options.signal?.throwIfAborted();
      ended = !!next.done; chunk = next.done ? new Uint8Array() : next.value; offset = 0;
    }
    return offset < chunk.length;
  }
  async function prepare(bits: number) {
    const needed = Math.ceil((bits - reader.bufferLength) / 8);
    let length = 0;
    while (length < needed && await refill()) {
      const count = Math.min(needed - length, chunk.length - offset);
      record.set(chunk.subarray(offset, offset + count), length); offset += count; length += count;
    }
    reader.stream = new Stream(record.subarray(0, length));
  }
  // Retain the native reader's partial byte between lattice vertices. Only
  // consumed bytes are copied before advancing an upstream borrowed range.
  async function* vertices() {
    try {
      while (await refill()) {
        await prepare(vertexBits);
        const flag = type === 4 ? reader.readFlag() : 0;
        const point = reader.readCoordinate(), color = reader.readComponents();
        if (type === 4) reader.align();
        yield {flag, x: Math.fround(point[0]), y: Math.fround(point[1]), color};
      }
    } finally { await chunks.return?.(undefined); }
  }
  const raster = createMeshRaster(settings.matrix, settings.bounds, settings.alpha, settings.name, settings.clipRect, settings.blendMode, charge);
  if (type === 6 || type === 7) {
    // At most 20 x 20 cells per patch in the native tessellator. Admission
    // covers its control points, generated vertices, packed copies and caches.
    charge(196608 + chunkBytes * 5);
    const decoder = new MeshPatchDecoder();
    const bounds = [Infinity, Infinity, -Infinity, -Infinity];
    async function* patches() {
      const bytes = new Uint8Array(Math.max(268, Math.floor(chunkBytes / 268) * 268));
      let written = 0;
      try {
        while (await refill()) {
          await prepare(bitsPerFlag);
          const flag = reader.readFlag();
          if (flag < 0 || flag > 3) throw new PdfError("E_PARSE", "Unknown mesh patch flag");
          const coordinates = (type === 6 ? 12 : 16) - (flag ? 4 : 0), colors = flag ? 2 : 4;
          await prepare(coordinates * 2 * bitsPerCoordinate + colors * numComps * bitsPerComponent);
          const patch = decoder.decode(type as 6 | 7, reader, flag);
          const view = new DataView(bytes.buffer, written, 268);
          for (let i = 0; i < 32; i++) view.setFloat64(i * 8, patch.coordinates[i]!);
          bytes.set(patch.colors, written + 256);
          for (let i = 0; i < 32; i += 2) {
            bounds[0] = Math.min(bounds[0]!, patch.coordinates[i]!); bounds[1] = Math.min(bounds[1]!, patch.coordinates[i + 1]!);
            bounds[2] = Math.max(bounds[2]!, patch.coordinates[i]!); bounds[3] = Math.max(bounds[3]!, patch.coordinates[i + 1]!);
          }
          written += 268;
          if (written === bytes.length) {yield bytes; written = 0;}
        }
        if (written) yield bytes.subarray(0, written);
      } finally {await chunks.return?.(undefined);}
    }
    const source = await PdfFileSource.fromStream(storage.fs, storage.directory, patches(), {
      chunkBytes, cacheBytes: chunkBytes, maxInputBytes: options.maxStagingBytes ?? Infinity,
      ...(options.signal ? {signal: options.signal} : {}),
    });
    let failed = false;
    try {
      const coordinates = new Float64Array(32), colors = new Uint8Array(12);
      for (let position = 0; position < source.size; position += 268) {
        const bytes = await readRecord(source, position, 268), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        for (let i = 0; i < 32; i++) coordinates[i] = view.getFloat64(i * 8);
        colors.set(bytes.subarray(256));
        const vertices = MeshPatchDecoder.vertices({coordinates, colors}, bounds);
        for (let i = 0; i < vertices.vertexCount; i += 3) raster.paint(vertices.positions, vertices.colors, i);
      }
      return source.size ? raster.image : undefined;
    } catch (error) {failed = true; throw error;}
    finally {await source.close().catch(error => {if (!failed) throw error;});}
  }
  charge(36);
  const positions = new Float32Array(6), colors = new Uint8Array(12);
  let count = 0;
  if (type === 4) {
    let pending = 0;
    for await (const vertex of vertices()) {
      if (pending === 0) {
        if (vertex.flag < 0 || vertex.flag > 2) throw new PdfError("E_PARSE", "Unknown type4 flag");
        if (vertex.flag === 0) pending = 3;
        else {
          if (vertex.flag === 1) { positions.copyWithin(0, 2, 4); colors.copyWithin(0, 4, 8); }
          positions.copyWithin(2, 4, 6); colors.copyWithin(4, 8, 12); pending = 1;
        }
      }
      const index = 3 - pending;
      positions[index * 2] = vertex.x; positions[index * 2 + 1] = vertex.y;
      colors.set(vertex.color.subarray(0, 3), index * 4);
      if (--pending === 0) { raster.paint(positions, colors); count++; }
    }
  } else {
    charge(chunkBytes * 8 + 64);
    async function* records() {
      const bytes = new Uint8Array(Math.max(12, Math.floor(chunkBytes / 12) * 12));
      let written = 0;
      for await (const vertex of vertices()) {
        const view = new DataView(bytes.buffer, written, 12);
        view.setFloat32(0, vertex.x); view.setFloat32(4, vertex.y); bytes.set(vertex.color.subarray(0, 3), written + 8);
        written += 12; if (written === bytes.length) {yield bytes; written = 0;}
      }
      if (written) yield bytes.subarray(0, written);
    }
    const source = await PdfFileSource.fromStream(storage.fs, storage.directory, records(), {
      chunkBytes, cacheBytes: chunkBytes * 4, maxInputBytes: options.maxStagingBytes ?? Infinity,
      ...(options.signal ? {signal: options.signal} : {}),
    });
    let failed = false;
    try {
      const rows = Math.floor(source.size / 12 / rowVertices);
      async function load(index: number, slot: number) {
        const bytes = await readRecord(source, index * 12, 12);
        const view = new DataView(bytes.buffer, bytes.byteOffset, 12);
        positions[slot * 2] = view.getFloat32(0); positions[slot * 2 + 1] = view.getFloat32(4);
        colors.set(bytes.subarray(8, 11), slot * 4);
      }
      for (let row = 0; row < rows - 1; row++) {
        for (let column = 0; column < rowVertices - 1; column++) {
          options.signal?.throwIfAborted();
          const index = row * rowVertices + column;
          await load(index, 0); await load(index + 1, 1); await load(index + rowVertices, 2);
          raster.paint(positions, colors);
          await load(index + rowVertices + 1, 0); raster.paint(positions, colors); count += 2;
        }
      }
    } catch (error) { failed = true; throw error; }
    finally { await source.close().catch(error => {if (!failed) throw error;}); }
  }
  return count ? raster.image : undefined;
}
