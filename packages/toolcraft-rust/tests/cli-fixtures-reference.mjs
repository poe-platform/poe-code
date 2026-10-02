import path from "node:path";
import {getCommandSourcePath,resolveCommandSecrets} from "../../toolcraft/dist/index.js";
import {createEnv,createFs,RESERVED_SERVICE_NAMES} from "../../toolcraft/dist/runtime/io.js";
import {loadCLIReference} from "./cli-reference.mjs";
export function loadFixtureReference(readFile){return loadCLIReference([
  "resolveFixtureRuntime","createFixtureEnvValues","resolveFixtureSecrets","loadFixtureScenario",
  "selectFixtureScenario","resolveFixturePath","createFixtureService","resolveFixtureMethodResult",
  "createFixtureFs","createFixtureFetch","createFixtureResponse","getFetchUrl","matchesFixtureValue",
  "isWriteLikeMethod","isReadLikeMethod","normalizeHttpMethod","isNumericFixtureSelector",
  "isPlainObject","formatAvailableList","formatJsonParseUserErrorMessage","removeNativeJsonParseLocation",
  "getJsonParseErrorLocation","getJsonParseCauseLocation","getNumericProperty","getJsonParseMessagePosition",
  "getSourceOffsetLocation","isAsciiDigit","hasOwnProperty","getErrorMessage"
],[],{path,readFile,getCommandSourcePath,resolveCommandSecrets,createEnv,createFs,RESERVED_SERVICE_NAMES});}
