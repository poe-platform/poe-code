export const cases = [];
const literal = (id, input, expected, extra = {}) => cases.push({ id, kind: 'literal', input, expected, ...extra });
const invariant = (id, input, rule, extra = {}) => cases.push({ id, kind: 'invariant', input, rule, ...extra });
literal('L01-empty', '', '');
literal('L02-heading-paragraph', '<h2>Title</h2><p>Hello <strong>world</strong>.</p>', '## Title\n\nHello **world**\\.\n');
literal('L03-inline-boundaries', '<p>one <em>two</em> three</p>', 'one *two* three\n');
literal('L04-whitespace', '<p> a\t b\r\n c&nbsp;d </p>', 'a b c\u00a0d\n');
literal('L05-unknown-entity', '<p>&bogus; &amp;lt; &#0; &#xD800; &#1114112;</p>', '\\&bogus; \\&lt; � � �\n');
literal('L06-raw-ordinary-text', '<p>&lt;script&gt;*x* [y](z)</p>', '\\<script\\>\\*x\\* \\[y\\]\\(z\\)\n');
literal('L07-drop-active', '<p>before</p><!--gone--><script>alert(1)</script><style>x{}</style><p>after</p>', 'before\n\nafter\n');
literal('L08-unterminated-script', '<p>before</p><script>never<p>after', 'before\n');
literal('L09-unterminated-comment', 'before<!--never<p>after', 'before\n');
literal('L10-unknown-elements', '<widget>A<inner>B</inner>C</widget>', 'ABC\n');
literal('L11-unclosed-elements', '<p>A<em>B', 'A*B*\n');
literal('L12-selfclosing', '<p>A<em/>B</p>', 'AB\n');
literal('L13-strict-utf8', '<p>Żółw 🐢 文</p>', 'Żółw 🐢 文\n', { everyByteSplit: true });
literal('L14-bom-nul', '\ufeff<p>A\0B</p>', 'A�B\n');
literal('L15-first-duplicate', '<A HREF="javascript:bad" href="https://safe.test">label</A>', 'label\n');
literal('L16-invalid-close-raw', '<script>bad</script x>still bad</SCRIPT ><p>ok</p>', 'ok\n');
literal('L17-rcdata', '<textarea>&lt;b&gt;A</textarea>', '\\<b\\>A\n');
literal('L18-malformed-tail', 'before <a href="unfinished', 'before \\<a href="unfinished\n');
literal('L19-plain-code', '<pre><code>A\r\n B\rC\n</code></pre>', '```\nA\n B\nC\n```\n');

const rejected = [
  ['javascript', 'javascript:alert(1)'], ['case', 'JaVaScRiPt:alert(1)'],
  ['entity-colon', 'javascript&colon;alert(1)'], ['entity-letter', 'java&#x73;cript:alert(1)'],
  ['nested-entity', 'java&amp;#x73;cript:alert(1)'], ['tab', 'java\tscript:alert(1)'],
  ['newline', 'java\nscript:alert(1)'], ['entity-newline', 'java&NewLine;script:alert(1)'],
  ['entity-tab', 'java&Tab;script:alert(1)'], ['percent-tab', 'java%09script:alert(1)'],
  ['percent-cr', 'https://safe.test/%0Dnext'], ['data', 'data:text/html,hello'],
  ['vbscript', 'vbscript:msgbox(1)'], ['file', 'file:///etc/passwd'],
  ['network-path', '//evil.test/x'], ['backslash', '\\evil.test\\x'],
  ['https-backslash', 'https:\\evil.test'], ['unknown-entity', 'https://safe.test/&unknown;'],
  ['nul', 'java\0script:alert(1)'], ['del', 'https://safe.test/\x7f'],
  ['scheme-confusion', 'https:javascript:alert(1)'],
];
for (const [name, destination] of rejected) {
  if (name === 'scheme-confusion') {
    invariant(`U-link-${name}`, `<a href="${destination}">label</a>`, 'record-destination-ambiguity');
    continue;
  }
  literal(`U-link-${name}`, `<a href="${destination}">label</a>`, 'label\n');
  literal(`U-image-${name}`, `<img src="${destination}" alt="label">`, 'label\n');
}
literal('U-image-mailto', '<img src="mailto:a@example.test" alt="label">', 'label\n');
for (const destination of ['https://safe.test/a?x=1&y=2', 'http://safe.test', '/path', '../path', '#part', 'mailto:a@example.test']) {
  invariant(`U-safe-${encodeURIComponent(destination)}`, `<a href="${destination}">label</a>`, 'safe-link', { destination });
}
for (const [name, destination] of [
  ['nbsp', '\u00a0javascript:alert(1)'], ['em-space', '\u2003javascript:alert(1)'],
  ['zero-width', '\u200bjavascript:alert(1)'], ['nested-percent', 'java%2573cript%253Aalert(1)'],
  ['percent-scheme', 'javascript%3Aalert(1)'], ['percent-slashes', '%2f%2fevil.test'],
  ['leading-space', ' javascript:alert(1)'], ['numeric-no-semicolon', 'java&#115cript:alert(1)'],
]) invariant(`U-ambiguous-${name}`, `<a href="${destination}">label</a>`, 'record-destination-ambiguity');
invariant('U-title-alt-injection', '<a href="https://safe.test" title="&quot;) [evil](javascript:bad)">safe</a><img src="https://safe.test/i" alt="] [evil](javascript:bad) &lt;img src=x onerror=evil&gt;" title="evil">', 'no-injected-active-markdown');
invariant('U-destination-delimiters', '<a href="https://safe.test/a (b)&quot;&gt;[c]">label</a>', 'encoded-delimiters');
invariant('F01-nested-list', '<ol start="7"><li>alpha<ul><li>beta</li></ul></li><li>gamma</li></ol>', 'nested-list');
invariant('F02-quote', '<blockquote><p>alpha</p><p>beta</p></blockquote>', 'quote');
invariant('F03-fence', '<pre><code class="language-js">const x = ```;\n\n end</code></pre>', 'fence-preserves');
invariant('F04-code-span', '<p><code> `x` </code></p>', 'code-span-preserves');
invariant('F05-ragged-table', '<table><caption>cap</caption><tr><td>a</td><td>b|c</td></tr><tr><td>d</td></tr></table>', 'table-content');
invariant('F06-rawtext', '<xmp>&amp;<b>X</b></xmp><plaintext><i>Y</i>', 'rawtext-content');
invariant('F07-br-hr', '<p>a<br>b</p><hr><p>c</p>', 'hardbreak-rule');
invariant('F08-unquoted-case', '<A HREF=https://safe.test>label</A>', 'safe-link', { destination: 'https://safe.test' });

for (const [id, bytes] of [['E01-truncated', [0xf0, 0x9f]], ['E02-overlong', [0xc0, 0xaf]], ['E03-surrogate', [0xed, 0xa0, 0x80]], ['E04-continuation', [0x80]]]) {
  cases.push({ id, kind: 'bytes-error', bytes, status: 1 });
}
const cap = (id, limits, input, extra = {}) => cases.push({ id, kind: 'limit', limits, input, status: 1, ...extra });
cap('B01-input', { maxInputBytes: 8 }, '123456789');
cap('B02-output', { maxOutputBytes: 8 }, '<p>123456789</p>');
cap('B03-token', { maxTokenBytes: 32 }, `<a title="${'x'.repeat(80)}">x</a>`);
cap('B04-tokens', { maxTokens: 2 }, '<p>x</p><p>y</p>');
cap('B05-nodes', { maxNodes: 2 }, '<p>x</p><p>y</p>');
cap('B06-depth', { maxDepth: 4 }, `${'<div>'.repeat(5)}x${'</div>'.repeat(5)}`);
cap('B07-attributes', { maxAttributes: 2 }, '<p a=1 b=2 c=3>x</p>');
cap('B08-table-cells', { maxTableCells: 2 }, '<table><tr><td>x</td><td>y</td></tr></table>');
cap('B09-cell-bytes', { maxTableCellBytes: 8 }, '<table><tr><td>123456789</td></tr></table>');
cap('B10-files', { maxFiles: 1 }, '', { args: ['a', 'b'] });
cap('B11-args', { maxArgumentBytes: 4 }, '', { args: ['12345'] });
cases.push({ id: 'B12-diagnostic', kind: 'diagnostic', limits: { maxDiagnosticBytes: 24 }, args: ['missing-' + 'x'.repeat(80)], status: 1, maximum: 24 });
cap('B13-work', { maxWorkUnits: 64 }, '<p>' + 'x'.repeat(1000) + '</p>');
for (const [name, input] of [
  ['attribute', '<a title="' + 'x'.repeat(200000)],
  ['entity', '&' + 'x'.repeat(200000) + ';'],
  ['delimiters', '<'.repeat(200000)],
  ['rawtext', '<script>' + '</scripX>'.repeat(25000)],
  ['backticks', '<pre>' + '`'.repeat(200000) + '</pre>'],
  ['deep', '<div>'.repeat(10000) + 'x'],
]) cap(`S-${name}`, { maxWorkUnits: 2048, maxInputBytes: 500000 }, input, { deadlineMs: 10000 });

export const stressScales = [8192, 32768, 131072, 524288];
export const stressForms = ['unterminated-quoted-attribute', 'repeated-less-than', 'rawtext-close-near-miss', 'long-entity', 'alternating-backticks'];
