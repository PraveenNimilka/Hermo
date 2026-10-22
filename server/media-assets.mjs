import {randomBytes} from 'node:crypto';
import {hash} from './store.mjs';

// Capability URLs grant one-hour access to one image, never workflow execution.
// Bytes remain encrypted; deleting a run cascades its assets. Revocation is live.
export function installMediaAssets(app,{store,origin}){
  const {db,seal,unseal}=store;
  db.exec('CREATE TABLE IF NOT EXISTS media_assets (token_hash TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,payload TEXT NOT NULL,bytes INTEGER NOT NULL,expires_at INTEGER NOT NULL)');
  const notFound=reply=>reply.code(404).send({error:{code:'NOT_FOUND',message:'This image is unavailable or its link expired.'}});
  app.get('/media/assets/:token',async(req,reply)=>{
    if(!/^[A-Za-z0-9_-]{43}$/.test(req.params.token))return notFound(reply);
    const asset=db.prepare('SELECT * FROM media_assets WHERE token_hash=? AND expires_at>?').get(hash(req.params.token),Date.now());
    const run=asset&&db.prepare('SELECT status,consumer_id,workflow_id FROM runs WHERE id=?').get(asset.run_id);
    if(!run||run.status!=='succeeded')return notFound(reply);
    if(run.consumer_id!=='studio'&&!db.prepare('SELECT id FROM api_keys WHERE id=? AND workflow_id=? AND revoked_at IS NULL AND expires_at>?').get(run.consumer_id,run.workflow_id,new Date().toISOString()))return notFound(reply);
    const {mime,data}=unseal(asset.payload);
    return reply.header('Content-Security-Policy',"default-src 'none'; sandbox").header('Cross-Origin-Resource-Policy','same-site').header('Content-Disposition','inline').header('Cache-Control','no-store').type(mime).send(Buffer.from(data,'base64'));
  });
  return {save(runId,packet){
    if(!runId||!db.prepare("SELECT id FROM runs WHERE id=? AND status='verifying'").get(runId))throw Error('MEDIA_UNSUPPORTED');
    if(!packet||!['image/png','image/jpeg','image/webp','image/gif'].includes(packet.mime)||typeof packet.data!=='string'||!packet.data.length||packet.data.length>11184812||!/^[A-Za-z0-9+/]+={0,2}$/.test(packet.data))throw Error('MEDIA_UNSUPPORTED');
    const bytes=Buffer.from(packet.data,'base64');
    const valid=packet.mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):packet.mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:packet.mime==='image/gif'?/^GIF8[79]a$/.test(bytes.subarray(0,6).toString()):bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
    if(!valid)throw Error('MEDIA_UNSUPPORTED');
    if(bytes.length>8388608)throw Error('MEDIA_TOO_LARGE');
    db.prepare('DELETE FROM media_assets WHERE expires_at<=?').run(Date.now());
    if(db.prepare('SELECT coalesce(sum(bytes),0) n FROM media_assets').get().n+bytes.length>134217728)throw Error('MEDIA_STORAGE_FULL');
    const token=randomBytes(32).toString('base64url');db.prepare('INSERT INTO media_assets VALUES (?,?,?,?,?)').run(hash(token),runId,seal(packet),bytes.length,Date.now()+3600000);
    return origin+'/media/assets/'+token;
  }};
}
