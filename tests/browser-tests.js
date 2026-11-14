import { openDatabase, Repository, DuplicateDateError, StaleEditError } from '../js/db.js';
import { newDraft, completeExercise, finalizeDraft, draftFromWorkout, validateDraft, clone, uuid, DEFAULT_SETTINGS } from '../js/domain.js';
import { createBackup, parseBackup, planImport } from '../js/backup.js';
import { Synchronizer } from '../js/sync.js';
import { AuthError, validateCloudConfig } from '../js/cloud.js';
import '../js/wheel.js';
const assert = (condition,message='Assertion failed') => { if(!condition) throw new Error(message); };
const equal = (actual,expected) => assert(JSON.stringify(actual)===JSON.stringify(expected),`Expected ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`);
const rejects = async (operation,type) => { try { await operation(); } catch(error) { if(type) assert(error instanceof type, error.message); return; } throw new Error('Expected rejection'); };
const workout = date => {const d=newDraft(date); completeExercise(d); return finalizeDraft(d);};
class FaultServer {
  constructor(){this.records=new Map();this.receipts=new Map();this.failBefore=false;this.loseResponse=false;this.expired=false;this.calls=0;}
  async push(op){
    this.calls++; if(this.expired) throw new AuthError('Expired test session'); if(this.failBefore) throw new Error('Connection failed');
    if(this.receipts.has(op.id)) return clone(this.receipts.get(op.id));
    const current=this.records.get(op.workoutId), sameDate=[...this.records.values()].find(w=>w.date===op.record.date&&w.id!==op.workoutId);
    if(sameDate) return {status:'conflict',record:clone(sameDate)};
    if((current?.revision||0)!==op.baseRevision) return {status:'conflict',record:current?clone(current):null};
    const record={...clone(op.record),revision:(current?.revision||0)+1,lastOperationId:op.id};
    this.records.set(record.id,record);const response={status:'ok',record};this.receipts.set(op.id,clone(response));
    if(this.loseResponse){this.loseResponse=false;throw new Error('Response lost after commit');} return response;
  }
  async pull(){if(this.expired)throw new AuthError('Expired test session');if(this.failBefore)throw new Error('Offline');return clone([...this.records.values()]);}
}
const tests=[]; const test=(name,body)=>tests.push({name,body});
test('Final workout, pending operation and draft removal commit together',async repo=>{
  const d=newDraft('2026-01-01');await repo.saveDraft(d);completeExercise(d);await repo.saveFinal(finalizeDraft(d));
  equal((await repo.all()).length,1);equal((await repo.operations()).length,1);equal(await repo.draft(),null);
});
test('Concurrent double save allows exactly one workout for a date',async repo=>{
  const a=workout('2026-01-01'),b=workout('2026-01-01');const results=await Promise.allSettled([repo.saveFinal(a),repo.saveFinal(b)]);
  equal(results.filter(r=>r.status==='fulfilled').length,1);assert(results.find(r=>r.status==='rejected').reason instanceof DuplicateDateError);equal((await repo.operations()).length,1);
});
test('A failed unique-date transaction leaves the draft and prior record intact',async repo=>{
  await repo.saveFinal(workout('2026-01-01'));const d=newDraft('2026-01-01');await repo.saveDraft(d);await rejects(()=>repo.saveFinal(workout('2026-01-01')),DuplicateDateError);
  equal((await repo.draft()).id,d.id);equal((await repo.all()).length,1);
});
test('Draft, selected set and hidden sets survive closing and reopening IndexedDB',async(repo,db)=>{
  const d=newDraft('2026-01-01');d.current=4;d.exercises[4].selectedSet=2;d.exercises[4].sets[2]={reps:7,weight:92.5};await repo.saveDraft(d);
  const second=await openDatabase(db.name);try{const restored=validateDraft(await new Repository(second,repo.owner).draft());equal(restored,d);}finally{second.close();}
});
test('Cached workouts, settings, operations and drafts are isolated by user',async(repo,db)=>{
  await repo.saveFinal(workout('2026-01-01'));await repo.saveDraft(newDraft());await repo.saveSettings({...DEFAULT_SETTINGS,defaultRepMode:'per-leg'});
  const other=new Repository(db,'other-user');equal(await other.all(),[]);equal(await other.operations(),[]);equal(await other.draft(),null);equal((await other.settings()).defaultRepMode,'total');
});
test('Offline final saves stay pending; reconnect synchronizes once',async repo=>{
  await repo.saveFinal(workout('2026-01-01'));const server=new FaultServer(),states=[];let online=false;
  const sync=new Synchronizer(repo,server,{online:()=>online,onState:s=>states.push(s.state),lock:fn=>fn()});await sync.run();equal(states.at(-1),'pending');equal(server.calls,0);
  online=true;await sync.run();await sync.run();equal(server.records.size,1);equal((await repo.operations()).length,0);equal(states.at(-1),'synced');
});
test('Lost server response is retried with the same operation ID without duplicates',async repo=>{
  await repo.saveFinal(workout('2026-01-01'));const server=new FaultServer();server.loseResponse=true;const states=[];
  const sync=new Synchronizer(repo,server,{online:()=>true,onState:s=>states.push(s.state),lock:fn=>fn()});const operation=(await repo.operations())[0].id;
  await sync.run();equal(states.at(-1),'failed');equal((await repo.operations())[0].id,operation);equal(server.records.size,1);
  await sync.run();equal(server.records.size,1);equal(server.records.values().next().value.revision,1);equal((await repo.operations()).length,0);
});
test('Expired authentication preserves pending work and cached history',async repo=>{
  await repo.saveFinal(workout('2026-01-01'));const server=new FaultServer();server.expired=true;let state;
  const sync=new Synchronizer(repo,server,{online:()=>true,onState:s=>state=s.state,lock:fn=>fn()});await sync.run();equal(state,'signin');equal((await repo.operations()).length,1);equal((await repo.all()).length,1);
  server.expired=false;await sync.run();equal(state,'synced');
});
test('Conflicting device and cloud edits are retained until explicit resolution',async repo=>{
  const saved=await repo.saveFinal(workout('2026-01-01'));const op=(await repo.operations())[0], serverRecord={...clone(saved),revision:2};serverRecord.exercises[0].sets[0].weight=80;
  await repo.markConflict(op,serverRecord);equal((await repo.all())[0].exercises[0].sets[0].weight,0);assert((await repo.operations())[0].conflict);
  await repo.resolve(saved.id,'local');const resolved=(await repo.operations())[0];equal(resolved.baseRevision,2);assert(resolved.id!==op.id);assert(!resolved.conflict);
});
test('Use cloud resolution replaces local values and clears the pending operation',async repo=>{
  const saved=await repo.saveFinal(workout('2026-01-01')),op=(await repo.operations())[0];const remote={...clone(saved),revision:3};remote.exercises[0].sets[0].weight=70;
  await repo.markConflict(op,remote);await repo.resolve(saved.id,'server');equal((await repo.all())[0].exercises[0].sets[0].weight,70);equal(await repo.operations(),[]);
});
test('A date collision on two devices resolves to the server UUID',async repo=>{
  const saved=await repo.saveFinal(workout('2026-01-01')),op=(await repo.operations())[0];const remote={...clone(saved),id:uuid(),revision:1};
  await repo.markConflict(op,remote);await repo.resolve(saved.id,'local');equal((await repo.all()).length,1);equal((await repo.all())[0].id,remote.id);equal((await repo.operations())[0].workoutId,remote.id);
});
test('Editing while an upload is in flight preserves the newer edit and rebases it',async repo=>{
  let saved=await repo.saveFinal(workout('2026-01-01'));const oldOp=(await repo.operations())[0];saved.exercises[0].sets[0].weight=45;await repo.saveFinal(saved,{editing:true});
  await repo.acknowledge(oldOp,{...oldOp.record,revision:1,lastOperationId:oldOp.id});equal((await repo.all())[0].exercises[0].sets[0].weight,45);equal((await repo.operations())[0].baseRevision,1);
});
test('A stale open draft cannot silently overwrite a newer saved version',async repo=>{
  const saved=await repo.saveFinal(workout('2026-01-01')),draft=draftFromWorkout(saved);saved.exercises[0].sets[0].weight=80;await repo.saveFinal(saved,{editing:true});
  await rejects(()=>repo.saveFinal(finalizeDraft(draft),{editing:true,baseRevision:draft.baseRevision,baseLocalVersion:draft.baseLocalVersion}),StaleEditError);equal((await repo.all())[0].exercises[0].sets[0].weight,80);
});
test('Deletion survives stale remote pulls and syncs as a tombstone',async repo=>{
  const saved=await repo.saveFinal(workout('2026-01-01')),op=(await repo.operations())[0];const remote={...clone(saved),revision:1,lastOperationId:op.id};await repo.acknowledge(op,remote);
  await repo.deleteWorkout(saved.id);await repo.mergeRemote([remote]);assert((await repo.all())[0].deleted);const server=new FaultServer();server.records.set(remote.id,remote);
  await new Synchronizer(repo,server,{online:()=>true,lock:fn=>fn()}).run();assert(server.records.get(saved.id).deleted);equal((await repo.operations()).length,0);
});
test('Deleted dates reuse their UUID and revision when explicitly logged again',async repo=>{
  const saved=await repo.saveFinal(workout('2026-01-01'));await repo.deleteWorkout(saved.id);const again=await repo.saveFinal(workout('2026-01-01'));equal(again.id,saved.id);assert(!again.deleted);equal((await repo.all()).length,1);
});
test('JSON import restores settings and draft; repeated imports do not duplicate',async repo=>{
  const d=newDraft('2026-01-02');d.current=5;const backup=parseBackup(JSON.stringify(createBackup([workout('2026-01-01')],{...DEFAULT_SETTINGS,defaultRepMode:'per-leg'},d)));
  equal((await repo.importBackup(backup)).imported,1);equal((await repo.importBackup(backup)).skipped,1);equal((await repo.all()).length,1);equal((await repo.settings()).defaultRepMode,'per-leg');equal(await repo.draft(),d);
});
test('Import conflicts require replacement; replacing uses the same sync queue',async repo=>{
  const original=await repo.saveFinal(workout('2026-01-01')),incoming=clone(original);incoming.exercises[0].sets[0].weight=50;const backup={workouts:[incoming],settings:clone(DEFAULT_SETTINGS),draft:null};
  equal(planImport(backup,await repo.all())[0].kind,'conflict');await repo.importBackup(backup);equal((await repo.all())[0].exercises[0].sets[0].weight,0);
  await repo.importBackup(backup,{[incoming.id]:'replace'});equal((await repo.all())[0].exercises[0].sets[0].weight,50);equal((await repo.operations()).length,1);
});
test('Cloud setup rejects secret/service-role keys and non-HTTPS URLs',async()=>{
  await rejects(async()=>validateCloudConfig('http://example.com','sb_publishable_test'));
  await rejects(async()=>validateCloudConfig('https://example.com','sb_secret_test'));
  const jwt=`e30.${btoa(JSON.stringify({role:'service_role'}))}.test`;await rejects(async()=>validateCloudConfig('https://example.com',jwt));
  equal(validateCloudConfig('https://example.com','sb_publishable_test').url,'https://example.com');
});
test('Wheel keyboard, mouse-wheel, bounds and synthetic touch drag handlers work',async()=>{
  const fixture=document.querySelector('#wheel-fixture');fixture.innerHTML='<number-wheel kind="reps" label="Test repetitions" value="10"></number-wheel>';const wheel=fixture.firstElementChild;
  wheel.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true}));equal(wheel.value,11);
  wheel.dispatchEvent(new WheelEvent('wheel',{deltaY:30,bubbles:true,cancelable:true}));equal(wheel.value,12);
  wheel.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}));equal(wheel.value,100);
  wheel.dispatchEvent(new WheelEvent('wheel',{deltaY:100,bubbles:true,cancelable:true}));equal(wheel.value,100);
  wheel.value=10;wheel.setPointerCapture=()=>{};
  wheel.dispatchEvent(new PointerEvent('pointerdown',{clientY:110,button:0,pointerId:1,pointerType:'touch',bubbles:true}));
  wheel.dispatchEvent(new PointerEvent('pointermove',{clientY:22,pointerId:1,pointerType:'touch',bubbles:true}));
  wheel.dispatchEvent(new PointerEvent('pointerup',{clientY:22,pointerId:1,pointerType:'touch',bubbles:true}));equal(wheel.value,12);
  assert(wheel.getAttribute('aria-valuenow')==='12');equal(wheel.querySelectorAll('.wheel-number').length,5);fixture.innerHTML='';
});
test('Workout layout fits 320, 375, 390 and 430 px without horizontal scrolling',async()=>{
  for(const width of [320,375,390,430]) {
    const frame=document.createElement('iframe');frame.title=`Responsive check ${width}px`;frame.style.cssText=`position:absolute;left:-10000px;top:0;width:${width}px;height:844px;border:0`;frame.src='../?dev=1';
    const loaded=new Promise(resolve=>frame.onload=resolve);document.body.append(frame);
    try{
      await loaded;
      for(let i=0;i<100&&!frame.contentDocument.querySelector('#exercise-name');i++)await new Promise(resolve=>setTimeout(resolve,30));
      const doc=frame.contentDocument;assert(doc.querySelector('#exercise-name'),`App did not initialize at ${width}px`);
      assert(doc.documentElement.scrollWidth<=width,`Horizontal overflow at ${width}px: ${doc.documentElement.scrollWidth}`);
      equal(doc.querySelectorAll('#exercise-name').length,1);equal(doc.querySelectorAll('number-wheel').length,3);
      for(const wheel of doc.querySelectorAll('number-wheel'))assert(wheel.getBoundingClientRect().width>50,`Wheel too narrow at ${width}px`);
    }finally{frame.remove();}
  }
});
document.querySelector('#run-tests').onclick=async()=>{
  const button=document.querySelector('#run-tests');button.disabled=true;const results=document.querySelector('#results');results.innerHTML='';let passed=0;
  for(const {name,body} of tests){const item=document.createElement('li');item.style.cssText='margin:12px 0;font-size:13px;overflow-wrap:anywhere';results.append(item);let db;
    try{db=await openDatabase(`form-disposable-test-${uuid()}`);await body(new Repository(db,'test-user'),db);passed++;item.textContent=`PASS · ${name}`;item.style.color='#30fed9';}
    catch(error){item.textContent=`FAIL · ${name}: ${error.message}`;item.style.color='#ffaaa5';console.error(name,error);}
    finally{if(db){const name=db.name;db.close();await new Promise((resolve,reject)=>{const req=indexedDB.deleteDatabase(name);req.onsuccess=resolve;req.onerror=()=>reject(req.error);});}}
    document.querySelector('#result-summary').textContent=`${passed} / ${tests.length} passed`;
  }
  button.disabled=false;document.title=`FORM checks: ${passed}/${tests.length} passed`;
};
