import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMermaid, renderMermaidSvg } from './index.js';

const examples = {
  mindmap: 'mindmap\n  root((Project))\n    Planning\n      Research\n    Delivery',
  gantt: 'gantt\n  title Release\n  dateFormat YYYY-MM-DD\n  section Build\n  Design :done, design, 2026-01-01, 2d\n  Code :active, code, after design, 3d\n  Ship :milestone, ship, after code, 0d',
  timeline: 'timeline\n  title History\n  section Early\n  2024 : Launch : Growth\n  2025 : Expansion',
  journey: 'journey\n  title My day\n  section Morning\n  Coffee: 5: Me\n  Work: 3: Me, Team',
  gitGraph: 'gitGraph\n  commit id: "first"\n  branch develop\n  checkout develop\n  commit id: "feature"\n  checkout main\n  merge develop tag: "v1"'
};

for (const [family, source] of Object.entries(examples)) {
  test(`${family} parses and renders meaningful content`, () => {
    const document = parseMermaid(source);
    assert.equal(document.family, family);
    assert.ok(document.nodes.length > 0);
    const result = renderMermaidSvg(source);
    assert.ok(result.svg.includes('<svg'));
    assert.ok(result.width > 0 && result.height > 0);
    assert.throws(() => parseMermaid(source, { limits: { maxNodes: 1 } }), /limit|budget/i);
  });
}

test('mindmap retains indentation and explicit node shapes', () => {
  const document = parseMermaid(examples.mindmap);
  assert.deepEqual(document.nodes.map(node => node.label), ['Project', 'Planning', 'Research', 'Delivery']);
  assert.equal(document.nodes[0]!.shape, 'circle');
  assert.deepEqual(document.edges.map(edge => [edge.from, edge.to]), [['root', 'mindmap_1'], ['mindmap_1', 'mindmap_2'], ['root', 'mindmap_3']]);
});

test('core families reject malformed data and unsafe labels', () => {
  for (const source of ['mindmap\nroot\nother', 'gantt\nBad: 2026-02-30, 1d', 'journey\nBad: 7: Me', 'gitGraph\ncheckout missing', 'gitGraph\nmerge missing', 'timeline\n: orphan']) {
    assert.throws(() => parseMermaid(source), { name: 'MermaidError' });
  }
  for (const family of ['mindmap', 'timeline', 'journey', 'gantt']) {
    assert.throws(() => parseMermaid(`${family}\n<script>alert</script>: 5: Me`));
  }
});

test('Gantt resolves dependencies and positions bars on a proportional time axis', async () => {
  const { layoutMermaid } = await import('./index.js');
  const document = parseMermaid(examples.gantt);
  const tasks = document.tasks!;
  assert.equal(tasks[1]!.start, tasks[0]!.end);
  assert.equal(tasks[2]!.start, tasks[1]!.end);
  assert.equal(tasks[1]!.end - tasks[1]!.start, 3 * 86400000);
  const scene = layoutMermaid(document);
  const design = scene.nodes.find(node => node.id === 'design')!;
  const code = scene.nodes.find(node => node.id === 'code')!;
  assert.ok(Math.abs(code.width / design.width - 1.5) < 0.01);
  assert.equal(code.x, design.x + design.width);
  assert.equal(scene.nodes.find(node => node.id === 'ship')!.shape, 'diamond');
});

test('gitGraph branch creation switches branches and merges both histories', () => {
  const document = parseMermaid('gitGraph\ncommit id: "base"\nbranch feature\ncommit id: "change"\ncheckout main\ncommit id: "other"\nmerge feature id: "merged"');
  assert.ok(document.nodes[1]!.label.startsWith('feature\n'));
  assert.deepEqual(document.edges.filter(edge => edge.to === 'merged').map(edge => edge.from), ['other', 'change']);
});

test('timeline continuation events and journey scores remain visible', () => {
  assert.ok(renderMermaidSvg('timeline\n2024 : Launch\n: Growth').svg.includes('Growth'));
  const svg = renderMermaidSvg(examples.journey).svg;
  for (const text of ['Coffee', '5/5', 'Me, Team', 'Morning']) assert.ok(svg.includes(text));
});

test('new families share PNG, PDF and cooperative SVG rendering', async () => {
  const { renderMermaidPng, renderMermaidPdf, renderMermaidSvgAsync, decodePngToRgba } = await import('./index.js');
  const { PdfDocument } = await import('@poe-code/pdf-ast');
  for (const source of Object.values(examples)) {
    const png = renderMermaidPng(source, { width: 240 });
    assert.equal(decodePngToRgba(png.png).width, 240);
    assert.equal(PdfDocument.load(renderMermaidPdf(source, { width: 240 }).pdf).pageCount, 1);
    assert.equal((await renderMermaidSvgAsync(source)).svg, renderMermaidSvg(source).svg);
  }
});

test('frontmatter and init theme variables apply to new families', () => {
  for (const source of Object.values(examples)) {
    const wrapped = `---\nconfig:\n  theme: dark\n  themeVariables:\n    textColor: '#abcdef'\n    primaryTextColor: '#abcdef'\n---\n%%{init: {"themeVariables":{"lineColor":"#123456"},"ignored":true}}%%\n${source}`;
    assert.ok(renderMermaidSvg(wrapped).svg.includes('#abcdef'));
  }
});

test('journey scores use readable embedded-font text', () => {
  const document = parseMermaid('journey\nCoffee: 5: Me');
  assert.equal(document.nodes[0]!.label, 'Coffee\nScore: 5/5\nMe');
});
