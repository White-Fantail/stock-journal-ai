/** CI only: provision artificial subjects through the real signed local API.
 * Never provision a real Google login or log source financial data.
 */
import {createHmac,randomUUID} from "node:crypto";
import assert from "node:assert/strict";
const base="http://127.0.0.1:18182";
const key=process.env.SAAS_INTERNAL_SECRET;
if(process.env.SAAS_TEST_DB_ACK!=="YES_DISPOSABLE_SAAS_DB"||
  !process.env.POSITIONARY_BROWSER_CI||!key||key.length<32)
 throw Error("Browser seed requires explicitly disposable local CI");
async function request(path,payload){
 const body=JSON.stringify(payload);
 const timestamp=String(Math.floor(Date.now()/1000));
 const nonce=randomUUID();
 const sig=createHmac("sha256",key).update(timestamp+"\n"+nonce+"\nPOST\n"+path+"\n"+body).digest("hex");
 const result=await fetch(base+path,{method:"POST",headers:{
  "Content-Type":"application/json","X-Saas-Timestamp":timestamp,
  "X-Saas-Nonce":nonce,"X-Saas-Signature":sig,
 },body});
 assert.equal(result.status,200,path+" status "+result.status);
 return result.json();
}
export const SUBJECT_A="9000000000000000041";
export const SUBJECT_B="9000000000000000042";
export default async function setup(){
 for(const [subject,name] of [[SUBJECT_A,"Synthetic A"],[SUBJECT_B,"Synthetic B"]]){
  const result=await request("/internal/v1/provision",{
   subject,email:subject+"@example.invalid",email_verified:true,name,
  });
  assert.ok(result.workspaceId&&result.userId,"Provision synthetic workspace");
 }
}
