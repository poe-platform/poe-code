import { parseHtml, serializeHtml, serializeHtmlBytes, inclusiveHtmlDescendants, detachHtmlNode, HtmlError, type HtmlNode, type HtmlLimits, type HtmlOptions } from '@poe-platform/safe-bash/commands/htmlq';
const limits:HtmlLimits={inputBytes:10000,decodedBytes:20000,retainedBytes:100000,nodes:1000,attributes:1000,depth:100,tokenBytes:10000,work:1000000,outputBytes:10000};
const options:HtmlOptions={signal:new AbortController().signal,limits};
declare const source:AsyncIterable<Uint8Array>;
const document:HtmlNode=await parseHtml(source,options);
const text:string=serializeHtml(document,options);
const bytes:AsyncGenerator<Uint8Array>=serializeHtmlBytes(document,options);
const nodes:Generator<HtmlNode>=inclusiveHtmlDescendants(document,options);
detachHtmlNode(document,options);
// @ts-expect-error Consumers cannot mutate engine-owned children.
document.children.push(document);
// @ts-expect-error Consumers cannot mutate ordered attributes.
document.attributes[0].value='x';
void text;void bytes;void nodes;void new HtmlError('E_LIMIT','limit',0,'nodes');

import { selectHtml, htmlqBytes, htmlq, htmlqCommands, createHtmlqCommand, parseHtmlqArguments, type HtmlqResult, type HtmlqRunOptions, type HtmlqArguments } from '@poe-platform/safe-bash/commands/htmlq';
import type { CommandContext } from '@poe-platform/safe-bash/contracts';
declare const context: CommandContext;
const invocation: HtmlqRunOptions = { argv: ['p', '--attributes', 'title'], limits: { decodedBytes: 10000 } };
const result: HtmlqResult = await htmlq(context, invocation);
const parsed: HtmlqArguments = parseHtmlqArguments(['p', '-t'], options);
const selection: Generator<HtmlNode> = selectHtml(document, ':not(.hidden)', options);
const projection: AsyncGenerator<Uint8Array> = htmlqBytes(source, ['p', '-p'], options);
const work: number = result.accounting.work;
void parsed; void selection; void projection; void work; void htmlqCommands(); void createHtmlqCommand();
// @ts-expect-error Invocation argv is readonly.
invocation.argv?.push('p');

const typedInvocation: HtmlqRunOptions = { selector: "p", filename: "-", output: "-", base: "https://e.test/", detectBase: true, text: true, ignoreWhitespace: true, pretty: false, attributes: ["id"], removeNodes: ["b"] };
const typedResult: HtmlqResult = await htmlq(context, typedInvocation);
void typedResult;
// @ts-expect-error SDK flags are boolean.
void htmlq(context, { text: "true" });
