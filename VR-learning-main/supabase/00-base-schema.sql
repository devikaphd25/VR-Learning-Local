-- UMES VR Classroom base Supabase schema.
-- Run this FIRST on a fresh Supabase project, before every migration in this folder.
-- Safe to rerun: tables and indexes use IF NOT EXISTS and functions are replaced.

create extension if not exists pgcrypto;

create table if not exists public.rooms (
    id uuid primary key default gen_random_uuid(),
    current_slide integer not null default 0 check (current_slide >= 0),
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    closed_at timestamptz,
    current_question_id uuid,
    question_state text not null default 'idle'
        check (question_state in ('idle', 'open', 'revealed'))
);

create table if not exists public.participants (
    id uuid primary key default gen_random_uuid(),
    room_id uuid not null references public.rooms(id) on delete cascade,
    role text not null check (role in ('professor', 'student')),
    display_name text,
    joined_at timestamptz not null default now()
);

create index if not exists participants_room_id_idx
on public.participants(room_id);

create table if not exists public.quiz_questions (
    id uuid primary key default gen_random_uuid(),
    deck text not null,
    slide_number integer not null check (slide_number >= 0),
    ordinal integer not null check (ordinal > 0),
    prompt text not null,
    choices jsonb not null,
    correct_index integer not null check (correct_index >= 0),
    created_at timestamptz not null default now(),
    unique (deck, slide_number, ordinal)
);

-- Add the FK only after quiz_questions exists, so a fresh database can be built
-- without dependency-order errors.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'rooms_current_question_id_fkey'
      and conrelid = 'public.rooms'::regclass
  ) then
    alter table public.rooms
      add constraint rooms_current_question_id_fkey
      foreign key (current_question_id)
      references public.quiz_questions(id)
      on delete set null;
  end if;
end
$$;

create table if not exists public.quiz_responses (
    id uuid primary key default gen_random_uuid(),
    room_id uuid not null references public.rooms(id) on delete cascade,
    participant_id uuid not null references public.participants(id) on delete cascade,
    question_id uuid not null references public.quiz_questions(id) on delete cascade,
    choice_index integer not null check (choice_index >= 0),
    is_correct boolean not null,
    response_ms integer,
    answered_at timestamptz not null default now(),
    unique (participant_id, question_id)
);

create index if not exists quiz_responses_room_id_idx
on public.quiz_responses(room_id);
create index if not exists quiz_responses_question_id_idx
on public.quiz_responses(question_id);

-- Core classroom RPCs used by src/services/classroom-session.services.ts.
create or replace function public.close_room(input_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.rooms
  set is_active = false,
      closed_at = now(),
      current_question_id = null,
      question_state = 'idle'
  where id = input_room_id;
end;
$$;

create or replace function public.get_slide_questions(input_deck text, input_slide integer)
returns table(question_id uuid, ordinal integer, prompt text, choices jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select q.id, q.ordinal, q.prompt, q.choices
  from public.quiz_questions q
  where q.deck = input_deck and q.slide_number = input_slide
  order by q.ordinal;
$$;

create or replace function public.ask_question(input_room_id uuid, input_question_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.quiz_questions where id = input_question_id) then
    raise exception 'QUESTION_NOT_FOUND';
  end if;

  update public.rooms
  set current_question_id = input_question_id,
      question_state = 'open'
  where id = input_room_id and is_active = true;

  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
end;
$$;

create or replace function public.reveal_question(input_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.rooms
  set question_state = 'revealed'
  where id = input_room_id and current_question_id is not null;
end;
$$;

create or replace function public.get_current_question(input_room_id uuid)
returns table(question_id uuid, prompt text, choices jsonb, question_state text, slide_number integer)
language sql
stable
security definer
set search_path = public
as $$
  select q.id, q.prompt, q.choices, r.question_state, q.slide_number
  from public.rooms r
  join public.quiz_questions q on q.id = r.current_question_id
  where r.id = input_room_id and r.question_state in ('open', 'revealed')
  limit 1;
$$;

create or replace function public.submit_answer(input_participant_id uuid, input_choice_index integer)
returns table(is_correct boolean, already_answered boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_room public.rooms%rowtype;
  selected_question public.quiz_questions%rowtype;
  existing public.quiz_responses%rowtype;
  verdict boolean;
begin
  select r.* into selected_room
  from public.participants p
  join public.rooms r on r.id = p.room_id
  where p.id = input_participant_id;

  if selected_room.id is null or selected_room.current_question_id is null
     or selected_room.question_state <> 'open' then
    raise exception 'NO_OPEN_QUESTION';
  end if;

  select * into selected_question
  from public.quiz_questions
  where id = selected_room.current_question_id;

  if input_choice_index < 0
     or input_choice_index >= jsonb_array_length(selected_question.choices) then
    raise exception 'INVALID_CHOICE';
  end if;

  select * into existing
  from public.quiz_responses
  where participant_id = input_participant_id
    and question_id = selected_question.id;

  if existing.id is not null then
    is_correct := existing.is_correct;
    already_answered := true;
    return next;
    return;
  end if;

  verdict := input_choice_index = selected_question.correct_index;
  insert into public.quiz_responses(room_id, participant_id, question_id, choice_index, is_correct)
  values(selected_room.id, input_participant_id, selected_question.id, input_choice_index, verdict);

  is_correct := verdict;
  already_answered := false;
  return next;
end;
$$;

create or replace function public.get_question_results(input_room_id uuid)
returns table(choice_index integer, votes bigint, correct_index integer, total_answered bigint)
language sql
stable
security definer
set search_path = public
as $$
  with room_question as (
    select current_question_id, question_state
    from public.rooms where id = input_room_id
  ), tally as (
    select qr.choice_index, count(*)::bigint as votes
    from public.quiz_responses qr, room_question rq
    where qr.room_id = input_room_id and qr.question_id = rq.current_question_id
    group by qr.choice_index
  ), total as (
    select count(*)::bigint as total_answered
    from public.quiz_responses qr, room_question rq
    where qr.room_id = input_room_id and qr.question_id = rq.current_question_id
  )
  select gs.choice_index,
         coalesce(t.votes, 0),
         case when rq.question_state = 'revealed' then q.correct_index else null end,
         total.total_answered
  from room_question rq
  join public.quiz_questions q on q.id = rq.current_question_id
  cross join lateral generate_series(0, jsonb_array_length(q.choices) - 1) gs(choice_index)
  left join tally t on t.choice_index = gs.choice_index
  cross join total
  order by gs.choice_index;
$$;

create or replace function public.get_room_scores(input_room_id uuid)
returns table(
  participant_id uuid,
  device_id text,
  display_name text,
  answered bigint,
  correct bigint,
  avg_response_ms numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id,
         case when to_jsonb(p) ? 'device_id' then to_jsonb(p)->>'device_id' else null end,
         p.display_name,
         count(qr.id)::bigint,
         count(qr.id) filter (where qr.is_correct)::bigint,
         avg(qr.response_ms)::numeric
  from public.participants p
  left join public.quiz_responses qr on qr.participant_id = p.id
  where p.room_id = input_room_id and p.role = 'student'
  group by p.id, p.display_name
  order by p.joined_at, p.id;
$$;

-- The browser invokes these classroom RPCs. Table access remains controlled by
-- Supabase/RLS and the later migrations; only function execution is granted.
grant execute on function public.close_room(uuid) to anon, authenticated;
grant execute on function public.get_slide_questions(text, integer) to anon, authenticated;
grant execute on function public.ask_question(uuid, uuid) to anon, authenticated;
grant execute on function public.reveal_question(uuid) to anon, authenticated;
grant execute on function public.get_current_question(uuid) to anon, authenticated;
grant execute on function public.submit_answer(uuid, integer) to anon, authenticated;
grant execute on function public.get_question_results(uuid) to anon, authenticated;
grant execute on function public.get_room_scores(uuid) to anon, authenticated;
