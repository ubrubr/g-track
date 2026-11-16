import { Repository,transaction,StaleEditError } from './db.js';
import { validateWorkout,validateDraft,contentKey } from './domain.js';
import { validateTemplate,validateSession,copy,newId } from './model.js';
import { validateProfile } from './schema3.js';
import { pauseWorkout,resumeWorkout,finishWorkout,upgradeSession } from './automatic.js';
import { StaleDocumentError,documentContent } from './training-db.js';
const request=req=>new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
const storeFor=kind=>kind==='template'?'templates':kind==='profile'?'profiles':'workoutDrafts';
const checked=value=>value.entity==='profile'?validateProfile(value):value.entity==='template'?validateTemplate(value):validateSession(value);
export class RoutineRepository extends Repository {
 docKey(kind,id){return `${this.owner}:${kind}:${id}`;}
 templates(){return transaction(this.db,['templates'],'readonly',s=>request(s.templates.index('owner').getAll(this.owner)));}
 sessions(){return transaction(this.db,['workoutDrafts'],'readonly',async s=>(await request(s.workoutDrafts.index('owner').getAll(this.owner))).filter(v=>!v.deleted));}
 active(id=null){return transaction(this.db,['workoutDrafts'],'readonly',async s=>{if(id){const value=await request(s.workoutDrafts.get(this.docKey('session',id)));return value&&!value.deleted?value:null;}return (await request(s.workoutDrafts.index('owner').getAll(this.owner))).filter(v=>!v.deleted).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0]||null;});}
 profile(){return transaction(this.db,['profiles'],'readonly',async s=>(await request(s.profiles.index('owner').getAll(this.owner))).find(v=>!v.deleted)||null);}
 async operations(){return (await super.operations()).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||Number(Boolean(a.entity))-Number(Boolean(b.entity))||a.key.localeCompare(b.key));}
 checkVersion(value,existing,force=false){if(force||!existing)return;const same=(value.localVersion||null)===(existing.localVersion||null)&&value.revision===existing.revision,ack=value.localVersion&&value.localVersion===existing.lastOperationId;if(!same&&!ack)throw new StaleDocumentError(existing);}
 async writeDocument(stores,value,existing){
  const valid=checked(value),kind=value.entity,key=this.docKey(kind,valid.id),old=await request(stores.ops.get(key));
  const op={id:newId(),key,owner:this.owner,entity:kind,workoutId:valid.id,baseRevision:existing?.revision||0,createdAt:new Date().toISOString(),conflict:old?.conflict||null};
  const saved={...valid,key,owner:this.owner,revision:op.baseRevision,updatedAt:new Date().toISOString(),localVersion:op.id,sync:op.conflict?'conflict':'pending'};
  stores[storeFor(kind)].put(saved);stores.ops.put({...op,record:saved});return saved;
 }
 saveDocument(value,{force=false}={}){const name=storeFor(value.entity);return transaction(this.db,[name,'ops'],'readwrite',async s=>{const old=await request(s[name].get(this.docKey(value.entity,value.id)));this.checkVersion(value,old,force);return this.writeDocument(s,value,old);});}
 saveTemplate(value,options={}){return this.saveDocument(value,options);}
 saveActive(value,options={}){return this.saveDocument(value,options);}
 saveProfile(value,options={}){return this.saveDocument(value,options);}
 switchWorkout(previous,next,now=Date.now()){
  return transaction(this.db,['workoutDrafts','ops'],'readwrite',async s=>{
   if(previous&&previous.id!==next.id){const old=await request(s.workoutDrafts.get(this.docKey('session',previous.id)));this.checkVersion(previous,old);await this.writeDocument(s,pauseWorkout(upgradeSession(previous,now),now),old);}
   const old=await request(s.workoutDrafts.get(this.docKey('session',next.id)));this.checkVersion(next,old);return this.writeDocument(s,resumeWorkout(upgradeSession(next,now),now),old);
  });
 }
 deleteTemplate(id){return transaction(this.db,['templates','ops'],'readwrite',async s=>{const old=await request(s.templates.get(this.docKey('template',id)));if(old)return this.writeDocument(s,{...old,deleted:true},old);});}
 discardActive(id){return transaction(this.db,['workoutDrafts','ops'],'readwrite',async s=>{const old=await request(s.workoutDrafts.get(this.docKey('session',id)));if(old&&!old.deleted){const value=upgradeSession(old);pauseWorkout(value);return this.writeDocument(s,{...value,deleted:true,prompt:null},old);}});}
 async saveFinalRecord(stores,record,{editing=false,clearDraft=true,baseRevision,baseLocalVersion}={}){
  const old=await request(stores.workouts.get(this.key(record.id)));
  if(editing&&baseRevision!==undefined&&(!old||old.revision!==baseRevision||(old.localVersion||null)!==(baseLocalVersion||null)))throw new StaleEditError(old||null);
  const saved=await this.queue(stores,record,old);if(clearDraft)stores.drafts.delete(this.owner);return saved;
 }
 async finish(value,history=[],now=Date.now()){
  const workout=finishWorkout(value,history,now);
  return transaction(this.db,['workouts','workoutDrafts','ops','drafts'],'readwrite',async s=>{const old=await request(s.workoutDrafts.get(this.docKey('session',value.id)));if(!old||old.deleted)throw new Error('Workout already saved.');this.checkVersion(value,old);const saved=await this.saveFinalRecord(s,workout);const closed=pauseWorkout(copy(value),now);await this.writeDocument(s,{...closed,deleted:true,prompt:null,rest:null,finishedWorkoutId:saved.id},old);return saved;});
 }
 acknowledge(op,server){
  if(!op.entity)return super.acknowledge(op,server);const name=storeFor(op.entity),key=this.docKey(op.entity,op.workoutId);
  return transaction(this.db,[name,'ops'],'readwrite',async s=>{const remote=checked(server),pending=await request(s.ops.get(op.key)),local=await request(s[name].get(key));if(!local){if(pending?.id===op.id)s.ops.delete(op.key);return;}if(local.revision>remote.revision)return;if(pending?.id===op.id){s[name].put({...remote,key,owner:this.owner,sync:'synced'});s.ops.delete(op.key);}else if(pending){pending.baseRevision=remote.revision;pending.record.revision=remote.revision;s.ops.put(pending);s[name].put({...local,revision:remote.revision,lastOperationId:remote.lastOperationId});}});
 }
 markConflict(op,server){
  if(!op.entity)return super.markConflict(op,server);const name=storeFor(op.entity);
  return transaction(this.db,[name,'ops'],'readwrite',async s=>{const pending=await request(s.ops.get(op.key));if(!pending)return;pending.conflict={server:server?copy(server):null,detectedAt:new Date().toISOString()};s.ops.put(pending);const local=await request(s[name].get(this.docKey(op.entity,op.workoutId)));if(local)s[name].put({...local,sync:'conflict'});});
 }
 mergeRemote(values){
  return transaction(this.db,['workouts','templates','workoutDrafts','profiles','ops'],'readwrite',async s=>{
   for(const value of values){const kind=value.entity,name=kind?storeFor(kind):'workouts',remote=kind?checked(value):validateWorkout(value),key=kind?this.docKey(kind,remote.id):this.key(remote.id),pending=await request(s.ops.get(key)),local=await request(s[name].get(key));
    if(pending){if(remote.revision>pending.baseRevision&&remote.lastOperationId!==pending.id){pending.conflict={server:remote,detectedAt:new Date().toISOString()};s.ops.put(pending);if(local)s[name].put({...local,sync:'conflict'});}continue;}
    if(!local||remote.revision>=local.revision)s[name].put({...remote,...(kind?{entity:kind}:{}),key,owner:this.owner,sync:'synced'});
   }
  });
 }
 resolveDocument(opKey,choice){
  return transaction(this.db,['workouts','templates','workoutDrafts','profiles','ops'],'readwrite',async s=>{const op=await request(s.ops.get(opKey));if(!op?.conflict)throw new Error('This conflict is already resolved.');const remote=op.conflict.server,kind=op.entity,name=kind?storeFor(kind):'workouts';s.ops.delete(opKey);
   if(choice==='server'){s[name].delete(opKey);if(remote)s[name].put({...remote,key:kind?this.docKey(kind,remote.id):this.key(remote.id),owner:this.owner,sync:'synced'});}
   else if(choice==='local'){if(remote&&remote.id!==op.record.id)s[name].put({...remote,key:kind?this.docKey(kind,remote.id):this.key(remote.id),owner:this.owner,sync:'synced'});const base=remote?.id===op.record.id?remote:{revision:op.baseRevision};if(kind)await this.writeDocument(s,op.record,base);else await this.queue(s,op.record,base);}
   else throw new Error('Choose a version.');
  });
 }
 resolve(id,choice){return this.resolveDocument(this.key(id),choice);}
 importAll(backup,choices={}, {restoreActive=false,restoreLegacyDraft=false,restoreProfile=false,currentProfile=null}={}){
  return transaction(this.db,['workouts','workoutDrafts','templates','profiles','ops','drafts','settings'],'readwrite',async s=>{
   let imported=0,skipped=0;
   for(const record of backup.workouts){const old=await request(s.workouts.get(this.key(record.id)));if(old&&contentKey(old)===contentKey(record)){skipped++;continue;}if(old&&choices[record.id]!=='replace'){skipped++;continue;}if(old?.sync==='conflict')throw new Error('Resolve this workout conflict first.');await this.queue(s,record,old);imported++;}
   for(const record of backup.templates||[]){const key=this.docKey('template',record.id),old=await request(s.templates.get(key));if(old&&documentContent(old)===documentContent(record)){skipped++;continue;}if(old&&choices[`template:${record.id}`]!=='replace'){skipped++;continue;}await this.writeDocument(s,record,old);imported++;}
   if(restoreActive)for(const record of backup.activeSessions?.length?backup.activeSessions:backup.activeSession?[backup.activeSession]:[]){const key=this.docKey('session',record.id),old=await request(s.workoutDrafts.get(key));if(old&&choices[`session:${record.id}`]!=='replace'){skipped++;continue;}await this.writeDocument(s,record,old);imported++;}
   if(restoreProfile&&backup.profile&&currentProfile){const old=await request(s.profiles.get(this.docKey('profile',currentProfile.id)));await this.writeDocument(s,{...backup.profile,id:currentProfile.id},old);}
   if(backup.draft&&restoreLegacyDraft)s.drafts.put({owner:this.owner,value:validateDraft(backup.draft)});s.settings.put({owner:this.owner,value:copy(backup.settings)});return {imported,skipped};
  });
 }
}
