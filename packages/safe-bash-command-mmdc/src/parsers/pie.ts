import { MermaidError, type MermaidBudget, type MermaidDocument } from "../contracts.js";
import { checkSafeLabelText, unquoteText, type ScannedStatement } from "../scanner.js";

export function parsePie(statements: readonly ScannedStatement[], budget: MermaidBudget): MermaidDocument {
  let header = statements[0]!.text.slice(3).trim();
  const showData = header.startsWith('showData');
  if (showData) header = header.slice(8).trim();
  let title: string | undefined;
  if (header.startsWith('title ')) title = checkSafeLabelText(header.slice(6).trim(), budget);
  else if (header) throw new MermaidError('E_SYNTAX', 'Invalid pie header');
  const slices: { label: string; value: number }[] = [];
  let total = 0;
  for (const statement of statements.slice(1)) {
    const text = statement.text;
    if (text.startsWith('title ')) { title = checkSafeLabelText(text.slice(6).trim(), budget); continue; }
    const quote = text[0];
    if (quote !== '"' && quote !== "'") throw new MermaidError('E_SYNTAX', 'Pie labels must be quoted', { span: statement });
    let end = 1;
    while (end < text.length && !(text[end] === quote && text[end - 1] !== '\\')) end++;
    if (end === text.length || text.slice(end + 1).trim()[0] !== ':') throw new MermaidError('E_SYNTAX', 'Invalid pie slice', { span: statement });
    const raw = text.slice(end + 1).trim().slice(1).trim();
    const value = Number(raw);
    if (!raw || !Number.isFinite(value) || value < 0) throw new MermaidError('E_SYNTAX', 'Pie values must be finite nonnegative numbers', { span: statement });
    total += value;
    if (!Number.isFinite(total)) throw new MermaidError('E_SYNTAX', 'Pie total exceeds numeric range');
    const label = checkSafeLabelText(unquoteText(text.slice(0, end + 1)), budget, statement);
    budget.chargeNodes(1); budget.chargeWork(text.length);
    slices.push({ label, value });
  }
  if (!total) throw new MermaidError('E_SYNTAX', 'Pie requires a positive total');
  return { family: 'pie', direction: 'TD', title, slices, showData, nodes: [], edges: [], groups: [], notes: [] };
}
