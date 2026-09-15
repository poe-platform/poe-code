import { run, makeFsModule } from "@poe-platform/safe-js/workerd";
import { createMemoryFileSystem } from "@poe-platform/safe-fs/fs/memory";
export default { async fetch() {
  const denial = await run('return [typeof process,typeof require,typeof fetch,typeof fs,typeof document,typeof Promise];');
  const direct = await run('return process;');
  let importDenied = false;
  try { await run('import {readFile} from "node:fs"; return readFile;'); } catch { importDenied = true; }
  const helper = await run('import {read} from "store"; return [read(),typeof fetch,typeof process];', {modules:{store:{read:()=>"grant"}}});
  const adapter = createMemoryFileSystem();
  await adapter.mkdir('/grant');
  const fs = makeFsModule({adapter,root:'/grant'});
  const filesystem = await run('import {writeFile,readFile} from "fs"; await writeFile("input","grant"); let denied; try {await readFile("/outside","utf8")} catch(e) {denied=e.code} return [await readFile("input","utf8"),denied,typeof process,typeof fetch];', {modules:{fs}});
  return Response.json({denial:denial.returnValue,directDenied:!direct.ok,importDenied,helper:helper.returnValue,filesystem:filesystem.returnValue});
}};
