import assert from 'node:assert/strict';
import { parseHtml, serializeHtml, serializeHtmlBytes, htmlText, inclusiveHtmlDescendants, detachHtmlNode, HtmlError, htmlqBaseline } from '@poe-platform/safe-bash/commands/htmlq';
const options={signal:new AbortController().signal,limits:{inputBytes:10000,decodedBytes:20000,retainedBytes:100000,nodes:1000,attributes:1000,depth:100,tokenBytes:10000,work:1000000,outputBytes:10000}};
async function* source() {yield new TextEncoder().encode('<table>x<tr><td>&copy;</table><script>a<b</script>');}
const document=await parseHtml(source(),options);
assert.equal(serializeHtml(document,options),'<html><head></head><body>x<table><tbody><tr><td>©</td></tr></tbody></table><script>a<b</script></body></html>');
assert.equal(htmlText(document,options),'x©a<b');
let streamed='';for await(const chunk of serializeHtmlBytes(document,options)) streamed+=new TextDecoder().decode(chunk);
assert.equal(streamed,serializeHtml(document,options));
const first=[...inclusiveHtmlDescendants(document,options)].find(node=>node.name==='table');detachHtmlNode(first,options);
assert.throws(()=>serializeHtml(document,options,'original'),error=>error instanceof HtmlError && error.code==='E_MUTATED');
assert.equal(htmlqBaseline.version,'0.5.0');
console.log('Installed htmlq engine: runtime, bytes, recovery and ownership passed');

const { Shell, createMemoryFileSystem } = await import('@poe-platform/safe-bash');
const contracts = await import('@poe-platform/safe-bash/contracts');
const { htmlqCommands, createHtmlqCommand, htmlq, htmlqBytes, selectHtml } = await import('@poe-platform/safe-bash/commands/htmlq');
assert.equal(createHtmlqCommand().runtimeIdentity, contracts.commandRuntimeIdentity);
assert.equal([...selectHtml(document, 'td:first-child', options)].length, 0); // table was detached
let projected = '';
for await (const bytes of htmlqBytes((async function* () { yield new TextEncoder().encode('<p>A<b>B</b></p>'); })(), ['p', '-t'], options)) projected += new TextDecoder().decode(bytes);
assert.equal(projected, 'AB\n');
const fs = createMemoryFileSystem();
await fs.writeFile('/input', new TextEncoder().encode('<div id="a"><span>1</span><span>2</span></div><div id="b"><span>3</span></div>'));
const shell = new Shell({ fs });
try {
  assert.equal((await shell.exec('htmlq div -f /input')).exitCode, 127);
  shell.use(htmlqCommands());
  const cli = await shell.exec('htmlq div -r span -f /input');
  assert.equal(cli.exitCode, 0); assert.equal(cli.stderr, ''); assert.equal(cli.stdout, '<div id="a"><span>2</span></div>\n');
  shell.use({ name: 'htmlq-sdk', setup(host) {
    host.commands.register({ name: 'sdk-htmlq', runtimeIdentity: contracts.commandRuntimeIdentity, execute(context) { return htmlq(context, { selector: 'div', removeNodes: ['span'], filename: '/input' }); } });
  } });
  assert.deepEqual(await shell.exec('sdk-htmlq'), cli);
  assert.equal((await shell.exec('htmlq -ti -f/input span')).stdout, '1\n\n2\n\n3\n\n');
  const same = await shell.exec('htmlq span -t -f /input -o /input');
  assert.equal(same.exitCode, 0); assert.equal(same.stdout, '');
  assert.equal(new TextDecoder().decode(await fs.readFile('/input')), '1\n2\n3\n');
  assert.equal((await shell.exec('htmlq --attribute id')).exitCode, 2);
  for (const command of ['htmlq -tt', 'htmlq -f /input --filename=/input']) {
    const duplicate = await shell.exec(command);
    assert.equal(duplicate.exitCode, 2);
    assert.equal(duplicate.stdout, '');
    assert.equal(duplicate.stderr, 'htmlq: E_ARGUMENT\n');
  }
  const missingValue = await shell.exec('htmlq -f --unknown');
  assert.equal(missingValue.exitCode, 2);
  assert.equal(missingValue.stdout, '');
  assert.equal(missingValue.stderr, 'htmlq: E_ARGUMENT\n');
  await fs.writeFile('/-input', new TextEncoder().encode('<p>literal</p>'));
  shell.use({ name: 'htmlq-literal-sdk', setup(host) {
    host.commands.register({ name: 'literal-sdk', runtimeIdentity: contracts.commandRuntimeIdentity, execute(context) { return htmlq(context, { selector: 'p', filename: '-input', text: true }); } });
  } });
  const literalSdk = await shell.exec('literal-sdk');
  assert.equal(literalSdk.exitCode, 0);
  assert.equal(literalSdk.stdout, 'literal\n');
  assert.deepEqual(literalSdk, await shell.exec('htmlq p --filename=-input -t'));
} finally { await shell.dispose(); }
console.log('Installed htmlq behavior: canonical registration, CLI/SDK, live mutations and atomic VFS passed');
