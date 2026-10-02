import { createRequire } from "node:module";
import { text, typography } from "./text.js";
import { resolveOutputFormat } from "./logging.js";
const native = createRequire(import.meta.url)("./toolcraft-design-rust.node");
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const thrown = new WeakMap();
const protect = operation => (...args) => {
  try { return operation(...args); }
  catch (value) { const carrier = new Error("Help formatter host operation failed"); thrown.set(carrier, value); throw carrier; }
};

export function createHelpFormatter(plain) {
  let depth = 0;
  function invoke(operation, args) {
    if (depth >= 128) throw new RangeError("Maximum call stack size exceeded");
    depth++;
    try { return native.designHelpPolicy(operation, args, plain, host); }
    catch (error) { if (thrown.has(error)) throw thrown.get(error); throw error; }
    finally { depth--; }
  }
  const operations = {
    undefined: () => undefined, empty: () => "", zero: () => 0, two: () => 2,
    true: () => true, false: () => false, question: () => "?",
    at: (value,index) => value[index], charCode: (value,index) => value.charCodeAt(index),
    increment: value => value + 1, add: (a,b) => a + b, subtract: (a,b) => a - b,
    lt: (a,b) => a < b, le: (a,b) => a <= b, gt: (a,b) => a > b,
    truthy: value => !!value, positive: value => value > 0,
    positiveLength: value => value.length > 0, emptyArray: value => value.length === 0,
    singleLine: value => value.length === 1,
    controlFinal: code => code >= 0x40 && code <= 0x7e,
    asciiCode: code => code <= 0x7f,
    partition: (value,index) => ({prefix:value.slice(0,index),rest:value.slice(index)}),
    points: value => Array.from(value).map(char => char.codePointAt(0) ?? 0),
    emoji: points => points.some(point => native.designHelpEmojiPoint(point)),
    sumPoints: points => points.reduce((width,point) => width + native.designHelpPointWidth(point),0),
    cluster: (value,index) => segmenter.segment(value.slice(index))[Symbol.iterator]().next().value?.segment ?? "",
    prefixCluster: (value,index) => segmenter.segment(value.slice(index))[Symbol.iterator]().next().value?.segment ?? value[index] ?? "",
    advance: cluster => cluster.length || 1,
    contentWidth: (width,prefix) => Math.max(1,width - prefix),
    single: value => [value],
    words(value) {
      const words=[]; let word="";
      for(const char of value) {
        if(invoke("whitespace",[char])) { if(word) {words.push(word);word="";} continue; }
        word+=char;
      }
      if(word) words.push(word);
      return words;
    },
    foldWords(words,prefix,firstWidth,continuation) {
      const lines=[],state={line:"",first:true};
      for(const word of words) invoke("word",[state,word,prefix,firstWidth,continuation,lines]);
      lines.push(state.first ? `${prefix}${state.line}` : state.line);
      return lines;
    },
    joinedWidth: (line,word) => line + 1 + word,
    appendWord: (state,word) => {state.line += ` ${word}`;},
    prefixLine: (first,prefix,line) => first ? `${prefix}${line}` : line,
    push: (array,value) => array.push(value),
    continueLine: state => {state.first=false;},
    setLine: (state,line) => {state.line=line;},
    rows: options => options.rows.map(row => ({
      left: plain ? invoke("ascii",[row.left]) : row.left.replaceAll("\r\n"," ").replaceAll("\n"," ").replaceAll("\r"," "),
      right: plain ? invoke("ascii",[row.right]) : row.right
    })),
    config: options => ({
      totalWidth:options.totalWidth ?? process.stdout.columns ?? 100,
      minLeftWidth:options.minLeftWidth ?? 12,maxLeftWidth:options.maxLeftWidth ?? 32,
      gap:options.gap ?? 3,indent:options.indent ?? 2
    }),
    validLayout: value => Number.isFinite(value) && value >= 0,
    invalidTotalWidth() {throw new Error("totalWidth must be a finite non-negative number.");},
    invalidMinLeftWidth() {throw new Error("minLeftWidth must be a finite non-negative number.");},
    invalidMaxLeftWidth() {throw new Error("maxLeftWidth must be a finite non-negative number.");},
    invalidGap() {throw new Error("gap must be a finite non-negative number.");},
    invalidIndent() {throw new Error("indent must be a finite non-negative number.");},
    maxLeft: rows => Math.max(...rows.map(row=>invoke("width",[row.left]))),
    clamp: (value,min,max) => Math.min(Math.max(value,min),max),
    spaces: width => " ".repeat(width), hang: (indent,width) => " ".repeat(indent + width + 2),
    renderRows: (rows,...args) => rows.flatMap(row=>invoke("row",[row,...args])).join("\n"),
    leftLines: (lines,first,hang) => lines.map((line,index)=>index === 0 ? `${first}${line}` : `${hang}${line}`),
    inlineLines(left,width,right,first,continuation) {
      const value=left[0] ?? "";
      const padded=value + " ".repeat(Math.max(0,width - invoke("width",[value])));
      const firstLine=`${first}${padded}${right[0]}`;
      const rest=right.slice(1).map(line=>`${continuation}${line}`);
      return [firstLine,...rest];
    },
    stackLines(left,right,first,hang,continuation) {
      const renderedLeft=left.map((line,index)=>index === 0 ? `${first}${line}` : `${hang}${line}`);
      const renderedRight=right.map(line=>`${continuation}${line}`);
      return [...renderedLeft,...renderedRight];
    },
    commandToken: token => text.command(token.text),
    optionToken: token => text.option(token.text),
    argumentToken(token) {const content=token.text;return invoke("argument",[content,resolveOutputFormat()]);},
    dimToken(token) {const content=token.text;return invoke("dim",[content,resolveOutputFormat()]);},
    literalToken: token => token.text,
    angleStart: content => content.startsWith("<"), angleEnd: content => content.endsWith(">"),
    argumentInterior: content => text.argument(content.slice(1,-1)),
    argument: content => text.argument(content), dim: content => typography.dim(content),
    depthPrefix: command => " ".repeat((command.depth ?? 0) * 2),
    template: value => `${value}`,
    commandTokens: command => plain ? joinHelpTokens(command.nameTokens) : renderHelpTokens(command.nameTokens),
    commandName: command => plain ? command.name : text.command(command.name),
    commandRow: (command,prefix,name) => ({left:`${prefix}${name}`,right:command.description}),
    optionTokens: option => plain ? joinHelpTokens(option.flagTokens) : renderHelpTokens(option.flagTokens),
    optionFlags: option => plain ? option.flags : text.option(option.flags),
    optionRow: (option,left) => ({left,right:option.description}),
    usageArgs: args => ` ${text.argument(args)}`,
    usage: (command,suffix) => `${text.usageCommand(command)}${suffix}`,
    invalidOperation() {throw new TypeError("Invalid help operation");}
  };
  const host={get:protect((value,key)=>value[key]),operate:protect((name,args)=>operations[name](...args))};
  function formatColumns(options) {return invoke("columns",[options]);}
  function styleHelpToken(token) {return invoke("token",[token]);}
  function joinHelpTokens(tokens) {return tokens.map(token=>token.text).join("");}
  function renderHelpTokens(tokens) {return tokens.map(token=>styleHelpToken(token)).join("");}
  function formatCommand(name,description) {return formatColumns({rows:[{left:text.command(name),right:description}]});}
  function formatOption(flags,description) {return formatColumns({rows:[{left:text.option(flags),right:description}]});}
  function formatUsage(command,args) {return invoke("usage",[command,args]);}
  function formatCommandList(commands) {return formatColumns({rows:commands.map(command=>invoke("commandRow",[command]))});}
  function formatOptionList(options) {return formatColumns({rows:options.map(option=>invoke("optionRow",[option]))});}
  function stripAnsi(value) {return invoke("strip",[value]);}
  return {formatColumns,formatCommand,formatUsage,formatOption,formatCommandList,formatOptionList,styleHelpToken,joinHelpTokens,renderHelpTokens,stripAnsi};
}
