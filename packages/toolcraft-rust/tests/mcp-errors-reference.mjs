import {loadMCPMetadataReference} from "./mcp-metadata-reference.mjs";
import {ToolError,JSON_RPC_ERROR_CODES} from "tiny-stdio-mcp-server";
import {UserError} from "../../toolcraft/dist/index.js";
import {isHttpErrorLike,createHttpErrorEnvelope} from "../../toolcraft/dist/api-error-summary.js";
export const original=loadMCPMetadataReference(["isHumanInLoopPending","renderPendingApproval","renderDeclinedApproval","toToolError","withToolErrorMapping"],{ToolError,JSON_RPC_ERROR_CODES,UserError,isHttpErrorLike,createHttpErrorEnvelope});
