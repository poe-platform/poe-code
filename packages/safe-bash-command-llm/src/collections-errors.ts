export class LlmCollectionDoesNotExist extends Error {
 constructor(name:string,message?:string){super(message??`Collection '${name}' does not exist`);this.name='LlmCollectionDoesNotExist';}
}
