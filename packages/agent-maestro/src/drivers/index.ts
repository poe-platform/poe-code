import { pipelineDriver } from "./pipeline.js";
import { registerDriver } from "./registry.js";

registerDriver(pipelineDriver);

export { pipelineDriver } from "./pipeline.js";
