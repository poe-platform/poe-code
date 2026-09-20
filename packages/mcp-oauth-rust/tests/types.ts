import { generateCodeVerifier, generateCodeChallenge } from "../src/index.js";
const verifier: string = generateCodeVerifier();
const challenge: string = generateCodeChallenge(verifier);
void challenge;
