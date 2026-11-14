-- FORM schema v1. Run once in the Supabase SQL editor, or `supabase db push`.
-- No production seed data. Auth users are created separately in the dashboard.
begin;

create or replace function public.form_valid_exercises(payload jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  e jsonb; s jsonb; pos integer; seen integer[] := '{}'; expected text; custom_name text;
  fixed_names text[] := array['Squats','Lunges','Step-Up Box','Calf Raises','Romanian Deadlift','Single-Leg Press','Custom Workout','Abs'];
  fixed_ids text[] := array['squats','lunges','step-up-box','calf-raises','romanian-deadlift','single-leg-press','custom','abs'];
  custom_names text[] := array['Barbell Bench Press','Dumbbell Bench Press','Incline Dumbbell Press','Overhead Press','Lateral Raise','Cable Fly','Pull-Up','Chin-Up','Lat Pulldown','Seated Cable Row','Barbell Row','Chest-Supported Row','Face Pull','Deadlift','Hip Thrust','Leg Press','Hack Squat','Goblet Squat','Leg Extension','Leg Curl','Biceps Curl','Hammer Curl','Triceps Pushdown','Overhead Triceps Extension','Cable Crunch','Hanging Leg Raise'];
begin
  if jsonb_typeof(payload) is distinct from 'array' or jsonb_array_length(payload) > 8 then return false; end if;
  for e in select value from jsonb_array_elements(payload) loop
    if jsonb_typeof(e) is distinct from 'object' or jsonb_typeof(e->'position') is distinct from 'number' then return false; end if;
    pos := (e->>'position')::integer;
    if pos < 1 or pos > 8 or pos = any(seen) then return false; end if;
    seen := array_append(seen,pos);
    if pos = 7 then
      select n into custom_name from unnest(custom_names) as names(n) where n = e->>'name';
      if custom_name is null then return false; end if;
      expected := 'custom:' || regexp_replace(regexp_replace(lower(custom_name),'[^a-z0-9]+','-','g'),'-$','');
    else
      if e->>'name' is distinct from fixed_names[pos] then return false; end if;
      expected := fixed_ids[pos];
    end if;
    if e->>'exerciseId' is distinct from expected or coalesce(e->>'repMode','') not in ('total','per-leg') then return false; end if;
    if jsonb_typeof(e->'variation') is distinct from 'string' or length(e->>'variation') > 120 or jsonb_typeof(e->'notes') is distinct from 'string' or length(e->>'notes') > 2000 then return false; end if;
    if jsonb_typeof(e->'sets') is distinct from 'array' then return false; end if;
    if jsonb_array_length(e->'sets') < 1 or jsonb_array_length(e->'sets') > 10 then return false; end if;
    for s in select value from jsonb_array_elements(e->'sets') loop
      if jsonb_typeof(s->'reps') is distinct from 'number' or jsonb_typeof(s->'weight') is distinct from 'number' then return false; end if;
      if (s->>'reps')::numeric < 1 or (s->>'reps')::numeric > 100 or mod((s->>'reps')::numeric,1) <> 0 then return false; end if;
      if (s->>'weight')::numeric < 0 or (s->>'weight')::numeric > 300 or mod((s->>'weight')::numeric,0.5) <> 0 then return false; end if;
    end loop;
  end loop;
  return true;
exception when others then return false;
end;
$$;

create table public.workouts (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  workout_date date not null check (workout_date between '1900-01-01' and '2200-12-31'),
  -- Individual exercises/sets are embedded so a finalized workout is one atomic row.
  exercises jsonb not null check (public.form_valid_exercises(exercises)),
  deleted boolean not null default false,
  revision bigint not null default 1 check (revision > 0 and revision < 9007199254740991),
  last_operation_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id,workout_date),
  unique (id,user_id),
  check (deleted or jsonb_array_length(exercises) > 0)
);
create index workouts_user_updated on public.workouts(user_id,updated_at);

create table public.sync_receipts (
  operation_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  workout_id uuid not null,
  request_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (workout_id,user_id) references public.workouts(id,user_id) on delete cascade
);
create index sync_receipts_user on public.sync_receipts(user_id);

alter table public.workouts enable row level security;
alter table public.sync_receipts enable row level security;
create policy workouts_owner_read on public.workouts for select to authenticated using ((select auth.uid()) = user_id);
create policy receipts_owner_read on public.sync_receipts for select to authenticated using (
  user_id = (select auth.uid()) and exists (select 1 from public.workouts w where w.id = workout_id and w.user_id = (select auth.uid()))
);
-- Writes only through the revision-checked RPC. No REST insert/update/delete grants.
revoke all on public.workouts, public.sync_receipts from anon, authenticated;
grant select on public.workouts, public.sync_receipts to authenticated;
revoke all on function public.form_valid_exercises(jsonb) from public, anon, authenticated;

create or replace function public.apply_workout(p_operation_id uuid,p_base_revision bigint,p_workout jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  workout_id uuid;
  workout_day date;
  existing public.workouts%rowtype;
  collision public.workouts%rowtype;
  receipt public.sync_receipts%rowtype;
  fingerprint text;
  response jsonb;
begin
  if owner_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_operation_id is null or p_base_revision is null or p_base_revision < 0 or jsonb_typeof(p_workout) is distinct from 'object' then raise exception 'Invalid operation'; end if;
  workout_id := (p_workout->>'id')::uuid;
  if workout_id is null or coalesce(p_workout->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid workout ID or date'; end if;
  workout_day := (p_workout->>'date')::date;
  if jsonb_typeof(p_workout->'deleted') is distinct from 'boolean' or not public.form_valid_exercises(p_workout->'exercises') then raise exception 'Invalid workout contents'; end if;
  if not (p_workout->>'deleted')::boolean and jsonb_array_length(p_workout->'exercises') = 0 then raise exception 'Complete at least one exercise'; end if;
  fingerprint := md5(p_workout::text || ':' || p_base_revision::text);
  -- Serializes all writes for this owner, including concurrent creates for one date.
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text,0));
  select * into receipt from public.sync_receipts where operation_id = p_operation_id;
  if found then
    if receipt.user_id <> owner_id or receipt.workout_id <> workout_id or receipt.request_hash <> fingerprint then raise exception 'Operation ID cannot be reused' using errcode = '42501'; end if;
    return receipt.result;
  end if;
  select * into existing from public.workouts where id = workout_id for update;
  if found and existing.user_id <> owner_id then raise exception 'Workout ID is unavailable' using errcode = '42501'; end if;
  select * into collision from public.workouts where user_id = owner_id and workout_date = workout_day and id <> workout_id for update;
  if found then return jsonb_build_object('status','conflict','workout',to_jsonb(collision)); end if;
  if existing.id is not null and existing.revision <> p_base_revision then return jsonb_build_object('status','conflict','workout',to_jsonb(existing)); end if;
  if existing.id is null and p_base_revision <> 0 then return jsonb_build_object('status','conflict','workout',null); end if;

  insert into public.workouts(id,user_id,workout_date,exercises,deleted,revision,last_operation_id)
  values (workout_id,owner_id,workout_day,p_workout->'exercises',(p_workout->>'deleted')::boolean,1,p_operation_id)
  on conflict (id) do update set
    workout_date = excluded.workout_date,
    exercises = excluded.exercises,
    deleted = excluded.deleted,
    revision = public.workouts.revision + 1,
    last_operation_id = p_operation_id,
    updated_at = clock_timestamp()
  returning * into existing;
  response := jsonb_build_object('status','ok','workout',to_jsonb(existing));
  insert into public.sync_receipts(operation_id,user_id,workout_id,request_hash,result) values(p_operation_id,owner_id,workout_id,fingerprint,response);
  return response;
end;
$$;
revoke all on function public.apply_workout(uuid,bigint,jsonb) from public, anon;
grant execute on function public.apply_workout(uuid,bigint,jsonb) to authenticated;
comment on table public.workouts is 'Owner-scoped atomic workout documents. Deleted rows are permanent synchronization tombstones.';
comment on table public.sync_receipts is 'Idempotency receipts. Retain while offline devices may retry an operation.';
commit;
