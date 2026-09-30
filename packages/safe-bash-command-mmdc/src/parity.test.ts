import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMermaid, renderMermaidSvg, renderMermaidPng, parseMmdcArguments } from "./index.js";

for (const source of [
  '---\ntitle: Hello\nconfig:\n  theme: dark\n---\ngraph TD\nA --> B',
  '%%{init: {"theme":"dark", "unknown":true}}%%\nflowchart TD\nA --> B',
  'flowchart TD\nA[Start]:::urgent --> B[End]\nclassDef urgent fill:#f96,stroke:#333,color:#000\nclass B urgent\nstyle B fill:#abc\nlinkStyle 0 stroke:#f00\nclick A "https://example.com"\ncallback B handler',
  'sequenceDiagram\nbox Purple Team\nparticipant A\nparticipant B\nend\nA->>B: hello\nlink A: Site @ https://example.com\nlinks B: {"Site":"https://example.com"}\nclick A callback handler',
  'pie showData title Pets\n"Dogs" : 60\n"Cats" : 40'
]) test(`renders standard Mermaid syntax: ${source.split('\n')[0]}`, () => {
  const svg = renderMermaidSvg(source);
  assert.ok(svg.svg.includes('<svg'));
  assert.ok(renderMermaidPng(source).png.length > 0);
});

test('metadata and flowchart style change the rendered appearance', () => {
  const result = renderMermaidSvg('---\ntitle: Hello\nconfig:\n  theme: dark\n---\nflowchart TD\nA:::urgent --> B\nclassDef urgent fill:#f96,stroke:#333,color:#fff');
  assert.ok(result.svg.includes('Hello'));
  assert.ok(result.svg.includes('#f96'));
  assert.ok(result.svg.includes('#333'));
  assert.ok(result.svg.includes('#fff'));
  assert.equal(parseMermaid('pie title Pets\n"Dogs": 60\n"Cats": 40').family, 'pie');
});

test('PDF output is inferred from filenames and accepts explicit format', () => {
  assert.equal(parseMmdcArguments(['-o','diagram.pdf']).outputFormat, 'pdf');
  assert.equal(parseMmdcArguments(['-e','pdf','-o','-']).outputFormat, 'pdf');
});

test('PDF SDK produces a readable page without Buffer and enforces output limits', async () => {
  const { renderMermaidPdf } = await import('./index.js');
  const { PdfDocument } = await import('@poe-code/pdf-ast');
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Buffer')!;
  Object.defineProperty(globalThis, 'Buffer', { value: undefined, configurable: true });
  try {
    const result = renderMermaidPdf('pie title Pets\n"Dogs": 60\n"Cats": 40');
    const document = PdfDocument.load(result.pdf);
    assert.equal(document.pageCount, 1);
    assert.ok(result.width > 0 && result.height > 0);
    assert.equal(result.accounting.outputBytes, result.pdf.length);
    assert.throws(() => renderMermaidPdf('flowchart TD; A --> B', { limits: { maxOutputBytes: 16 } }), /output.*limit/i);
  } finally { Object.defineProperty(globalThis, 'Buffer', descriptor); }
});

test('metadata retains source positions and merges source config without relaxing host quotas', () => {
  const source = '\ufeff---\r\ntitle: Cats 🐈\r\nconfig:\r\n  flowchart:\r\n    nodeSpacing: 48\r\n---\r\n%%{init: {"theme":"dark","flowchart":{"rankSpacing":72},"themeVariables":{"unused":"x"}}}%%\r\nflowchart TD\r\nA --> B';
  const document = parseMermaid(source);
  assert.equal(document.title, 'Cats 🐈');
  assert.deepEqual(document.config?.flowchart, { nodeSpacing: 48, rankSpacing: 72 });
  assert.equal(document.nodes[0]!.span?.line, 9);
  assert.equal(document.nodes[0]!.span?.offset, source.indexOf('A --> B'));
  assert.doesNotThrow(() => renderMermaidSvg(source));
  assert.throws(() => renderMermaidSvg(source, { limits: { maxSourceBytes: 16 } }), /Source byte limit/);
  assert.throws(() => parseMermaid('---\ntitle: Never closed'), /Unclosed/);
  assert.throws(() => parseMermaid('%%{init: {"theme":"dark"}\nflowchart TD\nA --> B'), /Unclosed/);
});

test('styles are applied after declarations and URL links survive in SVG', () => {
  const source = 'flowchart LR\nclass A urgent\nstyle B fill:#abc\nlinkStyle default stroke:#f00,stroke-width:3px\nclassDef urgent fill:#f96\nA:::urgent --> B\nclick A href "https://example.com?a=1&b=2" "Read more"';
  const document = parseMermaid(source);
  assert.equal(document.nodes[0]!.style?.fill, '#f96');
  assert.equal(document.nodes[1]!.style?.fill, '#abc');
  assert.equal(document.edges[0]!.style?.strokeWidth, 3);
  assert.ok(renderMermaidSvg(source).svg.includes('href="https://example.com?a=1&amp;b=2"'));
  assert.ok(renderMermaidSvg('sequenceDiagram\nparticipant A\nA->>A: Hi\nlink A: Site @ https://example.com').svg.includes('href="https://example.com"'));
});

test('participant boxes close independently and malformed boxes and pie data are rejected', () => {
  const source = 'sequenceDiagram\nbox Purple Team One\nparticipant A\nend\nbox transparent Team Two\nparticipant B\nend\nA->>B: Hi';
  const document = parseMermaid(source);
  assert.deepEqual(document.groups.map(group => group.label), ['Team One', 'Team Two']);
  assert.equal(document.nodes[0]!.groupId, document.groups[0]!.id);
  assert.doesNotThrow(() => renderMermaidSvg(source));
  assert.throws(() => parseMermaid('sequenceDiagram\nbox Purple Team\nparticipant A'), /Unclosed/);
  for (const value of ['-1', 'Infinity', 'NaN', '0', '']) assert.throws(() => parseMermaid(`pie\n"Empty": ${value}`));
  assert.ok(renderMermaidSvg('pie\n"Only": 1\n"Zero": 0').svg.includes('100.0%'));
});

test('source scale applies to PNG and PDF resolution without changing PDF page size', async () => {
  const source = '%%{init: {"scale":2}}%%\nflowchart TD\nA --> B';
  const svg = renderMermaidSvg(source);
  const png = renderMermaidPng(source);
  assert.equal(png.width, svg.width * 2);
  assert.equal(png.height, svg.height * 2);
  const { renderMermaidPdf } = await import('./index.js');
  const pdf = renderMermaidPdf(source);
  assert.equal(pdf.width, svg.width * 0.75);
});

test('pie ratios remain finite for large finite values', () => {
  const result = renderMermaidSvg('pie\n"Large": 1e308', { limits: { maxWork: 100000 } });
  assert.ok(result.svg.includes('100.0%'));
  assert.ok(!result.svg.includes('Infinity'));
});

test('frontmatter titles are visible text in graph and sequence output', () => {
  for (const body of ['flowchart LR\nA --> B', 'sequenceDiagram\nA->>B: Hello']) {
    const svg = renderMermaidSvg(`---\ntitle: Visible heading\n---\n${body}`).svg;
    assert.ok(svg.includes('>Visible heading</text>'));
  }
});

test('sequence named links retain every label and URL across repeated declarations', () => {
  const source = 'sequenceDiagram\nparticipant A\nA->>A: Hello\nlinks A: {"Docs":"https://example.com/docs","Status":"https://example.com/status"}\nlink A: Help @ https://example.com/help\nclick A href "https://example.com/profile"';
  const svg = renderMermaidSvg(source).svg;
  for (const label of ['Docs', 'Status', 'Help']) assert.ok(svg.includes(`>${label}</text>`));
  for (const path of ['docs', 'status', 'help', 'profile']) assert.ok(svg.includes(`href="https://example.com/${path}"`));
  assert.ok(renderMermaidPng(source).png.length > 0);
});

test('sequence boxes accept spaced functional CSS colors', () => {
  for (const fill of ['rgb(33, 66, 99)', 'rgba(33, 66, 99, 0.5)']) {
    const document = parseMermaid(`sequenceDiagram\nbox ${fill} Team\nparticipant A\nend\nA->>A: Hi`);
    assert.equal(document.groups[0]!.fill, fill);
    assert.equal(document.groups[0]!.label, 'Team');
  }
});
