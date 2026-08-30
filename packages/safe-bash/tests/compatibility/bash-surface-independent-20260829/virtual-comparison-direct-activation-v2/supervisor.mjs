import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {PROFILE} from './profile/profile.mjs';
import {runDirect} from './profile/direct-child.mjs';
import {launchProductCase} from './profile/case-launch.mjs';
import {readPinned,errorRecord} from './profile/auth.mjs';
import {installSources,installTools,installTypes,admittedPackage,extractValidatedTar,verifyMembers,writeExclusive} from './profile/setup.mjs';
import {validateMatrix} from './profile/data.mjs';
import {preflight,census,checkShipping,retainFile,hash} from './packet-io.mjs';
import {finalize} from './finalization.mjs';
const helperNames=['auth.mjs','profile.mjs','guard.mjs','case-driver.mjs','case-adapter.mjs','data.mjs'];
export async function run({packet,seal,grant,work,started,ownerLog}){
  const finalDeadline=Math.min(started+1800000,grant.notAfterEpochMs),bodyDeadline=finalDeadline-120000;
  const ledger={starts:0,maximum:115,active:0,rows:[],stopped:false,captureBytes:0,captureMaximum:134086656};
  const records=[],layouts=[],commands=[],secondary=[];let primaryPresent=false,primary;
  const check=()=>{if(Date.now()>=bodyDeadline)throw Error('BODY_DEADLINE');census(work,536870912);};
  const write=(name,value,terminal=false)=>{if(!terminal)check();return retainFile(path.join(work,'capture',name),Buffer.from(JSON.stringify(value,null,2)+'\n'),terminal?finalDeadline:bodyDeadline);};
  const freshEnv=()=>({HOME:path.join(work,'home'),TMPDIR:path.join(work,'tmp'),PATH:path.join(work,'empty-path'),LC_ALL:'C',LANG:'C',TZ:'UTC'});
  let setupElapsed=0,typeElapsed=0;
  try{
    const tools=preflight(packet,seal);
    const commandPlan=JSON.parse(readPinned(path.join(packet,'COMMAND-PLAN.json'),seal.files['COMMAND-PLAN.json']));
    const matrix=JSON.parse(readPinned(path.join(packet,'profile/MATRIX.json'),seal.files['profile/MATRIX.json']));validateMatrix(matrix);
    const members=JSON.parse(readPinned(path.join(packet,'profile/PACKAGE-MEMBERS.json'),seal.files['profile/PACKAGE-MEMBERS.json']));
    const inputs=JSON.parse(readPinned(path.join(packet,'profile/SOURCE-MEMBERS.json'),seal.files['profile/SOURCE-MEMBERS.json']));
    const staticEdges=JSON.parse(readPinned(path.join(packet,'profile/STATIC-EDGES.json'),seal.files['profile/STATIC-EDGES.json'])).edges;
    if(matrix.cases.length!==37||matrix.fixtures.length!==4||members.length!==954||inputs.length!==293||inputs.some(row=>row.path.startsWith('dist/')))throw Error('MATRIX_MEMBERSHIP');
    const compatibilitySeal={...seal,files:{...seal.files,'SOURCE-MEMBERS.json':seal.files['profile/SOURCE-MEMBERS.json']}};
    writeExclusive(path.join(work,'SOURCE-MEMBERS.json'),readPinned(path.join(packet,'profile/SOURCE-MEMBERS.json'),seal.files['profile/SOURCE-MEMBERS.json']));
    const sourcePacket=path.join(work,'source-packet');fs.mkdirSync(sourcePacket,{mode:448});
    for(const [destination,source]of [['SOURCE-MEMBERS.json','profile/SOURCE-MEMBERS.json'],['SOURCE-CAPSULE.json.gz.base64','SOURCE-CAPSULE.json.gz.base64']])writeExclusive(path.join(sourcePacket,destination),readPinned(path.join(packet,source),seal.files[source]));
    const sourceApp=path.join(work,'source-app'),installedApp=path.join(work,'installed-app'),movedApp=path.join(work,'moved-app');
    const setupStart=Date.now();
    installSources(sourcePacket,work,compatibilitySeal);installTools(tools,work);installTypes(tools,work,sourceApp);
    if(fs.existsSync(path.join(sourceApp,'dist')))throw Error('PREBUILT_SOURCE_DIST_REFUSED');
    for(const input of inputs)readPinned(path.join(sourceApp,input.path),input);
    check();
    const buildArgs=[path.join(work,'tools/typescript/bin/tsc'),'-p',path.join(sourceApp,'tsconfig.build.json')];
    commands.push({role:'build',executable:tools.node.path,args:buildArgs,cwd:sourceApp,authority:'trusted administration; no case permission claim'});
    const remainingBuild=180000-(Date.now()-setupStart);if(remainingBuild<=0)throw Error('SETUP_AGGREGATE_DEADLINE');
    const build=await runDirect({id:'build',node:tools.node,args:buildArgs,cwd:sourceApp,env:freshEnv(),capture:path.join(work,'capture/build'),timeoutMs:remainingBuild,bodyDeadline,finalDeadline},ledger);
    if(!build.row.qualified||build.row.status!==0)throw Error('BUILD_UNQUALIFIED');
    checkShipping(sourceApp,members);verifyMembers(path.join(sourceApp,'dist'),members.filter(row=>row.path.startsWith('dist/')).map(row=>({...row,path:row.path.slice(5)})));
    const archive=await admittedPackage(seal.archive.path,seal.archive,members);
    write('ARCHIVE-ADMISSION.json',{receipt:archive.receipt,ledger:archive.ledger,events:archive.events});
    extractValidatedTar(archive.buffer,path.join(installedApp,'node_modules/virtual-bash'));archive.buffer=undefined;
    verifyMembers(path.join(installedApp,'node_modules/virtual-bash'),members);checkShipping(path.join(installedApp,'node_modules/virtual-bash'),members);installTypes(tools,work,installedApp);
    setupElapsed=Date.now()-setupStart;if(setupElapsed>=180000)throw Error('SETUP_AGGREGATE_DEADLINE');
    for(const layout of ['source-built','installed','physically-moved']){
      check();
      const app=layout==='source-built'?sourceApp:layout==='installed'?installedApp:movedApp;
      if(layout==='physically-moved'){fs.renameSync(installedApp,movedApp);if(fs.existsSync(installedApp))throw Error('OLD_INSTALLED_PARENT_PRESENT');}
      const packageRoot=layout==='source-built'?sourceApp:path.join(app,'node_modules/virtual-bash');
      checkShipping(packageRoot,members);if(layout!=='source-built')verifyMembers(packageRoot,members);
      if(layout!=='physically-moved')for(const name of helperNames)writeExclusive(path.join(app,name),readPinned(path.join(packet,'profile',name),seal.files['profile/'+name]));
      const consumer=Buffer.from('import {Shell,MemoryFileSystem,agentCommands,type ShellResult} from '+JSON.stringify(layout==='source-built'?'./dist/index.js':'virtual-bash')+';\nconst fs=new MemoryFileSystem();const shell=new Shell({fs,env:{LC_ALL:"C"}}).use(agentCommands());const value:Promise<ShellResult>=shell.exec("",{stdin:new Uint8Array(),signal:new AbortController().signal});void value;void shell.dispose;\n');
      if(layout!=='physically-moved')writeExclusive(path.join(app,'consumer.mts'),consumer);
      const typeArgs=[path.join(work,'tools/typescript/bin/tsc'),'--noEmit','--strict','--exactOptionalPropertyTypes','--target','ES2023','--module','NodeNext','--moduleResolution','NodeNext','--types','node',path.join(app,'consumer.mts')];
      const typeRemaining=180000-typeElapsed;if(typeRemaining<=0)throw Error('TYPECHECK_AGGREGATE_DEADLINE');
      commands.push({role:'type-'+layout,executable:tools.node.path,args:typeArgs,cwd:app,authority:'trusted administration; source consumer is typechecked, not evaluated'});
      const typeStart=Date.now();const typed=await runDirect({id:'type-'+layout,node:tools.node,args:typeArgs,cwd:app,env:freshEnv(),capture:path.join(work,'capture/type-'+layout),timeoutMs:typeRemaining,bodyDeadline,finalDeadline},ledger);typeElapsed+=Date.now()-typeStart;
      if(typeElapsed>=180000||!typed.row.qualified||typed.row.status!==0)throw Error('TYPECHECK_UNQUALIFIED');
      const files={},edges={};for(const pin of members.filter(row=>row.path.endsWith('.js'))){files[path.join(packageRoot,pin.path)]=pin;edges[path.join(packageRoot,pin.path)]=staticEdges[pin.path]??[];}
      for(const name of helperNames)files[path.join(app,name)]=seal.files['profile/'+name];
      const productEntry=path.join(packageRoot,'dist/index.js');
      edges[path.join(app,'case-driver.mjs')]=['node:fs','node:url','./profile.mjs','./case-adapter.mjs','./data.mjs','virtual-bash',pathToFileURL(productEntry).href];
      edges[path.join(app,'case-adapter.mjs')]=['node:crypto','node:path'];edges[path.join(app,'data.mjs')]=['node:crypto'];
      edges[path.join(app,'profile.mjs')]=['node:path'];edges[path.join(app,'auth.mjs')]=['node:fs','node:crypto'];
      layouts.push({layout,app,packageRoot,entry:path.join(app,'case-driver.mjs'),sourceBuilt:layout==='source-built',shippingMembers:954,installedParentAbsent:layout==='physically-moved'?!fs.existsSync(installedApp):undefined});
      for(const row of matrix.cases){
        check();const id=layout+'-'+row.id,rolePath=path.join(work,'capture',id+'.role.json'),trace=path.join(work,'capture',id+'.trace');writeExclusive(trace,Buffer.alloc(0));
        const role={profile:PROFILE,kind:'product-case',id,caseId:row.id,layout,app,entry:path.join(app,'case-driver.mjs'),guard:path.join(app,'guard.mjs'),rolePath,trace,readFiles:[rolePath,trace,path.join(packet,'profile/MATRIX.json')],files,edges,builtins:seal.builtins,childProcessPermission:0,workerPermission:0,loaderThreads:0,loaderMode:'synchronous-registerHooks',nodePath:tools.node.path,matrix:path.join(packet,'profile/MATRIX.json'),productEntry};
        const roleBytes=Buffer.from(JSON.stringify(role)+'\n');writeExclusive(rolePath,roleBytes);
        const rolePin={bytes:roleBytes.length,sha256:hash(roleBytes)};
        const expectedRole=commandPlan.layouts.find(value=>value.layout===layout)?.cases.find(value=>value.id===id);
        if(!expectedRole||expectedRole.roleBytes!==rolePin.bytes||expectedRole.roleSha256!==rolePin.sha256)throw Error('PRESEALED_ROLE_IDENTITY');
        const before=ledger.starts;
        let observation,invocationFailed=false,invocationReason;
        try{observation=await launchProductCase({id,node:tools.node,role,rolePin,rootGrant:grant,closurePath:path.join(packet,'CANDIDATE-CLOSURE.json'),closurePin:seal.files['CANDIDATE-CLOSURE.json'],home:path.join(work,'home'),tmp:path.join(work,'tmp'),emptyPath:path.join(work,'empty-path'),capture:path.join(work,'capture',id),bodyDeadline,finalDeadline},ledger);}
        catch(reason){invocationFailed=true;invocationReason=reason;}
        try{write(id+'.lifecycle.json',{id,admitted:ledger.starts>before,rows:ledger.rows.slice(before),groupAbsence:'NOT_CLAIMED'},true);}catch(reason){if(invocationFailed)secondary.push(errorRecord(reason));else throw reason;}
        if(invocationFailed)throw invocationReason;
        const traceRows=Buffer.from(observation.loadTrace.base64,'base64').toString().trim().split('\n').map(line=>JSON.parse(line));
        if(!traceRows.some(event=>event.event==='module-loaded'&&event.url===pathToFileURL(productEntry).href&&event.sha256===files[productEntry].sha256))throw Error('PRODUCT_ENTRY_NOT_WITNESSED');
        const result={id,layout,caseId:row.id,...observation};records.push(result);write(id+'.json',result);
      }
    }
  }catch(reason){primaryPresent=true;primary=reason;ledger.stopped=true;try{ownerLog({event:'STOP',reason:errorRecord(reason)});}catch(error){secondary.push(errorRecord(error));}}
  const resultFor=state=>({schema:'direct-functional-111-observations-v1',profile:PROFILE,candidate:seal.candidate,archiveSha256:seal.archive.sha256,completed:records.length,planned:111,unrun:111-records.length,primaryPresent:state.primaryPresent,primary:state.primaryPresent?errorRecord(state.primary):undefined,layouts,commands,ledger,setupAggregateMs:setupElapsed,typecheckAggregateMs:typeElapsed,customLoaderThreads:0,productWorkersPermitted:0,caseSubprocessPermission:0,qualification:'Qualified public observations are not compatibility passes. Direct process/cooperative public cleanup only; no group absence/universal census/OS containment/RSS guarantee.',sampledWorkPresent:state.sampledWorkPresent,sampledWork:state.sampledWork,secondary,finalizationSecondaryPresent:state.secondaryPresent,finalizationSecondary:state.secondary.map(entry=>({phase:entry.phase,present:entry.present,reason:errorRecord(entry.reason)}))});
  const state=finalize({primaryPresent,primary,census:()=>census(work,536870912),publish:state=>write('TERMINAL.json',resultFor(state),true)});
  const result=resultFor(state);result.terminalPublicationFailed=!state.publicationSucceeded;
  return result;
}
