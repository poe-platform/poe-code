import { MermaidError, type MermaidBudget, type MermaidDocument } from '../contracts.js';
import { checkSafeLabelText, type ScannedStatement } from '../scanner.js';
import { CoreDocument } from './core-document.js';

export function* parseTimeline(statements: readonly ScannedStatement[], budget: MermaidBudget): Generator<void, MermaidDocument, void> {
  const document = new CoreDocument('timeline', budget);
  let previous: string | undefined;
  for (const statement of statements.slice(1)) {
    yield;
    if (document.heading(statement)) continue;
    const [period, ...events] = statement.text.split(':').map(part => part.trim());
    if (!period) {
      if (!previous || !events.length || events.some(event => !event)) throw new MermaidError('E_SYNTAX', 'Timeline event requires a period', { span: statement });
      const last = document.nodes.at(-1)!;
      const label = checkSafeLabelText([last.label, ...events].join('\n'), budget, statement);
      document.nodes[document.nodes.length - 1] = { ...last, label };
      continue;
    }
    if (events.some(event => !event)) throw new MermaidError('E_SYNTAX', 'Empty timeline event', { span: statement });
    const id = document.node([period, ...events].join('\n'), statement);
    if (previous) document.edge(previous, id);
    previous = id;
  }
  return document.finish();
}
