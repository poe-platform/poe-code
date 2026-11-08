/** Construct from fields rather than Request(Request): Node's transfer proxy
 * eagerly pulls stdin while an asynchronous host prepares its endpoint. Keep
 * the original stream and its backpressure until the service consumes it. */
export function hostingRequest(request:Request,url:string|URL,options:RequestInit):Request {
 return new Request(url,{
  method:request.method,headers:request.headers,body:request.body,
  cache:request.cache,credentials:request.credentials,integrity:request.integrity,
  keepalive:request.keepalive,mode:request.mode,redirect:request.redirect,
  referrer:request.referrer,referrerPolicy:request.referrerPolicy,
  signal:request.signal,duplex:'half',...options,
 } as RequestInit);
}
