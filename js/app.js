import { ALL_EXERCISES, EXERCISES, CUSTOM_GROUPS, customId, DEFAULT_SETTINGS, localDate, validDate, formatDate, number, validateSettings, validateDraft, contentKey } from './domain.js';
import { openDatabase, getMeta, setMeta, DuplicateDateError, StaleEditError } from './db.js';
import { TrainingRepository, ActiveSessionError, StaleDocumentError, documentContent } from './training-db.js';
import { Auth, Cloud } from './cloud.js';
import { Synchronizer } from './sync.js';
import * as M from './model.js';
import { analyze, progressionSuggestion, progressionKey, progressionToken, acceptProgression, changeBetween } from './analysis.js';
import { planImport } from './backup.js';
import { escape as h, icon, button, openSheet, closeSheet, sheetError, toast, setTable, metricValue, unitFor, changeLabel } from './ui.js';
import * as Views from './views.js';
import { exerciseEditor, setEditor } from './editors.js';
import { settingsPanel } from './settings.js';

const $=selector=>document.querySelector(selector),main=$('#main'),modal=$('#modal');
let db,auth,repo,cloud,synchronizer,records=[],templates=[],settings={...DEFAULT_SETTINGS,restSound:false,haptics:false,customExercises:[]},legacyDraft=null,legacyArchived=false;
let state={tab:'workout',stage:'home',date:localDate(),config:null,selectedTemplate:null,session:null,summary:null,historyId:null};
let dismissedProgressions={},filters={period:'30d',templateId:'*',exerciseId:'*',variation:'*',metric:'volume',selectedId:null,relationship:'volume'};
let busy=false,initialized=false,generation=0,syncState={state:'device',pending:0},retryTimer,retryDelay=3000,pendingConfirm=null,selectedRpe=null,timerContext=null,staleAttempt=null,configuration=null,audioContext;
const statusLabels={device:'Saved on device',signin:'Sign in to sync',syncing:'Syncing…',pending:'Sync pending',synced:'Synced',failed:'Sync failed',conflict:'Review conflict',upgrade:'Cloud upgrade required'};
const liveTemplates=()=>templates.filter(t=>!t.deleted);
const currentExercise=()=>state.session?.exercises[state.session.current];
function storageError(error){$('#storage-error').hidden=false;$('#storage-error').textContent=error.name==='QuotaExceededError'?'Device storage is full. Keep this page open and export a JSON backup.':'Device storage could not be saved. Keep this page open and export a backup before retrying.';}
function isStorageError(error){return ['QuotaExceededError','UnknownError','AbortError','InvalidStateError'].includes(error.name);}
async function task(fn){if(busy)return;busy=true;try{return await fn();}catch(error){handleError(error);throw error;}finally{busy=false;}}
function handleError(error){
  if(error instanceof ActiveSessionError){state.session=error.session;showActiveChoice();return;}
  if(error instanceof DuplicateDateError){confirmDialog('A workout already exists',`Open the saved workout for ${formatDate(error.record.date)}, or choose another date before saving this session.`,'Open saved workout',()=>openHistory(error.record.id));return;}
  if(error instanceof StaleDocumentError||error instanceof StaleEditError){showStale(error.record);return;}
  if(isStorageError(error))storageError(error);
  if(modal.open)sheetError(error);else toast(error.message||'Could not complete that action.');
}
function confirmDialog(title,message,label,callback,destructive=false){pendingConfirm=callback;openSheet(title,`<p class="sheet-description">${h(message)}</p><div class="sheet-actions">${button(h(label),'confirm-action',destructive?'destructive full':'primary full')}${button('Cancel','close-sheet','neutral full')}</div>`);}
function selectedDate(){return state.tab==='workout'&&state.stage==='active'&&state.session?state.session.date:state.tab==='workout'&&state.stage==='summary'&&state.summary?state.summary.date:state.date;}
function renderChrome(){
  const date=selectedDate(),back=state.tab==='workout'&&state.stage!=='home';
  $('#app-chrome').innerHTML=`<button class="icon-button bare" data-action="${back?'back':'settings'}" aria-label="${back?'Back':'Synchronization and settings'}">${icon(back?'back':'sync')}</button><label class="date-pill">${icon('calendar')}<span>${formatDate(date,{weekday:'short'})}</span><input id="workout-date" type="date" value="${date}" min="1900-01-01" max="2200-12-31" aria-label="Workout date"></label><button class="icon-button bare" data-action="settings" aria-label="Settings">${icon('settings')}</button><button class="sync-caption" id="sync-status" data-state="${syncState.state}" data-action="settings" aria-label="Synchronization: ${h(statusLabels[syncState.state])}"><span class="sync-dot" aria-hidden="true"></span><span>${statusLabels[syncState.state]}</span></button>`;
  $('.bottom-nav').innerHTML=[['workout','WORKOUT'],['history','HISTORY'],['analysis','ANALYSIS']].map(([tab,label])=>`<button data-action="tab" data-id="${tab}" ${state.tab===tab?'aria-current="page"':''}>${icon(tab)}<span>${label}</span></button>`).join('');
}
function updateSyncCaption(){const el=$('#sync-status');if(el){el.dataset.state=syncState.state;el.setAttribute('aria-label',`Synchronization: ${statusLabels[syncState.state]}`);el.querySelector('span:last-child').textContent=statusLabels[syncState.state];}}
function render({scroll=false}={}){
  if(!repo)return;renderChrome();main.className='';$('#page-footer').innerHTML='';
  if(state.tab==='history')main.innerHTML=Views.historyView(records,state.historyId);
  else if(state.tab==='analysis')main.innerHTML=Views.analysisView(records,templates,filters,dismissedProgressions);
  else if(state.stage==='configure'&&state.config){main.innerHTML=Views.configurationView(state.config);setFooter(`${button('SAVE WORKOUT','save-template','primary large full')}<button class="text-button" data-action="cancel-configuration">CANCEL</button>`);}
  else if(state.stage==='start'&&state.selectedTemplate){main.innerHTML=Views.startView(state.selectedTemplate);setFooter(`${button(`START ${h(state.selectedTemplate.name).toUpperCase()}`,'start-session','primary large full')}<button class="text-button" data-action="back-to-edit">BACK TO EDIT</button>`);}
  else if(state.stage==='active'&&state.session){main.innerHTML=Views.activeView(state.session,records,dismissedProgressions);setFooter(button(state.session.editing?'SAVE WORKOUT CHANGES':'FINISH AND SAVE WORKOUT','finish-session','primary large full'));}
  else if(state.stage==='summary'&&state.summary)main.innerHTML=Views.summaryView(state.summary,records);
  else {state.stage='home';main.innerHTML=Views.homeView({templates,session:state.session,legacyDraft:legacyArchived?null:legacyDraft,configuration});}
  if(scroll)window.scrollTo({top:0,behavior:'instant'});
  persistNavigation();
}
function setFooter(html){main.classList.add('has-footer');$('#page-footer').innerHTML=`<div class="page-footer">${html}</div>`;}
function persistNavigation(){if(db&&repo)setMeta(db,`ui:${repo.owner}`,{tab:state.tab,stage:state.stage,date:state.date,historyId:state.historyId,templateId:state.selectedTemplate?.id||null,summaryId:state.summary?.id||null}).catch(storageError);}
async function refreshData({active=true}={}){
  const source=repo,version=generation;const [workouts,savedTemplates,savedSession]=await Promise.all([source.all(),source.templates(),active?source.active():Promise.resolve(null)]);
  if(source!==repo||version!==generation)return;
  records=workouts;templates=savedTemplates;
  if(active&&!busy){
    if(!state.session&&savedSession)state.session=savedSession;
    else if(state.session&&savedSession?.id===state.session.id){if(!modal.open||documentContent(savedSession)===documentContent(state.session))state.session=savedSession;}
    else if(state.session&&!savedSession&&state.stage==='active'){state.session=null;state.stage='home';toast('This session was finished or discarded on another device.');}
  }
  if(state.summary){const saved=records.find(w=>w.id===state.summary.id);if(saved)state.summary=saved;}
}
async function activateOwner(){
  generation++;const version=generation;clearTimeout(retryTimer);repo=new TrainingRepository(db,auth.owner);cloud=auth.session?new Cloud(auth,repo.owner):null;
  settings={...DEFAULT_SETTINGS,restSound:false,haptics:false,customExercises:[],...await repo.settings()};document.documentElement.classList.toggle('reduce-motion',settings.reducedMotion);
  [records,templates,state.session,legacyDraft,configuration]=await Promise.all([repo.all(),repo.templates(),repo.active(),repo.draft(),getMeta(db,`configuration:${repo.owner}`)]);
  legacyArchived=(await getMeta(db,`legacy-migrated:${repo.owner}`))===legacyDraft?.id;
  dismissedProgressions=await getMeta(db,`dismissed-progressions:${repo.owner}`)||{};
  const nav=await getMeta(db,`ui:${repo.owner}`);state={...state,tab:nav?.tab||'workout',stage:'home',date:validDate(nav?.date)?nav.date:localDate(),historyId:nav?.historyId||null,summary:null,config:null,selectedTemplate:null};
  if(nav?.stage==='active'&&state.session){state.stage='active';}
  if(state.session?.prompt){state.stage='active';state.tab='workout';}
  if(nav?.stage==='summary'&&nav.summaryId){state.summary=records.find(w=>!w.deleted&&w.id===nav.summaryId)||null;if(state.summary)state.stage='summary';}
  syncState={state:auth.session?'device':'signin',pending:(await repo.operations()).length};
  synchronizer=new Synchronizer(repo,cloud,{onState:value=>{
    if(version!==generation)return;syncState=value;updateSyncCaption();
    if(value.state!=='syncing')refreshData().then(()=>{if(version===generation&&!busy&&!modal.open)render();}).catch(storageError);
    if(value.state==='failed'&&document.visibilityState==='visible'){clearTimeout(retryTimer);retryTimer=setTimeout(requestSync,retryDelay);retryDelay=Math.min(60000,retryDelay*2);}else if(value.state==='synced')retryDelay=3000;
  }});
  render();if(state.session?.prompt)showBorg();else if(state.stage==='active'&&state.session){const running=state.session.exercises.some(e=>e.sets.some(s=>s.timer.runningSince!==null));toast(`Workout restored · ${running?'set stopwatch running':'timers paused or not started'}`);}
  requestSync();
}
function requestSync(){clearTimeout(retryTimer);synchronizer?.run().catch(error=>{syncState={state:'failed',message:error.message};updateSyncCaption();});}
async function saveConfiguration(){if(state.config)await setMeta(db,`configuration:${repo.owner}`,state.config);configuration=state.config?M.copy(state.config):null;}
async function mutateSession(fn,{rerender=true,sync=true}={}){
  if(!state.session)throw new Error('No active workout.');const before=M.copy(state.session);
  try{fn(state.session);state.session=M.validateSession(state.session);staleAttempt={entity:'session',value:M.copy(state.session)};state.session=await repo.saveActive(state.session);staleAttempt=null;$('#storage-error').hidden=true;if(rerender)render();if(sync)requestSync();return state.session;}
  catch(error){state.session=before;throw error;}
}
function library(){const map=new Map([...ALL_EXERCISES,{id:'custom',name:'Custom Workout'}].map(e=>[e.id,{...e}]));for(const e of settings.customExercises||[])map.set(e.id,e);for(const value of [...templates,...records,state.session].filter(Boolean))for(const e of value.exercises)map.set(e.exerciseId,{id:e.exerciseId,name:e.name});return [...map.values()];}
function openLibrary(){
  openSheet('Add exercise',`<label class="sr-only" for="exercise-search">Search exercises</label><input class="library-search" id="exercise-search" type="search" placeholder="Search exercises" autocomplete="off"><div class="library-list">${library().sort((a,b)=>a.name.localeCompare(b.name)).map(e=>`<button class="library-option" data-action="choose-exercise" data-id="${h(e.id)}" data-search="${h(e.name.toLowerCase())}"><span>${h(e.name)}</span>${icon('plus')}</button>`).join('')}</div><div class="sheet-actions">${button(`${icon('plus')}CREATE CUSTOM EXERCISE`,'new-custom-exercise','neutral full')}</div><p class="field-help">The original exercise library and all popular custom choices are available here.</p>`);
  $('#exercise-search').oninput=event=>{const term=event.target.value.trim().toLowerCase();modal.querySelectorAll('[data-search]').forEach(el=>el.hidden=!el.dataset.search.includes(term));};
}
function openTemplateMenu(id){const t=templates.find(t=>t.id===id);if(!t)return;openSheet(t.name,`<div class="menu-list">${button(`${icon('edit')}Edit workout`,'select-template','neutral',`data-id="${id}"`)}${button(`${icon('copy')}Duplicate`,'duplicate-template','neutral',`data-id="${id}"`)}${button('Rename','rename-template','neutral',`data-id="${id}"`)}${button(`${icon('trash')}Delete template`,'delete-template','destructive',`data-id="${id}"`)}</div>`);}
function showActiveChoice(next=null){if(next)pendingConfirm=next;openSheet('A workout is in progress',`<p class="sheet-description">${h(state.session?.name||'Your workout')} is saved on this device. Resume it or explicitly discard it before starting another.</p><div class="sheet-actions">${button('RESUME WORKOUT','resume-session','primary full')}${button('Discard unfinished workout','discard-for-next','destructive full')}</div>`);}
async function openHistory(id){closeSheet();state.tab='history';state.historyId=id;render({scroll:true});requestAnimationFrame(()=>document.querySelector(`[data-workout="${id}"]`)?.scrollIntoView({block:'start',behavior:settings.reducedMotion?'auto':'smooth'}));}
function showBorg(){
  const prompt=state.session?.prompt;if(!prompt)return;selectedRpe=null;
  openSheet('HOW HARD WAS THAT SET?',`<p class="borg-subtitle">Rate your perceived exertion</p><div class="borg-selected" aria-live="polite"><strong id="borg-selected-value">—</strong><p id="borg-selected-description">Select your Borg RPE (6–20)</p></div><div class="borg-scale" role="radiogroup" aria-label="Borg Rating of Perceived Exertion, 6 to 20">${M.BORG_ANCHORS.map((description,i)=>`<button class="borg-value" type="button" role="radio" aria-checked="false" aria-label="${i+6} · ${h(description)}" tabindex="${i===0?'0':'-1'}" data-action="select-borg" data-id="${i+6}" style="background:${M.borgColor(i+6)}">${i+6}</button>`).join('')}</div><div class="borg-scale-labels"><span>6 · No exertion</span><span>20 · Maximal exertion</span></div><div class="sheet-actions">${button('CONFIRM RPE','confirm-borg','primary large full','disabled id="confirm-rpe"')}<button class="text-button" data-action="skip-borg">SKIP RPE</button></div>`,{type:'borg',closable:false});
}
function selectBorg(value){
  if(!Number.isInteger(value)||value<6||value>20)return;selectedRpe=value;$('#borg-selected-value').textContent=value;$('#borg-selected-description').textContent=M.borgDescription(value);$('#confirm-rpe').disabled=false;
  modal.querySelectorAll('.borg-value').forEach(b=>{const selected=Number(b.dataset.id)===value;b.setAttribute('aria-checked',String(selected));b.tabIndex=selected?0:-1;});
  modal.querySelector(`.borg-value[data-id="${value}"]`)?.scrollIntoView({inline:'center',block:'nearest',behavior:settings.reducedMotion?'auto':'smooth'});
}
async function completeSet(id){const e=currentExercise(),set=e.sets.find(s=>s.id===id);if(set.completed){openSetEditor(id);return;}await mutateSession(s=>M.beginCompletion(s,e.id,id));showBorg();}
function openSetEditor(id,focus='weight'){const e=currentExercise(),set=e.sets.find(s=>s.id===id);if(!set)return;setEditor(e,set,changes=>task(async()=>{await mutateSession(s=>{const target=M.getSet(s,e.id,id).set;Object.assign(target,changes);if('durationSeconds'in changes){target.timer={accumulatedMs:(changes.durationSeconds||0)*1000,runningSince:null,touched:changes.durationSeconds!==null};}});}),{focus});}
function showTimer(id){
  const e=currentExercise(),set=e.sets.find(s=>s.id===id);timerContext={exerciseId:e.id,setId:id};
  openSheet(`${e.name} · set ${e.sets.indexOf(set)+1}`,`<p class="timer-display" data-modal-timer="${id}">${M.formatTime(M.timerElapsed(set.timer)/1000)}</p><p class="timer-state">${set.timer.runningSince===null?'Paused':'Stopwatch running'}</p><div class="timer-actions">${button(`${icon(set.timer.runningSince===null?'play':'pause')}${set.timer.runningSince===null?'START':'PAUSE'}`,set.timer.runningSince===null?'resume-set-timer':'pause-set-timer','neutral')}${button(`${icon('stop')}STOP`,'stop-set-timer','primary')}</div><div class="sheet-actions">${button('RESET','reset-set-timer','neutral full')}</div>`,{type:'stopwatch'});
}
async function performFinish(){
  const before=M.copy(state.session);staleAttempt={entity:'workout',value:before};
  const saved=await repo.finish(state.session);state.session=null;state.summary=saved;state.stage='summary';state.tab='workout';staleAttempt=null;legacyDraft=null;closeSheet();await refreshData({active:false});render({scroll:true});toast('Workout saved on device.');requestSync();
}
function showStale(existing){
  const attempted=staleAttempt;if(!attempted){toast('This record changed. Reopen it before editing.');return;}attempted.existing=existing;
  const describe=value=>value?`<h3>${h(value.name||'Workout')}</h3><p>${value.deleted?'Deleted':`${value.exercises?.length||0} exercises`}</p>`:'<p>No saved version</p>';
  openSheet('Review newer changes',`<p class="sheet-description">This document changed after you opened it. Choose a version before saving.</p><div class="comparison-columns"><div><h3>Your changes</h3>${describe(attempted.value)}</div><div><h3>Saved version</h3>${describe(existing)}</div></div><div class="sheet-actions">${button('KEEP MY CHANGES','keep-stale','primary full')}${button('USE SAVED VERSION','use-stale','neutral full')}</div>`);
}
const settingsContext={get:()=>({auth,repo,settings,session:state.session,records,templates,syncState,statusLabels}),onAccount:activateOwner,onSettings:async value=>{settings=validateSettings(value);await repo.saveSettings(settings);document.documentElement.classList.toggle('reduce-motion',settings.reducedMotion);},enableSound:async()=>{const Ctx=window.AudioContext||window.webkitAudioContext;if(Ctx){audioContext=audioContext||new Ctx();await audioContext.resume();}},confirm:confirmDialog,importBackup:showImport};
function soundRest(){if(settings.haptics&&navigator.vibrate)navigator.vibrate([140,80,140]);if(settings.restSound&&audioContext?.state==='running'){const oscillator=audioContext.createOscillator(),gain=audioContext.createGain();oscillator.frequency.value=660;gain.gain.value=.06;oscillator.connect(gain);gain.connect(audioContext.destination);oscillator.start();oscillator.stop(audioContext.currentTime+.22);}}

let importContext=null,progressionContext=null,conflictContext=null;
function showImport(backup){
  const plan=planImport(backup,records),conflicts=plan.filter(p=>p.kind==='conflict'),templateConflicts=(backup.templates||[]).filter(t=>{const old=templates.find(x=>x.id===t.id);return old&&documentContent(old)!==documentContent(t);});importContext=backup;
  openSheet('Restore backup',`<p class="sheet-description">${plan.filter(p=>p.kind==='new').length} new workouts · ${plan.filter(p=>p.kind==='duplicate').length} duplicates skipped. ${backup.templates?.length||0} templates.<br>Backup settings will be restored. Choose how to handle changed records.</p>${conflicts.map(p=>`<div class="import-row"><strong>${formatDate(p.incoming.date)} · ${h(p.incoming.name||'Workout')}</strong><p>Device: ${M.trainingTotals(p.existing.exercises).sets} sets. Backup: ${M.trainingTotals(p.incoming.exercises).sets} sets.</p><select data-import-key="${p.incoming.id}" aria-label="Version for ${p.incoming.date}"><option value="keep">Keep existing workout</option><option value="replace">Use backup version</option></select></div>`).join('')}${templateConflicts.map(t=>`<div class="import-row"><strong>${h(t.name)}</strong><select data-import-key="template:${t.id}" aria-label="Template version for ${h(t.name)}"><option value="keep">Keep existing template</option><option value="replace">Use backup template</option></select></div>`).join('')}${backup.activeSession?`<label class="checkbox-row"><input id="restore-active" type="checkbox">Restore the backup's unfinished workout${state.session?' and replace this active session':''}</label>`:''}${backup.draft?'<label class="checkbox-row"><input id="restore-legacy" type="checkbox">Restore earlier-version draft</label>':''}<div class="sheet-actions">${button('RESTORE BACKUP','confirm-import','primary large full')}</div>`);
}
function showConflict(key){
  repo.operations().then(ops=>{
    const op=ops.find(o=>o.key===key&&o.conflict);if(!op)return;conflictContext=op;
    const describe=record=>!record?'<p>No cloud record</p>':`<h3>${h(record.name||record.date||'Workout')}</h3><p>${record.deleted?'Deleted':`${record.exercises.length} exercises`}</p>${record.exercises.map(e=>`<p style="margin-top:9px">${h(e.name)}<br>${(e.plan||e.sets).map(s=>`${s.targetReps??s.reps} × ${s.targetWeight??s.weight} kg${s.borgRpe!=null?` · Borg ${s.borgRpe}`:''}`).join('<br>')}</p>`).join('')}`;
    openSheet('Choose a version',`<p class="sheet-description">Both versions stay available until you choose. The selected device version is submitted against the cloud revision.</p><div class="comparison-columns"><div><h3>This device</h3>${describe(op.record)}</div><div><h3>Cloud</h3>${describe(op.conflict.server)}</div></div><div class="sheet-actions">${button('KEEP THIS DEVICE','resolve-local','primary full')}${button('USE CLOUD VERSION','resolve-server','neutral full')}</div>`);
  }).catch(handleError);
}
function showPoint(id){
  const data=analyze(records,filters),point=data.rows.find(p=>p.workoutId===id);if(!point)return;filters.selectedId=id;render();
  openSheet(formatDate(point.date,{weekday:'short'}),`<h3>${h(point.name)}</h3><div class="comparison-card"><p class="compare-value">${metricValue(point[filters.metric],filters.metric)} <small>${unitFor(filters.metric)}</small></p><p class="caption">${changeLabel(changeBetween(point[filters.metric],point.previous?.[filters.metric]),filters.metric)}</p>${point.previous?`<p class="field-help">Previous: ${metricValue(point.previous[filters.metric],filters.metric)} · ${formatDate(point.previous.date)}</p>`:''}</div>${point.exercises.map(Views.recordExercise).join('')}<div class="sheet-actions">${button('OPEN WORKOUT','open-workout','primary full',`data-id="${id}"`)}</div>`,{wide:true});
}
function showProgression(templateId,exerciseId,active=false){
  const template=templates.find(t=>t.id===templateId),exercise=active?currentExercise():template?.exercises.find(e=>e.id===exerciseId);if(!exercise)return;
  const suggestion=progressionSuggestion(exercise,records,{templateId:active?state.session.templateId:template.id,beforeDate:active?state.session.date:'2200-12-31'});if(!suggestion){toast('Not enough comparable completed sessions for a suggestion.');return;}
  progressionContext={templateId,exerciseId,suggestion,active};
  openSheet('Suggested progression',`<h3>${h(exercise.name)}</h3><p class="timer-display" style="font-size:35px">${number(suggestion.toWeight)} <small>kg</small></p><p class="sheet-description">${h(suggestion.explanation)}</p><p class="field-help">${active?'Only pending set targets in this session will change. Completed sets and the saved template stay unchanged.':'Only this saved template’s planned weights will change. Historical workouts stay unchanged.'}</p><div class="sheet-actions">${button('ACCEPT SUGGESTION','accept-progression','primary full')}${button('DISMISS','dismiss-progression','neutral full')}</div>`);
}
async function editWorkout(id){
  const workout=records.find(w=>w.id===id&&!w.deleted);if(!workout)throw new Error('Workout unavailable.');
  if(state.session){if(state.session.editing&&state.session.id===id){state.tab='workout';state.stage='active';closeSheet();render({scroll:true});return;}showActiveChoice(()=>editWorkout(id));return;}
  state.session=await repo.saveActive(M.sessionFromWorkout(workout),{starting:true});state.tab='workout';state.stage='active';closeSheet();render({scroll:true});requestSync();
}
function openSessionDetails(){
  const e=currentExercise();openSheet('Exercise details',`<form id="session-details-form" data-submit="save-session-details"><div class="field"><label for="session-name">Workout name</label><input id="session-name" name="name" maxlength="80" value="${h(state.session.name)}" required></div><div class="field"><label for="session-variation">Equipment or variation</label><input id="session-variation" name="variation" maxlength="120" value="${h(e.variation)}"></div><div class="form-grid"><div class="field"><label for="session-rep-mode">Repetition convention</label><select id="session-rep-mode" name="repMode"><option value="total" ${e.repMode==='total'?'selected':''}>Total reps</option><option value="per-leg" ${e.repMode==='per-leg'?'selected':''}>Reps per leg</option></select></div><div class="field"><label for="session-rest">Rest target · seconds</label><input id="session-rest" name="rest" type="number" min="0" max="3600" step="1" value="${e.restSeconds}" inputmode="numeric" required></div></div><div class="field"><label for="session-notes">Exercise notes</label><textarea id="session-notes" name="notes" maxlength="2000">${h(e.notes)}</textarea></div><p class="field-help">Use combined external load; 0 kg means bodyweight. Per-leg sets include both legs in volume and total reps. Rest is a target, not measured rest.</p><button class="button primary full" type="submit">SAVE DETAILS</button></form>`);
}
const actions={
  'close-sheet':()=>closeSheet(),
  'confirm-action':async()=>{const fn=pendingConfirm;pendingConfirm=null;if(fn)await fn();},
  'settings':()=>settingsPanel(settingsContext),
  'settings-sync':async()=>{await synchronizer.run();await refreshData();await settingsPanel(settingsContext);},
  'review-conflict':target=>showConflict(target.dataset.id),
  'tab':async target=>{state.tab=target.dataset.id;if(state.tab==='analysis')filters.metric='volume';if(state.tab==='workout'&&state.session)state.stage='active';await refreshData({active:false});render({scroll:true});if(state.tab==='workout'&&state.session?.prompt)showBorg();},
  'home':()=>{closeSheet();state.tab='workout';state.stage='home';state.date=localDate();render({scroll:true});},
  'back':async()=>{if(state.stage==='configure')return actions['cancel-configuration']();if(state.stage==='start')return actions['back-to-edit']();state.stage='home';render({scroll:true});},
  'create-template':async()=>{state.config=M.blankTemplate();state.stage='configure';state.tab='workout';await saveConfiguration();render({scroll:true});},
  'resume-configuration':()=>{state.config=M.copy(configuration);state.stage='configure';state.tab='workout';render({scroll:true});},
  'select-saved':()=>openSheet('Saved workouts',`<div class="menu-list">${liveTemplates().map(t=>button(h(t.name),'select-template','neutral full',`data-id="${t.id}"`)).join('')}</div>`),
  'select-template':async target=>{const t=templates.find(t=>t.id===target.dataset.id&&!t.deleted);if(!t)throw new Error('Template unavailable.');state.config=M.copy(t);state.selectedTemplate=t;state.stage='configure';state.tab='workout';closeSheet();await saveConfiguration();render({scroll:true});},
  'template-menu':target=>openTemplateMenu(target.dataset.id),
  'duplicate-template':async target=>{const source=templates.find(t=>t.id===target.dataset.id),duplicate=M.copy(source);duplicate.id=M.newId();duplicate.name=`${source.name.slice(0,70)} copy`;duplicate.revision=0;delete duplicate.localVersion;delete duplicate.lastOperationId;await repo.saveTemplate(duplicate);await refreshData({active:false});closeSheet();render();requestSync();toast('Template duplicated.');},
  'rename-template':target=>{const t=templates.find(t=>t.id===target.dataset.id);openSheet('Rename workout',`<form data-submit="save-template-name"><input type="hidden" name="id" value="${t.id}"><div class="field"><label for="new-template-name">Workout name</label><input id="new-template-name" name="name" maxlength="80" value="${h(t.name)}" required></div><button type="submit" class="button primary full">SAVE NAME</button></form>`);},
  'save-template-name':async(form)=>{const data=new FormData(form),t=M.copy(templates.find(t=>t.id===data.get('id')));t.name=data.get('name').trim();staleAttempt={entity:'template',value:t};await repo.saveTemplate(t);staleAttempt=null;await refreshData({active:false});closeSheet();render();requestSync();},
  'delete-template':target=>{const t=templates.find(t=>t.id===target.dataset.id);confirmDialog('Delete this template?',`Remove ${t.name} from saved workouts? Completed history and any active snapshot stay unchanged.`,'Delete template',async()=>{await repo.deleteTemplate(t.id);await refreshData({active:false});closeSheet();render();requestSync();},true);},
  'cancel-configuration':()=>confirmDialog('Leave configuration?','The saved template will stay unchanged. Discard this unfinished configuration?','Discard changes',async()=>{state.config=null;configuration=null;await setMeta(db,`configuration:${repo.owner}`,null);closeSheet();state.stage='home';render({scroll:true});}),
  'save-template':async()=>{const form=$('#configuration-form');if(!form.reportValidity())return;state.config.name=$('#template-name').value.trim();const valid=M.validateTemplate(state.config);staleAttempt={entity:'template',value:{...valid,localVersion:state.config.localVersion}};const saved=await repo.saveTemplate({...valid,localVersion:state.config.localVersion});staleAttempt=null;state.selectedTemplate=saved;state.config=null;configuration=null;await setMeta(db,`configuration:${repo.owner}`,null);await refreshData({active:false});state.stage='start';render({scroll:true});toast('Template saved. Your workout has not started yet.');requestSync();},
  'back-to-edit':async()=>{state.config=M.copy(state.selectedTemplate);state.stage='configure';await saveConfiguration();render({scroll:true});},
  'add-exercise':()=>openLibrary(),
  'choose-exercise':async target=>{if(target.dataset.id==='custom')return actions['new-custom-exercise']();const e=library().find(e=>e.id===target.dataset.id);if(!e)return;state.config.exercises.push(M.plannedExercise(e,{repMode:settings.defaultRepMode}));M.normalizeOrder(state.config);await saveConfiguration();closeSheet();render();},
  'new-custom-exercise':()=>openSheet('Custom Workout',`<form data-submit="create-custom-exercise"><div class="field"><label for="custom-exercise-name">Exercise name</label><input id="custom-exercise-name" name="name" maxlength="80" placeholder="Name your exercise" required autocomplete="off"></div><button class="button primary full" type="submit">ADD CUSTOM EXERCISE</button></form>`),
  'create-custom-exercise':async form=>{const name=new FormData(form).get('name').trim();if(!name)throw new Error('Enter an exercise name.');const existing=library().find(e=>e.name.toLowerCase()===name.toLowerCase()),e=existing||{id:`user:${M.newId()}`,name};if(!existing){settings.customExercises=[...(settings.customExercises||[]),e];await repo.saveSettings(settings);}state.config.exercises.push(M.plannedExercise(e,{repMode:settings.defaultRepMode}));M.normalizeOrder(state.config);await saveConfiguration();closeSheet();render();},
  'configure-exercise':target=>{const id=target.dataset.id,e=state.config.exercises.find(e=>e.id===id);exerciseEditor(e,value=>task(async()=>{state.config.exercises[state.config.exercises.findIndex(e=>e.id===id)]=value;await saveConfiguration();render();}));},
  'remove-exercise':async target=>{state.config.exercises=state.config.exercises.filter(e=>e.id!==target.dataset.id);M.normalizeOrder(state.config);await saveConfiguration();render();},
  'move-exercise':async target=>{const from=Number(target.dataset.index);M.reorderExercises(state.config,from,from+Number(target.dataset.direction));await saveConfiguration();render();},
  'start-session':async()=>{
    if(state.session){showActiveChoice(()=>actions['start-session']());return;}
    const existing=records.find(w=>!w.deleted&&w.date===state.date);if(existing){confirmDialog('A workout is already saved',`You already recorded training for ${formatDate(state.date)}. Edit it or choose another date.`,'Open saved workout',()=>openHistory(existing.id));return;}
    state.session=await repo.saveActive(M.sessionFromTemplate(state.selectedTemplate,state.date));state.stage='active';state.tab='workout';render({scroll:true});requestSync();
  },
  'resume-session':()=>{closeSheet();state.stage='active';state.tab='workout';render({scroll:true});if(state.session.prompt)showBorg();},
  'discard-session':()=>confirmDialog('Discard unfinished workout?','Completed history stays unchanged. The active sets and timers will be discarded. Export a backup first if you want to keep a copy.','Discard workout',async()=>{await repo.discardActive();state.session=null;closeSheet();state.stage='home';render();requestSync();},true),
  'discard-for-next':()=>{const next=pendingConfirm;confirmDialog('Discard this unfinished workout?','This will remove the active session. Completed history stays available.','Discard and continue',async()=>{await repo.discardActive();state.session=null;closeSheet();if(next)await next();else{state.stage='home';render();}requestSync();},true);},
  'resume-legacy':async()=>{const original=M.copy(validateDraft(legacyDraft));await setMeta(db,`legacy-archive:${repo.owner}`,original);state.session=await repo.saveActive(M.migrateLegacyDraft(original));await setMeta(db,`legacy-migrated:${repo.owner}`,original.id);legacyArchived=true;state.tab='workout';state.stage='active';render({scroll:true});toast('Earlier values restored. Timing starts from this resume.');requestSync();},
  'go-exercise':target=>actions['set-current-exercise'](Number(target.dataset.index)),
  'set-current-exercise':async index=>{await mutateSession(s=>{s.current=index;});},
  'previous-exercise':()=>actions['set-current-exercise'](Math.max(0,state.session.current-1)),
  'next-exercise':()=>actions['set-current-exercise'](Math.min(state.session.exercises.length-1,state.session.current+1)),
  'edit-set':target=>openSetEditor(target.dataset.id,target.dataset.focus||'weight'),
  'set-timer':async target=>{const e=currentExercise(),set=e.sets.find(s=>s.id===target.dataset.id);if(set.completed)return openSetEditor(set.id);if(!set.timer.touched){if(settings.restSound)await settingsContext.enableSound();await mutateSession(s=>M.startSet(s,e.id,set.id));}showTimer(set.id);},
  'resume-set-timer':async()=>{await mutateSession(s=>M.startSet(s,timerContext.exerciseId,timerContext.setId));showTimer(timerContext.setId);},
  'pause-set-timer':async()=>{await mutateSession(s=>M.pauseSet(s,timerContext.exerciseId,timerContext.setId));showTimer(timerContext.setId);},
  'reset-set-timer':async()=>{await mutateSession(s=>M.resetSet(s,timerContext.exerciseId,timerContext.setId));showTimer(timerContext.setId);},
  'stop-set-timer':async()=>{await mutateSession(s=>M.beginCompletion(s,timerContext.exerciseId,timerContext.setId));showBorg();},
  'complete-set':target=>completeSet(target.dataset.id),
  'select-borg':target=>selectBorg(Number(target.dataset.id)),
  'confirm-borg':async()=>{if(selectedRpe===null)return;const token=state.session.prompt.token;await mutateSession(s=>M.confirmCompletion(s,selectedRpe,Date.now(),token));closeSheet();render();},
  'skip-borg':async()=>{const token=state.session.prompt.token;await mutateSession(s=>M.confirmCompletion(s,null,Date.now(),token));closeSheet();render();},
  'pause-rest':()=>mutateSession(s=>M.pauseRest(s.rest)),
  'resume-rest':()=>mutateSession(s=>M.resumeRest(s.rest)),
  'extend-rest':()=>mutateSession(s=>M.addRest(s.rest)),
  'skip-rest':()=>mutateSession(s=>M.skipRest(s.rest)),
  'focus-next':async()=>{const next=M.nextPending(state.session,state.session.rest?.afterSetId);if(!next)return;await mutateSession(s=>{s.current=next.index;s.highlightSetId=next.set.id;});document.querySelector(`[data-set-id="${next.set.id}"]`)?.scrollIntoView({block:'center',behavior:settings.reducedMotion?'auto':'smooth'});},
  'add-set':()=>mutateSession(s=>M.addSessionSet(s,currentExercise().id)),
  'skip-exercise':()=>{const e=currentExercise(),apply=async()=>{await mutateSession(s=>{M.skipExercise(s,e.id,true);if(s.rest?.afterExerciseId===e.id)M.skipRest(s.rest);const next=M.nextPending(s);if(next)s.current=next.index;});closeSheet();};if(M.completedSets(e).length)confirmDialog('Skip completed work?','This exercise will be excluded from totals. Its values remain available if you restore it.','Skip exercise',apply,true);else return apply();},
  'restore-exercise':()=>mutateSession(s=>M.skipExercise(s,currentExercise().id,false)),
  'session-details':()=>openSessionDetails(),
  'save-session-details':async form=>{const d=new FormData(form);await mutateSession(s=>{s.name=d.get('name').trim();const e=s.exercises[s.current];e.variation=d.get('variation').trim();e.notes=d.get('notes').trim();e.repMode=d.get('repMode');e.restSeconds=Number(d.get('rest'));});closeSheet();},
  'finish-session':()=>{if(state.session.prompt){showBorg();return;}if(!M.trainingTotals(state.session.exercises).sets)throw new Error('Complete at least one set before finishing.');const unfinished=M.unfinishedSets(state.session);if(unfinished)confirmDialog('Save completed work only?',`${unfinished} unfinished ${unfinished===1?'set remains':'sets remain'}. Only completed, unskipped work will count in your history and analysis.`,'FINISH AND SAVE',performFinish);else return performFinish();},
  'summary-analysis':()=>{closeSheet();filters={...filters,metric:'volume',templateId:state.summary.templateId||'*',selectedId:state.summary.id};state.tab='analysis';render({scroll:true});},
  'summary-detail':()=>openSheet('Completed work',state.summary.exercises.map(Views.recordExercise).join(''),{wide:true}),
  'edit-workout':target=>editWorkout(target.dataset.id),
  'delete-workout':target=>{const w=records.find(w=>w.id===target.dataset.id);confirmDialog('Delete workout?',`Delete ${w.name||'the workout'} from ${formatDate(w.date)}? The deletion will synchronize to your other devices.`,'Delete workout',async()=>{if(state.session?.editing&&state.session.id===w.id){await repo.discardActive();state.session=null;}await repo.deleteWorkout(w.id);await refreshData({active:false});closeSheet();render();requestSync();toast('Workout deleted on device.');},true);},
  'record-analysis':target=>{const w=records.find(w=>w.id===target.dataset.id);filters={...filters,period:'all',templateId:w.templateId||'*',exerciseId:'*',variation:'*',metric:'volume',selectedId:w.id};state.tab='analysis';render({scroll:true});},
  'analysis-period':target=>{filters.period=target.dataset.id;render();},
  'analysis-metric':target=>{filters.metric=target.dataset.id;render();},
  'filter-exercise':target=>{filters.exerciseId=target.dataset.id;filters.variation='*';render();},
  'relationship-volume':()=>{filters.relationship='volume';render();},
  'relationship-weight':()=>{filters.relationship='maxWeight';render();},
  'chart-point':target=>showPoint(target.dataset.id),
  'open-workout':target=>openHistory(target.dataset.id),
  'stat-detail':()=>{const rows=analyze(records,filters).rows;openSheet('Recorded sessions',`<div class="session-list">${rows.map(r=>`<button class="session-analysis-row" data-action="chart-point" data-id="${r.workoutId}"><span>${formatDate(r.date)}<small>${h(r.name)}</small></span><span>${number(r.volume)} kg</span></button>`).join('')||'<p class="caption" style="padding:15px">No completed sessions in this range.</p>'}</div>`);},
  'review-progression':target=>showProgression(target.dataset.template,target.dataset.id),
  'apply-active-progression':()=>showProgression(state.session.templateId,currentExercise().id,true),
  'accept-progression':async()=>{const ctx=progressionContext;if(!ctx)return;if(ctx.active)await mutateSession(s=>acceptProgression(s.exercises[s.current],ctx.suggestion));else{const t=M.copy(templates.find(t=>t.id===ctx.templateId));acceptProgression(t.exercises.find(e=>e.id===ctx.exerciseId),ctx.suggestion);staleAttempt={entity:'template',value:t};await repo.saveTemplate(t);staleAttempt=null;await refreshData({active:false});render();requestSync();}closeSheet();toast('Suggested planned weight accepted.');},
  'dismiss-progression':async()=>{const ctx=progressionContext;if(!ctx)return;const key=progressionKey(ctx.templateId,ctx.exerciseId),next={...dismissedProgressions,[key]:progressionToken(ctx.suggestion)};await setMeta(db,`dismissed-progressions:${repo.owner}`,next);dismissedProgressions=next;closeSheet();render();toast('Suggestion dismissed until new comparable training is recorded.');},
  'confirm-import':async()=>{const choices=Object.fromEntries([...modal.querySelectorAll('[data-import-key]')].map(e=>[e.dataset.importKey,e.value]));const result=await repo.importAll(importContext,choices,{restoreActive:Boolean($('#restore-active')?.checked),restoreLegacyDraft:Boolean($('#restore-legacy')?.checked)});if($('#restore-legacy')?.checked)await setMeta(db,`legacy-migrated:${repo.owner}`,null);settings={...settings,...await repo.settings()};document.documentElement.classList.toggle('reduce-motion',settings.reducedMotion);state.session=await repo.active();legacyDraft=await repo.draft();legacyArchived=(await getMeta(db,`legacy-migrated:${repo.owner}`))===legacyDraft?.id;await refreshData({active:false});closeSheet();state.stage='home';state.tab='workout';render();requestSync();toast(`${result.imported} documents restored; ${result.skipped} duplicates or conflicts kept.`);},
  'resolve-local':()=>resolveConflict('local'),
  'resolve-server':()=>resolveConflict('server'),
  'keep-stale':async()=>{const attempted=staleAttempt;if(!attempted)return;if(attempted.entity==='workout'){state.session=M.copy(attempted.value);state.session.baseRevision=attempted.existing?.revision||0;state.session.baseLocalVersion=attempted.existing?.localVersion||null;state.session=await repo.saveActive(state.session,{force:true});await performFinish();}else if(attempted.entity==='template'){const saved=await repo.saveTemplate(attempted.value,{force:true});state.selectedTemplate=saved;state.config=null;state.stage='start';await refreshData({active:false});closeSheet();render();requestSync();}else{state.session=await repo.saveActive(attempted.value,{force:true});closeSheet();render();requestSync();}staleAttempt=null;},
  'use-stale':async()=>{const attempted=staleAttempt;if(!attempted)return;if(attempted.entity==='template'){state.config=M.copy(attempted.existing);state.stage='configure';await saveConfiguration();}else if(attempted.entity==='workout'){await repo.discardActive();state.session=null;state.tab='history';state.historyId=attempted.existing?.id||null;}else state.session=await repo.active();staleAttempt=null;closeSheet();await refreshData({active:false});render();}
};
async function resolveConflict(choice){const op=conflictContext;if(!op)return;if(op.entity)await repo.resolveDocument(op.key,choice);else await repo.resolve(op.workoutId,choice);state.session=await repo.active();await refreshData({active:false});if(state.stage==='active'&&!state.session)state.stage='home';closeSheet();render();requestSync();toast('Conflict resolved.');}
document.addEventListener('click',event=>{const target=event.target.closest('[data-action]');if(!target||target.disabled||!initialized)return;const action=actions[target.dataset.action];if(!action)return;event.preventDefault();task(()=>action(target,event)).catch(()=>{});});
document.addEventListener('submit',event=>{const form=event.target;if(!form.dataset.submit||!actions[form.dataset.submit])return;event.preventDefault();task(()=>actions[form.dataset.submit](form)).catch(()=>{});});
document.addEventListener('input',event=>{if(event.target.id==='template-name'&&state.config){state.config.name=event.target.value;saveConfiguration().catch(storageError);}});
document.addEventListener('change',event=>{
  if(!initialized)return;const id=event.target.id;
  if(id==='workout-date')task(async()=>{const date=event.target.value;if(!validDate(date))throw new Error('Choose a valid calendar date.');if(state.tab==='workout'&&state.stage==='active')await mutateSession(s=>s.date=date);else{state.date=date;renderChrome();persistNavigation();}}).catch(()=>{});
  if(id==='active-exercise')task(()=>actions['set-current-exercise'](Number(event.target.value))).catch(()=>{});
  if(id==='analysis-template'||id==='analysis-exercise'||id==='analysis-variation'){filters[id==='analysis-template'?'templateId':id==='analysis-exercise'?'exerciseId':'variation']=event.target.value;if(id==='analysis-exercise')filters.variation='*';filters.selectedId=null;render();}
});
modal.addEventListener('keydown',event=>{const radio=event.target.closest('.borg-value');if(!radio)return;let next=Number(radio.dataset.id);if(['ArrowRight','ArrowUp'].includes(event.key))next=Math.min(20,next+1);else if(['ArrowLeft','ArrowDown'].includes(event.key))next=Math.max(6,next-1);else if(event.key==='Home')next=6;else if(event.key==='End')next=20;else return;event.preventDefault();selectBorg(next);modal.querySelector(`.borg-value[data-id="${next}"]`)?.focus({preventScroll:true});});
function updateTimers(){
  const s=state.session;if(!s)return;const workout=$('[data-workout-duration]');if(workout)workout.textContent=M.formatTime(M.sessionElapsed(s),true);
  document.querySelectorAll('[data-set-timer]').forEach(el=>{const set=currentExercise()?.sets.find(s=>s.id===el.dataset.setTimer);if(set&&!set.completed&&set.timer.touched)el.textContent=M.formatTime(M.timerElapsed(set.timer)/1000);});
  const timer=$('[data-modal-timer]');if(timer&&timerContext){const set=M.getSet(s,timerContext.exerciseId,timerContext.setId).set;timer.textContent=M.formatTime(M.timerElapsed(set.timer)/1000);}
  const rest=$('[data-rest-countdown]');if(rest)rest.textContent=M.formatTime(Math.ceil(M.restRemaining(s.rest)/1000));
  if(!busy&&!modal.open&&s.rest?.status==='running'&&M.restRemaining(s.rest)===0)task(async()=>{await mutateSession(session=>{M.checkRest(session);session.rest.notified=true;});soundRest();toast('Rest complete. Your next set is ready.');}).catch(()=>{});
}
setInterval(updateTimers,250);
window.addEventListener('online',requestSync);
window.addEventListener('offline',()=>{syncState={state:'device',pending:syncState.pending};updateSyncCaption();});
document.addEventListener('visibilitychange',()=>{if(!initialized)return;if(document.visibilityState==='visible'){updateTimers();refreshData().then(()=>{if(!busy&&!modal.open)render();requestSync();}).catch(storageError);}else clearTimeout(retryTimer);});
window.visualViewport?.addEventListener('resize',()=>{document.body.classList.toggle('keyboard-open',document.activeElement?.matches('input,textarea,select')&&window.visualViewport.height<window.innerHeight-140);});
document.addEventListener('focusout',()=>requestAnimationFrame(()=>{if(!document.activeElement?.matches('input,textarea,select'))document.body.classList.remove('keyboard-open');}));
async function initialize(){
  try{const local=['127.0.0.1','localhost'].includes(location.hostname),name=new URLSearchParams(location.search).get('db');db=await openDatabase(local&&/^gtrack-(qa|test)-[a-z0-9-]+$/i.test(name||'')?name:undefined);auth=new Auth(db);await auth.initialize();await activateOwner();initialized=true;}
  catch(error){storageError(error);main.innerHTML=`<div class="empty-state">${icon('info')}<h1>Training storage is unavailable</h1><p>${h(error.message)}. Allow browser storage and reopen G-Track.</p></div>`;return;}
  const dev=['127.0.0.1','localhost'].includes(location.hostname)&&new URLSearchParams(location.search).has('dev');
  if('serviceWorker'in navigator&&!dev)try{const registration=await navigator.serviceWorker.register('./service-worker.js',{scope:'./',updateViaCache:'none'});registration.addEventListener('updatefound',()=>{const worker=registration.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller)toast('Update ready. Close and reopen G-Track after training.');});});}catch{toast('Offline shell could not be cached. Reopen while online.');}
}
initialize();
