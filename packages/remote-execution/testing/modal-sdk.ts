/** Local provisioning fixture only; never a cloud qualification receipt. */
export const Probe = {
 withTcp(port:number) {
  return {toProto:()=>({tcpPort:port})};
 },
};
