import { pythonLlmManifest as manifest } from './llm-manifest.js';
import { pythonLlmProvider } from './llm-provider.js';

export const pythonLlmPackages = manifest;

export interface PythonLlmPackageAsset {
  readonly file: string;
  readonly bytes: Uint8Array;
}

/** Install host-verified, statically bundled wheels before relocating the interpreter. */
export function installPythonLlmPackages(runtime: {
  readonly version: string;
  readonly FS: {mkdirTree(path: string): void; writeFile(path: string, bytes: Uint8Array): void};
  readonly globals: {set(name: string, value: unknown): void; delete(name: string): void};
  unpackArchive(bytes: Uint8Array, format: string, options: {extractDir: string}): void;
  runPython(source: string): unknown;
}, assets: readonly PythonLlmPackageAsset[]): void {
  if (runtime.version !== manifest.pyodide) throw new Error('LLM packages require the pinned Python runtime');
  if (assets.length !== manifest.distributions.length) throw new Error('Incomplete Python LLM package assets');
  const root = '/lib/python3.14/site-packages';
  const wheelRoot = root + '/llm-wheels';
  runtime.FS.mkdirTree(wheelRoot);
  const paths: string[] = [];
  for (const distribution of manifest.distributions) {
    const asset = assets.find(asset => asset.file === distribution.file);
    if (!asset || asset.bytes.byteLength !== distribution.bytes) throw new Error('Invalid Python LLM package asset: ' + distribution.file);
    if (distribution.nativeModules.length || ['llm', 'puremagic'].includes(distribution.name)) {
      runtime.unpackArchive(asset.bytes, 'zip', {extractDir: root});
    } else {
      const path = wheelRoot + '/' + distribution.file;
      runtime.FS.writeFile(path, asset.bytes);
      paths.push(path);
    }
  }
  // LLM imports readline for chat key bindings even for redirected stdin.
  // The Worker has no terminal line editor; these bindings have no effect there.
  runtime.FS.writeFile(root + '/readline.py', new TextEncoder().encode(
    '"""Readline key bindings for the non-terminal Worker input stream."""\n' +
    'def parse_and_bind(binding):\n' +
    ' import sys\n' +
    ' if sys.stdin.isatty():\n' +
    '  raise OSError("Terminal line editing is unavailable in this runtime")\n'));
  runtime.FS.writeFile(root + '/llm_safe_host.py', new TextEncoder().encode(pythonLlmProvider));
  const metadata = root + '/llm_safe_host-0.1.dist-info';
  runtime.FS.mkdirTree(metadata);
  runtime.FS.writeFile(metadata + '/METADATA', new TextEncoder().encode('Metadata-Version: 2.1\nName: llm-safe-host\nVersion: 0.1\n'));
  runtime.FS.writeFile(metadata + '/entry_points.txt', new TextEncoder().encode('[llm]\nsafe_host = llm_safe_host\n'));
  runtime.globals.set('_safe_llm_wheel_paths', JSON.stringify(paths));
  try {
    // Select the host provider before guest code can influence plugin discovery.
    runtime.runPython('import json, sys; sys.path.extend(json.loads(_safe_llm_wheel_paths)); import llm.plugins; llm.plugins.DEFAULT_PLUGINS = (); llm.plugins.LLM_LOAD_PLUGINS = "llm-safe-host"; llm.plugins.load_plugins(); from llm_safe_host import restrict_providers; restrict_providers()');
  } finally {
    runtime.globals.delete('_safe_llm_wheel_paths');
  }
}
