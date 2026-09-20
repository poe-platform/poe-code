import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';
const referenceRoot=fileURLToPath(new URL('../user-error/src/',import.meta.url));
const native=fileURLToPath(new URL('./dist/index.js',import.meta.url));
export default defineConfig({
 root:fileURLToPath(new URL('../../',import.meta.url)),
 plugins:[{name:'rust-user-error-contracts',enforce:'pre',resolveId(source,importer){if(importer?.startsWith(referenceRoot)&&source==='./index.js')return native;},transform(code,id){
  if(id.startsWith(referenceRoot)&&id.endsWith('.test.ts'))return {code:code+`\nimport {UserError as nativeContract} from ${JSON.stringify(native)};\nif(UserError!==nativeContract)throw new Error('Error contracts must execute own native adapter');`,map:null};
 }}],
 test:{include:['packages/user-error/src/index.test.ts'],cache:false,testTimeout:2000}
});
