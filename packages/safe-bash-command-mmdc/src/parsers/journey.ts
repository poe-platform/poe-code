import { MermaidError, type MermaidBudget, type MermaidDocument } from '../contracts.js';
import { type ScannedStatement } from '../scanner.js';
import { CoreDocument } from './core-document.js';

export function* parseJourney(statements: readonly ScannedStatement[], budget: MermaidBudget): Generator<void, MermaidDocument, void> {
  const document = new CoreDocument('journey', budget);
  let previous: string | undefined;
  for (const statement of statements.slice(1)) {
    yield;
    if (document.heading(statement)) continue;
    const [task, rawScore, actors, ...extra] = statement.text.split(':').map(part => part.trim());
    const score = Number(rawScore);
    if (!task || !rawScore || !Number.isInteger(score) || score < 1 || score > 5 || extra.length) throw new MermaidError('E_SYNTAX', 'Journey tasks require a score from 1 to 5', { span: statement });
    const id = document.node(`${task}\nScore: ${score}/5${actors ? `\n${actors}` : ''}`, statement);
    if (previous) document.edge(previous, id);
    previous = id;
  }
  return document.finish();
}
