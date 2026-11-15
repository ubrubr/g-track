// Synthetic, local-only review data. Never included in the production build.
import { openDatabase, setMeta } from '../js/db.js';
import { TrainingRepository } from '../js/training-db.js';
import { localDate } from '../js/domain.js';
import * as M from '../js/model.js';

export async function preparePreview(name,mode='home') {
  if(!['127.0.0.1','localhost'].includes(location.hostname)||!/^gtrack-(qa|test)-[a-z0-9-]+$/.test(name))throw new Error('Preview fixtures are restricted to isolated localhost databases.');
  const db=await openDatabase(name),repo=new TrainingRepository(db,'device'),now=Date.now(),today=localDate();
  const template=M.blankTemplate('Leg Day');
  template.exercises=[M.plannedExercise({id:'squats',name:'Squats'},{sets:4,reps:10,weight:60,rest:90}),M.plannedExercise({id:'romanian-deadlift',name:'Romanian Deadlift'},{sets:3,reps:12,weight:50,rest:60})];
  template.exercises[0].variation='Barbell';template.exercises[1].variation='Dumbbells';M.normalizeOrder(template);
  const saved=await repo.saveTemplate(template),push=M.blankTemplate('Push Day');push.exercises=[M.plannedExercise({id:'bench-press',name:'Bench Press'},{weight:40}),M.plannedExercise({id:'shoulder-press',name:'Shoulder Press'},{weight:20})];M.normalizeOrder(push);await repo.saveTemplate(push);
  const history=[];
  for(const [days,rpe,load] of [[21,14,57.5],[14,14,60],[7,13,60]]){
    const date=new Date(now-days*86400000),day=localDate(date),start=date.getTime()-36*60000,session=M.sessionFromTemplate(saved,day,start);
    for(const exercise of session.exercises)for(const set of exercise.sets){if(exercise.exerciseId==='squats')set.weight=load;set.completed=true;set.durationSeconds=42;set.borgRpe=rpe;set.startedAt=new Date(start).toISOString();set.endedAt=new Date(start+42000).toISOString();set.completedAt=set.endedAt;}
    history.push(await repo.saveFinal(M.finishSession(session,start+36*60000)));
  }
  if(mode==='active'||mode==='borg'||mode==='rest'){
    const session=M.sessionFromTemplate(saved,today,now-(42*60+18)*1000),e=session.exercises[0],s=e.sets[0];
    M.startSet(session,e.id,s.id,now-180000);M.beginCompletion(session,e.id,s.id,now-138000);M.confirmCompletion(session,13,now-138000);
    if(mode==='rest'){session.rest={...session.rest,status:'running',remainingMs:90000,deadline:now+90000,notified:false};}
    else{M.skipRest(session.rest);if(mode==='borg')M.beginCompletion(session,e.id,e.sets[1].id,now);}
    await repo.saveActive(session);await setMeta(db,'ui:device',{tab:'workout',stage:'active',date:today});
  }else if(mode==='summary')await setMeta(db,'ui:device',{tab:'workout',stage:'summary',date:today,summaryId:history.at(-1).id});
  else await setMeta(db,'ui:device',{tab:mode==='analysis'?'analysis':'workout',stage:'home',date:today});
  db.close();return {template:saved,history,url:`../?dev=1&db=${name}`};
}
