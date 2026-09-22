/**
 * Instructor menu content model and lesson-page loader.
 * Goal: translate Supabase week_activities rows into three-button lesson pages
 * (presentation, challenge, briefing) shown by instructor-menu.system.ts.
 */
export type InstructorTaskAction = "presentation" | "challenge" | "briefing";

export type InstructorTaskContent = {
  activityId?: number;
  sourceActivityId?: number;
  unavailableReason?: string;
  buttonId: string;
  typeId: string;
  titleId: string;
  descriptionId: string;
  type: string;
  title: string;
  description: string;
  action: InstructorTaskAction;
  assetPath?: string | null;
};

export type InstructorLessonContent = {
  pageId: string;
  labelId: string;
  label: string;
  tasks: InstructorTaskContent[];
};

// Menu copy lives here instead of inside the behavior system. Later this
// array can be replaced by rows returned from Supabase without changing the
// dashboard pagination or button handlers.
export const INSTRUCTOR_LESSONS: InstructorLessonContent[] = [
  {
    pageId: "lesson-page-1",
    labelId: "lesson-1-label",
    label: "LESSON 1 - LITERAL COMPUTERS AND THE FIVE COMPUTER PARTS",
    tasks: [
      {
        buttonId: "presentation-mode-button",
        typeId: "lesson-1-task-1-type",
        titleId: "lesson-1-task-1-title",
        descriptionId: "lesson-1-task-1-description",
        type: "VIDEO",
        title: "Literal Computers and the Five Computer Parts",
        description: "Present CPU, RAM, storage, input, and output",
        action: "presentation"
      },
      {
        buttonId: "quick-challenge-button",
        typeId: "lesson-1-task-2-type",
        titleId: "lesson-1-task-2-title",
        descriptionId: "lesson-1-task-2-description",
        type: "CHALLENGE",
        title: "Five Parts Challenge",
        description: "Identify the job of each computer component",
        action: "challenge"
      },
      {
        buttonId: "class-mode-button",
        typeId: "lesson-1-task-3-type",
        titleId: "lesson-1-task-3-title",
        descriptionId: "lesson-1-task-3-description",
        type: "BRIEFING",
        title: "Five Parts Debrief",
        description: "Review the five-part computer model",
        action: "briefing",
        assetPath: "/images/briefings/week-1/five-parts-of-every-computer-debrief.png"
      }
    ]
  },
  {
    pageId: "lesson-page-2",
    labelId: "lesson-2-label",
    label: "LESSON 2 - LOADING AND CLASSIFICATION",
    tasks: [
      {
        buttonId: "task-lesson2-video",
        typeId: "lesson-2-task-1-type",
        titleId: "lesson-2-task-1-title",
        descriptionId: "lesson-2-task-1-description",
        type: "PRESENTATION",
        title: "Loading and Classification",
        description: "Present storage, RAM, CPU, hardware, and software",
        action: "presentation"
      },
      {
        buttonId: "task-lesson2-challenge",
        typeId: "lesson-2-task-2-type",
        titleId: "lesson-2-task-2-title",
        descriptionId: "lesson-2-task-2-description",
        type: "CHALLENGE",
        title: "Loading and Classification Challenge",
        description: "Check how programs load and components are classified",
        action: "challenge"
      },
      {
        buttonId: "task-lesson2-briefing",
        typeId: "lesson-2-task-3-type",
        titleId: "lesson-2-task-3-title",
        descriptionId: "lesson-2-task-3-description",
        type: "DEBRIEF",
        title: "Loading and Classification Debrief",
        description: "Review program loading, hardware, and software",
        action: "briefing",
        assetPath: "/images/briefings/week-1/loading-and-classification-debrief.png"
      }
    ]
  }
];

/** Local mapping: Five Parts series in slot 1, original single-question quiz in slot 3. */
function moveCurrentChallengeToThirdSlot(): void {
  const first = INSTRUCTOR_LESSONS[0]?.tasks.find(task => task.action === "challenge");
  const third = INSTRUCTOR_LESSONS[2]?.tasks.find(task => task.action === "challenge");
  if (!first || !third) return;
  third.sourceActivityId = first.activityId;
  third.title = "Challenge 3 — Computer Parts Quiz";
  third.description = "Identify the job of each computer component";
  first.title = "Challenge 1 — Computer Parts: True or False";
  first.description = "Answer five True/False questions about computer components";
  const second = INSTRUCTOR_LESSONS[1]?.tasks.find(task => task.action === "challenge");
  if (second) {
    second.title = "Challenge 2 — Devices In & Out";
    second.description = "Sort devices into input, output, both, or storage";
  }
  delete first.unavailableReason;
}

INSTRUCTOR_LESSONS.push({
  pageId: "lesson-page-3", labelId: "lesson-3-label",
  label: "LESSON 3 - LANGUAGE LADDER AND TRANSLATORS",
  tasks: [
    { buttonId: "task-lesson3-video", typeId: "lesson-3-task-1-type", titleId: "lesson-3-task-1-title", descriptionId: "lesson-3-task-1-description", type: "PRESENTATION", title: "Language Ladder and Translators", description: "Review programming languages and translators", action: "presentation" },
    { buttonId: "task-lesson3-challenge", typeId: "lesson-3-task-2-type", titleId: "lesson-3-task-2-title", descriptionId: "lesson-3-task-2-description", type: "CHALLENGE", title: "Five Parts Challenge", description: "Identify the job of each computer component", action: "challenge" },
    { buttonId: "task-lesson3-briefing", typeId: "lesson-3-task-3-type", titleId: "lesson-3-task-3-title", descriptionId: "lesson-3-task-3-description", type: "DEBRIEF", title: "Language Ladder Debrief", description: "Review programming languages and translators", action: "briefing", assetPath: "/images/briefings/week-1/language-ladder-and-translators-debrief.png" }
  ]
});
moveCurrentChallengeToThirdSlot();

export type InstructorContentResponse = {
  weekNumber: number;
  weekTitle: string;
  lessons: Array<{
    lessonNumber: number;
    title: string;
    activities: Array<{
      activityId: number;
      activityType: InstructorTaskAction | "game";
      title: string;
      description: string;
      assetPath?: string | null;
      environmentPath?: string | null;
      durationSeconds?: number | null;
    }>;
  }>;
};

export function replaceInstructorLessons(content: InstructorContentResponse): void {
  const lessons = content.lessons.map((lesson, lessonIndex) => {
    const isWeekOneLessonOne = content.weekNumber === 1 && lesson.lessonNumber === 1;
    const isWeekOneLessonTwo = content.weekNumber === 1 && lesson.lessonNumber === 2;
    const isWeekOneLessonThree = content.weekNumber === 1 && lesson.lessonNumber === 3;
    const canonicalLessonTitle = isWeekOneLessonOne
      ? "Literal Computers and the Five Computer Parts"
      : isWeekOneLessonTwo
        ? "Loading and Classification"
      : isWeekOneLessonThree
        ? "Language Ladder and Translators"
      : lesson.title;
    const tasks = lesson.activities
      .filter(activity => activity.activityType !== "game")
      .slice(0, 3)
      .map((activity, taskIndex) => {
        const canonicalCopies: Partial<Record<string, {
          type: string;
          title: string;
          description: string;
        }>> = {
              presentation: {
                type: "PRESENTATION",
                title: "Literal Computers and the Five Computer Parts",
                description: "Present CPU, RAM, storage, input, and output"
              },
              challenge: {
                type: "CHALLENGE",
                title: "Five Parts Challenge",
                description: "Identify the job of each computer component"
              },
              briefing: {
                type: "DEBRIEF",
                title: "Five Parts Debrief",
                description: "Review the five-part computer model"
              }
            };
        const lessonThreeCopies: Partial<Record<string, {
          type: string;
          title: string;
          description: string;
        }>> = {
          presentation: {
            type: "PRESENTATION",
            title: "Language Ladder and Translators",
            description: "Explain how source code reaches the CPU"
          },
          challenge: {
            type: "CHALLENGE",
            title: "Translators Challenge",
            description: "Check compilers, interpreters, and machine language"
          },
          briefing: {
            type: "DEBRIEF",
            title: "Language Ladder and Translators Debrief",
            description: "Review how Python instructions reach the CPU"
          }
        };
        const lessonTwoCopies: Partial<Record<string, {
          type: string;
          title: string;
          description: string;
        }>> = {
          presentation: {
            type: "PRESENTATION",
            title: "Loading and Classification",
            description: "Present storage, RAM, CPU, hardware, and software"
          },
          challenge: {
            type: "CHALLENGE",
            title: "Loading and Classification Challenge",
            description: "Check how programs load and components are classified"
          },
          briefing: {
            type: "DEBRIEF",
            title: "Loading and Classification Debrief",
            description: "Review program loading, hardware, and software"
          }
        };
        const canonicalCopy = isWeekOneLessonOne
          ? canonicalCopies[activity.activityType]
          : isWeekOneLessonTwo
            ? lessonTwoCopies[activity.activityType]
          : isWeekOneLessonThree
            ? lessonThreeCopies[activity.activityType]
            : undefined;

        return {
          activityId: activity.activityId,
          buttonId:
            lessonIndex === 0
              ? ["presentation-mode-button", "quick-challenge-button", "class-mode-button"][taskIndex]
              : `task-lesson${lessonIndex + 1}-${activity.activityType}`,
          typeId: `lesson-${lessonIndex + 1}-task-${taskIndex + 1}-type`,
          titleId: `lesson-${lessonIndex + 1}-task-${taskIndex + 1}-title`,
          descriptionId: `lesson-${lessonIndex + 1}-task-${taskIndex + 1}-description`,
          type: canonicalCopy?.type ?? activity.activityType.toUpperCase(),
          title: canonicalCopy?.title ?? activity.title,
          description: canonicalCopy?.description ?? activity.description,
          action: activity.activityType as InstructorTaskAction,
          assetPath:
            isWeekOneLessonOne && activity.activityType === "briefing"
              ? "/images/briefings/week-1/five-parts-of-every-computer-debrief.png"
              : isWeekOneLessonTwo && activity.activityType === "briefing"
                ? "/images/briefings/week-1/loading-and-classification-debrief.png"
              : isWeekOneLessonThree && activity.activityType === "briefing"
                ? "/images/briefings/week-1/language-ladder-and-translators-debrief.png"
                : activity.assetPath
        };
      });

    return {
      pageId: `lesson-page-${lessonIndex + 1}`,
      labelId: `lesson-${lessonIndex + 1}-label`,
      label: `LESSON ${lesson.lessonNumber} - ${canonicalLessonTitle.toUpperCase()}`,
      tasks
    };
  });

  if (lessons.length > 0) {
    INSTRUCTOR_LESSONS.splice(0, INSTRUCTOR_LESSONS.length, ...lessons);
    if (content.weekNumber === 1) moveCurrentChallengeToThirdSlot();
  }
}
