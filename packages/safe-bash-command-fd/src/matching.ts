import { Pattern } from 'safe-bash-regex-engine';
import { Budget } from 'safe-bash-regex-engine/text/budget';
import { EreLedger } from 'safe-bash-regex-engine/ere/limits';
import { compileEre } from 'safe-bash-regex-engine/ere/syntax';
import { prepareUtf8EreSubject } from 'safe-bash-regex-engine/ere/matcher';
import type { EreProgram } from 'safe-bash-regex-engine/ere/types';
import { globFragments, parseIgnorePatterns } from 'safe-bash-regex-engine/glob';
import type { CommandContext } from 'safe-bash-contracts';
import type { FdCommandOptions, FdMatcher } from './command.js';

const sharedEncoder = new TextEncoder();

export function createFdMatcher(context: CommandContext, options: FdCommandOptions): FdMatcher {
  const budget = new Budget(context, {maxSteps: options.maxRegexSteps ?? Infinity, maxBufferBytes: options.maxRegexBufferBytes ?? Infinity});
  const ledger = new EreLedger({maxExpansionBytes: Infinity, maxExpansionFields: Infinity}, {
    work: options.maxRegexSteps ?? Infinity, subjectBytes: options.maxRegexBufferBytes ?? Infinity,
  });
  const patterns = new Map<string, Pattern>();
  const globs = new Map<string, EreProgram>();
  const signal = context.signal;
  async function glob(source: string, path: string, directory: boolean, ancestors: boolean, literalUnclosedClass = true): Promise<boolean> {
    const key = `${literalUnclosedClass}:${source}`;
    let program = globs.get(key);
    if (!program) {
      program = await compileEre(await globFragments(source, literalUnclosedClass, ledger, signal), ledger, signal);
      globs.set(key, program);
    }
    for (let end = path.length; end >= 0;) {
      { const c = ledger.checkpoint(signal); if (c) await c; }
      if (end !== path.length || !source.endsWith('/') || directory) {
        const subject = await prepareUtf8EreSubject(sharedEncoder.encode(path.slice(0, end)), ledger, signal);
        if (await subject(program)(0)) return true;
      }
      if (!ancestors || end === 0) break;
      end = path.lastIndexOf('/', end - 1);
    }
    return false;
  }
  return {
    async pattern(source, subject, mode, caseMode) {
      const insensitive = caseMode === 'insensitive' || caseMode === 'smart' && ![...source].some(c => c.toUpperCase() === c && c.toLowerCase() !== c);
      if (mode === 'glob') {
        const pattern = source.startsWith('/') ? '\\' + source : '/' + source;
        return glob(insensitive ? pattern.toLowerCase() : pattern, insensitive ? subject.toLowerCase() : subject, false, false, false);
      }
      if (mode === 'fixed') return (insensitive ? subject.toLowerCase() : subject).includes(insensitive ? source.toLowerCase() : source);
      let effectiveSource = source;
      let effectiveInsensitive = insensitive;
      if (effectiveSource.startsWith('(?i)')) { effectiveSource = effectiveSource.slice(4); effectiveInsensitive = true; }
      else if (effectiveSource.startsWith('(?-i)')) { effectiveSource = effectiveSource.slice(5); effectiveInsensitive = false; }
      const key = `${effectiveInsensitive}:${effectiveSource}`;
      let pattern = patterns.get(key);
      if (!pattern) { pattern = new Pattern(effectiveSource, true, effectiveInsensitive, 'jq'); patterns.set(key, pattern); }
      return await pattern.find(subject, budget) !== undefined;
    },
    async ignores(contents) {
      const rules = parseIgnorePatterns(contents);
      for (const {pattern} of rules) {
        const key = `true:${pattern}`;
        if (!globs.has(key)) globs.set(key, await compileEre(await globFragments(pattern, true, ledger, signal), ledger, signal));
      }
      return rules;
    },
    glob,
  };
}
