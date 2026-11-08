export interface DockerBuildContextFile{relativePath:string;bytes:Buffer;}
export function readDockerBuildContextFiles(buildContext:string):Promise<DockerBuildContextFile[]>;
