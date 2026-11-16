// Synthetic review data. The production build excludes this entire directory.
import { openDatabase,setMeta } from '../js/db.js';
import { RoutineRepository } from '../js/routine-db.js';
import { localDate } from '../js/domain.js';
import * as M from '../js/model.js';
import * as A from '../js/automatic.js';
export async function preparePreview(name,mode='routines'){
 if(!['127.0.0.1','localhost'].includes(location.hostname)||!/^gtrack-(qa|test)-[a-z0-9-]+$/.test(name))throw new Error('Use an isolated localhost preview database.');
 const db=await openDatabase(name),repo=new RoutineRepository(db,'device'),now=Date.now(),r=A.blankRoutine('Leg Day');
 r.exercises=[A.plannedExercise({id:'squats',name:'Squat'},{sets:4,reps:10,weight:80,rest:180}),A.plannedExercise({id:'romanian-deadlift',name:'Romanian Deadlift'},{sets:3,reps:12,weight:50,rest:180})];M.normalizeOrder(r);const saved=await repo.saveTemplate(r),other=A.blankRoutine('Upper Body');other.exercises=[A.plannedExercise({id:'custom:barbell-bench-press',name:'Barbell Bench Press'},{weight:40}),A.plannedExercise({id:'custom:barbell-row',name:'Barbell Row'},{weight:35})];M.normalizeOrder(other);const upper=await repo.saveTemplate(other);
 await repo.saveProfile({version:3,entity:'profile',id:M.newId(),displayName:'',units:'kg',defaultRestSeconds:180,rpeEnabled:true,routineOrder:[saved.id,upper.id],deleted:false});
 const history=[];for(const [days,weight] of [[14,57.5],[7,60]]){const when=now-days*86400000,s=A.startWorkout(saved,localDate(new Date(when)),when-30*60000);for(let i=0;i<s.exercises.length;i++){A.enterExercise(s,i,when-30*60000+i*10*60000);const e=s.exercises[i];for(let j=0;j<e.sets.length;j++){if(i===0)e.sets[j].weight=weight;A.completeSet(s,e.id,e.sets[j].id,{now:when-29*60000+i*10*60000+j*100000});A.rateSet(s,13,s.prompt.token,when-29*60000+i*10*60000+j*100000+2000);}}history.push(await repo.saveFinal(A.finishWorkout(s,history,when)));}
 let session=null;if(['active','rest','rpe','workouts'].includes(mode)){session=A.startWorkout(saved,localDate(),now-240000);A.completeSet(session,session.exercises[0].id,session.exercises[0].sets[0].id,{now:now-120000});A.rateSet(session,13,session.prompt.token,now-119000);if(mode!=='rest')M.skipRest(session.rest);if(mode==='rpe')A.completeSet(session,session.exercises[0].id,session.exercises[0].sets[1].id,{now});if(mode==='workouts')A.pauseWorkout(session,now);session=await repo.saveActive(session);}
 const active=['active','rest','rpe'].includes(mode);await setMeta(db,'final-ui:device',{tab:active?'workouts':['history','profile','workouts'].includes(mode)?mode:'routines',page:active?'active':'list',sessionId:session?.id||null});db.close();return {template:saved,history,url:`../?dev=1&db=${name}`};
}
