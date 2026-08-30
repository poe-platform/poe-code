import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
const [manifestFile,suite,cases,selection='all'] = process.argv.slice(2);
let admitted = false;
try {
  const manifest = JSON.parse(fs.readFileSync(manifestFile,'utf8'));
  if (!path.isAbsolute(manifest.directory) || !Array.isArray(manifest.files) || manifest.files.length !== 11) throw Error('manifest shape');
  const actualNames = fs.readdirSync(manifest.directory).sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(manifest.files.map(row=>row.name).sort())) throw Error('member set');
  for (const row of manifest.files) {
    if (!/^(types|errors|limits|syntax|matcher)\.(js|d\.ts)$|^package\.json$/.test(row.name)) throw Error('path');
    const location = path.join(manifest.directory,row.name);
    const stat = fs.lstatSync(location);
    if (!stat.isFile() || stat.size !== row.size || (stat.mode&0o777) !== row.mode) throw Error('type/size/mode');
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(location)).digest('hex');
    if (sha256 !== row.sha256) throw Error('hash');
  }
  console.log(JSON.stringify({ event:'admitted', manifest }));
  admitted = true;
  process.argv = [process.execPath,suite,manifest.directory,cases,selection];
  await import(pathToFileURL(suite).href);
} catch (error) {
  console.log(JSON.stringify({ event:admitted?'execution-error':'ADMISSION_DENIED', message:String(error?.stack??error) }));
  process.exitCode = admitted?1:2;
}
