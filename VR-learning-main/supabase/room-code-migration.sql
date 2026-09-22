-- Run once in Supabase SQL Editor.
-- Adds Professor-PIN login with automatic classroom creation while preserving
-- persistent headset identity, automatic student names, and fixed seats.

alter table public.rooms add column if not exists code text;
alter table public.participants add column if not exists device_id text;
alter table public.participants add column if not exists seat text;

create unique index if not exists participants_room_device_idx
on public.participants(room_id, device_id)
where device_id is not null;

create unique index if not exists rooms_one_active_code_idx
on public.rooms(code)
where is_active = true and code is not null;

drop function if exists public.create_room_with_code(text);

create or replace function public.create_room()
returns table(room_id uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The first deployment uses one live class at a time. Starting a new
  -- instructor session closes any room left active by a closed browser.
  update rooms r
  set is_active = false,
      closed_at = now()
  where r.is_active = true;

  insert into rooms(current_slide, is_active, created_at, closed_at, code)
  values(0, true, now(), null, null)
  returning id into room_id;

  insert into participants(room_id, role, display_name)
  values(room_id, 'professor', 'Instructor');

  return next;
end;
$$;

drop function if exists public.join_room_with_code(text, text, text);

create or replace function public.join_latest_active_room(
  input_device_id text,
  input_name text default null
)
returns table(
  room_id uuid,
  participant_id uuid,
  current_slide integer,
  display_name text,
  seat text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_room rooms%rowtype;
  existing_participant participants%rowtype;
  selected_seat text;
  selected_name text;
  student_number integer;
begin
  select r.* into selected_room
  from rooms r
  where r.is_active = true
  order by r.created_at desc
  limit 1;

  if selected_room.id is null then
    raise exception 'NO_ACTIVE_ROOM';
  end if;

  select p.* into existing_participant
  from participants p
  where p.room_id = selected_room.id
    and p.device_id = input_device_id
  limit 1;

  if existing_participant.id is null then
    select candidate.seat_name into selected_seat
    from unnest(array[
      'Seat_R1_01','Seat_R1_02','Seat_R1_03','Seat_R1_04','Seat_R1_05',
      'Seat_R2_01','Seat_R2_02','Seat_R2_03','Seat_R2_04','Seat_R2_05',
      'Seat_R3_01','Seat_R3_02','Seat_R3_03','Seat_R3_04','Seat_R3_05',
      'Seat_R4_01','Seat_R4_02','Seat_R4_03','Seat_R4_04','Seat_R4_05',
      'Seat_R5_01','Seat_R5_02','Seat_R5_03','Seat_R5_04','Seat_R5_05'
    ]) with ordinality as candidate(seat_name, seat_order)
    where not exists (
      select 1 from participants p
      where p.room_id = selected_room.id and p.seat = candidate.seat_name
    )
    order by candidate.seat_order
    limit 1;

    if selected_seat is null then
      raise exception 'ROOM_FULL';
    end if;

    select count(*)::integer + 1 into student_number
    from participants p
    where p.room_id = selected_room.id and p.role = 'student';

    selected_name := coalesce(nullif(trim(input_name), ''), 'Student ' || student_number);

    insert into participants(room_id, role, display_name, device_id, seat)
    values(selected_room.id, 'student', selected_name, input_device_id, selected_seat)
    returning * into existing_participant;
  end if;

  room_id := selected_room.id;
  participant_id := existing_participant.id;
  current_slide := selected_room.current_slide;
  display_name := existing_participant.display_name;
  seat := existing_participant.seat;
  return next;
end;
$$;

grant execute on function public.create_room() to anon, authenticated;
grant execute on function public.join_latest_active_room(text, text) to anon, authenticated;
