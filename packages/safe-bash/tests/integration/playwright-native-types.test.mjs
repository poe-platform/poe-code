import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

test('native Playwright provider is structurally assignable to the portable adapter', {
  skip: !process.env.PLAYWRIGHT_TEST_TYPES && 'Set PLAYWRIGHT_TEST_TYPES to the native provider declaration entry',
}, () => {
  const filename = fileURLToPath(new URL('../../out/playwright-native-typecheck.ts', import.meta.url));
  const adapter = fileURLToPath(new URL('../../src/playwright/adapter.js', import.meta.url));
  const source = `import type { Browser, BrowserContext, Page, FileChooser } from ${JSON.stringify(process.env.PLAYWRIGHT_TEST_TYPES)};
import type { PlaywrightBrowser, PlaywrightContext, PlaywrightPage, PlaywrightFileChooser } from ${JSON.stringify(adapter)};
declare const browser: Browser;
declare const context: BrowserContext;
declare const page: Page;
declare const chooser: FileChooser;
const nativeBrowser: PlaywrightBrowser = browser;
const nativeContext: PlaywrightContext = context;
const nativePage: PlaywrightPage = page;
const nativeChooser: PlaywrightFileChooser = chooser;
void [nativeBrowser, nativeContext, nativePage, nativeChooser];`;
  const options = { noEmit: true, strict: true, skipLibCheck: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true,
    target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, types: ['node'] };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (path, language, ...rest) => path === filename ? ts.createSourceFile(path, source, language, true) : getSourceFile(path, language, ...rest);
  const program = ts.createProgram([filename], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: path => path, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n' }));
});
