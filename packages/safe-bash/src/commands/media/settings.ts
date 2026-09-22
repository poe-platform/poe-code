import type { MediaCommandsOptions } from './plugin.js';
import type { RemoteMediaOptions } from './remote.js';

/** Own settings before a host yields, without loading shell or transport code. */
export function captureMediaOptions(options: RemoteMediaOptions | MediaCommandsOptions): RemoteMediaOptions | MediaCommandsOptions {
  if ('service' in options) return { ...options,
    resource: structuredClone(options.resource),
    ...(options.provider ? { provider: structuredClone(options.provider) } : {}),
    ...(options.limits ? { limits: structuredClone(options.limits) } : {}),
    ...(options.grants ? { grants: structuredClone(options.grants) } : {}),
    ...(options.descriptors ? { descriptors: structuredClone(options.descriptors) } : {}),
    ...(options.stdin ? { stdin: structuredClone(options.stdin) } : {}),
  };
  return { ...options,
    ...(options.engine ? { engine: { execute: options.engine.execute.bind(options.engine) } } : {}),
    ...(options.ffmpeg ? { ffmpeg: {
      build: options.ffmpeg.build, grammarRevision: options.ffmpeg.grammarRevision,
      argv: options.ffmpeg.argv, lateAccess: options.ffmpeg.lateAccess, effects: options.ffmpeg.effects,
      run: options.ffmpeg.run.bind(options.ffmpeg),
    } } : {}),
    ...(options.imageMagick ? { imageMagick: {
      build: options.imageMagick.build, grammarRevision: options.imageMagick.grammarRevision,
      argv: options.imageMagick.argv, lateAccess: options.imageMagick.lateAccess, effects: options.imageMagick.effects,
      ...(options.imageMagick.discoveryContext ? { discoveryContext: options.imageMagick.discoveryContext.bind(options.imageMagick) } : {}),
      run: options.imageMagick.run.bind(options.imageMagick),
    } } : {}),
  };
}
