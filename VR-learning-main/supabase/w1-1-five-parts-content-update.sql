-- Week 1, Lesson 1: The Five Parts of Every Computer.
-- Run after weekly-content-migration.sql in the Supabase SQL Editor.

update public.learning_weeks
set title = 'Literal Computers and the Five Computer Parts',
    description = 'CPU, RAM, storage, input, output, challenge, game, and debrief.',
    updated_at = now()
where week_number = 1;

do $$
declare
  target_week_id bigint;
  target_lesson_id bigint;
  challenge_activity_id bigint;
  target_question_id uuid;
begin
  select id into target_week_id
  from public.learning_weeks
  where week_number = 1;

  if target_week_id is null then
    raise exception 'Week 1 does not exist. Run weekly-content-migration.sql first.';
  end if;

  if to_regclass('public.week_lessons') is not null then
    execute $sql$
      select id
      from public.week_lessons
      where week_id = $1 and lesson_number = 1
      limit 1
    $sql$
    into target_lesson_id
    using target_week_id;
  end if;

  if target_lesson_id is not null then
    execute $sql$
      update public.week_lessons
      set title = 'Literal Computers and the Five Computer Parts',
          updated_at = now()
      where id = $1
    $sql$
    using target_lesson_id;

    execute $sql$
      update public.week_activities
      set title = case activity_type
            when 'presentation' then 'Literal Computers and the Five Computer Parts'
            when 'challenge' then 'Five Parts Challenge'
            when 'briefing' then 'Five Parts Debrief'
            else title
          end,
          description = case activity_type
            when 'presentation' then 'Present CPU, RAM, storage, input, and output.'
            when 'challenge' then 'Identify the job of each computer component.'
            when 'briefing' then 'Review the five-part computer model.'
            else description
          end,
          asset_path = case activity_type
            when 'presentation' then '/videos/week-1/w1-1-final-video.mp4'
            when 'briefing' then './images/briefings/week-1/five-parts-of-every-computer-debrief.png'
            else asset_path
          end,
          updated_at = now()
      where week_id = $1 and lesson_id = $2
    $sql$
    using target_week_id, target_lesson_id;

    execute $sql$
      select id
      from public.week_activities
      where week_id = $1
        and lesson_id = $2
        and activity_type = 'challenge'
      order by activity_order
      limit 1
    $sql$
    into challenge_activity_id
    using target_week_id, target_lesson_id;
  else
    update public.week_activities
    set title = case activity_type
          when 'presentation' then 'Literal Computers and the Five Computer Parts'
          when 'challenge' then 'Five Parts Challenge'
          when 'briefing' then 'Five Parts Debrief'
          else title
        end,
        description = case activity_type
          when 'presentation' then 'Present CPU, RAM, storage, input, and output.'
          when 'challenge' then 'Identify the job of each computer component.'
          when 'briefing' then 'Review the five-part computer model.'
          else description
        end,
        asset_path = case activity_type
          when 'presentation' then '/videos/week-1/w1-1-final-video.mp4'
          when 'briefing' then './images/briefings/week-1/five-parts-of-every-computer-debrief.png'
          else asset_path
        end,
        updated_at = now()
    where week_id = target_week_id
      and activity_order in (1, 2, 4);

    select id into challenge_activity_id
    from public.week_activities
    where week_id = target_week_id
      and activity_type = 'challenge'
    order by activity_order
    limit 1;
  end if;

  if challenge_activity_id is null then
    raise exception 'Week 1 Lesson 1 challenge activity was not found.';
  end if;

  select id into target_question_id
  from public.quiz_questions
  where activity_id = challenge_activity_id
  order by ordinal
  limit 1;

  if target_question_id is null then
    insert into public.quiz_questions (
      deck, slide_number, ordinal, prompt, choices, correct_index, activity_id
    ) values (
      'w1-1',
      1,
      1,
      'Which part of a computer runs the instructions — the “brain”?',
      '["CPU", "Main memory (RAM)", "Secondary storage", "Input devices"]'::jsonb,
      0,
      challenge_activity_id
    );
  else
    update public.quiz_questions
    set prompt = 'Which part of a computer runs the instructions — the “brain”?',
        choices = '["CPU", "Main memory (RAM)", "Secondary storage", "Input devices"]'::jsonb,
        correct_index = 0
    where id = target_question_id;
  end if;
end
$$;
