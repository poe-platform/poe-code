import type {Font, Glyph, GlyphRun} from "@pdf-lib/fontkit";
import {SsconvertError, type CapabilityContext} from "../../contracts.js";
import {harfbuzzBase64} from "./harfbuzz/data.js";

// Only immutable compiled code is shared. Font data, native handles and failure
// state belong to one conversion and are discarded together on any failure.
let compiled: Promise<WebAssembly.Module> | undefined;
const heapLimit = 64 * 1024 * 1024;
export function createFontShaper(context: CapabilityContext, tick: (amount?: number) => void) {
  let exports: WebAssembly.Exports | undefined, disposed = false;
  const fonts = new Map<Font, {font: number; data: number}>();
  const dispose = () => { disposed = true; exports = undefined; fonts.clear(); };
  context.own(dispose); // Register before asynchronous compilation or acquisition.
  const fail = (): never => { dispose(); throw new SsconvertError("resource-limit", "ssconvert PDF font shaping could not complete"); };
  const call = (name: string, ...args: number[]): number => {
    const fn = exports?.[name];
    if (disposed || typeof fn !== "function") return fail();
    try { return fn(...args) as number; } catch { return fail(); }
  };
  const memory = () => {
    const value = exports?.memory;
    if (disposed || !(value instanceof WebAssembly.Memory)) return fail();
    return value;
  };
  const view = (pointer: number, length: number, alignment = 1) => {
    const buffer = memory().buffer;
    if (!Number.isSafeInteger(pointer) || pointer <= 0 || pointer % alignment || !Number.isSafeInteger(length) || length < 0 || pointer + length > buffer.byteLength) return fail();
    return new DataView(buffer, pointer, length);
  };
  const check = (buffer = 0) => {
    tick();
    if (call("ssconvert_hb_failure", buffer) !== 0) fail();
  };
  return {
    dispose,
    async addFont(bytes: Uint8Array, metrics: Font) {
      tick(bytes.length);
      if (disposed || bytes.length > context.limits.inputBytes) fail();
      if (!exports) {
        compiled ??= WebAssembly.compile(Uint8Array.from(atob(harfbuzzBase64), character => character.charCodeAt(0)));
        const module = await compiled;
        tick();
        if (disposed) fail();
        const unexpected = () => fail();
        const instance = await WebAssembly.instantiate(module, {
          wasi_snapshot_preview1: {proc_exit: unexpected},
          env: {_emscripten_runtime_keepalive_clear: unexpected, _abort_js: unexpected, _setitimer_js: unexpected,
            emscripten_resize_heap(requested: number) {
              const current = memory();
              if (!Number.isSafeInteger(requested) || requested < current.buffer.byteLength || requested > heapLimit) return fail();
              try { current.grow(Math.ceil((requested - current.buffer.byteLength) / 65536)); return 1; } catch { return fail(); }
            }}
        });
        tick();
        if (disposed) fail();
        exports = instance.exports;
        call("__wasm_call_ctors");
        check();
      }
      try {
        const data = call("malloc", bytes.length);
        new Uint8Array(view(data, bytes.length).buffer, data, bytes.length).set(bytes);
        // READONLY: the owned input remains alive until the font/instance dies.
        const blob = call("hb_blob_create", data, bytes.length, 1, 0, 0);
        const face = call("hb_face_create", blob, 0);
        const font = call("hb_font_create", face);
        check();
        if (!blob || !face || !font || call("hb_face_get_upem", face) !== metrics.unitsPerEm) fail();
        call("hb_font_set_scale", font, metrics.unitsPerEm, metrics.unitsPerEm);
        call("hb_face_destroy", face);
        call("hb_blob_destroy", blob);
        fonts.set(metrics, {font, data});
      } catch (error) { dispose(); throw error; }
    },
    shape(metrics: Font, text: string): GlyphRun {
      tick(text.length);
      const selected = fonts.get(metrics);
      if (!selected || disposed || text.length > context.limits.inputBytes / 2) return fail();
      let buffer = 0, input = 0;
      try {
        buffer = call("hb_buffer_create");
        input = call("malloc", Math.max(2, text.length * 2));
        const utf16 = view(input, Math.max(2, text.length * 2), 2);
        for (let i = 0; i < text.length; i++) utf16.setUint16(i * 2, text.charCodeAt(i), true);
        call("hb_buffer_add_utf16", buffer, input, text.length, 0, text.length);
        call("hb_buffer_set_cluster_level", buffer, 1);
        call("hb_buffer_guess_segment_properties", buffer);
        check(buffer);
        const complete = call("hb_shape_full", selected.font, buffer, 0, 0, 0);
        check(buffer);
        if (!complete || call("hb_buffer_get_content_type", buffer) !== 2) fail();
        const length = call("hb_buffer_get_length", buffer);
        if (!Number.isSafeInteger(length) || length < 0 || length > (context.limits.workbookWork ?? context.limits.inputBytes)) fail();
        tick(length * 20);
        const infoPointer = call("hb_buffer_get_glyph_infos", buffer, 0);
        const positionPointer = call("hb_buffer_get_glyph_positions", buffer, 0);
        const direction = call("hb_buffer_get_direction", buffer);
        const script = call("hb_buffer_get_script", buffer);
        const languagePointer = call("hb_language_to_string", call("hb_buffer_get_language", buffer));
        let language = "";
        if (languagePointer) {
          for (let i = 0; i < 256; i++) {
            const byte = view(languagePointer + i, 1).getUint8(0);
            if (byte === 0) break;
            language += String.fromCharCode(byte);
            if (i === 255) fail();
          }
        }
        check(buffer);
        // Acquire views after all native calls that could grow the memory.
        const infos = length ? view(infoPointer, length * 20, 4) : undefined;
        const positions = length ? view(positionPointer, length * 20, 4) : undefined;
        const rows = Array.from({length}, (_, i) => ({
          id: infos!.getUint32(i * 20, true), cluster: infos!.getUint32(i * 20 + 8, true),
          xAdvance: positions!.getInt32(i * 20, true), yAdvance: positions!.getInt32(i * 20 + 4, true),
          xOffset: positions!.getInt32(i * 20 + 8, true), yOffset: positions!.getInt32(i * 20 + 12, true)
        }));
        const clusters = [...new Set(rows.map(row => row.cluster))].sort((a, b) => a - b);
        const codePoints = new Map<number, number[]>();
        for (const [index, start] of clusters.entries()) {
          if (start >= text.length || (start > 0 && text.charCodeAt(start) >= 0xdc00 && text.charCodeAt(start) <= 0xdfff)) fail();
          codePoints.set(start, [...text.slice(start, clusters[index + 1] ?? text.length)].map(character => character.codePointAt(0)!));
        }
        let advanceWidth = 0, advanceHeight = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const glyphs = rows.map(row => {
          tick();
          if (row.id >= metrics.numGlyphs) fail();
          // fontkit caches glyphs by ID. Own Unicode mappings without mutating
          // that cache when multiple clusters or cells reuse the same outline.
          const glyph: Glyph = Object.create(metrics.getGlyph(row.id), {codePoints: {value: codePoints.get(row.cluster)!}});
          const box = glyph.bbox;
          minX = Math.min(minX, advanceWidth + row.xOffset + box.minX);
          minY = Math.min(minY, advanceHeight + row.yOffset + box.minY);
          maxX = Math.max(maxX, advanceWidth + row.xOffset + box.maxX);
          maxY = Math.max(maxY, advanceHeight + row.yOffset + box.maxY);
          advanceWidth += row.xAdvance; advanceHeight += row.yAdvance;
          return glyph;
        });
        if (!length) minX = minY = maxX = maxY = 0;
        return {glyphs, positions: rows, advanceWidth, advanceHeight,
          script: String.fromCharCode(script >>> 24, script >>> 16 & 255, script >>> 8 & 255, script & 255),
          direction: direction === 4 ? "ltr" : direction === 5 ? "rtl" : null, language: language || null, features: {},
          bbox: {minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY}};
      } catch (error) { dispose(); throw error; }
      finally {
        if (!disposed) {
          if (buffer) call("hb_buffer_destroy", buffer);
          if (input) call("free", input);
        }
      }
    }
  };
}
