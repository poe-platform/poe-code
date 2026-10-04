import { describe, expect, it } from 'vitest';
import { parseXml, parseXmlSteps, type XmlElement, type XmlContent, type XmlStreamEvent } from './index.js';

const inputs = ['<r><x>text</r>', '<r><x', '<r></r', '<r>&missing; tail&broken</r>', '<?xml version="1.0"?><!--before--><r a="1">text<![CDATA[c]]><x/></r><?after ok?>'];
const summarize = (event: XmlStreamEvent) => event.type === 'content'
  ? [event.type, event.content.kind, event.content.text, event.parent?.name]
  : [event.type, event.element.name, event.parent?.name];
function* treeEvents(node: XmlElement, parent?: XmlElement): Generator<XmlStreamEvent> {
  yield { type: 'open', element: node, parent };
  for (const child of node.content) {
    if (child.kind === 'element') yield* treeEvents(child, node);
    else yield { type: 'content', content: child, parent: node };
  }
  yield { type: 'close', element: node, parent };
}
const outside = (content: readonly XmlContent[] | undefined): XmlStreamEvent[] => (content ?? []).map(value => {
  if (value.kind === 'element') throw new Error('unexpected root sibling');
  return { type: 'content', content: value, parent: undefined };
});
describe('recovery parser events', () => {
  it('propagates consumer failures unchanged', () => {
    const failure = new Error('consumer failed');
    const parser = parseXmlSteps('<r><x/></r>', { retainTree: false, events: () => { throw failure; } });
    expect(() => { for (const _step of parser) void _step; }).toThrow(failure);
  });
  it('enforces resource limits while discarding the tree', () => {
    const parser = parseXmlSteps('<r><x/><x/></r>', { retainTree: false, maxNodes: 2, recover: () => {} });
    expect(() => { for (const _step of parser) void _step; }).toThrow();
  });
  for (const input of inputs) it(`preserves repairs and node order: ${input}`, () => {
    const expectedMessages: string[] = [], actualMessages: string[] = [], actual: XmlStreamEvent[] = [];
    const expected = parseXml(input, { recover: message => expectedMessages.push(message) });
    const parser = parseXmlSteps(input, { retainTree: false, events: (event: XmlStreamEvent) => actual.push(event), recover: (message: string) => actualMessages.push(message) });
    let step = parser.next(); while (!step.done) step = parser.next();
    expect(step.value.children).toEqual([]); expect(step.value.content).toEqual([]); expect(step.value.text).toBe('');
    expect(actualMessages).toEqual(expectedMessages);
    expect(actual.map(summarize)).toEqual([...outside(expected.prolog), ...treeEvents(expected), ...outside(expected.epilog)].map(summarize));
    for (const event of actual) if (event.type !== 'content') { expect(event.element.children).toEqual([]); expect(event.element.content).toEqual([]); }
  });
});
