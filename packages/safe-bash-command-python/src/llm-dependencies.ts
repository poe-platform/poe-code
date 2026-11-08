/** Pinned build-time inputs for the offline LLM Python runtime. No runtime fetches. */
export const pythonLlmDependencies = Object.freeze({
  pyodideVersion: '314.0.6',
  baseUrl: 'https://cdn.jsdelivr.net/pyodide/v314.0.6/full/',
  archives: Object.freeze([
  {
    "fileName": "typing_extensions-4.15.0-py3-none-any.whl",
    "byteLength": 44613,
    "sha256": "3f122252f0d498d80f7a684cc1d8baa6fa65b75e99447d77a6dd90e0f04302e3"
  },
  {
    "fileName": "typing_inspection-0.4.2-py3-none-any.whl",
    "byteLength": 14610,
    "sha256": "c9270737700f07813e1a87b63138993997afedbd2548f20fa739cc398f1b9f2f"
  },
  {
    "fileName": "annotated_types-0.7.0-py3-none-any.whl",
    "byteLength": 11963,
    "sha256": "6b34f564725f8d309442f8d15abcceed1bf140fe2412e2c58da721426ae2222e"
  },
  {
    "fileName": "pydantic_core-2.41.5-cp314-cp314-pyemscripten_2026_0_wasm32.whl",
    "byteLength": 1310163,
    "sha256": "9802bd7a5e6679ec4c13be778f19f021e6147459c89cc916b913f7970f86dddb"
  },
  {
    "fileName": "pydantic-2.12.5-py3-none-any.whl",
    "byteLength": 463578,
    "sha256": "52d15d19fbe2a62ac9b63348df7b38e5ebb186063a9b923a837dd6e43273b414"
  }
].map(archive => Object.freeze(archive))),
  nativeModules: Object.freeze([Object.freeze({
    archive: 'pydantic_core-2.41.5-cp314-cp314-pyemscripten_2026_0_wasm32.whl',
    path: 'pydantic_core/_pydantic_core.cpython-314-wasm32-emscripten.so',
    sha256: '94477475eb48c67b6b25fd47a7955c1d01479f7971522aff90215bb517be8246',
  })]),
});

export interface PythonLlmDependencyArchive {
  readonly fileName: string;
  readonly bytes: Uint8Array;
}

/** Call during loadRuntime, with statically bundled wheels and registered native modules. */
export async function installPythonLlmDependencies(
  runtime: {
    readonly version: string;
    unpackArchive(bytes: Uint8Array, format: 'zip', options: {extractDir: string}): void;
  },
  archives: readonly PythonLlmDependencyArchive[],
): Promise<void> {
  if (runtime.version !== pythonLlmDependencies.pyodideVersion) throw new Error('Python LLM dependencies require Pyodide 314.0.6');
  const supplied = new Map(archives.map(archive => [archive.fileName, archive.bytes]));
  if (archives.length !== pythonLlmDependencies.archives.length || supplied.size !== archives.length
    || pythonLlmDependencies.archives.some(archive => !supplied.has(archive.fileName))) {
    throw new Error('A complete pinned Python LLM dependency bundle is required');
  }
  // Snapshot every input before hashing or extracting, so callers cannot change
  // bytes while an asynchronous digest is pending. Reject sizes before copying.
  const snapshots = pythonLlmDependencies.archives.map(archive => {
    const bytes = supplied.get(archive.fileName)!;
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== archive.byteLength) {
      throw new Error('Python LLM dependency size or digest mismatch: ' + archive.fileName);
    }
    return {archive, bytes: new Uint8Array(bytes)};
  });
  for (const {archive, bytes} of snapshots) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const sha256 = Array.from(digest, value => value.toString(16).padStart(2, '0')).join('');
    if (sha256 !== archive.sha256) throw new Error('Python LLM dependency digest mismatch: ' + archive.fileName);
  }
  // Validate the whole bundle before touching the interpreter filesystem.
  for (const {bytes} of snapshots) runtime.unpackArchive(bytes, 'zip', {extractDir: '/lib/python3.14/site-packages'});
}
