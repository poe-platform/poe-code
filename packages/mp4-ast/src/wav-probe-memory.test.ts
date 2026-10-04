import assert from 'node:assert/strict';
import {it} from 'node:test';
import {parseWav,wavAst} from './index.js';

function fixture() {
 const bytes=new Uint8Array(44+65536),view=new DataView(bytes.buffer),encoder=new TextEncoder();
 for(const [offset,text] of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']] as const)bytes.set(encoder.encode(text),offset);
 view.setUint32(4,bytes.length-8,true);view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,2,true);
 view.setUint32(24,8000,true);view.setUint32(28,32000,true);view.setUint16(32,4,true);view.setUint16(34,16,true);view.setUint32(40,bytes.length-44,true);
 view.setInt16(44,16384,true);view.setInt16(46,-16384,true);return bytes;
}

it('probes WAV streams, packets and frames without decoding PCM channels',()=>{
 const bytes=fixture(),plugin=wavAst();
 const expected=plugin.probe(bytes,{showPackets:true,showFrames:true});
 const FloatArray=globalThis.Float32Array;
 globalThis.Float32Array=new Proxy(FloatArray,{construct(){assert.fail('WAV probing must not decode PCM channel arrays');}});
 try {assert.deepEqual(plugin.probe(bytes,{showPackets:true,showFrames:true}),expected);}
 finally {globalThis.Float32Array=FloatArray;}
});

it('honors decodeAudio=false while retaining WAV sample bytes and default decoding',()=>{
 const bytes=fixture(),full=parseWav(bytes);
 assert.equal(full.tracks[0]!.decodedAudio!.channelData[0]![0],0.5);
 assert.equal(full.tracks[0]!.decodedAudio!.channelData[1]![0],-0.5);
 const parsed=wavAst().parse(bytes,{decodeAudio:false});
 assert.equal(parsed.tracks[0]!.decodedAudio,undefined);
 const {decodedAudio,...track}=full.tracks[0]!;
 assert.ok(decodedAudio);
 assert.deepEqual(parsed,{...full,tracks:[track]});
 assert.equal(parsed.tracks[0]!.samples[0]!.data.buffer,bytes.buffer);
});
