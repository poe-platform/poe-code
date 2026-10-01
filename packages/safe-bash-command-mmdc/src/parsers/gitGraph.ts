import { MermaidError, type MermaidBudget, type MermaidDocument } from '../contracts.js';
import { isAsciiWhitespace, unquoteText, type ScannedStatement } from '../scanner.js';
import { CoreDocument } from './core-document.js';

function words(text: string): string[] {
  const result: string[] = [];
  let start = 0;
  let quote = '';
  for (let i = 0; i <= text.length; i++) {
    const ch = text[i] ?? ' ';
    if (quote) {
      if (ch === quote && text[i - 1] !== '\\') quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (isAsciiWhitespace(ch)) {
      if (i > start) result.push(unquoteText(text.slice(start, i)));
      start = i + 1;
    }
  }
  return result;
}

export function* parseGitGraph(statements: readonly ScannedStatement[], budget: MermaidBudget): Generator<void, MermaidDocument, void> {
  const document = new CoreDocument('gitGraph', budget);
  const branches = new Map<string, string | undefined>([['main', undefined]]);
  let current = 'main';
  const header = statements[0]!.text.slice('gitGraph'.length).trim();
  const direction = header === 'TB:' || header === 'TB' ? 'TD' : header === 'BT:' || header === 'BT' ? 'BT' : 'LR';
  if (!['', ':', 'LR', 'LR:', 'TB', 'TB:', 'BT', 'BT:'].includes(header)) throw new MermaidError('E_SYNTAX', 'Invalid gitGraph direction');
  for (const statement of statements.slice(1)) {
    yield;
    const [command, ...args] = words(statement.text);
    const named: Record<string, string> = Object.create(null) as Record<string, string>;
    const positional: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      if (arg.endsWith(':')) {
        const value = args[++i];
        if (value === undefined) throw new MermaidError('E_SYNTAX', 'Missing gitGraph attribute value', { span: statement });
        named[arg.slice(0, -1)] = value;
      } else positional.push(arg);
    }
    const target = positional[0];
    if (command === 'branch') {
      if (!target || branches.has(target) || positional.length !== 1 || Object.keys(named).some(key => key !== 'order')) throw new MermaidError('E_SYNTAX', 'Invalid or duplicate branch', { span: statement });
      budget.chargeNodes(1);
      branches.set(target, branches.get(current));
      current = target;
      continue;
    }
    if (command === 'checkout' || command === 'switch') {
      if (!target || !branches.has(target) || args.length !== 1) throw new MermaidError('E_SYNTAX', 'Unknown checkout branch', { span: statement });
      current = target;
      continue;
    }
    if (command !== 'commit' && command !== 'merge' && command !== 'cherry-pick') throw new MermaidError('E_UNSUPPORTED', `Unsupported gitGraph command '${command}'`, { span: statement });
    if (Object.keys(named).some(key => !['id', 'tag', 'type', 'parent'].includes(key))) throw new MermaidError('E_SYNTAX', 'Unknown commit attribute', { span: statement });
    if (named.type && !['NORMAL', 'REVERSE', 'HIGHLIGHT'].includes(named.type)) throw new MermaidError('E_SYNTAX', 'Invalid commit type', { span: statement });
    if ((command === 'commit' && positional.length) || (command === 'merge' && positional.length !== 1) || (command === 'cherry-pick' && positional.length)) throw new MermaidError('E_SYNTAX', 'Invalid commit arguments', { span: statement });
    const parent = branches.get(current);
    const other = command === 'merge' ? branches.get(target!) : command === 'cherry-pick' ? named.id : undefined;
    if (command !== 'commit' && (!other || other === parent || (command === 'cherry-pick' && !document.ids.has(other)))) throw new MermaidError('E_SYNTAX', 'Invalid merge or cherry-pick target', { span: statement });
    const id = command === 'cherry-pick' ? `cherry_${document.nodes.length}` : named.id ?? `commit_${document.nodes.length}`;
    const label = `${current}\n${id}${command === 'cherry-pick' ? `\ncherry-pick ${other}` : ''}${named.tag ? `\n${named.tag}` : ''}${named.type && named.type !== 'NORMAL' ? `\n${named.type}` : ''}`;
    document.node(label, statement, 'circle', id);
    if (parent) document.edge(parent, id);
    if (other) document.edge(other, id);
    branches.set(current, id);
  }
  return document.finish(direction);
}
