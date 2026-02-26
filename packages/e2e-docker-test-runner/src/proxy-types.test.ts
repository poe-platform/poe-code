import { describe, it, expectTypeOf } from 'vitest';
import type { ProxyRoute, ProxyConfig, CapturedExchange, SnapshotMode, SnapshotMissBehavior } from './proxy-types.js';

describe('proxy types', () => {
  it('defines SnapshotMode as playback or record', () => {
    expectTypeOf<SnapshotMode>().toEqualTypeOf<'playback' | 'record'>();
  });

  it('defines SnapshotMissBehavior options', () => {
    expectTypeOf<SnapshotMissBehavior>().toEqualTypeOf<'error' | 'warn' | 'passthrough' | 'record'>();
  });

  it('defines ProxyRoute with required fields and optional snapshotDir', () => {
    expectTypeOf<ProxyRoute>().toEqualTypeOf<{
      path: string;
      target: string;
      mode: SnapshotMode;
      snapshotDir?: string;
    }>();
  });

  it('defines ProxyConfig with port, routes, captureFile, and onMiss', () => {
    expectTypeOf<ProxyConfig>().toEqualTypeOf<{
      port: number;
      routes: ProxyRoute[];
      captureFile: string;
      onMiss: SnapshotMissBehavior;
    }>();
  });

  it('defines CapturedExchange request and response payload shape', () => {
    expectTypeOf<CapturedExchange>().toEqualTypeOf<{
      timestamp: string;
      route: string;
      request: {
        method: string;
        path: string;
        headers: Record<string, string>;
        body: unknown;
      };
      response: {
        status: number;
        body: unknown;
      };
    }>();
  });
});
