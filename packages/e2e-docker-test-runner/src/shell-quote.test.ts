import { describe, it, expect } from 'bun:test';
import { shellQuote } from './shell-quote.js';

describe('shellQuote', () => {
  it('wraps value in single quotes', () => {
    expect(shellQuote('hello')).toBe("'hello'");
  });

  it('escapes embedded single quotes', () => {
    expect(shellQuote("it's")).toBe("'it'\"'\"'s'");
  });

  it('handles empty string', () => {
    expect(shellQuote('')).toBe("''");
  });

  it('preserves JSON content', () => {
    const json = JSON.stringify({ command: 'node', args: ['--eval', 'console.log("hi")'] });
    const quoted = shellQuote(json);
    expect(quoted[0]).toBe("'");
    expect(quoted[quoted.length - 1]).toBe("'");
    expect(quoted).toContain('"command"');
  });
});
