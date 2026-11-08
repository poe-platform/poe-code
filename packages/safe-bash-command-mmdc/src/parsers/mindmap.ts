import { MermaidError, type MermaidBudget, type MermaidDocument, type NodeShape } from '../contracts.js';
import { unquoteText, type ScannedStatement } from '../scanner.js';
import { CoreDocument } from './core-document.js';

export function* parseMindmap(statements: readonly ScannedStatement[], budget: MermaidBudget): Generator<void, MermaidDocument, void> {
  const document = new CoreDocument('mindmap', budget);
  const parents: { column: number; id: string }[] = [];
  const shapes: readonly [string, string, NodeShape][] = [['((', '))', 'circle'], ['{{', '}}', 'hexagon'], ['[', ']', 'rect'], ['(', ')', 'rounded'], [')', '(', 'rounded']];
  for (const statement of statements.slice(1)) {
    yield;
    let label = statement.text;
    let id: string | undefined;
    let shape: NodeShape = 'rounded';
    if (label.startsWith('::')) throw new MermaidError('E_UNSUPPORTED', 'Mindmap icons and CSS classes are unsupported', { span: statement });
    for (const [open, close, candidate] of shapes) {
      const index = label.indexOf(open);
      if (index < 0) continue;
      if (!label.endsWith(close)) throw new MermaidError('E_SYNTAX', 'Unclosed mindmap shape', { span: statement });
      id = label.slice(0, index).trim() || undefined;
      label = unquoteText(label.slice(index + open.length, -close.length));
      shape = candidate;
      break;
    }
    if (!label) throw new MermaidError('E_SYNTAX', 'Empty mindmap node', { span: statement });
    while (parents.length && parents.at(-1)!.column >= statement.column) parents.pop();
    if (document.nodes.length && !parents.length) throw new MermaidError('E_SYNTAX', 'Mindmap must have one indented root', { span: statement });
    const node = document.node(label, statement, shape, id);
    if (parents.length) document.edge(parents.at(-1)!.id, node, false);
    parents.push({ column: statement.column, id: node });
  }
  return document.finish();
}
