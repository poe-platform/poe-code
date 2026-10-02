import { FsError, type CommandContext } from 'safe-bash-contracts';
import { pathOf } from 'safe-bash-contracts/path';
import { renderSchemaJson } from './schema-json.js';
import { createLlmConfiguration } from './configuration.js';
import { loadLlmStoredSchemaJson, type LlmStoredSchemaOptions } from './stored-schema.js';

export async function showSchemaCommand(context: Pick<CommandContext,'fs'|'cwd'|'env'|'signal'>, args: string[], emit: (text:string)=>Promise<void>, diagnostic: (text:string)=>Promise<void>, controls: LlmStoredSchemaOptions): Promise<number> {
  const usage = 'Usage: llm schemas show [OPTIONS] SCHEMA_ID\n';
  const invalid = async (message:string): Promise<number> => {
    await diagnostic(usage + "Try 'llm schemas show -h' for help.\n\nError: " + message + '\n'); return 2;
  };
  let database: string | undefined, path: string | undefined, ended=false, help=false;
  const inputs: string[]=[];
  for (let index=0;index<args.length;index++) {
    context.signal.throwIfAborted();
    const arg=args[index]!;
    if (!ended && arg==='--') { ended=true; continue; }
    if (!ended && arg.startsWith('--help=')) { await diagnostic("Error: Option '--help' does not take a value.\n"); return 2; }
    if (!ended && (arg==='--help'||arg==='-h')) { help=true; continue; }
    if (!ended && arg.startsWith('-') && arg!=='-') {
      const equals=arg.indexOf('='), long=arg.startsWith('--');
      const flag=long?arg.slice(0,equals<0?undefined:equals):arg.slice(0,2);
      if (!['-d','--database','-p','--path'].includes(flag)) return invalid(`No such option: ${flag}`);
      const attached=long?(equals<0?undefined:arg.slice(equals+1)):(arg.length>2?arg.slice(2):undefined);
      const value=attached??args[++index];
      if (value===undefined) { await diagnostic(`Error: Option '${flag}' requires an argument.\n`); return 2; }
      if (flag==='-p'||flag==='--path') path=value; else database=value;
    } else inputs.push(arg);
  }
  if (help) {
    await emit(usage+'\n  Show a stored schema\n\nOptions:\n  -d, --database FILE  Path to log database\n  -h, --help           Show this message and exit.\n'); return 0;
  }
  if (!inputs.length) return invalid("Missing argument 'SCHEMA_ID'.");
  if (inputs.length>1) return invalid(`Got unexpected extra argument (${inputs[1]})`);
  const selected=path??database;
  const filename=selected===undefined?`${createLlmConfiguration(context).directory}/logs.db`:pathOf(context,selected);
  try {
    for (const [label, supplied] of [["'-p' / '--path'",path],["'-d' / '--database'",database]] as const) {
      if (supplied===undefined) continue;
      let suppliedStat;
      try { suppliedStat=await context.fs.stat(pathOf(context,supplied),{signal:context.signal}); }
      catch (error) {
        if (!(error instanceof FsError)||error.code!=='ENOENT') throw error;
        return invalid(`Invalid value for ${label}: File '${supplied}' does not exist.`);
      }
      if (suppliedStat.type!=='file') return invalid(`Invalid value for ${label}: File '${supplied}' is a directory.`);
    }
    let stat;
    try { stat=await context.fs.stat(filename,{signal:context.signal}); }
    catch (error) {
      if (!(error instanceof FsError)||error.code!=='ENOENT') throw error;
      if (selected!==undefined) return invalid(`Invalid value for '${path===undefined?"-d' / '--database":"-p' / '--path"}': File '${selected}' does not exist.`);
      await diagnostic(`Error: No log database found at ${filename}\n`); return 1;
    }
    if (stat.type!=='file') return invalid(`Invalid value for '${path===undefined?"-d' / '--database":"-p' / '--path"}': File '${selected??filename}' is a directory.`);
    const raw=await loadLlmStoredSchemaJson(context,inputs[0]!,{...controls,database:filename,migrate:true});
    if (raw===undefined) { await diagnostic('Error: Invalid schema ID\n'); return 1; }
    await renderSchemaJson(raw,emit,context.signal);
    return 0;
  } catch (error) {
    context.signal.throwIfAborted();
    await diagnostic(`Error: ${error instanceof Error?error.message:String(error)}\n`); return 1;
  }
}
