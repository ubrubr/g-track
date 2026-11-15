import { openDatabase } from '../js/db.js';
import { TrainingRepository } from '../js/training-db.js';
import { preparePreview } from './preview-fixtures.js';
import { trainingTotals, BORG_ANCHORS } from '../js/model.js';
const assert=(value,message='Assertion failed')=>{if(!value)throw new Error(message);};
const equal=(a,b)=>assert(JSON.stringify(a)===JSON.stringify(b),`Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
// Offscreen frames throttle requestAnimationFrame; allow async UI transactions to settle.
const settle=()=>new Promise(resolve=>setTimeout(resolve,40));
async function wait(check,message='Control did not update'){for(let i=0;i<160;i++){const value=await check();if(value)return value;await new Promise(resolve=>setTimeout(resolve,25));}throw new Error(message);}
let frame,db,repo,doc,name;
async function close(){if(frame){frame.remove();frame=null;}if(db){const old=db.name;db.close();db=null;await new Promise(resolve=>{const r=indexedDB.deleteDatabase(old);r.onsuccess=resolve;r.onerror=resolve;r.onblocked=resolve;});}}
async function launch(mode=null,width=390){await close();name=`gtrack-test-ui-${crypto.randomUUID()}`;if(mode)await preparePreview(name,mode);db=await openDatabase(name);repo=new TrainingRepository(db,'device');frame=document.createElement('iframe');frame.title='Disposable application under test';frame.style.cssText=`position:absolute;left:-10000px;top:0;width:${width}px;height:844px;border:0`;frame.src=`../?dev=1&db=${name}`;document.body.append(frame);await wait(()=>frame.contentDocument?.querySelector('[data-action="tab"]'));doc=frame.contentDocument;await settle(frame.contentWindow);}
async function click(selector){const el=await wait(()=>doc.querySelector(selector));assert(!el.disabled,`Disabled: ${selector}`);el.click();await settle(frame.contentWindow);}
function field(selector,value,event='input'){const el=doc.querySelector(selector);assert(el,`Missing input ${selector}`);el.value=value;el.dispatchEvent(new Event(event,{bubbles:true}));}
async function submit(selector){const form=doc.querySelector(selector);assert(form);form.requestSubmit();await settle(frame.contentWindow);}
async function modalClosed(){await wait(()=>!doc.querySelector('#modal').open);}
async function reload(selector){const before=frame.contentDocument;frame.contentWindow.location.reload();await wait(()=>frame.contentDocument!==before&&frame.contentDocument?.querySelector(selector),'Reload did not initialize');doc=frame.contentDocument;await settle();}
const tests=[],test=(name,body)=>tests.push({name,body});

test('Four sequential stages, custom exercises, accessible reordering and individual targets',async()=>{
  await launch();await click('[data-action="create-template"]');field('#template-name','Browser Leg Day');
  for(const id of ['squats','lunges']){await click('[data-action="add-exercise"]');await click(`[data-action="choose-exercise"][data-id="${id}"]`);}
  await click('[data-action="add-exercise"]');await click('[data-action="new-custom-exercise"]');field('#custom-exercise-name','Cable Pull Through');await submit('[data-submit="create-custom-exercise"]');await modalClosed();
  await click('[data-action="move-exercise"][data-index="2"][data-direction="-1"]');equal([...doc.querySelectorAll('.configure-exercise h2')].map(e=>e.textContent),['Squats','Cable Pull Through','Lunges']);
  await click('[data-action="add-exercise"]');await click('[data-action="choose-exercise"][data-id="abs"]');await click('[aria-label="Remove Abs"]');equal(doc.querySelectorAll('.configure-exercise').length,3);
  await click('[aria-label="Edit targets for Squats"]');field('#planned-set-count','4','change');await settle(frame.contentWindow);field('[aria-label="Target weight for set 1"]','60');field('[aria-label="Target weight for set 2"]','62.5');field('[aria-label="Target repetitions for set 4"]','11');field('#exercise-rest','45');await submit('#exercise-form');await modalClosed();
  await click('[data-action="save-template"]');await wait(()=>doc.querySelector('[data-action="start-session"]'));
  equal((await repo.all()).length,0);const t=(await repo.templates())[0];equal(t.exercises[0].plan.map(s=>s.targetWeight),[60,62.5,0,0]);equal(t.exercises[0].plan[3].targetReps,11);equal(t.exercises[0].restSeconds,45);
  await click('[data-action="start-session"]');await wait(()=>doc.querySelector('.set-table'));assert((await repo.active()).startedAt);equal((await repo.all()).length,0);assert(doc.querySelectorAll('number-wheel').length===0);
});
test('Set Start, Pause and Reset do not complete work or open Borg',async()=>{
  await click('[aria-label="Start or resume stopwatch for set 1"]');await wait(()=>doc.querySelector('[data-action="pause-set-timer"]'));assert((await repo.active()).exercises[0].sets[0].timer.runningSince!==null);
  await click('[data-action="pause-set-timer"]');assert((await repo.active()).exercises[0].sets[0].timer.runningSince===null);assert(!doc.querySelector('.borg-scale'));
  await click('[data-action="reset-set-timer"]');const s=(await repo.active()).exercises[0].sets[0];equal(s.completed,false);equal(s.durationSeconds,null);equal(s.timer.accumulatedMs,0);assert(!doc.querySelector('.borg-scale'));
  await click('[data-action="resume-set-timer"]');await click('[data-action="stop-set-timer"]');await wait(()=>doc.querySelector('.borg-scale'));
});
test('All 15 Borg values respond directly, no initial rating; reload retains pending completion',async()=>{
  equal(doc.querySelectorAll('[role="radio"]').length,15);assert(doc.querySelector('#confirm-rpe').disabled);equal(doc.querySelectorAll('[aria-checked="true"]').length,0);
  for(let rpe=6;rpe<=20;rpe++){await click(`[data-action="select-borg"][data-id="${rpe}"]`);equal(doc.querySelector('#borg-selected-value').textContent,String(rpe));equal(doc.querySelector('#borg-selected-description').textContent,BORG_ANCHORS[rpe-6]);equal(doc.querySelector('[aria-checked="true"]').dataset.id,String(rpe));}
  const token=(await repo.active()).prompt.token;await reload('.borg-scale');equal((await repo.active()).prompt.token,token);assert(doc.querySelector('#confirm-rpe').disabled,'Reload must start with no selected Borg rating');
  await click('[data-action="select-borg"][data-id="20"]');await click('[data-action="confirm-borg"]');await modalClosed();const s=(await repo.active()).exercises[0].sets[0];equal(s.borgRpe,20);equal(s.completed,true);equal(trainingTotals((await repo.active()).exercises).volume,600);
});
test('Rest Pause, +30, Resume and Skip remain independent; running stopwatch survives refresh',async()=>{
  await click('[data-action="pause-rest"]');const before=(await repo.active()).rest.remainingMs;await click('[data-action="extend-rest"]');equal((await repo.active()).rest.remainingMs,before+30000);await click('[data-action="resume-rest"]');equal((await repo.active()).rest.status,'running');await click('[data-action="skip-rest"]');equal((await repo.active()).rest.status,'skipped');
  await click('[aria-label="Start or resume stopwatch for set 2"]');const running=(await repo.active()).exercises[0].sets[1].timer.runningSince;await reload('.set-table');equal((await repo.active()).exercises[0].sets[1].timer.runningSince,running);assert(doc.querySelector('.set-row:nth-child(3) .set-timer').textContent.includes('running'));
  await click('[aria-label="Complete set 2"]');await click('[data-action="skip-borg"]');await modalClosed();equal((await repo.active()).exercises[0].sets[1].borgRpe,null);equal(trainingTotals((await repo.active()).exercises).volume,1225);
});
test('Add, skip completed exercise with confirmation, and restore preserve recorded values',async()=>{
  await click('[data-action="add-set"]');equal((await repo.active()).exercises[0].sets.length,5);await click('[data-action="skip-exercise"]');assert(doc.querySelector('#modal').open);await click('[data-action="confirm-action"]');await modalClosed();equal(trainingTotals((await repo.active()).exercises).volume,0);
  field('#active-exercise','0','change');await settle(frame.contentWindow);await click('[data-action="restore-exercise"]');equal(trainingTotals((await repo.active()).exercises).volume,1225);equal((await repo.active()).exercises[0].sets[0].borgRpe,20);
});
test('Finish saves only completed work once; history edits recalculate volume and Borg',async()=>{
  const finish=doc.querySelector('[data-action="finish-session"]');assert(finish.getBoundingClientRect().height>=60);await click('[data-action="finish-session"]');assert(doc.querySelector('#modal').textContent.includes('unfinished'));await click('[data-action="confirm-action"]');await wait(()=>doc.querySelector('[data-action="summary-analysis"]'));equal((await repo.all()).length,1);equal(await repo.active(),null);equal(trainingTotals((await repo.all())[0].exercises).sets,2);
  await click('[data-action="tab"][data-id="history"]');await click('[data-action="edit-workout"]');await wait(()=>doc.querySelector('.set-table'));await click('[aria-label="Edit completed set 1"]');field('#actual-weight','65');field('#recorded-set-rpe','14','change');await submit('#set-edit-form');await modalClosed();await click('[data-action="finish-session"]');await click('[data-action="confirm-action"]');await wait(()=>doc.querySelector('[data-action="summary-analysis"]'));equal((await repo.all()).length,1);equal(trainingTotals((await repo.all())[0].exercises).volume,1275);equal(trainingTotals((await repo.all())[0].exercises).rpe,14);
});
test('Interactive analysis filters, metrics, point details and linked history use recorded values',async()=>{
  await click('[data-action="summary-analysis"]');equal(doc.querySelector('[data-action="analysis-metric"][aria-pressed="true"]').dataset.id,'volume');await click('[data-action="chart-point"].chart-point');assert(doc.querySelector('#modal').textContent.includes('1275')||doc.querySelector('#modal').textContent.includes('1,275'));await click('[data-action="open-workout"]');await wait(()=>doc.querySelector('.history-card[open]'));
  await click('[data-action="tab"][data-id="analysis"]');await click('[data-action="analysis-metric"][data-id="rpe"]');assert(doc.querySelector('.chart-card').textContent.includes('14'));field('#analysis-exercise','squats','change');await settle(frame.contentWindow);for(const p of ['7d','30d','3m','6m','all'])await click(`[data-action="analysis-period"][data-id="${p}"]`);for(const metric of ['maxWeight','reps','duration','volume'])await click(`[data-action="analysis-metric"][data-id="${metric}"]`);assert(!doc.querySelector('#storage-error:not([hidden])'));
});
test('Template duplicate, rename, cancel and delete leave completed history unchanged',async()=>{
  await launch('home');const initial=(await repo.all()).length;await click('[data-action="template-menu"]');await click('[data-action="duplicate-template"]');await modalClosed();equal((await repo.templates()).filter(t=>!t.deleted).length,3);const copy=(await repo.templates()).find(t=>t.name.endsWith(' copy'));
  await click(`[data-action="template-menu"][data-id="${copy.id}"]`);await click('[data-action="rename-template"]');field('#new-template-name','Recovery Day');await submit('[data-submit="save-template-name"]');await modalClosed();assert((await repo.templates()).some(t=>t.name==='Recovery Day'));
  await click(`[data-action="select-template"][data-id="${copy.id}"]`);field('#template-name','Not saved');await click('[data-action="cancel-configuration"]');await click('[data-action="confirm-action"]');await modalClosed();equal((await repo.templates()).find(t=>t.id===copy.id).name,'Recovery Day');
  await click(`[data-action="template-menu"][data-id="${copy.id}"]`);await click('[data-action="delete-template"]');await click('[data-action="confirm-action"]');await modalClosed();equal((await repo.templates()).filter(t=>!t.deleted).length,2);equal((await repo.all()).length,initial);
});
test('Progression dismissal survives refresh; explicit acceptance changes only planned targets',async()=>{
  await click('[data-action="tab"][data-id="analysis"]');await click('[data-action="review-progression"]');const text=doc.querySelector('#modal').textContent;assert(text.includes('61.5'));const history=JSON.stringify(await repo.all());const chosen=doc.querySelector('#modal').textContent.includes('Squats')?'squats':'romanian-deadlift';await click('[data-action="dismiss-progression"]');await modalClosed();const remaining=doc.querySelectorAll('[data-action="review-progression"]').length;
  await reload('.analysis-title');equal(doc.querySelectorAll('[data-action="review-progression"]').length,remaining);equal(JSON.stringify(await repo.all()),history);
  await click('[data-action="review-progression"]');await click('[data-action="accept-progression"]');await modalClosed();equal(JSON.stringify(await repo.all()),history);assert((await repo.templates()).some(t=>t.exercises.some(e=>e.acceptedProgression)));assert(chosen);
});
test('Home, active, Borg and analysis fit 320/375/390/430/1280; footer and touch targets remain usable',async()=>{
  for(const width of [320,375,390,430,1280])for(const mode of ['home','active','borg','analysis']){
    await launch(mode,width);assert(doc.documentElement.scrollWidth<=width,`${mode} overflows ${width}px: ${doc.documentElement.scrollWidth}`);
    if(mode==='active'){const rect=doc.querySelector('[data-action="finish-session"]').getBoundingClientRect(),nav=doc.querySelector('.bottom-nav').getBoundingClientRect();assert(rect.height>=60);assert(rect.bottom<=nav.top+1,`Finish overlaps navigation at ${width}px`);assert(rect.left>=0&&rect.right<=width);}
    if(mode==='borg'){assert(doc.querySelector('#confirm-rpe').disabled);for(const value of doc.querySelectorAll('.borg-value'))assert(value.getBoundingClientRect().width>=44);assert(doc.querySelector('.borg-scale').scrollWidth>doc.querySelector('.borg-scale').clientWidth||width>=800);}
  }
});
document.querySelector('#run-tests').onclick=async()=>{const button=document.querySelector('#run-tests');button.disabled=true;let passed=0;const results=document.querySelector('#results');results.innerHTML='';for(const {name,body} of tests){const item=document.createElement('li');item.style.cssText='margin:12px 0;font-size:13px;overflow-wrap:anywhere';results.append(item);try{await body();passed++;item.textContent=`PASS · ${name}`;item.style.color='#30fed9';}catch(error){item.textContent=`FAIL · ${name}: ${error.message}`;item.style.color='#ffaaa5';console.error(name,error);}document.querySelector('#result-summary').textContent=`${passed} / ${tests.length} passed`;}await close();button.disabled=false;document.title=`G-Track training checks: ${passed}/${tests.length} passed`;};
