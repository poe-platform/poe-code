import { transformSync } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { expect, test } from 'vitest';
import { preserveBrowserPolling } from '../scripts/build-browser-provider-evaluation.js';

const source = `export class Frame {
  async waitForFunctionExpression(injectedScript, arg) {
    return injectedScript.evaluateHandle((injected, value) => {
      const predicate = () => value.answer;
      const next = () => predicate();
      return next();
    }, arg);
  }
}`;

async function runPolling(code: string) {
  const module = { exports: {} as {
    Frame: new () => {
      waitForFunctionExpression(handle: unknown, arg: unknown): Promise<number>;
    };
  } };
  runInNewContext(
    transformSync(code, { format: 'cjs', minify: true, keepNames: true }).code,
    { module },
  );
  const handle = {
    evaluateHandle(callback: (...args: unknown[]) => unknown, arg: unknown) {
      return runInNewContext(`(${callback.toString()})`)({}, arg);
    },
    evaluateExpressionHandle(expression: string, options: { isFunction: boolean }, arg: unknown) {
      expect(options).toEqual({ isFunction: true });
      return runInNewContext(`(${expression})`)({}, arg);
    },
  };
  return new module.exports.Frame().waitForFunctionExpression(handle, { answer: 17 });
}

test('polling source stays self-contained when the provider keeps minified names', async () => {
  await expect(runPolling(source)).rejects.toThrow('is not defined');
  await expect(runPolling(preserveBrowserPolling(source))).resolves.toBe(17);
});

test('changed provider polling injection fails qualification', () => {
  expect(() => preserveBrowserPolling(source.replace('evaluateHandle', 'otherEvaluation')))
    .toThrow('polling serialization changed');
  expect(() => preserveBrowserPolling('export class Frame {}'))
    .toThrow('polling method changed');
});
