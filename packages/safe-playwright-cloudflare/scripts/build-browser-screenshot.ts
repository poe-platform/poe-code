import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import ts from 'typescript';

/** Keep the pinned browser callback as data so consumer minifiers cannot rename its helpers. */
export function screenshotPreparationModule(source: string): string {
  const ast = ts.createSourceFile('screenshotter.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const callback = ast.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'inPagePrepareForScreenshots');
  const owner = ast.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'Screenshotter');
  const method = owner?.members.find((node): node is ts.MethodDeclaration => ts.isMethodDeclaration(node) && node.name.getText(ast) === '_preparePageForScreenshot');
  if (!callback || !method) throw new Error('Pinned screenshot preparation changed');
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'inPagePrepareForScreenshots.toString') calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(method);
  if (calls.length !== 1) throw new Error('Pinned screenshot serialization changed');
  const call = calls[0]!;
  const start = method.getStart(ast);
  const body = source.slice(start, call.getStart(ast)) + JSON.stringify(callback.getText(ast)) + source.slice(call.end, method.end);
  const sizes = ['_originalViewportSize', '_fullPageSize'].map(name => {
    const sizeMethod = owner!.members.find((node): node is ts.MethodDeclaration => ts.isMethodDeclaration(node) && node.name.getText(ast) === name);
    if (!sizeMethod) throw new Error('Pinned screenshot dimensions changed');
    const evaluations: ts.CallExpression[] = [];
    const collect = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'waitForFunctionValueInUtility') evaluations.push(node);
      ts.forEachChild(node, collect);
    };
    collect(sizeMethod);
    if (evaluations.length !== 1 || evaluations[0]!.arguments.length !== 2) throw new Error('Pinned screenshot dimensions serialization changed');
    const evaluation = evaluations[0]!;
    const offset = sizeMethod.getStart(ast);
    return source.slice(offset, evaluation.getStart(ast)) + `waitForBrowserScreenshotSize(this._page.mainFrame(), progress, ${JSON.stringify(evaluation.arguments[1]!.getText(ast))})` + source.slice(evaluation.end, sizeMethod.end);
  });
  return `/*! Derived from @cloudflare/playwright 1.3.6 screenshotter.js; Microsoft Corporation; Apache-2.0. */
async function waitForBrowserScreenshotSize(frame, progress, expression) {
  return frame.retryWithProgressAndTimeouts(progress, [100], async (continuePolling) => {
    const result = await progress.race(frame.evaluateExpression(expression, { isFunction: true, world: 'utility' }));
    return result || continuePolling;
  });
}
export const browserScreenshotMethods = ({${body},${sizes.join(',')}});
export const prepareBrowserScreenshot = browserScreenshotMethods._preparePageForScreenshot;
`;
}

export async function buildBrowserScreenshot() {
  const root = dirname(dirname(createRequire(import.meta.url).resolve('@cloudflare/playwright')));
  const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (metadata.version !== '1.3.6') throw new Error('Qualify screenshot preparation before changing Playwright');
  const source = await readFile(join(root, 'lib/playwright-core/src/server/screenshotter.js'), 'utf8');
  await writeFile(new URL('../src/browser-screenshot.generated.js', import.meta.url), screenshotPreparationModule(source));
}
