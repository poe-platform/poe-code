import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseAnsi} from '../dist/index.js';
import {parseAnsi as oracle} from '../../terminal-png/dist/index.js';
test('native ANSI parsing matches SDK control and Unicode cases',()=>{
 const controls=['\x1b[1m','\x1b[22m','\x1b[31m','\x1b[38;5;256m','\x1b[48:2::12:34:56m','\x1b[2K','\x1b[1J','\x1b[2J','\x1b[3G','\x1b[H','\x1b[s','\x1b[u','\x1b7','\x1b8','\r','\b','\n','\v','\t','\x1b]8;;URL\x07'];
 let state=1729;function pick(n){state=(Math.imul(state,1664525)+1013904223)>>>0;return state%n;}
 for(let run=0;run<1024;run++){let input='';for(let n=0;n<16;n++){input+=['hello','测','Ａ','🙂','e\u0301','\ud800',' '][pick(7)]+controls[pick(controls.length)];}assert.deepEqual(parseAnsi(input),oracle(input));}
});
test('native SVG matches SDK layout across styles, colors, Unicode and tabs',async()=>{
 const own=await import('../dist/index.js'),sdk=await import('../../terminal-png/dist/index.js');
 for(const input of ['hello','测│','👩‍💻│','🇺🇸│','e\u0301x','\u0301','A\tB','\x1b[1;3;4;9;31;48;5;42m<&>\x1b[0m','\x1b[7mselected\x1b[8mhidden','row\n\nnext'])for(const options of [{},{window:false},{padding:0,window:false},{padding:7}])assert.equal(own.renderSvg(own.parseAnsi(input),options),sdk.renderSvg(sdk.parseAnsi(input),options));
 for(let index=0;index<256;index++)assert.equal(own.renderSvg(own.parseAnsi(`\x1b[38;5;${index}mcolor`),{}),sdk.renderSvg(sdk.parseAnsi(`\x1b[38;5;${index}mcolor`),{}));
});
test('std-only Deflate and PNG round-trip through Node zlib',async()=>{
 const {createRequire}=await import('node:module'),{inflateSync,crc32}=await import('node:zlib'),native=createRequire(import.meta.url)('../dist/terminal-png-rust.node');
 const inputs=[Buffer.alloc(0),Buffer.alloc(65536,42),Buffer.from(Array.from({length:65536},(_,i)=>i%256))];let state=77;inputs.push(Buffer.from(Array.from({length:32769},()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state>>>24;})));
 for(const input of inputs)assert.deepEqual(inflateSync(native.terminalDeflate(input)),input);
 const rgba=Buffer.from([255,0,0,255,0,255,0,255]),png=native.terminalEncodePng(2,1,rgba);let at=8,data=[];
 while(at<png.length){const length=png.readUInt32BE(at),tag=png.toString('ascii',at+4,at+8);assert.equal(png.readUInt32BE(at+8+length),crc32(png.subarray(at+4,at+8+length)));if(tag==='IDAT')data.push(png.subarray(at+8,at+8+length));at+=12+length;}
 assert.deepEqual(inflateSync(Buffer.concat(data)),Buffer.concat([Buffer.from([0]),rgba]));
});
test('portable graphemes match Intl for Indic, emoji and UTF16 cases',async()=>{
 const {createRequire}=await import('node:module'),native=createRequire(import.meta.url)('../dist/terminal-png-rust.node'),segmenter=new Intl.Segmenter('en',{granularity:'grapheme'});
 const parts=['A','e','\u0301','\r','\n','\u200d','👩','💻','🇺','🇸','क','्','क','\u093e','\ud800','\udfff','\u0600','\u1100','\u1161','\u11a8'];let state=11;
 for(let n=0;n<4096;n++){let input='';for(let i=0;i<12;i++){state=(Math.imul(state,1664525)+1013904223)>>>0;input+=parts[state%parts.length];}assert.deepEqual(native.terminalGraphemes(input),Array.from(segmenter.segment(input),value=>value.segment));}
});
test('native raster preserves SDK dimensions and font pixels without resvg at runtime',async()=>{
 const own=await import('../dist/index.js'),sdk=await import('../../terminal-png/dist/index.js'),{Resvg}=await import('@resvg/resvg-js'),{createRequire}=await import('node:module'),native=createRequire(import.meta.url)('../dist/terminal-png-rust.node');
 for(const input of ['Hello │ é','\x1b[1mBold\x1b[3m italic\x1b[4m underline','\x1b[31;48;5;42mERROR\x1b[0m\nnext row']){
  const svg=own.renderSvg(own.parseAnsi(input)),reference=sdk.renderPng(svg),png=own.renderPng(svg);assert.equal(png.readUInt32BE(16),reference.readUInt32BE(16));assert.equal(png.readUInt32BE(20),reference.readUInt32BE(20));
  const baseline=new Resvg(svg,{font:{defaultFontFamily:'JetBrains Mono',fontFiles:[...sdk.JETBRAINS_MONO_FONT_FILES],loadSystemFonts:false,monospaceFamily:'JetBrains Mono'},fitTo:{mode:'zoom',value:4}}).render(),rgba=native.terminalRasterRgba(svg);
  const pixels=baseline.pixels;assert.equal(rgba.length,pixels.length);let error=0;for(let i=0;i<rgba.length;i++)error+=Math.abs(rgba[i]-pixels[i]);assert.ok(error/rgba.length<3,`mean channel difference ${error/rgba.length}`);
 }
});

test('raster optimization preserves clipped, translucent and offscreen shapes',async()=>{
 const {createRequire}=await import('node:module'),{createHash}=await import('node:crypto'),native=createRequire(import.meta.url)('../dist/terminal-png-rust.node');
 const cases=[
 ["<svg width='8' height='8'><rect x='-2' y='-1' width='4.4' height='3.9' fill='#123456'/><circle cx='6' cy='6' r='1.7' fill='#abcdef80'/></svg>",'0e9ea45639b5c3ba6e58afae7eed2bd03d40fe33c286be69d4860c5faedc37bb'],
 ["<svg width='8' height='8'><polygon points='-2,2 4,0 10,7 1,4' fill='#ff0000' opacity='.4'/><rect x='2.03' y='1.4' width='3.3' height='2.7' fill='#00ff0080'/></svg>",'682557d36fb2ff93385dcee663ee4a2fc6e6d17649b0648d6326eb3cf2bdafcb'],
 ["<svg width='8' height='8'><rect x='20' y='20' width='3' height='3'/><rect x='-4' y='0' width='1' height='2'/></svg>",'ad7facb2586fc6e966c004d7d1d16b024f5805ff7cb47c7a85dabd8b48892ca7']
 ];for(const[svg,hash]of cases)assert.equal(createHash('sha256').update(native.terminalRasterRgba(svg)).digest('hex'),hash);
});
