import { MermaidError, type DiagramFamily, type DocumentEdge, type DocumentGroup, type DocumentNode, type MermaidBudget, type MermaidDocument, type NodeShape } from '../contracts.js';
import { checkSafeLabelText, type ScannedStatement } from '../scanner.js';

/** Shared accounting and identity checks for the core graph-based grammars. */
export class CoreDocument {
  readonly nodes: DocumentNode[] = [];
  readonly edges: DocumentEdge[] = [];
  readonly groups: DocumentGroup[] = [];
  readonly ids = new Set<string>();
  title: string | undefined;
  groupId: string | undefined;
  constructor(readonly family: DiagramFamily, readonly budget: MermaidBudget) {}

  node(label: string, statement: ScannedStatement, shape: NodeShape = 'rounded', id = `${this.family}_${this.nodes.length}`): string {
    if (this.ids.has(id)) throw new MermaidError('E_SYNTAX', `Duplicate node '${id}'`, { span: statement });
    this.budget.chargeNodes(1);
    this.budget.chargeWork(statement.text.length);
    this.ids.add(id);
    this.nodes.push({ id, label: checkSafeLabelText(label, this.budget, statement), shape, groupId: this.groupId, span: statement });
    return id;
  }

  edge(from: string, to: string, arrow = true): void {
    this.budget.chargeEdges(1);
    this.edges.push({ id: `edge_${this.edges.length}`, from, to, lineStyle: 'solid', startMarker: 'none', endMarker: arrow ? 'arrow' : 'none' });
  }

  heading(statement: ScannedStatement): boolean {
    const text = statement.text;
    if (text.startsWith('title ')) {
      this.title = checkSafeLabelText(text.slice(6).trim(), this.budget, statement);
      return true;
    }
    if (text.startsWith('section ')) {
      this.budget.chargeNodes(1);
      this.groupId = `section_${this.groups.length}`;
      this.groups.push({ id: this.groupId, label: checkSafeLabelText(text.slice(8).trim(), this.budget, statement), kind: 'subgraph', span: statement });
      return true;
    }
    return false;
  }

  finish(direction: MermaidDocument['direction'] = 'LR'): MermaidDocument {
    if (!this.nodes.length) throw new MermaidError('E_SYNTAX', `${this.family} requires data`);
    return { family: this.family, direction, title: this.title, nodes: this.nodes, edges: this.edges, groups: this.groups, notes: [] };
  }
}
