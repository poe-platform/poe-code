const encoder = new TextEncoder(), decoder = new TextDecoder();
const schedule = () => new Promise(resolve => setTimeout(resolve, 0));

// The host supplies bytes or a compiled module; no filesystem or network authority.
export function createConverter(loadWasm) {
  let module;
  return async function convert(request, control = {}) {
    const checkpoint = () => {
      if (control.signal?.aborted) throw Object.assign(Error('Document conversion cancelled'), {code:'E_CANCELLED'});
    };
    checkpoint();
    const drawing = request.mode === 'drawing';
    if (drawing ? !['mermaid','graphviz'].includes(request.format) : !['docx','pdf'].includes(request.format)) throw Error('Unsupported document format');
    if (drawing && (typeof request.source !== 'string' || request.source.length > 1024 * 1024)) throw Object.assign(Error('Invalid drawing source or source exceeds 1 MiB'), {code:'E_LIMIT'});
    const buffers = [], resources = [];
    let binaryLength = 0;
    const binary = value => {
      if (!(value instanceof Uint8Array)) throw TypeError('Document resources must be Uint8Array values');
      const entry = {offset: binaryLength, length: value.length};
      binaryLength += value.length; buffers.push(value); return entry;
    };
    for (const resource of request.resources ?? []) resources.push({id: resource.id, ...binary(resource.bytes)});
    const options = {...request.options};
    if (options.pdfFonts) options.pdfFonts = options.pdfFonts.map(font => ({id: font.id, ...binary(font.bytes)}));
    const json = encoder.encode(JSON.stringify({...request, resources, options}));
    const size = 4 + json.length + binaryLength;
    if (size > 256 * 1024 * 1024) throw Object.assign(Error('Document input exceeds 256 MiB'), {code: 'E_LIMIT'});
    module ??= Promise.resolve().then(loadWasm).then(value => value instanceof WebAssembly.Module ? value : WebAssembly.compile(value)).catch(error => {module = undefined; throw error;});
    // A fresh instance prevents concurrent conversions from sharing mutable memory.
    const wasm = (await WebAssembly.instantiate(await module)).exports;
    checkpoint();
    let ptr = wasm.document_alloc(size), task = 0, address = 0, length = 0;
    try {
      if (!ptr) throw Object.assign(Error('Document input allocation failed'), {code:'E_LIMIT'});
      new DataView(wasm.memory.buffer, ptr, 4).setUint32(0, json.length, true);
      new Uint8Array(wasm.memory.buffer, ptr + 4, json.length).set(json);
      let at = ptr + 4 + json.length;
      for (const bytes of buffers) {new Uint8Array(wasm.memory.buffer, at, bytes.length).set(bytes); at += bytes.length;}
      task = wasm.document_start(ptr, size, drawing ? 2 : request.format === 'docx' ? 0 : 1);
      ptr = 0; // The task now owns the input allocation.
      let started = Date.now(), steps = 0;
      while (!wasm.document_step(task)) {
        checkpoint();
        if (++steps % 64 === 0 || Date.now() - started >= 8) {
          if (control.cooperate) await control.cooperate();
          // A host checkpoint may resolve on the microtask queue. Advance the
          // event loop as well so AbortSignal timers and UI events can run.
          await schedule(); checkpoint(); started = Date.now();
        }
      }
      checkpoint();
      const result = wasm.document_result(task);
      address = Number(result & 0xffffffffn); length = Number(result >> 32n);
      const output = new Uint8Array(wasm.memory.buffer, address, length);
      if (output[0] !== 0) {
        const error = JSON.parse(decoder.decode(output.subarray(1)));
        throw Object.assign(Error(error.message), {code: error.code});
      }
      const metadataLength = new DataView(output.buffer, output.byteOffset + 1, 4).getUint32(0, true);
      const metadata = JSON.parse(decoder.decode(output.subarray(5, 5 + metadataLength)));
      const bytes = output.slice(5 + metadataLength);
      if (drawing) return JSON.parse(decoder.decode(bytes));
      return {bytes, diagnostics: metadata.diagnostics, usage: metadata.usage};
    } finally {
      if (address) wasm.document_free(address, length);
      if (task) wasm.document_drop(task);
      if (ptr) wasm.document_free(ptr, size);
    }
  };
}
