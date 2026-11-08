import path from 'node:path';
import assert from 'node:assert/strict';

function tokens(source) {
  const result = []; let position = 0;
  const add = (kind, value, offset, escaped = false) => result.push({ kind, value, offset, escaped });
  const code = (interpolation = false) => {
    let braces = 0;
    while (position < source.length) {
      const character = source[position], offset = position;
      if (/\s/.test(character)) { position++; continue; }
      if (source.startsWith('//', position)) { while (position < source.length && source[position] !== '\n') position++; continue; }
      if (source.startsWith('/*', position)) { const end = source.indexOf('*/', position + 2); assert.ok(end >= 0); position = end + 2; continue; }
      if (character === '"' || character === "'") {
        position++; let value = '', escaped = false, closed = false;
        while (position < source.length) { const current = source[position++]; if (current === character) { closed = true; break; } if (current === '\\') { escaped = true; value += current; assert.ok(position < source.length); value += source[position++]; } else value += current; }
        assert.ok(closed); add('string', value, offset, escaped); continue;
      }
      if (character === '`') {
        position++; add('template', '', offset); let closed = false;
        while (position < source.length) { if (source[position] === '\\') { position += 2; continue; } if (source[position] === '`') { position++; closed = true; break; } if (source.startsWith('${', position)) { position += 2; code(true); continue; } position++; }
        assert.ok(closed); add('template-end', '', position); continue;
      }
      const previous = result.at(-1)?.value;
      if (character === '/' && (previous === undefined || ['=', '(', '[', '{', ',', ':', ';', '!', '?', '=>', 'return', 'throw', 'case', '|', '&'].includes(previous))) {
        position++; let bracket = false, closed = false;
        while (position < source.length) { const current = source[position++]; if (current === '\\') { position++; continue; } if (current === '[') bracket = true; if (current === ']') bracket = false; if (current === '/' && !bracket) { closed = true; break; } }
        assert.ok(closed, 'regular expression lexical boundary'); while (/[a-z]/i.test(source[position] ?? '') && position < source.length) position++; add('regex', '', offset); continue;
      }
      if (/[a-z_$]/i.test(character)) { let value = ''; while (position < source.length && /[a-z0-9_$]/i.test(source[position])) value += source[position++]; add('word', value, offset); continue; }
      if (character === '}' && interpolation && braces === 0) { position++; return; }
      if (character === '{') braces++; if (character === '}') braces--;
      if (source.startsWith('=>', position)) { position += 2; add('punctuation', '=>', offset); } else { position++; add('punctuation', character, offset); }
    }
    assert.equal(interpolation, false, 'unterminated template interpolation');
  };
  code(); return result;
}

export function mapImports(entries) {
  const files = new Map();
  for (const entry of entries) {
    assert.ok(typeof entry.stagedPath === 'string' && entry.stagedPath !== '' && !entry.stagedPath.startsWith('/') && !entry.stagedPath.split('/').includes('..'));
    assert.ok(!files.has(entry.stagedPath)); assert.ok(entry.origin && typeof entry.origin.kind === 'string');
    assert.ok(Buffer.isBuffer(entry.body)); files.set(entry.stagedPath, entry);
  }
  const edges = [];
  for (const entry of entries) {
    if (!/\.(?:mjs|js)$/.test(entry.stagedPath)) continue;
    const source = entry.body.toString('utf8');
    const lexical = tokens(source);
    for (let index = 0; index < lexical.length; index++) {
      const token = lexical[index];
      if (token.kind !== 'word' || !['import', 'export'].includes(token.value) || lexical[index - 1]?.value === '.') continue;
      let selected;
      if (token.value === 'import' && lexical[index + 1]?.value === '.') continue;
      if (token.value === 'import' && lexical[index + 1]?.kind === 'string') selected = lexical[index + 1];
      else if (token.value === 'import' && lexical[index + 1]?.value === '(') {
        if (lexical[index + 2]?.kind === 'string') selected = lexical[index + 2];
        else { edges.push({ importer: entry.stagedPath, offset: token.offset, kind: 'COMPUTED_IMPORT_REQUIRES_RUNTIME_BOUND_LOADER' }); continue; }
      } else {
        if (token.value === 'export' && ['const','let','var','function','class','async','default'].includes(lexical[index + 1]?.value)) continue;
        for (let next = index + 1; next < lexical.length && lexical[next].value !== ';'; next++) { if (lexical[next].kind === 'word' && lexical[next].value === 'from' && lexical[next + 1]?.kind === 'string') { selected = lexical[next + 1]; break; } }
      }
      if (!selected) continue;
      assert.equal(selected.escaped, false, 'escaped import specifier requires explicit source adjudication');
      const specifier = selected.value;
      if (specifier.startsWith('node:')) { edges.push({ importer: entry.stagedPath, specifier, kind: 'PINNED_NODE_BUILTIN' }); continue; }
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
        assert.equal(specifier, 'virtual-bash/commands/node/host');
        edges.push({ importer: entry.stagedPath, specifier, kind: 'EXPECTED_PRIVATE_EXPORT_DENIAL' }); continue;
      }
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(entry.stagedPath), specifier));
      assert.ok(!target.startsWith('../') && !target.startsWith('/'), 'staged import escapes');
      const destination = files.get(target); assert.ok(destination, `missing explicit origin ${entry.stagedPath} -> ${specifier}`);
      edges.push({ importer: entry.stagedPath, specifier, target, kind: 'BOUND_RELATIVE_IMPORT', origin: destination.origin });
    }
  }
  return edges;
}
