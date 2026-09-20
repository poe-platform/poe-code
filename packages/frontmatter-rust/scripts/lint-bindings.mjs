import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url),manifest=fileURLToPath(new URL('bindings/shared/Cargo.toml',root));
for(const args of [['fmt','--manifest-path',manifest,'--','--check'],['clippy','--locked','--manifest-path',manifest,'--all-targets','--','-D','warnings']]){
 const result=spawnSync('cargo',args,{env:{...process.env,CARGO_TARGET_DIR:fileURLToPath(new URL('../../out/rust-mcp-target',root))},stdio:'inherit'});
 if(result.error)throw result.error;if(result.status!==0)process.exit(result.status??1);
}
