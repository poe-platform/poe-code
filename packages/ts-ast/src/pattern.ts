import { parseCode, type CodeNode, type Language } from './tree.js';

interface Variable { name: string; many: boolean }
const preparedVariables = new WeakMap<CodeNode, Variable>();
function parseVariable(text: string): Variable | undefined {
  const match = /^(\$\$\$|\$)([A-Z_][A-Z_0-9]*)?$/.exec(text);
  if (!match || (match[1] === '$' && !match[2])) return undefined;
  return { name: match[2] ?? '', many: match[1] === '$$$' };
}
export function variable(node: CodeNode): Variable | undefined {
  const prepared = preparedVariables.get(node);
  if (prepared) return prepared;
  if (node.language === 'json' || node.language === 'css') return undefined;
  let text = node.text.trim();
  if (node.kind === 'ExpressionStatement' && text.endsWith(';')) text = text.slice(0, -1).trimEnd();
  return parseVariable(text);
}

/** Give grammars without dollar identifiers valid placeholder tokens. Strings stay literal. */
function prepare(pattern: string, language: Language): { source: string; markers: Map<string, Variable> } {
  const markers = new Map<string, Variable>();
  if (language !== 'json' && language !== 'css') return { source: pattern, markers };
  let prefix = '__ast_capture_';
  while (pattern.includes(prefix)) prefix += '_';
  let source = '', quote = '', escaped = false, comment = false, previous = '';
  const containers: string[] = [];
  for (let i = 0; i < pattern.length;) {
    const char = pattern[i]!;
    if (comment) {
      source += char; i++;
      if (char === '*' && pattern[i] === '/') { source += '/'; i++; comment = false; }
      continue;
    }
    if (quote) {
      source += char; i++;
      if (char === quote && !escaped) quote = '';
      escaped = char === '\\' && !escaped;
      previous = 'string';
      continue;
    }
    if (char === '"' || (char === "'" && language === 'css')) { quote = char; source += char; i++; continue; }
    if (char === '/' && pattern[i + 1] === '*' && language === 'css') { comment = true; source += '/*'; i += 2; continue; }
    if (char === '$') {
      const token = /^(?:\$\$\$|\$)[A-Z_][A-Z_0-9]*|^\$\$\$/.exec(pattern.slice(i))?.[0];
      if (token) {
        const value = parseVariable(token)!;
        const placeholder = `${prefix}${markers.size}__`;
        let replacement = language === 'json' ? JSON.stringify(placeholder) : placeholder;
        markers.set(replacement, value);
        const next = pattern.slice(i + token.length).trimStart()[0];
        if (language === 'json' && containers.at(-1) === '{' && (previous === '{' || previous === ',') && next !== ':') {
          replacement += ':null';
          markers.set(replacement, value);
        }
        source += replacement; i += token.length; previous = 'value'; continue;
      }
    }
    if (char === '{' || char === '[') containers.push(char);
    if (char === '}' || char === ']') containers.pop();
    if (char.trim()) previous = char;
    source += char; i++;
  }
  return { source, markers };
}
const wrappers = new Set(['Script', 'JsonText', 'Stream', 'Document', 'ExpressionStatement', 'BlockMapping', 'StyleSheet']);
export function patternNode(pattern: string, language: Language): CodeNode {
  const { source, markers } = prepare(pattern, language);
  let tree = parseCode(source, language);
  let selected: CodeNode | undefined;
  if (language === 'json' && tree.errors.length) {
    tree = parseCode(`{${source}}`, language);
    selected = [...tree.walk()].find(n => n.kind === 'Property');
  }
  if (language === 'css' && tree.errors.length) {
    tree = parseCode(`x{${source}}`, language);
    selected = [...tree.walk()].find(n => n.kind === 'Declaration');
  }
  if (tree.errors.length) throw new Error(`Invalid ${language} pattern: ${pattern}`);
  for (const node of tree.walk()) {
    const meta = markers.get(node.text);
    if (meta) preparedVariables.set(node, meta);
  }
  let result = selected ?? tree.root;
  while (wrappers.has(result.kind)) {
    const significant = result.children.filter(n => !n.trivia && n.kind !== ';');
    if (significant.length !== 1) break;
    result = significant[0]!;
  }
  return result;
}
