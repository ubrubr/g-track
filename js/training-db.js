import { Repository, transaction, DuplicateDateError, StaleEditError } from './db.js';
import { validateWorkout, contentKey, validateDraft } from './domain.js';
import { copy, newId, validateTemplate, validateSession, finishSession } from './model.js';
const request=req=>new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
const entity=record=>record.entity||'workout';
export function documentContent(record) { const data=copy(record);for(const key of ['key','owner','revision','updatedAt','lastOperationId','localVersion','sync'])delete data[key];return JSON.stringify(data); }
export class ActiveSessionError extends Error { constructor(session){super('A workout is already in progress. Resume or discard it first.');this.session=session;} }
export class StaleDocumentError extends Error { constructor(record){super('This document changed on another device or tab. Review the newer version before saving.');this.record=record;} }
export class TrainingRepository extends Repository {
  docKey(kind,id){return `${this.owner}:${kind}:${id}`;}
  storeKey(kind,id){return kind==='session'?this.owner:this.docKey(kind,id);}
  templates(){return transaction(this.db,['templates'],'readonly',({templates})=>request(templates.index('owner').getAll(this.owner)));}
  active(){return transaction(this.db,['sessions'],'readonly',async({sessions})=>{const value=await request(sessions.get(this.owner));return value&&!value.deleted?value:null;});}
  async operations(){return (await super.operations()).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));}
  async queueDocument(stores,kind,value,existing){
    const valid=kind==='template'?validateTemplate(value):validateSession(value),key=this.docKey(kind,valid.id),old=await request(stores.ops.get(key));
    const same=existing?.id===value.id,op={id:newId(),key,owner:this.owner,entity:kind,workoutId:value.id,baseRevision:same?existing.revision:0,createdAt:new Date().toISOString(),conflict:old?.conflict||null};
    const saved={...valid,entity:kind,key:this.storeKey(kind,valid.id),owner:this.owner,revision:op.baseRevision,updatedAt:new Date().toISOString(),localVersion:op.id,sync:op.conflict?'conflict':'pending'};
    stores[kind==='template'?'templates':'sessions'].put(saved);stores.ops.put({...op,record:saved});return saved;
  }
  saveTemplate(value,{force=false}={}){
    return transaction(this.db,['templates','ops'],'readwrite',async stores=>{
      const existing=await request(stores.templates.get(this.storeKey('template',value.id)));
      this.checkVersion(value,existing,force);
      return this.queueDocument(stores,'template',value,existing);
    });
  }
  checkVersion(value,existing,force){
    if(!existing||existing.id!==value.id||force)return;
    const same=(value.localVersion||null)===(existing.localVersion||null)&&value.revision===existing.revision;
    const acknowledged=value.localVersion&&existing.lastOperationId===value.localVersion;
    if(!same&&!acknowledged)throw new StaleDocumentError(existing);
  }
  saveActive(value,{force=false,starting=false}={}){
    return transaction(this.db,['sessions','ops'],'readwrite',async stores=>{
      const existing=await request(stores.sessions.get(this.owner));
      if(existing&&!existing.deleted&&existing.id!==value.id)throw new ActiveSessionError(existing);
      this.checkVersion(value,existing,force||(starting&&existing?.deleted));return this.queueDocument(stores,'session',value,existing);
    });
  }
  deleteTemplate(id){return transaction(this.db,['templates','ops'],'readwrite',async stores=>{
    const old=await request(stores.templates.get(this.storeKey('template',id)));if(!old)throw new Error('Template not found.');return this.queueDocument(stores,'template',{...old,deleted:true},old);
  });}
  discardActive(){return transaction(this.db,['sessions','ops'],'readwrite',async stores=>{
    const old=await request(stores.sessions.get(this.owner));if(old&&!old.deleted)return this.queueDocument(stores,'session',{...old,deleted:true,prompt:null},old);
  });}
  finish(value,now=Date.now()){
    const workout=finishSession(value,now);
    return transaction(this.db,['workouts','ops','drafts','sessions'],'readwrite',async stores=>{
      const active=await request(stores.sessions.get(this.owner));
      if(!active||active.id!==value.id||active.deleted)throw new Error('This session has already been finished or discarded.');
      this.checkVersion(value,active,false);
      const saved=await this.saveFinalRecord(stores,workout,{editing:value.editing,baseRevision:value.editing?value.baseRevision:undefined,baseLocalVersion:value.baseLocalVersion});
      await this.queueDocument(stores,'session',{...active,deleted:true,prompt:null,rest:null,finishedWorkoutId:saved.id},active);
      return saved;
    });
  }
  acknowledge(op,server){
    if(!op.entity)return super.acknowledge(op,server);
    const kind=op.entity,name=kind==='template'?'templates':'sessions';
    return transaction(this.db,[name,'ops'],'readwrite',async stores=>{
      const checked=kind==='template'?validateTemplate(server):validateSession(server),key=this.storeKey(kind,op.workoutId);
      const pending=await request(stores.ops.get(op.key)),local=await request(stores[name].get(key));
      if(local?.id!==op.workoutId){if(pending?.id===op.id)stores.ops.delete(op.key);return;}
      if(local.revision>checked.revision)return;
      if(pending?.id===op.id){stores[name].put({...checked,key,owner:this.owner,sync:'synced'});stores.ops.delete(op.key);}
      else if(pending){pending.baseRevision=checked.revision;pending.record.revision=checked.revision;stores.ops.put(pending);stores[name].put({...local,revision:checked.revision,lastOperationId:checked.lastOperationId});}
    });
  }
  markConflict(op,server){
    if(!op.entity)return super.markConflict(op,server);
    const name=op.entity==='template'?'templates':'sessions';
    return transaction(this.db,[name,'ops'],'readwrite',async stores=>{
      const pending=await request(stores.ops.get(op.key));if(!pending)return;
      pending.conflict={server:server?copy(server):null,detectedAt:new Date().toISOString()};stores.ops.put(pending);
      const local=await request(stores[name].get(this.storeKey(op.entity,op.workoutId)));if(local?.id===op.workoutId)stores[name].put({...local,sync:'conflict'});
    });
  }
  async mergeRemote(values){
    await super.mergeRemote(values.filter(v=>!v.entity));
    await transaction(this.db,['templates','sessions','ops'],'readwrite',async stores=>{
      const docs=values.filter(v=>v.entity).sort((a,b)=>String(a.updatedAt).localeCompare(String(b.updatedAt)));
      for(const value of docs){
        const kind=value.entity,name=kind==='template'?'templates':'sessions',server=kind==='template'?validateTemplate(value):validateSession(value),key=this.storeKey(kind,server.id),opKey=this.docKey(kind,server.id);
        const local=await request(stores[name].get(key)),op=await request(stores.ops.get(opKey));
        if(op){
          if(server.revision!==op.baseRevision&&server.lastOperationId!==op.id){op.conflict={server,detectedAt:new Date().toISOString()};stores.ops.put(op);if(local?.id===server.id)stores[name].put({...local,sync:'conflict'});}continue;
        }
        if(kind==='session'&&local?.id!==server.id){
          if(server.deleted)continue;
          if(local&&!local.deleted){const otherOp=await request(stores.ops.get(this.docKey(kind,local.id)));if(otherOp){otherOp.conflict={server,detectedAt:new Date().toISOString()};stores.ops.put(otherOp);stores.sessions.put({...local,sync:'conflict'});continue;}}
        }
        if(!local||local.id!==server.id||server.revision>=local.revision)stores[name].put({...server,key,owner:this.owner,sync:'synced'});
      }
    });
  }
  resolveDocument(opKey,choice){
    return transaction(this.db,['workouts','drafts','templates','sessions','ops'],'readwrite',async stores=>{
      const op=await request(stores.ops.get(opKey));if(!op?.conflict)throw new Error('This conflict is already resolved.');
      if(!op.entity)throw new Error('Use the workout conflict resolution.');
      const kind=op.entity,name=kind==='template'?'templates':'sessions',server=op.conflict.server,key=this.storeKey(kind,op.workoutId);
      stores.ops.delete(opKey);
      if(choice==='server'){
        stores[name].delete(key);if(server)stores[name].put({...server,key:this.storeKey(kind,server.id),owner:this.owner,sync:'synced'});
      }else if(choice==='local'){
        const doc=copy(op.record);if(server&&server.id!==doc.id){stores[name].delete(key);doc.id=server.id;}
        await this.queueDocument(stores,kind,doc,server);
      }else throw new Error('Choose a version to keep.');
    });
  }
  importAll(backup,choices={}, {restoreActive=false,restoreLegacyDraft=false}={}){
    return transaction(this.db,['workouts','ops','drafts','settings','templates','sessions'],'readwrite',async stores=>{
      let imported=0,skipped=0;
      for(const incoming of backup.workouts){
        const byDate=await request(stores.workouts.index('ownerDate').get([this.owner,incoming.date])),byId=await request(stores.workouts.get(this.key(incoming.id)));
        if(byDate&&byId&&byDate.id!==byId.id)throw new Error('A backup ID and date match different records.');
        const old=byId||byDate;
        if(old&&contentKey(old)===contentKey(incoming)){skipped++;continue;}
        if(old&&choices[incoming.id]!=='replace'){skipped++;continue;}
        if(old?.sync==='conflict')throw new Error('Resolve cloud conflicts before replacing this workout.');
        await this.queue(stores,{...incoming,id:old?.id||incoming.id},old);imported++;
      }
      for(const incoming of backup.templates||[]){
        const old=await request(stores.templates.get(this.storeKey('template',incoming.id)));
        if(old&&documentContent(old)===documentContent(incoming)){skipped++;continue;}
        if(old&&choices[`template:${incoming.id}`]!=='replace'){skipped++;continue;}
        await this.queueDocument(stores,'template',incoming,old);imported++;
      }
      if(backup.activeSession&&restoreActive){
        const old=await request(stores.sessions.get(this.owner));
        if(old&&!old.deleted&&old.id!==backup.activeSession.id)await this.queueDocument(stores,'session',{...old,deleted:true,prompt:null},old);
        await this.queueDocument(stores,'session',backup.activeSession,old?.id===backup.activeSession.id?old:null);
      }
      if(backup.draft&&restoreLegacyDraft)stores.drafts.put({owner:this.owner,value:validateDraft(backup.draft)});
      stores.settings.put({owner:this.owner,value:copy(backup.settings)});return {imported,skipped};
    });
  }
}
