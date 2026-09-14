import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import reference from './__snapshots__/iso2022-escape-audit-oracle.json';
import {iso2022JpCodec} from './iso2022-jp-codec.js';
import {iso2022Jp1Codec} from './iso2022-jp-1-codec.js';
import {iso2022Jp2Codec} from './iso2022-jp-2-codec.js';
import {iso2022Jp3Codec,iso2022Jp2004Codec} from './iso2022-jis-revision-codec.js';
import {iso2022JpExtCodec} from './iso2022-jp-ext-codec.js';
import {iso2022KrCodec} from './iso2022-kr-codec.js';
import {DoubleByteIncrementalDecoder} from './double-byte-incremental-decoder.js';
import {ExecutionBudget} from './execution-budget.js';
import {PythonDecodeError} from './decode-error.js';
import {PythonRuntimeError} from './error.js';

const codecs=[iso2022JpCodec,iso2022Jp1Codec,iso2022Jp2Codec,iso2022Jp3Codec,iso2022Jp2004Codec,iso2022JpExtCodec,iso2022KrCodec];

it.each(reference.cases)('preserves escape boundaries and recovery: $name $input',row=>{
  expect(reference.reference.version.startsWith('3.14.7 ')).toBe(true);
  expect(reference.reference.unicode).toBe('16.0.0');
  const codec=codecs.find(candidate=>candidate.name===row.name)!;
  const hash=createHash('sha256');
  for(const errors of ['strict','replace','ignore'] as const){
    for(let split=0;split<=row.input.length;split++){
      const meter=new ExecutionBudget({maxSteps:100000,maxAllocatedBytes:1000000});
      const decoder=new DoubleByteIncrementalDecoder(codec,errors);
      const steps:unknown[]=[];
      const parts=[row.input.slice(0,split),row.input.slice(split),[],[65]];
      for(const [index,part] of parts.entries()){
        let result:unknown;
        try{result=['ok',[...decoder.decode(Uint8Array.from(part),index>=2,meter)]];}
        catch(error){
          if(error instanceof PythonDecodeError)result=['error',error.name,[...error.object],error.start,error.end,error.reason];
          else if(error instanceof PythonRuntimeError)result=['error',error.name,error.message];
          else throw error;
        }
        const state=decoder.getstate(meter);
        steps.push([result,[[...state[0]],String(state[1])]]);
      }
      decoder.reset(meter);
      const state=decoder.getstate(meter);
      steps.push([[...state[0]],String(state[1])]);
      hash.update(JSON.stringify(steps)+'\n');
    }
  }
  expect(hash.digest('hex')).toBe(row.digest);
});
