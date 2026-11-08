// Reference tests mock this renderer. Production consumers inject their own.
import { renderAcpStream } from "../../agent-spawn/src/acp/renderer.js";
import { createSpawnAutonomous } from "../dist/index.js";
export const spawnAutonomous = createSpawnAutonomous(renderAcpStream);
