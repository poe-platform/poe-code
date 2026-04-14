import { execSync } from 'node:child_process';
import type { Engine } from './types.js';

let resolvedContext: string | null | undefined = undefined;

export function setResolvedContext(context: string | null): void {
  resolvedContext = context;
}

/** Detect a running colima Docker context */
export function detectRunningContext(): string | null {
  try {
    const output = execSync('colima list --json', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const lines = output.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      const profile = JSON.parse(line);
      if (profile.status === 'Running' && profile.runtime === 'docker') {
        const name = profile.name || profile.profile;
        return name === 'default' ? 'colima' : `colima-${name}`;
      }
    }
  } catch {
    // colima not installed or list failed
  }
  return null;
}

/**
 * Get the resolved Docker context.
 * Lazily detects a running colima context on first call.
 */
export function getResolvedContext(): string | null {
  if (resolvedContext === undefined) {
    resolvedContext = detectRunningContext();
  }
  return resolvedContext;
}

export function buildContextArgs(engine: Engine, context: string | null): string[] {
  if (context && engine === 'docker') {
    return ['--context', context];
  }
  return [];
}
