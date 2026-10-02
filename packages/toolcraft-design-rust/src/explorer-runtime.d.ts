import type {ExplorerConfig} from './explorer-state.js';
export declare function runExplorer<R = void>(config: ExplorerConfig<R>): Promise<R | null>;
