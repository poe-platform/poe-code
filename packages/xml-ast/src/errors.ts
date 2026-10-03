export class XmlLimitError extends SyntaxError {
  constructor(readonly limit: string, message: string) { super(message); }
}
