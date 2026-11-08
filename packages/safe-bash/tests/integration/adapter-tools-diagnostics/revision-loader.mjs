import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const owned = fileURLToPath(new URL('.', import.meta.url));
const revision = process.env.DIAGNOSTIC_REVISION ?? 'worktree';
assert.ok(['worktree', '19149d3d9c5dc6f309b61f215a140df18adaf6e4'].includes(revision));
const fixture = 'tests/integration/adapter-tools/fixtures.ts';
const matrix = 'tests/integration/adapter-tools/matrix.test.ts';
const mock = 'tests/fs/webdav/mock.ts';
const matrixRevision = process.env.DIAGNOSTIC_MATRIX_REVISION;
assert.ok(matrixRevision === undefined || ['df5bc453de004a8eb483696cf4ae1986a012cca1',
  '33ddb70c75865e3e695cf471b942ab0add98a891'].includes(matrixRevision));
const mutation = process.env.DIAGNOSTIC_MUTATION;
assert.ok(mutation === undefined || mutation === 'append-untyped');
const selected = path => path.startsWith('src/') || path === fixture || path === mock || path === matrix;

export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('.') || specifier.startsWith('file:')) && context.parentURL) {
    const url = new URL(specifier, context.parentURL);
    if (url.protocol === 'file:') {
      const path = relative(root, fileURLToPath(url)).replace(/\.js$/, '.ts');
      if (selected(path)) return { url: pathToFileURL(`${root}${path}`).href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (!url.startsWith('file:')) return nextLoad(url, context);
  const path = relative(root, fileURLToPath(url));
  if (!selected(path)) return nextLoad(url, context);
  const selectedRevision = matrixRevision && (path === fixture || path === matrix) ? matrixRevision : revision;
  let source = selectedRevision === 'worktree' ? readFileSync(`${root}${path}`, 'utf8')
    : execFileSync('git', ['show', `${selectedRevision}:${path}`], { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (path === fixture) {
    const original = 'fileURLToPath(new URL("./.real-", import.meta.url))';
    assert.equal(source.split(original).length, 2);
    source = source.replace(original, JSON.stringify(`${owned}.real-`));
  }
  if (mutation === 'append-untyped' && path === 'src/fs/readonly/index.ts') {
    const original = '    readOnly("writeFile", path);';
    assert.equal(source.split(original).length, 2);
    source = source.replace(original, '    if (_options?.flag === "a") throw Object.assign(new Error("audit-only wrong boundary type"), { code: "EROFS", path });\n' + original);
  }
  return { format: 'module', shortCircuit: true, source: ts.transpileModule(source, {
    fileName: path, compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext,
      verbatimModuleSyntax: true, sourceMap: false },
  }).outputText };
}
