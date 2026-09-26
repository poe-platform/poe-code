import { CsvkitDiagnostic } from '../errors.js';

/** Frames describe the frozen Python reference, never the JavaScript call stack. */
export interface PythonFrame {
  readonly path: string;
  readonly line: number;
  readonly function: string;
  readonly source?: string;
}
export interface PythonTraceback {
  readonly profile: string;
  readonly frames: readonly PythonFrame[];
}

/** Injected codecs/drivers may report an actual reference exception explicitly. */
export class PythonException extends CsvkitDiagnostic {
  constructor(readonly exceptionClass: string, readonly detail: string,
    readonly traceback?: PythonTraceback) {
    super(detail);
    this.name = exceptionClass;
  }
}
