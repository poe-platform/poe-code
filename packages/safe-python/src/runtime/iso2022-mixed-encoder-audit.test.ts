import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import reference from './__snapshots__/codec-mixed-encoder-oracle.json';
import {iso2022JpCodec} from './iso2022-jp-codec.js';
import {iso2022Jp1Codec} from './iso2022-jp-1-codec.js';
import {iso2022Jp2Codec} from './iso2022-jp-2-codec.js';
import {iso2022Jp3Codec,iso2022Jp2004Codec} from './iso2022-jis-revision-codec.js';
import {iso2022JpExtCodec} from './iso2022-jp-ext-codec.js';
import {iso2022KrCodec} from './iso2022-kr-codec.js';
import {DoubleByteIncrementalEncoder} from './double-byte-incremental-encoder.js';
import {CodePointString} from './code-point-string.js';
import {ExecutionBudget} from './execution-budget.js';
import {PythonEncodeError} from './encode-error.js';

const codecs=[iso2022JpCodec,iso2022Jp1Codec,iso2022Jp2Codec,iso2022Jp3Codec,iso2022Jp2004Codec,iso2022JpExtCodec,iso2022KrCodec];

it.each(reference.cases)('preserves mixed encoder transitions: $name $input',row=>{
  expect(reference.reference.version.startsWith('3.14.7 ')).toBe(true);
  expect(reference.reference.unicode).toBe('16.0.0');
  const codec=codecs.find(candidate=>candidate.name===row.name)!;
  const hash=createHash('sha256');
  for(const errors of ['strict','replace','ignore'] as const){
    for(let split=0;split<=row.input.length;split++){
      const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});
      const encoder=new DoubleByteIncrementalEncoder(codec,errors);
      const steps:unknown[]=[];
      const parts=[row.input.slice(0,split),row.input.slice(split),[],[0x304b],[0x309a],[65]];
      for(const [index,part] of parts.entries()){
        let result:unknown;
        try{result=['ok',[...encoder.encode(new CodePointString(Uint32Array.from(part),meter),index===2||index>=4,meter)]];}
        catch(error){
          if(error instanceof PythonEncodeError)result=['error',error.name,[...error.object],error.start,error.end,error.reason];
          else throw error;
        }
        steps.push([result,String(encoder.getstate(meter))]);
      }
      encoder.reset(meter);
      steps.push(String(encoder.getstate(meter)));
      hash.update(JSON.stringify(steps)+'\n');
    }
  }
  expect(hash.digest('hex')).toBe(row.digest);
});
