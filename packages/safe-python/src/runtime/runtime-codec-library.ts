import {codecLibrarySources} from './runtime-codec-library-source.js';
import {codecFamilySources} from './runtime-codec-family-source.js';
import {singleByteLibrarySources} from './runtime-single-byte-library-source.js';
import {rot13UndefinedSources} from './runtime-rot13-undefined-source.js';
import {platformCodecSources} from './runtime-platform-codec-source.js';
import {punycodeLibrarySources} from './runtime-punycode-library-source.js';
import {analyzeModule} from '../analysis.js';
import {RuntimeFrozenProgram} from './runtime-frozen-program.js';
import {executeModule} from './module-execution.js';
import {createRuntimeFrameBody,type RuntimeProgramContext} from './runtime-program.js';
import {RuntimeDictionaryNamespace} from './runtime-dictionary-namespace.js';
import {OrderedKeyMap} from './ordered-key-map.js';
import type {RuntimeCodePrograms} from './runtime-code-programs.js';
import type {ExecutionMeter} from './execution-budget.js';
import type {RuntimeValue,TypeValue} from './runtime-values.js';

// Observable source metadata of the pinned reference build. This is a guest
// filename only: the loader never opens it or grants access to that host path.
const referenceLibrary='/opt/homebrew/Cellar/python@3.14/3.14.7/Frameworks/Python.framework/Versions/3.14/lib/python3.14';

// Immutable, interpreter-owned definitions are compiled at module initialization.
// No guest source enters this map. Constant recipes and immutable syntax are
// shared; guest values, code records, namespaces and execution are session-local
// and charged independently of import order in other sessions.
const libraryDefinitions=new Map([...codecLibrarySources,...codecFamilySources,...singleByteLibrarySources,...rot13UndefinedSources,...platformCodecSources,...punycodeLibrarySources].map(([name,source])=>{
  const filename=`${referenceLibrary}/${name.replaceAll('.','/')}${name==='encodings'?'/__init__':''}.py`;
  const codeFilename=name==='codecs'?'<frozen codecs>':filename;
  return [name,{filename,codeFilename,program:new RuntimeFrozenProgram(analyzeModule(source,{filename:codeFilename}),codeFilename)}] as const;
}));

/** Session-local, lazy execution of interpreter-owned library sources. Neither
 * module names nor guest stream objects grant access to host modules or files. */
export class RuntimeCodecLibrary {
  constructor(
    private readonly modules:Map<string,RuntimeValue>,
    private readonly context:RuntimeProgramContext,
    private readonly programs:RuntimeCodePrograms,
    private readonly moduleType:TypeValue,
    private readonly meter:ExecutionMeter
  ) {}

  load(name:string):RuntimeValue|undefined {
    const existing=this.modules.get(name);
    if(existing!==undefined)return existing;
    const definition=libraryDefinitions.get(name);
    if(definition===undefined)return undefined;
    const {values,keys,calls,builtins}=this.context;
    const separator=name.lastIndexOf('.');
    const parentName=separator<0?'':name.slice(0,separator);
    if(parentName)this.load(parentName);
    const dictionary=values.dictionary(new OrderedKeyMap<RuntimeValue,RuntimeValue>(keys,this.meter));
    const namespace=new RuntimeDictionaryNamespace(dictionary,values,this.meter);
    const module=values.instance(this.moduleType,dictionary);
    namespace.store('__name__',values.string(name));
    namespace.store('__package__',values.string(name==='encodings'?name:parentName));
    namespace.store('__builtins__',builtins.object!);
    namespace.store('__doc__',values.none);
    if(name==='codecs'){
      // Native aliases follow the pinned Darwin arm64 reference, independently
      // of host endianness. Each alias shares the same guest bytes object.
      for(const [names,bytes] of [
        [['BOM_UTF8'],[0xef,0xbb,0xbf]],
        [['BOM_LE','BOM_UTF16_LE','BOM','BOM_UTF16','BOM32_LE'],[0xff,0xfe]],
        [['BOM_BE','BOM_UTF16_BE','BOM32_BE'],[0xfe,0xff]],
        [['BOM_UTF32_LE','BOM_UTF32','BOM64_LE'],[0xff,0xfe,0,0]],
        [['BOM_UTF32_BE','BOM64_BE'],[0,0,0xfe,0xff]]
      ] as const){
        const value=values.bytes(Uint8Array.from(bytes));
        for(const alias of names)namespace.store(alias,value);
      }
    }
    const {filename}=definition;
    namespace.store('__file__',values.string(filename));
    if(definition.codeFilename===filename){
      const slash=filename.lastIndexOf('/');
      // Import metadata describes the pinned guest library; it grants no
      // filesystem access and does not write or read a host bytecode cache.
      namespace.store('__cached__',values.string(`${filename.slice(0,slash)}/__pycache__/${filename.slice(slash+1,-3)}.cpython-314.pyc`));
    }
    if(name==='encodings')namespace.store('__path__',values.list([values.string(`${referenceLibrary}/encodings`)]));
    this.modules.set(name,module);
    try {
      const program=definition.program.instantiate(values,this.meter);
      this.programs.register(program);
      const namespaces={globals:namespace,locals:namespace,builtins};
      const body=createRuntimeFrameBody(program,this.context,this.meter);
      executeModule(program.module,{...namespaces,calls,body:frame=>body(frame,namespaces)},this.meter);
      if(name==='codecs')this.load('encodings');
      return module;
    } catch(error) {
      this.modules.delete(name);
      throw error;
    }
  }
}
