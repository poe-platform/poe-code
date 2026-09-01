import { ConditionalUnsupported } from "../src/shell/conditional.ts";

export class EreTransportRoot {
  constructor() {
    throw new ConditionalUnsupported("[[ =~ ]] is not supported by the browser shell entry");
  }
}
