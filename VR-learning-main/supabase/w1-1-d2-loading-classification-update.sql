-- Week 1, Lesson 2 / W1-1-D2: Loading and Classification.
-- Run after weekly-content-migration.sql in the Supabase SQL Editor.

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

  if to_regclass('public.week_lessons') is null then
    raise exception 'week_lessons does not exist. Run the current weekly-content-migration.sql first.';
  end if;

  select id into target_lesson_id
  from public.week_lessons
  where week_id = target_week_id and lesson_number = 2
  limit 1;

  if target_lesson_id is null then
    raise exception 'Week 1 Lesson 2 does not exist.';
  end if;

  update public.week_lessons
  set title = 'Loading and Classification',
      updated_at = now()
  where id = target_lesson_id;

  update public.week_activities
  set title = case activity_type
        when 'presentation' then 'Loading and Classification'
        when 'challenge' then 'Loading and Classification Challenge'
        when 'briefing' then 'Loading and Classification Debrief'
        else title
      end,
      description = case activity_type
        when 'presentation' then 'Present storage, RAM, CPU, hardware, and software.'
        when 'challenge' then 'Check how programs load and components are classified.'
        when 'briefing' then 'Review program loading, hardware, and software.'
        else description
      end,
      asset_path = case activity_type
        when 'presentation' then '/videos/week-1/w1-2-final-video.mp4'
        when 'briefing' then '/images/briefings/week-1/loading-and-classification-debrief.png'
        else asset_path
      end,
      updated_at = now()
  where week_id = target_week_id and lesson_id = target_lesson_id;

  select id into challenge_activity_id
  from public.week_activities
  where week_id = target_week_id
    and lesson_id = target_lesson_id
    and activity_type = 'challenge'
  order by activity_order
  limit 1;

  if challenge_activity_id is null then
    raise exception 'Week 1 Lesson 2 challenge activity was not found.';
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
      'w1-1-d2',
      2,
      1,
      'When a program starts, where is it loaded before the CPU executes it?',
      '["Secondary storage", "Main memory (RAM)", "Output device", "Keyboard"]'::jsonb,
      1,
      challenge_activity_id
    );
  else
    update public.quiz_questions
    set deck = 'w1-1-d2',
        slide_number = 2,
        ordinal = 1,
        prompt = 'When a program starts, where is it loaded before the CPU executes it?',
        choices = '["Secondary storage", "Main memory (RAM)", "Output device", "Keyboard"]'::jsonb,
        correct_index = 1
    where id = target_question_id;
  end if;
end
$$;
