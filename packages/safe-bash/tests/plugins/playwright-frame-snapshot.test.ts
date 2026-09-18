import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { createFrameSnapshot } from '../../src/playwright/frame-snapshot.js';
import type { FrameSnapshotInput, FrameSnapshotCapsule, FrameSnapshotRenderResult } from '../../src/playwright/frame-snapshot.js';
import type { SnapshotContentNode, SnapshotNode } from '../../src/playwright/adapter.js';

function element(attributes: Record<string, string> = {}, properties: Partial<SnapshotNode> = {}): SnapshotNode {
  return { tagName: 'BUTTON', textContent: 'Save', firstChild: { nodeType: 3, textContent: properties.textContent ?? 'Save' }, isConnected: true, getAttribute: name => attributes[name] ?? null, ...properties };
}

function tree(tagName: string, children: SnapshotContentNode[], attributes: Record<string, string> = {}): SnapshotNode {
  const linked = children.map(child => Object.assign(Object.create(child) as SnapshotContentNode, { nextSibling: null as SnapshotContentNode | null }));
  for (let index = 0; index < linked.length; index++) linked[index]!.nextSibling = linked[index + 1] ?? null;
  const node = element(attributes, { tagName, firstChild: linked[0] ?? null });
  Object.defineProperty(node, 'textContent', { get() { throw new Error('aggregate textContent is forbidden'); } });
  return node;
}

function fixture(nodes: SnapshotNode[] = [], body = '', limits: FrameSnapshotInput = { maxSnapshotBytes: 4096, maxSnapshotRefs: 20 }) {
  const encodedLengths: number[] = [];
  const context = createContext({
    document: {
      body: { innerText: body },
      querySelectorAll(selector: string) {
        assert.equal(selector, 'button, input, textarea, select, a[href], [role], [contenteditable="true"]');
        return nodes;
      },
    },
    TextEncoder: class extends TextEncoder {
      override encode(value = '') {
        encodedLengths.push(value.length);
        assert.ok(value.length <= limits.maxSnapshotBytes, 'oversized string reached encoding');
        return super.encode(value);
      }
    },
  });
  const create = runInContext(`(${createFrameSnapshot.toString()})`, context) as typeof createFrameSnapshot;
  const capsule: FrameSnapshotCapsule = create(limits);
  context.capsule = capsule;
  return {
    capsule, context, encodedLengths,
    render(refs: readonly string[]) {
      context.refs = refs;
      return JSON.parse(runInContext('JSON.stringify(capsule.render(refs))', context)) as FrameSnapshotRenderResult;
    },
  };
}

test('standalone callback retains real nodes while exporting only bounded status and rendered text', () => {
  const original = element();
  const current = fixture([original]);
  assert.equal(current.capsule.status, 'ok');
  assert.equal(current.capsule.count, 1);
  assert.equal(current.capsule.nodes[0], original);
  assert.equal('tagName' in current.capsule, false);
  assert.equal(runInContext('JSON.stringify({status:capsule.status,count:capsule.count})', current.context), '{"status":"ok","count":1}');
  assert.deepEqual(current.render(['e12']), { status: 'ok', text: '- button "Save" [ref=e12]\n' });
});

test('readable text trims paragraphs and skips blank lines without allocating refs', () => {
  const current = fixture([], ' Heading \n\n\t \n Details\r\n');
  assert.equal(current.capsule.count, 0);
  assert.deepEqual(current.render([]), { status: 'ok', text: '- text "Heading"\n- text "Details"\n' });
  const empty = fixture();
  empty.context.document.body = null;
  assert.deepEqual(empty.render([]), { status: 'ok', text: '' });
});

test('author-only and naming-prohibited roles never infer names from descendants', () => {
  const roles = ['navigation', 'search', 'region', 'form', 'group', 'img', 'generic', 'presentation', 'paragraph'];
  const nodes = roles.map(role => element({ role }, { tagName: 'DIV', textContent: '.css{color:red}window.secret=1;Go home' }));
  assert.equal(fixture(nodes).render(nodes.map((_, index) => `e${index + 1}`)).text,
    roles.map((role, index) => `- ${role} "" [ref=e${index + 1}]\n`).join(''));
  for (const node of nodes) {
    Object.defineProperty(node, 'textContent', { get() { throw new Error('container text must not be read'); } });
    Object.defineProperty(node, 'firstChild', { get() { throw new Error('container descendants must not be visited'); } });
  }
  assert.equal(fixture(nodes).render(nodes.map((_, index) => `e${index + 1}`)).status, 'ok');
});

test('author-only roles accept explicit names but naming-prohibited roles do not', () => {
  const nodes = [
    element({ role: 'navigation', 'aria-label': 'Main' }),
    element({ role: 'img', 'aria-label': 'Chart' }),
    element({ role: 'generic', 'aria-label': 'Wrong', title: 'Wrong' }),
    element({ role: 'paragraph', 'aria-label': 'Wrong' }),
  ];
  assert.equal(fixture(nodes).render(['e1', 'e2', 'e3', 'e4']).text,
    '- navigation "Main" [ref=e1]\n- img "Chart" [ref=e2]\n- generic "" [ref=e3]\n- paragraph "" [ref=e4]\n');
});

test('content names exclude source and hidden descendants but retain inline text and named images', () => {
  const children = [
    { nodeType: 3, textContent: 'Go ' },
    tree('STYLE', [{ nodeType: 3, textContent: 'source' }]),
    tree('SCRIPT', [{ nodeType: 3, textContent: 'source' }]),
    tree('SPAN', [{ nodeType: 3, textContent: 'hidden' }], { 'aria-hidden': 'true' }),
    tree('SPAN', [{ nodeType: 3, textContent: 'hidden' }], { hidden: '' }),
    tree('IMG', [], { alt: 'home' }),
  ];
  const nodes = [tree('A', children), tree('BUTTON', children), tree('DIV', children, { role: 'heading' })];
  assert.equal(fixture(nodes).render(['e1', 'e2', 'e3']).text,
    '- link "Go home" [ref=e1]\n- button "Go home" [ref=e2]\n- heading "Go home" [ref=e3]\n');
});

test('labels traverse visible content and explicit hidden references without chaining labelledby', () => {
  const label = tree('LABEL', [
    { nodeType: 3, textContent: 'Account ' },
    tree('SPAN', [], { 'aria-label': 'name' }),
    tree('SPAN', [{ nodeType: 3, textContent: 'wrong' }], { 'aria-hidden': 'true' }),
    tree('SCRIPT', [{ nodeType: 3, textContent: 'wrong' }]),
  ]);
  const hidden = tree('SPAN', [{ nodeType: 3, textContent: 'Hidden label' }], { hidden: '', 'aria-labelledby': 'cycle' });
  const empty = tree('SPAN', []);
  const ownerDocument = { defaultView: null, getElementById: (id: string) => ({ label, hidden, empty }[id] ?? null) };
  const nodes = [
    element({}, { tagName: 'INPUT', labels: [label] }),
    element({ 'aria-labelledby': 'missing label hidden label', 'aria-label': 'wrong' }, { ownerDocument }),
    element({ 'aria-labelledby': 'empty', 'aria-label': 'wrong' }, { ownerDocument }),
    element({ 'aria-labelledby': 'missing', 'aria-label': '  Fallback  ' }, { ownerDocument }),
    element({ 'aria-label': ' \t ' }, { textContent: 'Contents' }),
  ];
  assert.equal(fixture(nodes).render(['e1', 'e2', 'e3', 'e4', 'e5']).text,
    '- textbox "Account name" [ref=e1]\n- button "Account name Hidden label" [ref=e2]\n- button "" [ref=e3]\n- button "Fallback" [ref=e4]\n- button "Contents" [ref=e5]\n');
});

test('name traversal and label ID scanning fail closed at the byte-derived work budget', () => {
  const wide = tree('BUTTON', Array.from({ length: 200 }, () => tree('SPAN', [])));
  let deep = tree('SPAN', []);
  for (let index = 0; index < 200; index++) deep = tree('SPAN', [deep]);
  const ids = element({ 'aria-labelledby': 'missing '.repeat(200) });
  for (const node of [wide, tree('BUTTON', [deep]), ids]) {
    assert.deepEqual(fixture([node], '', { maxSnapshotBytes: 64, maxSnapshotRefs: 1 }).render(['e1']), { status: 'byte-limit', text: '' });
  }
});

test('computed visibility prunes descendants and block boundaries separate content names', () => {
  const styled = (display: string, visibility = 'visible') => ({
    defaultView: { document: {}, getComputedStyle: () => ({ display, visibility }) },
  });
  const hidden = tree('SPAN', [{ nodeType: 3, textContent: 'Wrong' }]);
  Object.defineProperty(hidden, 'ownerDocument', { value: styled('none') });
  Object.defineProperty(hidden, 'firstChild', { get() { throw new Error('hidden descendants must not be read'); } });
  const invisible = tree('SPAN', [{ nodeType: 3, textContent: 'Wrong' }]);
  Object.defineProperty(invisible, 'ownerDocument', { value: styled('inline', 'hidden') });
  const block = tree('SPAN', [{ nodeType: 3, textContent: 'First' }]);
  Object.defineProperty(block, 'ownerDocument', { value: styled('block') });
  const button = tree('BUTTON', [block, { nodeType: 3, textContent: 'last' }, hidden, invisible]);
  assert.equal(fixture([button]).render(['e1']).text, '- button "First last" [ref=e1]\n');
});

test('wrapping labels exclude their control and hidden ancestor references remain usable', () => {
  const control = element({}, { tagName: 'INPUT', value: 'not a name' });
  const label = tree('LABEL', []);
  Object.defineProperty(label, 'firstChild', { value: control });
  Object.defineProperty(control, 'nextSibling', { value: { nodeType: 3, textContent: 'Label' } });
  Object.defineProperty(control, 'labels', { value: [label] });
  const reference = tree('SPAN', [{ nodeType: 3, textContent: 'Hidden reference' }]);
  Object.defineProperty(reference, 'parentElement', { value: element({ hidden: '' }, { tagName: 'DIV' }) });
  const button = element({ 'aria-labelledby': 'label' }, { ownerDocument: { defaultView: null, getElementById: () => reference } });
  assert.equal(fixture([control, button]).render(['e1', 'e2']).text,
    '- textbox "Label" [ref=e1] [value="not a name"]\n- button "Hidden reference" [ref=e2]\n');
});

test('native wrapping and for labels and aria-labelledby retain naming precedence', () => {
  const nodes = [
    element({}, { tagName: 'INPUT', labels: [{ textContent: 'Name' }] }),
    element({}, { tagName: 'INPUT', labels: [{ textContent: 'Email' }, { textContent: 'address' }] }),
    element({ 'aria-labelledby': ' first\tmissing\nlast\r\f', 'aria-label': 'Wrong', placeholder: 'Wrong' }, {
      tagName: 'INPUT', labels: [{ textContent: 'Wrong' }],
      ownerDocument: { defaultView: null, getElementById: id => id === 'missing' ? null : { textContent: id === 'first' ? 'Account' : 'name' } },
    }),
    element({ 'aria-label': 'ARIA wins' }, { tagName: 'INPUT', labels: [{ textContent: 'Wrong' }] }),
  ];
  assert.equal(fixture(nodes).render(['e1', 'e2', 'e3', 'e4']).text,
    '- textbox "Name" [ref=e1]\n- textbox "Email address" [ref=e2]\n- textbox "Account name" [ref=e3]\n- textbox "ARIA wins" [ref=e4]\n');
});

test('native input roles, states, values and password exclusion match snapshot formatting', () => {
  const password = element({ type: 'password' }, { tagName: 'INPUT' });
  Object.defineProperty(password, 'value', { get() { throw new Error('password must not be read'); } });
  const nodes = [
    element({ type: 'checkbox' }, { tagName: 'INPUT', checked: true }),
    element({ type: 'checkbox' }, { tagName: 'INPUT', indeterminate: true }),
    element({ type: 'radio', 'aria-checked': 'false' }, { tagName: 'INPUT', checked: true }),
    element({ type: 'text' }, { tagName: 'INPUT', value: 'Ada "Lovelace"', disabled: true }),
    password,
    element({ type: 'number' }, { tagName: 'INPUT', value: '42' }),
    element({ type: 'search', 'aria-disabled': 'true' }, { tagName: 'INPUT', value: 'query' }),
    element({}, { tagName: 'SELECT', multiple: true, value: 'first' }),
    element({ role: 'switch', 'aria-checked': 'mixed' }),
  ];
  assert.equal(fixture(nodes).render(nodes.map((_, index) => `e${index + 1}`)).text,
    '- checkbox "" [ref=e1] [checked=true]\n- checkbox "" [ref=e2] [checked=mixed]\n- radio "" [ref=e3] [checked=false]\n'
    + '- textbox "" [ref=e4] [disabled] [value="Ada \\"Lovelace\\""]\n- textbox "" [ref=e5]\n'
    + '- spinbutton "" [ref=e6] [value="42"]\n- searchbox "" [ref=e7] [disabled] [value="query"]\n'
    + '- listbox "" [ref=e8] [value="first"]\n- switch "Save" [ref=e9] [checked=mixed]\n');
});

test('fallback names and tag roles retain native snapshot behavior', () => {
  const nodes = [
    element({ type: 'submit' }, { tagName: 'INPUT' }),
    element({ type: 'reset' }, { tagName: 'INPUT' }),
    element({ type: 'button' }, { tagName: 'INPUT', value: 'Go' }),
    element({ type: 'image', alt: 'Picture' }, { tagName: 'INPUT' }),
    element({ title: 'Title', placeholder: 'Wrong' }, { tagName: 'TEXTAREA' }),
    element({ placeholder: 'Hint' }, { tagName: 'INPUT' }),
    element({}, { tagName: 'A', textContent: 'Link' }),
    element({}, { tagName: 'DIV', textContent: 'Editable' }),
  ];
  assert.equal(fixture(nodes).render(nodes.map((_, index) => `e${index + 1}`)).text,
    '- button "Submit" [ref=e1]\n- button "Reset" [ref=e2]\n- button "Go" [ref=e3]\n- button "Picture" [ref=e4]\n'
    + '- textbox "Title" [ref=e5]\n- textbox "Hint" [ref=e6]\n- link "Link" [ref=e7]\n- div "" [ref=e8]\n');
});

test('large id, class and unrelated attributes never enter snapshot extraction', () => {
  const huge = 'x'.repeat(40 * 1024 * 1024);
  const attributes = { id: huge, class: huge, 'data-unrelated': huge };
  const original = element(attributes);
  const seen: string[] = [];
  const getAttribute = original.getAttribute;
  original.getAttribute = name => { seen.push(name); return getAttribute(name); };
  Object.defineProperty(original, 'attributes', { get() { throw new Error('must not describe attributes'); } });
  const current = fixture([original]);
  assert.deepEqual(current.render(['e1']), { status: 'ok', text: '- button "Save" [ref=e1]\n' });
  assert.ok(!seen.some(name => name in attributes));
  assert.equal(current.capsule.nodes[0], original);
});

for (const field of ['body', 'aria-label', 'value', 'role', 'text', 'labels', 'labelledby', 'title', 'placeholder']) {
  test(`oversized ${field} fails with a fixed status before encoding page-sized strings`, () => {
    const huge = 'x'.repeat(4 * 1024 * 1024);
    const attributes = ['aria-label', 'role', 'title', 'placeholder'].includes(field) ? { [field]: huge } : {};
    if (field === 'labelledby') attributes['aria-labelledby'] = 'label';
    const original = element(attributes, {
      tagName: ['value', 'labels', 'title', 'placeholder'].includes(field) ? 'INPUT' : 'BUTTON',
      textContent: field === 'text' ? huge : 'Save',
      ...(field === 'value' ? { value: huge } : {}),
      ...(field === 'labels' ? { labels: [{ textContent: huge }] } : {}),
      ...(field === 'labelledby' ? { ownerDocument: { defaultView: null, getElementById: () => ({ textContent: huge }) } } : {}),
    });
    const current = fixture([original], field === 'body' ? huge : '', { maxSnapshotBytes: 64, maxSnapshotRefs: 1 });
    assert.deepEqual(current.render(['e1']), { status: 'byte-limit', text: '' });
    assert.ok(current.encodedLengths.every(length => length <= 64));
  });
}

test('complete escaped UTF-8 output, state and host ref syntax share one exact byte budget', () => {
  const original = element({ role: 'custom"\n', 'aria-label': '  é😀"\\\n  ' });
  const body = 'hé😀\u0000';
  const expected = `- text ${JSON.stringify(body)}\n- ${JSON.stringify('custom"\n').slice(1, -1)} ${JSON.stringify('é😀"\\')} [ref=e123456]\n`;
  const bytes = Buffer.byteLength(expected);
  assert.equal(fixture([original], body, { maxSnapshotBytes: bytes, maxSnapshotRefs: 1 }).render(['e123456']).text, expected);
  assert.deepEqual(fixture([original], body, { maxSnapshotBytes: bytes - 1, maxSnapshotRefs: 1 }).render(['e123456']), { status: 'byte-limit', text: '' });
  const input = element({}, { tagName: 'INPUT', value: '\u0000é😀"\\' });
  const rendered = fixture([input]).render(['e1']).text;
  assert.equal(fixture([input], '', { maxSnapshotBytes: Buffer.byteLength(rendered), maxSnapshotRefs: 1 }).render(['e1']).text, rendered);
  assert.equal(fixture([input], '', { maxSnapshotBytes: Buffer.byteLength(rendered) - 1, maxSnapshotRefs: 1 }).render(['e1']).status, 'byte-limit');
});

test('aggregate output rejects overflow even when every individual element fits', () => {
  const single = fixture([element()]).render(['e1']).text;
  const current = fixture([element(), element()], '', { maxSnapshotBytes: Buffer.byteLength(single), maxSnapshotRefs: 2 });
  assert.deepEqual(current.render(['e1', 'e2']), { status: 'byte-limit', text: '' });
});

test('R+1 count rejects without retaining or inspecting any candidate nodes', () => {
  const nodes = new Proxy([element(), element()], { get(target, key, receiver) {
    if (key !== 'length') throw new Error('overflow nodes must not be inspected');
    return Reflect.get(target, key, receiver);
  } });
  const current = fixture(nodes, '', { maxSnapshotBytes: 1024, maxSnapshotRefs: 1 });
  assert.equal(current.capsule.status, 'ref-limit');
  assert.equal(current.capsule.count, 0);
  assert.equal(current.capsule.nodes.length, 0);
  assert.deepEqual(current.render([]), { status: 'ref-limit', text: '' });
  assert.equal(fixture([element()], '', { maxSnapshotBytes: 1024, maxSnapshotRefs: 1 }).capsule.count, 1);
});

test('zero remaining budgets admit empty frames but reject actual text or refs', () => {
  const limits = { maxSnapshotBytes: 0, maxSnapshotRefs: 0 };
  assert.deepEqual(fixture([], '', limits).render([]), { status: 'ok', text: '' });
  assert.deepEqual(fixture([], 'text', limits).render([]), { status: 'byte-limit', text: '' });
  assert.equal(fixture([element()], '', limits).capsule.status, 'ref-limit');
});

test('invalid limits and mismatched refs return fixed statuses without page strings', () => {
  for (const value of [-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    for (const key of ['maxSnapshotBytes', 'maxSnapshotRefs']) {
      const current = fixture([], '', { maxSnapshotBytes: 1024, maxSnapshotRefs: 1, [key]: value });
      assert.equal(current.capsule.status, 'invalid-input');
      assert.deepEqual(current.render([]), { status: 'invalid-input', text: '' });
    }
  }
  const current = fixture([element()]);
  assert.deepEqual(current.render([]), { status: 'invalid-refs', text: '' });
  assert.deepEqual(current.render(['e1', 'e2']), { status: 'invalid-refs', text: '' });
  assert.deepEqual(current.render(['x'.repeat(8192)]), { status: 'byte-limit', text: '' });
});

test('retained identity survives replacement while later field mutations remain bounded', () => {
  const attributes = { 'aria-label': 'Original' };
  const original = element(attributes);
  const nodes = [original];
  const current = fixture(nodes, '', { maxSnapshotBytes: 64, maxSnapshotRefs: 1 });
  nodes[0] = element({ 'aria-label': 'Replacement' });
  assert.equal(current.capsule.nodes[0], original);
  assert.equal(current.render(['e1']).text, '- button "Original" [ref=e1]\n');
  attributes['aria-label'] = 'x'.repeat(1024 * 1024);
  assert.deepEqual(current.render(['e1']), { status: 'byte-limit', text: '' });
  assert.equal(current.capsule.status, 'ok');
  assert.equal(current.capsule.count, 1);
  assert.equal(current.capsule.nodes[0], original);
});

test('DOM exceptions and document absence never export guest exception text', () => {
  const original = element();
  original.getAttribute = () => { throw new Error('guest error'.repeat(100_000)); };
  assert.deepEqual(fixture([original]).render(['e1']), { status: 'failed', text: '' });
  const context = createContext({ TextEncoder });
  const capsule = runInContext(`(${createFrameSnapshot.toString()})({maxSnapshotBytes:100,maxSnapshotRefs:1})`, context) as ReturnType<typeof createFrameSnapshot>;
  assert.equal(capsule.status, 'failed');
  assert.equal(capsule.count, 0);
});

test('native acquisition exceptions discard partially retained nodes and return fixed admission status', () => {
  const failure = new DOMException('x'.repeat(4 * 1024 * 1024), 'SecurityError');
  for (const phase of ['document', 'query', 'candidate']) {
    const candidates = [element(), element()];
    if (phase === 'candidate') Object.defineProperty(candidates, '1', { get() { throw failure; } });
    const context = createContext({ TextEncoder, document: {
      body: null,
      querySelectorAll() {
        if (phase === 'query') throw failure;
        return candidates;
      },
    } });
    if (phase === 'document') Object.defineProperty(context, 'document', { get() { throw failure; } });
    const capsule = runInContext(`(${createFrameSnapshot.toString()})({maxSnapshotBytes:100,maxSnapshotRefs:2})`, context) as FrameSnapshotCapsule;
    assert.equal(capsule.status, 'failed');
    assert.equal(capsule.count, 0);
    assert.equal(capsule.nodes.length, 0);
    context.capsule = capsule;
    assert.equal(runInContext('JSON.stringify(capsule.render([]))', context), '{"status":"failed","text":""}');
  }
});

for (const field of ['body', 'tagName', 'labels', 'labelledby', 'value']) {
  test(`native ${field} exceptions never escape the browser render callback`, () => {
    const failure = new DOMException('x'.repeat(4 * 1024 * 1024), 'InvalidStateError');
    const original = element(field === 'labelledby' ? { 'aria-labelledby': 'label' } : {}, { tagName: 'INPUT' });
    const current = fixture([original], 'Already rendered');
    if (field === 'body') Object.defineProperty(current.context.document.body, 'innerText', { get() { throw failure; } });
    else if (field === 'labelledby') Object.defineProperty(original, 'ownerDocument', { value: {
      defaultView: null, getElementById() { throw failure; },
    } });
    else Object.defineProperty(original, field, { get() { throw failure; } });
    assert.deepEqual(current.render(['e1']), { status: 'failed', text: '' });
    assert.equal(current.capsule.status, 'ok');
    assert.equal(current.capsule.count, 1);
    assert.equal(current.capsule.nodes[0], original);
  });
}
