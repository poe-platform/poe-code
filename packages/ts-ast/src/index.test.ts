import { describe, expect, it } from 'vitest';
import { applyEdits, findMatches, matchPattern, parseCode, rewriteCode } from './index.js';

describe('language trees', () => {
  it.each([
    ['a.ts', 'const x: number = 1'], ['a.mts', 'export {}'], ['a.cts', 'export {}'],
    ['a.js', 'f(1)'], ['a.mjs', 'f(1)'], ['a.cjs', 'f(1)'],
    ['a.tsx', '<Box>{x}</Box>'], ['a.jsx', '<Box />'],
    ['a.json', '{"a": [1, true]}'], ['a.yaml', 'a:\n  - one\n'], ['a.yml', 'a: true'],
    ['a.html', '<div id="x">hello</div>'], ['a.css', '.x { color: red; }']
  ])('parses %s with complete lossless coverage', (filename, source) => {
    const tree = parseCode(source, filename);
    expect(tree.errors).toEqual([]);
    expect(tree.root.text).toBe(source);
    const leaves = [...tree.walk()].filter(n => n.children.length === 0);
    expect(leaves.map(n => n.text).join('')).toBe(source);
    for (const n of tree.walk()) {
      expect(new TextDecoder().decode(new TextEncoder().encode(source).slice(...n.range))).toBe(n.text);
      n.children.forEach((child, i) => {
        expect(child.parent).toBe(n);
        expect(child.previousSibling).toBe(n.children[i - 1]);
        expect(child.nextSibling).toBe(n.children[i + 1]);
      });
    }
  });
  it('uses UTF-8 bytes and zero-based byte columns across CRLF', () => {
    const tree = parseCode('// 🐈\r\nf("é")', 'ts');
    const call = findMatches(tree, 'f($X)')[0]!;
    expect(call.node.range).toEqual([9, 16]);
    expect(call.node.start).toEqual({ line: 1, column: 0 });
    expect(call.node.end).toEqual({ line: 1, column: 7 });
    expect(call.captures.X!.text).toBe('"é"');
  });
  it('reports syntax errors and rejects unsupported languages', () => {
    expect(parseCode('f(', 'ts').errors.length).toBeGreaterThan(0);
    expect(() => parseCode('', 'a.go')).toThrow('Unsupported');
  });
});

describe('structural matching', () => {
  it('matches structure rather than text and enforces repeated captures', () => {
    const tree = parseCode('f(a + b, a+b); f(a, b); // f(x,x)\n"f(x,x)";', 'ts');
    const matches = findMatches(tree, 'f($X, $X)');
    expect(matches.map(m => m.node.text)).toEqual(['f(a + b, a+b)']);
    expect(findMatches(tree, 'f($_, $_)')).toHaveLength(2);
    expect(matchPattern(matches[0]!.node, 'f($A, $B)')?.captures.A?.text).toBe('a + b');
  });
  it.each([
    ['f()', 'f($$$ARGS)', ''], ['f(a, /* keep */ b)', 'f($$$ARGS)', 'a, /* keep */ b'],
    ['[a, b, c]', '[$X, $$$ARGS]', 'b, c'],
    ['({a: 1, b: 2})', '({$$$ARGS})', 'a: 1, b: 2'],
    ['function f() { a(); b(); }', 'function f() { $$$ARGS }', 'a(); b();'],
    ['<Box><A /> hello <B /></Box>', '<Box>$$$ARGS</Box>', '<A /> hello <B />']
  ])('captures sequences in %s', (source, pattern, expected) => {
    const matches = findMatches(parseCode(source, 'tsx'), pattern);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.captures.ARGS!.text).toBe(expected);
  });
  it('backtracks variadics and handles anonymous sequences', () => {
    const tree = parseCode('f(a, stop, b, stop); f(stop)', 'ts');
    expect(findMatches(tree, 'f($$$A, stop, $$$B)')).toHaveLength(2);
    expect(findMatches(tree, 'f($$$)')).toHaveLength(2);
  });
  it('composes rules and passes captures through relations', () => {
    const tree = parseCode('function outer() { before(); f(x); after(); } f(y);', 'ts');
    const matches = findMatches(tree, { all: [
      { pattern: 'f($X)' }, { inside: { kind: 'FunctionDeclaration' } },
      { not: { has: { regex: '^y$' } } },
      { follows: { pattern: 'before()' } }, { precedes: { pattern: 'after()' } },
      { any: [{ regex: '^f' }, { kind: 'Number' }] }
    ] });
    expect(matches.map(m => m.captures.X!.text)).toEqual(['x']);
  });
  it.each([
    ['json', '{"x": 1, "y": 2}', '"x": $V', '1'],
    ['yaml', 'x: one\ny: two\n', 'x: $V', 'one'],
    ['html', '<div><b>Hello</b></div>', '<b>$V</b>', 'Hello'],
    ['css', '.x { color: red; }', 'color: $V;', 'red']
  ])('supports patterns in %s', (language, source, pattern, expected) => {
    expect(findMatches(parseCode(source, language), pattern)[0]?.captures.V?.text).toBe(expected);
  });
});

describe('lossless rewrites', () => {
  it('preserves Unicode, indentation and comments outside replacement spans', () => {
    const source = '// 🐈\n  f(a, /* yes */ b); // end\n';
    expect(rewriteCode(parseCode(source, 'ts'), 'f($$$ARGS)', 'g($$$ARGS)')).toBe('// 🐈\n  g(a, /* yes */ b); // end\n');
  });
  it('does not recursively rewrite nested overlapping matches', () => {
    expect(rewriteCode(parseCode('f(f(x))', 'ts'), 'f($X)', 'g($X)')).toBe('g(f(x))');
  });
  it('validates edit spans, UTF-8 boundaries and overlap', () => {
    expect(applyEdits('é xyz', [{ range: [3, 6], replacement: 'ok' }])).toBe('é ok');
    expect(() => applyEdits('é', [{ range: [1, 2], replacement: '' }])).toThrow();
    expect(() => applyEdits('abc', [{ range: [0, 2], replacement: '' }, { range: [1, 3], replacement: '' }])).toThrow();
    expect(() => rewriteCode(parseCode('f(x)', 'ts'), 'f($X)', '$MISSING')).toThrow('capture');
  });
});

describe('syntax-sensitive matching regressions', () => {
  it('keeps sparse array slots and for-loop fields significant', () => {
    expect(findMatches(parseCode('[a,,b]; [a,b]', 'ts'), '[a,b]').map(m => m.node.text)).toEqual(['[a,b]']);
    expect(findMatches(parseCode('for (; x;) {} for (x;;) {}', 'ts'), 'for (; $X;) {}').map(m => m.node.text)).toEqual(['for (; x;) {}']);
  });
  it('accepts semicolon-terminated statement variadics including empty blocks', () => {
    const tree = parseCode('function f() {} function f() { a(); b(); }', 'ts');
    expect(findMatches(tree, 'function f() { $$$BODY; }').map(m => m.captures.BODY!.text)).toEqual(['', 'a(); b();']);
  });
  it.each([
    ['json', '{"a":1,"b":2}', '{$$$PROPS}', '"a":1,"b":2'],
    ['json', '{}', '{$$$PROPS}', ''],
    ['json', '[1,2]', '[$$$PROPS]', '1,2'],
    ['tsx', '<A></A>', '<A>$$$PROPS</A>', ''],
    ['ts', '({})', '({$$$PROPS})', '']
  ])('supports empty and populated sequences in %s: %s', (lang, code, pattern, expected) => {
    expect(findMatches(parseCode(code, lang), pattern)[0]?.captures.PROPS?.text).toBe(expected);
  });
  it('treats quoted JSON dollar strings as literal values', () => {
    expect(findMatches(parseCode('["$X", 1]', 'json'), '"$X"').map(m => m.node.text)).toEqual(['"$X"']);
  });
  it('keeps failed alternatives from leaking captures', () => {
    const tree = parseCode('f(a, b)', 'ts');
    const matches = findMatches(tree, { any: [{ all: [{ pattern: 'f($X, $Y)' }, { regex: 'never' }] }, { pattern: 'f($Y, $X)' }] });
    expect(matches[0]!.captures.X!.text).toBe('b');
  });
  it('enforces equality for repeated variadic captures', () => {
    expect(findMatches(parseCode('f([a,b], [a, b]); f([a], [b])', 'ts'), 'f([$$$X], [$$$X])')).toHaveLength(1);
  });
});

describe('source fidelity', () => {
  it('preserves byte-order marks and mixed line endings', () => {
    const source = '\uFEFF// header\r\nf(x);\r\nf(y);\r';
    expect(rewriteCode(parseCode(source, 'ts'), 'f($X)', 'g($X)')).toBe('\uFEFF// header\r\ng(x);\r\ng(y);\r');
    expect(applyEdits(source, [])).toBe(source);
  });
  it('single captures exclude punctuation and trivia', () => {
    const matches = findMatches(parseCode('f(x)', 'ts'), '$X');
    expect(matches.some(m => m.node.kind === '(' || m.node.kind === ')')).toBe(false);
  });
  it('supports CSS dollar strings literally', () => {
    expect(findMatches(parseCode('a { content: "$X"; color: red; }', 'css'), 'content: "$X";')).toHaveLength(1);
  });
});
