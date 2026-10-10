import type { TrialUnit } from "@/lib/plan";
import type { TaskScope } from "@/lib/taskMeta";

// Every piece of interface copy in the app, in English. The other languages'
// files have to match this shape exactly — TypeScript flags any key that's missing there.
// Copy that depends on a number is a small function, so each language can
// handle its own plurals and word order.

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

export const en = {
  /** Used for dates and times (toLocaleDateString / toLocaleTimeString). */
  locale: "en-US",

  common: {
    cancel: "Cancel",
    save: "Save",
    delete: "Delete",
    done: "Done",
    close: "Close",
    tryAgain: "Try again",
    aiUnreachable: "Couldn't reach the AI. Check your connection and try again.",
  },

  tabs: {
    next: "Today",
    tasks: "Tasks",
    settings: "Settings",
  },

  format: {
    /** "45 mins", "1 hour", "2 hours 15 mins" */
    duration: (hours: number, mins: number) => {
      const minsLabel = `${mins} ${plural(mins, "min", "mins")}`;
      const hoursLabel = `${hours} ${plural(hours, "hour", "hours")}`;
      if (hours === 0) return minsLabel;
      if (mins === 0) return hoursLabel;
      return `${hoursLabel} ${minsLabel}`;
    },
    /** Compact budget beside the session clock — "45m", "1h 30m". */
    budget: (hours: number, mins: number) => {
      if (hours === 0) return `${mins}m`;
      return mins === 0 ? `${hours}h` : `${hours}h ${mins}m`;
    },
    /** A task's length when it has none — a goal kept up through the day. */
    noDuration: "No duration",
    taskCount: (count: number) => `${count} ${plural(count, "task", "tasks")}`,
    /** "12 tasks", "1 completed task", "3 pending tasks". */
    scopedTaskCount: (count: number, scope: TaskScope) => {
      const noun = plural(count, "task", "tasks");
      return scope === "all" ? `${count} ${noun}` : `${count} ${scope} ${noun}`;
    },
  },

  due: {
    completed: "Completed",
    noDeadline: "No deadline",
    overdue: "Overdue",
    daysOverdue: (days: number) => `${days}d overdue`,
    dueAgo: (days: number, time: string) =>
      days === 1 ? `Due yesterday at ${time}` : `Due ${days} days ago at ${time}`,
    dueToday: "Due today",
    dueTodayBy: (time: string) => `Due today by ${time}`,
    dueTomorrow: "Due tomorrow",
    dueTomorrowAt: (time: string) => `Due tomorrow at ${time}`,
    inDays: (days: number) => `In ${days} days`,
    dueOnAt: (day: string, time: string) => `Due ${day} at ${time}`,
    /** A deadline with no set time — just its day. */
    dueOn: (day: string) => `Due ${day}`,
    dueAgoDay: (days: number) => (days === 1 ? "Due yesterday" : `Due ${days} days ago`),
    archived: "Archived",
    skipped: "Skipped",
  },

  /** The generic 3-step plan a new medium/complex task starts with. */
  planTemplate: ["Gather what you need", "Do the core work", "Wrap up and review"],

  next: {
    allCaughtUp: "All caught up",
    allCaughtUpBody: "You've completed everything on your list. Add a new task to keep going.",
    addATask: "Add a task",
    /** Before the score number on the Next card, which is set in its own colour. */
    scoreLabel: "Score: ",
    custom: "Custom...",
    minutesPlaceholder: "Minutes, e.g. 50",
    minutesUnit: "min",
    energy: { ready: "Ready", low: "Low energy", procrastinating: "Stuck" },
    sessionPlan: "SESSION PLAN",
    total: (duration: string) => `${duration} total`,
    startSession: (duration: string) => `Start session (${duration})`,
    details: "Details",
    priorityRank: (rank: number) => `#${rank} Priority`,
    startSessionFor: (duration: string) => `Start Session (${duration})`,
    previous: "Previous",
    nextCard: "Next",
    /** The card's Start button — its length sits beside it, not inside the label. */
    startSessionLabel: "Start session",
    /** The same button while that task's session is running: back into it, full screen. */
    resumeSession: "Resume session",
    breakDown: "Break down",
    getAdvice: "Get advice",
    /** Under Start session on the Next card: finishes the task without a session. */
    markComplete: "Mark complete",
    taskComplete: "Task complete",
    /** In place of the rank when the user put this task first. */
    pinned: "Pinned first",
    /** The button in the header that opens the Schedule. */
    schedule: "Schedule",
    /** Read out for today's progress bar. */
    todayProgress: (done: number, total: number) => `${done} of ${total} of today's tasks done`,
    /** When every task for today is done — the bar is full. */
    doneForToday: "Done for today",
    doneForTodayBody: "Everything due today is finished. What's coming up is in your schedule.",
    /** Open tasks exist, but none of them is due today. */
    nothingToday: "Nothing due today",
    nothingTodayBody: "No task is due today. Your schedule shows the other days, and Tasks has everything — tasks without a deadline too.",
    openSchedule: "Open schedule",
    /** Beside Open schedule when nothing is due today: the way to every task. */
    seeTasks: "See all tasks",
    /** The page's title, under today's date. */
    today: "Today",
    /** Today's card: what's left and what's done. */
    tasksLeft: (count: number) => `${count} ${plural(count, "task", "tasks")} left`,
    doneOfTotal: (done: number, total: number) => `${done} of ${total} done`,
  },

  /** The Schedule screen (app/schedule.tsx): the week — or the whole year — and the plan for each day. */
  schedule: {
    title: "Schedule",
    /** Under the title: the week's (or year's) open tasks and how long they take. */
    summary: (count: number, duration: string) => `${count} due · ${duration}`,
    /** The same when none of them has a length (tasks with no duration). */
    summaryCount: (count: number) => `${count} due`,
    /** The switch between the two views. */
    week: "Week",
    year: "Year",
    previousWeek: "Previous week",
    nextWeek: "Next week",
    thisWeek: "Back to this week",
    previousYear: "Previous year",
    nextYear: "Next year",
    thisYear: "Back to this year",
    today: "TODAY",
    stepOf: (step: number, total: number, label: string) => `Step ${step} of ${total}: ${label}`,
    nothingDue: "Nothing due this day",
    done: "DONE",
  },

  session: {
    leave: "Leave session",
    taskOf: (index: number, total: number) => `Task ${index} of ${total}`,
    tasksHeading: "SESSION TASKS & SUBTASKS",
    timerTitle: "SESSION TIMER",
    pause: "Pause",
    resume: "Resume",
    pauseA11y: "Pause session timer",
    resumeA11y: "Resume session timer",
    restartA11y: "Restart session timer",
    remainingOf: (budget: string) => `remaining of ${budget}`,
    overBudget: (budget: string) => `over your ${budget}`,
    of: (total: number) => `of ${total}`,
    switchTo: (title: string) => `Switch to ${title}`,
    aiAdvice: "AI Advice",
    closeAdvice: "Close AI advice",
    readingTask: "Reading through this task…",
    finishSession: "Done — finish session",
    nextTask: "Done with this task → Next task",
    aiBreakdown: "AI Breakdown",
    resetTimer: "Reset",
    pauseTimer: "Pause Timer",
    resumeTimer: "Resume Timer",
    complete: "Complete",
    cancelSession: "Cancel session",
    cancelTitle: "Cancel this session?",
    cancelBody: "The timer stops and the time you've spent won't be kept. The task itself stays exactly as it is.",
    keepGoing: "Keep going",
    endSession: "End session",
    hideAdvice: "Hide AI Advice",
    takeAdvice: "Take AI Advice",
    stuck: "I'm stuck",
    /** A session on a task with no duration, which has no timer. */
    noTimer: "No timer for this one — tap Complete once it's done.",
    /** The session's button for a photo, document or note about the task. */
    addContext: "Add context",
    contextIntro: "Show Nexdo what you're working on — a photo of the instructions, a document or a note. It updates this task's steps and advice.",
  },

  breakdown: {
    eyebrow: "AI BREAKDOWN",
    close: "Close AI breakdown",
    steps: (count: number) => `${count} ${plural(count, "step", "steps")}`,
    generating: "Generating…",
    regenerate: "Regenerate",
    breakingDown: "Breaking this task down…",
    stepPlaceholder: "Describe the step…",
    addStep: "Add step",
    confirm: "Confirm these steps",
  },

  tasks: {
    title: "Tasks",
    addTask: "Add Task",
    searchPlaceholder: "Search tasks...",
    pendingSuffix: " pending",
    completedSuffix: " completed",
    overdueCount: (count: number) => `${count} overdue`,
    showingPrefix: "Showing ",
    showingSuffix: (shown: number, total: number) => ` of ${total} tasks`,
    emptyTitle: "No tasks found",
    emptyBody: "Try a different filter or search term.",
    status: { all: "All", pending: "Pending", completed: "Completed", overdue: "Overdue", noDeadline: "No deadline", archived: "Archived" },
    sort: { recent: "Recently added", dueDate: "Due date", priority: "Priority score" },
    score: (score: number) => `Score: ${score}`,
  },

  taskDetail: {
    notFound: "Task not found",
    goBack: "Go back",
    postponeTitle: "POSTPONE",
    postpone: { oneDay: "+1 day", threeDays: "+3 days", oneWeek: "+1 week" },
    customDate: "Pick a date",
    setDate: "Set date",
    editTask: "Edit task",
    subtasksTitle: "SUBTASKS",
    addSubtask: "Add subtask...",
    editSubtask: (label: string) => `Edit ${label}`,
    deleteSubtask: (label: string) => `Delete ${label}`,
    notes: "NOTES",
    contextTitle: "ADD CONTEXT FOR AI",
    contextPlaceholder: "e.g. I already finished the research.",
    deleteTask: "Delete Task",
    saveChanges: "Save Changes",
    deleteConfirmTitle: "Delete this task?",
    deleteConfirmBody: "This can't be undone.",
    notePlaceholder: "What should the AI know about this task?",
    editNote: "Edit note",
    deleteNote: "Delete note",
    repeatEyebrow: "REPEATS",
    setRepeat: "Make it repeat",
    editRepeat: "Change",
    stopRepeating: "Stop repeating",
    stopRepeatingTitle: "Stop repeating?",
    stopRepeatingBody: "This task stays on your list as a one-off. No new occurrences will be created; past ones are kept.",
    editScopeTitle: "Change a repeating task",
    editScopeBody: "Apply these changes to…",
    scopeThis: "Only this occurrence",
    scopeFuture: "This and future ones",
    scopeSeries: "All of them, past ones too",
    deleteScopeTitle: "Delete a repeating task",
    deleteScopeBody: "Skip just this occurrence (the next one takes its place), or delete every occurrence, past ones included?",
    deleteThisOccurrence: "This occurrence",
    deleteWholeSeries: "Whole series",
    adviceTitle: "AI ADVICE",
    /** The report Task Details shows after Nexdo reassesses a task for a new note. */
    reassess: {
      running: "Nexdo is reassessing this task…",
      updatedTitle: "Task updated based on your new context",
      upToDate: "Your task is up to date. No changes to your task details were needed.",
      clarifyTitle: "Nexdo needs one detail",
      answerPlaceholder: "Answer Nexdo…",
      deadlineUnclear: "When is this task due now? Nexdo couldn't tell an exact date from your note.",
      aiFailed: "Nexdo couldn't reassess this task right now. Nothing was changed.",
      saveFailed: "Nexdo couldn't save the changes. Nothing was changed.",
      keptUserEdits: "Some suggestions were skipped because you changed the same details while Nexdo was working.",
      discard: "Discard note",
      dismiss: "Dismiss",
      title: (from: string, to: string) => `Title: “${from}” → “${to}”`,
      description: { added: "Description: Added", updated: "Description: Updated", removed: "Description: Removed" },
      deadline: (from: string, to: string) => `Deadline: ${from} → ${to}`,
      deadlineUnchanged: "Deadline: Unchanged",
      duration: (from: string, to: string) => `Estimated duration: ${from} → ${to}`,
      completed: "Task: Completed",
      priority: (from: string, to: string) => `Priority: ${from} → ${to}`,
      levels: { critical: "Critical", high: "High", medium: "Medium", low: "Low" },
      score: (from: number, to: number) => `Task score: ${from} → ${to}`,
      subtasks: (parts: string[]) => `Subtasks: Updated (${parts.join(", ")})`,
      subtaskParts: {
        added: (count: number) => `${count} added`,
        removed: (count: number) => `${count} removed`,
        completed: (count: number) => `${count} marked done`,
        renamed: (count: number) => `${count} renamed`,
        retimed: (count: number) => `${count} re-estimated`,
        reordered: "reordered",
      },
      advice: { added: "AI advice: Added", revised: "AI advice: Revised" },
    },
    /** The reminder line in the deadline card — the reminder is not the deadline, so it's shown on its own. */
    reminderAt: (when: string) => `Reminder: ${when}`,
    reminderNoDeadline: "No reminder — this task has no deadline.",
    reminderNoneLeft: "No reminder left before the deadline.",
    reminderMuted: "Reminders are off for this task.",
    reminderOffInSettings: "Deadline reminders are off in Settings.",
    muteReminders: "Turn off",
    unmuteReminders: "Turn on",
    restore: "Restore",
    /** The plan summary above the subtasks. */
    planLeft: (steps: number, duration: string) => `${steps} ${plural(steps, "step", "steps")} left · ${duration}`,
    /** A suggested day for a step — a suggestion, not a booking in a calendar. */
    today: "Today",
    tomorrow: "Tomorrow",
    /** Start session on a task while another task's session is running. */
    switchSessionTitle: "Switch sessions?",
    switchSessionBody: "A session is running on another task. Starting this one ends it, and its timer won't be kept.",
    switchSession: "Start this one",
    /** planLeft for steps with no time on them. */
    stepsLeft: (steps: number) => `${steps} ${plural(steps, "step", "steps")} left`,
    /** A photo or document given as context for the task (Add context for AI). */
    attach: {
      addPhoto: "Add a photo",
      takePhoto: "Take a photo",
      addDocument: "Add a file",
      photo: "Your photo",
      document: "Your document",
      hint: "Nexdo reads it and updates the task. The file itself isn't kept.",
      notePlaceholder: "Anything Nexdo should know about it? (optional)",
      remove: "Remove the file",
      tooBig: "That file is too big. Nexdo can read files up to 6 MB.",
      unsupported: "Nexdo can read photos, PDFs and text files.",
      pickFailed: "Couldn't open that file. Try again.",
      /** The camera was refused, now or before. */
      cameraDenied: "Nexdo needs the camera to take a photo. You can allow it in your phone's Settings.",
      readingPhoto: "Nexdo is reading your photo…",
      readingDocument: "Nexdo is reading your document…",
      readFailed: "Nexdo couldn't read that file. Nothing was changed.",
      emptyPhoto: "Nexdo couldn't find anything to read in that photo. Try a sharper one.",
      emptyDocument: "Nexdo couldn't find anything to read in that file.",
      fromPhoto: "From a photo",
      fromDocument: "From a document",
      showMore: "Show more",
      showLess: "Show less",
    },
  },

  form: {
    title: "Add New Task",
    taskTitle: "TASK TITLE",
    titlePlaceholder: "e.g. Complete Organic Chemistry lab writeup",
    titleRequired: "Task title is required.",
    duration: "ESTIMATED DURATION",
    customDuration: "Custom duration",
    minutesPlaceholder: "Minutes, e.g. 50",
    minutesUnit: "min",
    durationError: "Enter a positive whole number of minutes.",
    deadlineInPast: "That time has already passed — pick a later one.",
    deadline: "DEADLINE",
    specificDate: "Specific date / time",
    pickDate: "Pick on calendar",
    changeDate: "Change",
    priority: "PRIORITY LEVEL",
    priorities: { high: "High Priority", medium: "Medium Priority", low: "Low Priority" },
    /** The button that opens Plan steps and Notes & context, both optional. */
    optional: "Optional",
    planSteps: "Plan Steps",
    stepPlaceholder: "e.g. Step 1: Draft the introduction",
    notesTitle: "NOTES & CONTEXT",
    notesPlaceholder: "Add key requirements, instructions, or links...",
    addTask: "Add Task",
    deadlines: {
      today: "Today",
      tomorrow: "Tomorrow",
      friday: "This Friday",
      none: "No deadline",
    },
    durationOptions: { 15: "15m", 30: "30m", 45: "45m", 60: "1h", 90: "1.5h", 120: "2h", 180: "3h+", 0: "No duration" } as Record<
      number,
      string
    >,
    editEyebrow: "EDIT TASK",
    editTitlePlaceholder: "Task title",
    editCurrentDeadline: (label: string) => `Current deadline: ${label}`,
    deadlineRemoved: "The deadline will be removed.",
    newDeadline: (label: string) => `New deadline: ${label}`,
    /** A deadline is a day; a time is only added when the user wants one. */
    addTime: "Add a time",
    removeTime: "No set time",
  },

  /**
   * What's left of the AI chat's copy (the chat itself was removed on
   * 2026-10-08): onboarding's brain dump records a voice note with it.
   */
  chat: {
    attachmentReplies: {
      voice: "I couldn't quite catch that recording — try again somewhere quieter, or type it instead.",
    },
    couldntCatch: "Couldn't catch that",
    couldntTranscribe: "Couldn't transcribe",
    micPermissionTitle: "Microphone access needed",
    micPermissionBody: "Nexdo needs microphone access to record voice notes. You can enable it in Settings.",
    voiceNoteLabel: (duration: string) => `Voice note (${duration})`,
  },

  /** Magic mic — live voice (app/live-voice.tsx) — and the tab bar's mic button that opens it. */
  live: {
    open: "Talk to add or change tasks",
    /** The tab bar's mic on Free, where it wears a padlock and opens the plans. */
    openLocked: "Magic mic — part of Nexdo Pro",
    title: "Magic mic",
    connecting: "Connecting…",
    listening: (clock: string) => `Listening · ${clock}`,
    finishing: "Catching your last words…",
    stopped: "Stopped",
    undo: "Undo",
    yourTasks: "Your tasks",
    emptyTitle: "No open tasks",
    emptyBody: "Say one and it appears here.",
    marks: { added: "Just added", updated: "Updated", completed: "Done" },
    stop: "Stop listening",
    talkAgain: "Talk again",
    done: "Done",
    problems: {
      permission: "Nexdo needs the microphone to hear you. You can allow it in Settings.",
      unavailable: "Couldn't start Magic mic. Check your connection and try again.",
      connection: "The connection dropped. What you'd already said still counts.",
      timeLimit: "Magic mic stops after 5 minutes — tap Talk again to keep going.",
      silence: "Stopped listening after a quiet moment — tap Talk again to keep going.",    },
  },

  /** The first-run tour over the tab bar (components/AppTour.tsx) — a sentence or two per stop, no more. */
  tour: {
    next: "Next",
    done: "Got it",
    skip: "Skip",
    /** Read out by screen readers before each card. */
    stepOf: (step: number, total: number) => `Step ${step} of ${total}`,
    steps: {
      next: {
        title: "Today",
        body: "What's due today, with the task most worth doing on top. Swipe for the others, or tap Start session to focus.",
      },
      tasks: {
        title: "All your tasks",
        body: "Everything on your plate, in one list. Add Task adds one by hand; tap a task to change it, and tick it off when it's done.",
      },
      voice: {
        title: "Magic mic",
        body: "Tap the mic and just talk — Nexdo adds and changes tasks as you speak.",
      },
      /** The same stop on Free, where the mic wears a padlock. */
      voiceLocked: {
        title: "Magic mic",
        body: "Tap the mic and just talk — Nexdo adds and changes tasks as you speak. It comes with Nexdo Pro.",
      },
    },
  },

  /** What the assistant says when the app itself (not the AI model) writes the reply. */
  assistant: {
    foundOne: (title: string) => `I found 1 task: "${title}". Want me to add it?`,
    foundMany: (count: number, titles: string) => `I found ${count} tasks: ${titles}. Want me to add them?`,
    goAhead: "Want me to go ahead with that?",
    done: "Done.",
    wontChange: "No worries — I won't make that change.",
    nothingToUndo: "There's nothing to undo.",
    undone: "Undone.",
    added: (title: string) => `Added "${title}" to your tasks.`,
    addedMany: (count: number, titles: string) => `Added ${count} tasks: ${titles}.`,
    updated: (title: string) => `Updated "${title}".`,
    markedDone: (title: string) => `Marked "${title}" as done.`,
    deleted: (title: string) => `Deleted "${title}".`,
    deletedMany: (countLabel: string) => `Deleted ${countLabel}.`,
    loggedContext: (title: string) => `Got it — logged that on "${title}".`,
    rescheduled: (title: string) => `Rescheduled "${title}".`,
    skipped: (title: string) => `Got it — I'll hold off suggesting "${title}" for a bit.`,
    brokeDown: (title: string, count: number) => `Broke "${title}" into ${count} steps.`,
    redirectNext: (minutes: number) => `Set up the Today page for ${minutes} minutes.`,
    fallbackYourTask: "your task",
    fallbackThat: "that",
    whichOne: (titles: string) => `Which one do you mean: ${titles}?`,
    whichDelete: "Which task should I delete?",
    overdueWorkflow: (text: string) => `I'll help with "${text}" without changing a task yet.`,
    bestNext: (title: string, score: number) => `Your best next move is "${title}" — priority score ${score}.`,
    allCaughtUp: "You're all caught up — nothing pending right now.",
    noTaskFound: 'I couldn\'t find a task in that — try naming what you need to do, like "clean the house tomorrow".',
    adviceDoNow: (label: string, duration: string) => `Do this now: ${label} (~${duration}).`,
    adviceJustDo: (title: string, duration: string) => `Just do it — ${title} should take about ${duration}.`,
    /** The offline advice for a task (or step) with no duration to quote. */
    adviceKeepUp: (title: string) => `Keep ${title} going through the day, and tick it off once it's done.`,
    adviceStartWith: (label: string) => `Do this now: ${label}.`,
    urgencyHigh: "this is one of your most urgent tasks",
    urgencyMedium: "this is worth tackling soon",
    urgencyLow: "there's no rush, but it's on your list",
    adviceDetail: (score: number, urgency: string) => `Priority score ${score}/100 — ${urgency}.`,
    /** Said after "Added …" when the account hasn't confirmed the save. */
    notSavedYet: "It's on this phone but not saved to your account yet — Nexdo will keep trying.",
  },

  /** Repeating tasks — the rule in words, and the picker on the Add form and Task Details. */
  recurrence: {
    everyDays: (n: number) => (n === 1 ? "Every day" : `Every ${n} days`),
    everyWeeks: (n: number, days: string) => (n === 1 ? `Every week on ${days}` : `Every ${n} weeks on ${days}`),
    everyMonths: (n: number, day: number) => (n === 1 ? `Every month on day ${day}` : `Every ${n} months on day ${day}`),
    everyYears: (n: number, date: string) => (n === 1 ? `Every year on ${date}` : `Every ${n} years on ${date}`),
    until: (label: string, date: string) => `${label}, until ${date}`,
    title: "REPEAT",
    frequencies: { none: "Doesn't repeat", daily: "Daily", weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" },
    every: "Every",
    unit: (frequency: "daily" | "weekly" | "monthly" | "yearly", n: number) =>
      ({
        daily: plural(n, "day", "days"),
        weekly: plural(n, "week", "weeks"),
        monthly: plural(n, "month", "months"),
        yearly: plural(n, "year", "years"),
      })[frequency],
    decrease: "Repeat less often",
    increase: "Repeat more often",
    onDays: "ON",
    ends: "ENDS",
    endsNever: "Never",
    endsOn: "On a date",
    summary: (label: string) => `Repeats: ${label}`,
    firstOn: (when: string) => `First one: ${when}`,
    ifMissed: "IF ONE IS MISSED",
    missedKeep: "Keep it open",
    missedSkip: "Skip it",
    missedKeepHint: "A missed one stays open until you do it, and the next one waits.",
    missedSkipHint: "A missed one is marked skipped once the next one is due.",
  },

  /** What the assistant says about changes to existing tasks — written from what actually happened. */
  ops: {
    joinList: (items: string[]) =>
      items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`,
    andMore: (list: string, more: number) => `${list} and ${more} more`,
    quote: (title: string) => `"${title}"`,
    nextOccurrence: (when: string) => `The next one is due ${when}.`,
    seriesEnded: "That was the last one in the series.",
    alreadyDone: (title: string) => `"${title}" is already marked as completed, so nothing changed.`,
    alreadyOpen: (title: string) => `"${title}" is already open, so nothing changed.`,
    noDeadlineToMove: (title: string) => `"${title}" has no deadline to move, so I left it as it is.`,
    invalidChange: (title: string) => `I couldn't apply that change to "${title}", so nothing changed.`,
    nothingChanged: (title: string) => `"${title}" already looks like that — nothing changed.`,
    reopened: (title: string) => `Reopened "${title}" — it's back on your list.`,
    skippedOccurrence: (title: string, when?: string) =>
      `Skipped this occurrence of "${title}".${when ? ` The next one is due ${when}.` : " That was the last one in the series."}`,
    deletedSeries: (title: string, count: number) =>
      `Deleted the whole "${title}" series (${count} ${plural(count, "occurrence", "occurrences")}).`,
    endedSeries: (title: string) => `"${title}" won't repeat any more. Past occurrences are kept.`,
    updatedCompleted: (title: string) => `Updated "${title}" — it's still marked as completed.`,
    nowDue: (when: string) => `New deadline: ${when}.`,
    stoppedRepeating: (title: string) => `"${title}" won't repeat any more — it's now a one-off task.`,
    nowRepeats: (title: string, rule: string) => `"${title}" now repeats (${rule}).`,
    completedMany: (n: number) => `Marked ${n} ${plural(n, "task", "tasks")} as done.`,
    reopenedMany: (n: number) => `Reopened ${n} ${plural(n, "task", "tasks")}.`,
    updatedMany: (n: number) => `Updated ${n} ${plural(n, "task", "tasks")}.`,
    shiftedMany: (n: number, amount: number, unit: "minutes" | "hours" | "days" | "weeks" | "months") => {
      const size = Math.abs(amount);
      const unitLabel = {
        minutes: plural(size, "minute", "minutes"),
        hours: plural(size, "hour", "hours"),
        days: plural(size, "day", "days"),
        weeks: plural(size, "week", "weeks"),
        months: plural(size, "month", "months"),
      }[unit];
      return `Moved the ${plural(n, "deadline", "deadlines")} of ${n} ${plural(n, "task", "tasks")} ${size} ${unitLabel} ${amount > 0 ? "later" : "earlier"}.`;
    },
    someStillCompleted: (n: number) => `${n} of them ${n === 1 ? "is" : "are"} still marked as completed.`,
    deletedMany: (n: number) => `Deleted ${n} ${plural(n, "task", "tasks")}.`,
    noDeadlineSkipped: (n: number) =>
      n === 1 ? "1 task has no deadline and was left as it is." : `${n} tasks have no deadline and were left as they are.`,
    alreadyDoneMany: (n: number) => (n === 1 ? "1 was already completed." : `${n} were already completed.`),
    alreadyOpenMany: (n: number) => (n === 1 ? "1 was already open." : `${n} were already open.`),
    nothingChangedMany: "Those tasks already look like that — nothing changed.",
    notFound: "I couldn't find that task — it may have been deleted. Nothing was changed.",
    whichDates: "I couldn't tell which dates you mean — could you put it another way? Nothing was changed.",
    whichTasks: "I couldn't tell which tasks you mean — could you say which ones? Nothing was changed.",
    nothingMatched: "No tasks match that, so nothing was changed.",
    someNotFound: (n: number) => `${n} ${plural(n, "task", "tasks")} couldn't be found.`,
    confirmComplete: (n: number, titles: string) => `Mark ${n} ${plural(n, "task", "tasks")} as done? ${titles}.`,
    confirmReopen: (n: number, titles: string) => `Reopen ${n} ${plural(n, "task", "tasks")}? ${titles}.`,
    confirmDelete: (n: number, titles: string, includesCompleted: boolean) =>
      `Delete ${n} ${plural(n, "task", "tasks")}${includesCompleted ? " (completed ones included)" : ""}? ${titles}.`,
    confirmDeleteSeries: (title: string) => `Delete every occurrence of "${title}", past ones included?`,
    confirmShift: (n: number, titles: string, amount: number, unit: "minutes" | "hours" | "days" | "weeks" | "months") => {
      const size = Math.abs(amount);
      const unitLabel = {
        minutes: plural(size, "minute", "minutes"),
        hours: plural(size, "hour", "hours"),
        days: plural(size, "day", "days"),
        weeks: plural(size, "week", "weeks"),
        months: plural(size, "month", "months"),
      }[unit];
      return `Move the ${plural(n, "deadline", "deadlines")} of ${n} ${plural(n, "task", "tasks")} ${size} ${unitLabel} ${amount > 0 ? "later" : "earlier"}? ${titles}.`;
    },
    confirmUpdate: (n: number, titles: string) => `Change ${n} ${plural(n, "task", "tasks")}? ${titles}.`,
    askEditScope: (title: string, rule: string) =>
      `"${title}" repeats (${rule}). Should I change just this occurrence, or this one and all future ones?`,
    askDeleteScope: (title: string, rule: string) =>
      `"${title}" repeats (${rule}). Should I skip just this occurrence, stop the series from here on (past ones stay), or delete the whole series?`,
    askEditScopeMany: (n: number) =>
      `${n} of those ${plural(n, "task repeats", "tasks repeat")}. Should the change apply only to the current occurrences, or to future ones too?`,
    askDeleteScopeMany: (n: number) =>
      `${n} of those ${plural(n, "task repeats", "tasks repeat")}. Should I skip just the current occurrences, or delete the whole series?`,
    listHeader: (n: number) => (n === 1 ? "1 task matches:" : `${n} tasks match:`),
    repeatingUpdateNote: "For repeating tasks, only the current occurrence changes.",
    repeatingDeleteNote: "Repeating tasks among them will stop repeating.",
    listEmpty: "No tasks match that.",
    listMore: (n: number) => `…and ${n} more.`,
    completedOn: (when: string) => `completed ${when}`,
    dueOn: (when: string) => `due ${when}`,
    overdueSince: (when: string) => `overdue since ${when}`,
    dateUnclear: (phrase: string) =>
      `I couldn't tell which date "${phrase}" means, so I haven't added anything yet. Which day is it? (For example "March 4".)`,
    archived: (title: string) => `Archived "${title}".`,
    restored: (title: string) => `Restored "${title}" — it's back on your list.`,
  },

  settings: {
    title: "Settings",
    subtitle: "Customize your experience",

    account: "ACCOUNT",
    signOut: "Sign out",
    signingOut: "Signing out…",
    signOutCleanupError: "Signed out, but local data cleanup needs attention.",
    signOutError: "Couldn't sign out. Try again.",
    unsavedTasksTitle: "Some tasks aren't saved yet",
    unsavedTasksBody: (count: number) =>
      `${count === 1 ? "1 task hasn't" : `${count} tasks haven't`} reached your account yet — check your connection. If you sign out now, ${count === 1 ? "it stays" : "they stay"} safe on this phone and ${count === 1 ? "is" : "are"} saved the next time you sign in here, but won't show on other devices until then.`,
    signOutAnyway: "Sign out anyway",

    /** The plan section's title, on Free and on Pro alike — which plan it is, is the card's first line. */
    plan: "YOUR PLAN",
    upgrade: "Upgrade to Nexdo Pro",
    upgradeBody: "Monthly or yearly — cancel anytime.",
    restorePurchases: "Restore purchases",
    restoring: "Restoring…",
    restoreDone: "Nexdo Pro is back on this account.",
    restoreNothing: "No Nexdo Pro purchase was found for this phone's store account.",
    restoreOffline: "You're offline. Connect and try again.",
    restoreError: "Couldn't restore purchases. Try again.",
    manageSubscription: "Manage subscription",
    manageError: "Couldn't open your subscription. Try again.",
    proActive: "Nexdo Pro is active.",
    proRenews: (date: string) => `Nexdo Pro · renews ${date}`,
    proEnds: (date: string) => `Nexdo Pro · ends ${date}`,

    notifications: "NOTIFICATIONS",
    dailyNudge: "Daily planning",
    dailyNudgeBody: "One note a day: what's due and where to start. Separate from deadline reminders.",
    nudgeTime: "Remind me at",
    overdueAlerts: "Overdue task alerts",
    overdueAlertsBody: "A heads-up when a task with a set time passes its deadline.",
    notificationsNote: "Reminders are scheduled on this phone. A task without a deadline never gets one.",
    notificationsBlockedTitle: "Notifications are off",
    notificationsBlockedBody: "Allow notifications for Nexdo in your phone's settings to get reminders.",
    openPhoneSettings: "Open settings",
    deadlineReminders: "Deadline reminders",
    deadlineRemindersBody: "On the day a task is due. A task with no set time is reminded at the time below.",
    reminderTime: "Reminder time",
    beforeDeadline: "ALSO BEFORE A SET TIME",
    offsetChip: (minutes: number) =>
      minutes < 60 ? `${minutes} min` : minutes < 1440 ? plural(minutes / 60, "1 hour", `${minutes / 60} hours`) : plural(minutes / 1440, "1 day", `${minutes / 1440} days`),
    importantReminder: "Extra reminder for high priority",
    importantReminderBody: "The day before, at the reminder time.",
    notificationsDenied: "Notifications are off for Nexdo in your phone's settings, so no reminder can arrive.",

    language: "LANGUAGE",

    support: "HELP & SUPPORT",
    help: "FAQ / Help",
    helpBody: "Answers to common questions, or get in touch.",
    tour: "App tour",
    tourBody: "A quick look around Nexdo.",
    sendFeedback: "Send feedback",
    privacy: "Privacy policy",
    terms: "Terms of service",
    version: (version: string) => `Nexdo v${version}`,
    linkError: "Couldn't open that link. Try again.",
  },

  /** Free vs Pro: what a plan counts each month (lib/plan.ts), and what's said when one runs out. */
  plan: {
    meters: {
      /** Notes under "Add context for AI" on Task Details — the meter is still called "chat". */
      chat: "Context notes for AI",
      media: "Photos and documents",
      voice: "Voice notes",
      live: "Magic mic",
      assist: "Breakdowns and advice",
    },
    minutes: (count: number) => `${count} min`,
    used: {
      chat: "You've used this month's context notes for AI.",
      media: "You've used this month's photos and documents.",
      voice: "You've used this month's voice note minutes.",
      live: "You've used this month's Magic mic minutes.",
      assist: "You've used this month's breakdowns and advice.",
    },
    /** Free has no Magic mic at all. */
    liveProOnly: "Magic mic comes with Nexdo Pro.",
    resets: "Your allowance starts again on the 1st.",
    upgradeHint: "Nexdo Pro gives you far more each month — and adding tasks by hand is always free.",
    limitTitle: "Monthly limit reached",
    /** Settings → Your plan: what the month has used so far. */
    thisMonth: "This month",
    names: { free: "Free plan", pro: "Nexdo Pro" },
    usedOf: (used: number, limit: string) => `${used} of ${limit}`,
    proOnly: "Pro only",
  },

  /** The Nexdo Pro paywall (app/paywall.tsx). Prices come from the store, never from here. */
  paywall: {
    close: "Close",
    title: "Let Nexdo do more of the thinking.",
    subtitle: (taskCount: number) =>
      taskCount === 0
        ? "Pro gives the AI room to plan your tasks with you."
        : `Nexdo already organized your ${plural(taskCount, "task", `${taskCount} tasks`)}. Pro gives the AI room to keep planning ${plural(taskCount, "it", "them")} with you.`,
    yearly: "Yearly",
    monthly: "Monthly",
    save: (percent: number) => `Save ${percent}%`,
    aMonth: (price: string) => `${price} a month`,
    perMonth: "per month",
    eachMonth: "Each month",
    free: "Free",
    pro: "Pro",
    unlimitedNote: "Adding tasks by hand, the Today page and reminders are unlimited on both plans.",
    startTrial: (count: number, unit: TrialUnit) => `Start ${count}-${unit} free trial`,
    subscribe: "Get Nexdo Pro",
    working: "One moment…",
    trialTerms: (count: number, unit: TrialUnit, price: string, yearly: boolean) =>
      `Free for ${count} ${plural(count, unit, `${unit}s`)}, then ${price} a ${yearly ? "year" : "month"}. Cancel anytime.`,
    terms: (price: string, yearly: boolean) => `${price} a ${yearly ? "year" : "month"}, renewed until you cancel.`,
    continueFree: "Continue with Free",
    restore: "Restore purchases",
    termsLink: "Terms",
    privacyLink: "Privacy",
    loading: "Loading plans…",
    loadError: "Couldn't load the plans. Check your connection and try again.",
    retry: "Try again",
    purchaseError: "The purchase didn't go through. Try again.",
    purchasePending: "Your purchase is waiting for approval. Nexdo Pro switches on as soon as it's confirmed.",
    offline: "You're offline. Connect and try again.",
    welcomeTitle: "You're on Nexdo Pro",
    welcomeBody: "Your new monthly allowance is ready to use.",
  },

  /** Settings → Send feedback. */
  feedback: {
    title: "Send feedback",
    subtitle: "Help us make Nexdo better.",
    typeLabel: "FEEDBACK TYPE",
    types: { suggestion: "Suggestion", bug: "Bug", general: "General feedback", other: "Other" },
    messageLabel: "YOUR MESSAGE",
    messagePlaceholder: "Tell us what's on your mind…",
    messageRequired: "Write a message first.",
    optional: "Optional",
    screenshotLabel: "SCREENSHOT",
    addScreenshot: "Attach a screenshot",
    screenshotAttached: "Screenshot attached",
    viewScreenshot: "View screenshot",
    removeScreenshot: "Remove screenshot",
    screenshotInvalid: "That image can't be attached. Pick a screenshot or photo under 5 MB.",
    screenshotError: "Couldn't upload your screenshot. Try again, or remove it and send without it.",
    privacyNote: "Sent with your Nexdo account, app version and phone type, so there's no need to add your email.",
    submit: "Send feedback",
    sending: "Sending…",
    success: "Thanks for your feedback.",
    successBody: "We read every message. It helps decide what we fix and build next.",
    error: "Couldn't send your feedback. Check your connection and try again.",
    rateLimited: "You've sent a lot of feedback in a short time. Try again in a little while.",
  },

  /** Phone notifications — shown by the system, outside the app. */
  notifications: {
    overdueTitle: (title: string) => `Overdue: ${title}`,
    overdueBody: "Its deadline just passed. Tap to finish it or pick a new time.",
    /** Android lists these under Nexdo's notification settings. */
    overdueChannel: "Overdue tasks",
    remindersChannel: "Task reminders",
    planningChannel: "Daily planning",
    completeAction: "Mark as done",
    dueTodayTitle: (title: string) => `Due today: ${title}`,
    dueTodayBody: "No set time — any time today works.",
    /** At an exact deadline, the moment it arrives. */
    dueNowTitle: (title: string) => `Due now: ${title}`,
    dueNowBody: (time: string) => `Set for ${time} today.`,
    dueInBody: (offset: string, time: string) => `Due in ${offset}, at ${time}.`,
    offsetLabel: (minutes: number) =>
      minutes < 60
        ? `${minutes} ${plural(minutes, "minute", "minutes")}`
        : minutes < 1440
          ? `${Math.round(minutes / 60)} ${plural(Math.round(minutes / 60), "hour", "hours")}`
          : `${Math.round(minutes / 1440)} ${plural(Math.round(minutes / 1440), "day", "days")}`,
    dueTomorrowTitle: (title: string) => `Due tomorrow: ${title}`,
    dueTomorrowBody: "Tomorrow, no set time.",
    dueTomorrowAtBody: (time: string) => `Due tomorrow at ${time}.`,
    dailyTitle: "Plan your day",
    dailyDueBody: (count: number, top: string) =>
      `${count} ${plural(count, "task", "tasks")} due today.${top ? ` Start with "${top}".` : ""}`,
    dailyOpenBody: (count: number, top: string) =>
      `${count} open ${plural(count, "task", "tasks")}.${top ? ` Start with "${top}".` : ""}`,
    /** Two days before a free trial turns into a paid plan (lib/trialReminder.ts). */
    trialEndingTitle: "Your free trial ends in 2 days",
    trialEndingBody: (date: string) => `Nexdo Pro starts on ${date}. Don't want it? Cancel before then from Settings.`,
  },

  profile: {
    addName: "Add your name",
    editAccount: "Edit your account",
  },

  /** The Account sheet — the one place profile details are edited. */
  account: {
    title: "Account",
    close: "Close account settings",
    changePhoto: "Change profile picture",
    photoHint: "JPG or PNG under 5MB",
    photoError: "Couldn't update your picture. Try again.",
    name: "Name",
    namePlaceholder: "Your name",
    nameRequired: "Add your name.",
    nameError: "Couldn't save your name. Try again.",
    saving: "Saving…",
    saved: "Saved",
    email: "Email",
    noEmail: "No email on this account",
    changePassword: "Change password",
    currentPassword: "Current password",
    newPassword: "New password",
    confirmPassword: "Confirm new password",
    passwordHint: "Use at least 8 characters.",
    passwordMismatch: "Those two passwords don't match.",
    passwordUpdated: "Password updated.",
    passwordError: "Couldn't change your password. Check the current one and try again.",
    savePassword: "Save password",
    deleteAccount: "Delete account",
    deleteTitle: "Delete your account?",
    deleteBody:
      "This permanently deletes your Nexdo account and everything on it — every task and setting, on every device. It can't be undone.",
    deleteProNote:
      "Deleting your account doesn't cancel Nexdo Pro. Cancel it in your App Store or Google Play subscriptions first, or it keeps renewing.",
    deleteConfirm: "Delete account",
    deleting: "Deleting…",
    deleteError: "Couldn't delete your account. Try again.",
    deletePartialError: "Couldn't finish deleting your account — some of your data is already gone, but the account is still here. Try again to finish.",
  },

  /** The chrome every onboarding step shares, then step 1's own copy. */
  onboarding: {
    next: "Next step",
    getStarted: "Get Started",
    haveAccount: "I already have an account",
    stickyNotes: ["dentist appt?", "exam next week", "groceries", "reply to email"],
    headline: "Stop figuring out what to do next.",
    body: "Dump everything on your mind. Nexdo organizes it, detects deadlines, and tells you what deserves your attention.",
    nextUp: "NEXT UP",
    sampleTask: "Finish chemistry lab report",
    dueTomorrow: "Due tomorrow",
  },

  /** Onboarding step 2 — the drag-to-sort demo. */
  onboardingSort: {
    headline: "Everything in your head.\nDrag it into order.",
    body: "Pull the line down — watch the mess sort itself into a plan.",
    head: "IN YOUR HEAD",
    plan: "IN YOUR PLAN",
    priority: { high: "HIGH", medium: "MED", low: "LOW" },
    dragHandle: "Drag to sort your tasks",
  },

  /** Onboarding step 3 — what gets in the user's way. The options are
   *  first-person confessions, so the question asks which ones fit. Labels are
   *  in the same order as the GOALS ids in app/onboarding-goals.tsx. */
  onboardingGoals: {
    headline: "Be honest — which of these sound like you?",
    body: "Pick as many as you like. No judgment here.",
    options: [
      "I forget what I need to do",
      "I have too much on my mind",
      "I struggle to prioritize",
      "I procrastinate on big tasks",
      "I don't know where to start",
      "I want to be more organized",
    ],
    continue: "Continue",
  },

  /** Onboarding step 4 — the brain dump, typed or spoken. Every line asks for
   *  tasks by name: "what's on your mind" read as an invitation to chat. */
  onboardingDump: {
    eyebrow: "TRY IT WITH YOUR REAL TASKS",
    headline: "What do you need to get done this week?",
    body: "**List every task on your plate** — messy is fine. Type them, or tap the mic and say them out loud.",
    placeholder: "Finish math homework by Friday\nEmail my professor\nBuy groceries tonight…",
    startRecording: "Start speaking",
    stopRecording: "Stop and write it down",
    transcribing: "Writing it down…",
    organize: "Organize with Nexdo",
    // Shown instead of the dump once this install has had its free AI run.
    trialUsedHeadline: "You've already tried Nexdo's AI",
    trialUsedBody: "The free preview is **one run per device**. Create your account to keep your tasks and keep organizing with AI.",
    trialUsedCta: "Continue",
  },

  /** Onboarding step 5 — the wait while the AI reads the dump. */
  onboardingAnalyzing: {
    headline: "Turning that into a plan…",
    body: "Nexdo is analyzing dates, durations, dependencies, and cognitive load.",
    steps: [
      "Finding distinct tasks in raw text",
      "Detecting deadlines & time windows",
      "Estimating realistic effort",
      "Calculating priority scores & next action",
    ],
  },

  /** Onboarding step 6 — what the AI pulled out of the dump. */
  onboardingPlan: {
    extracted: (count: number) => `${count} ${plural(count, "TASK", "TASKS")} EXTRACTED`,
    headline: "Your mind looks a little clearer.",
    body: "Nexdo extracted specific tasks, identified deadlines, and calculated durations.",
    nothingFound: "Nexdo couldn't find anything to do in that. You can add tasks yourself once you're set up.",
    score: (value: number) => `Score ${value}`,
    next: "What should I do first?",
  },

  /** Onboarding step 7 — the one task Nexdo picks, and a tip for doing it. */
  onboardingFocus: {
    eyebrow: "THE DECISION ENGINE",
    headline: "So… what should you do first?",
    body: "You don't organize your tasks and then still wonder where to start. **Nexdo makes the decision.**",
    nextFocus: "NEXT FOCUS",
    urgency: (score: number) => `Urgency ${score} / 100`,
    advice: "AI ADVICE",
    thinking: "Thinking of a tip…",
    nothing: "There's nothing to decide on yet. Add a task once you're set up and Nexdo will pick for you.",
    next: "Makes sense",
  },

  /** Onboarding step 8 — asking for notifications, with a sample of one. */
  onboardingNotify: {
    headline: "One nudge, right when it matters.",
    body: "Not fifty notifications. Just the one that keeps you on track.",
    sampleTime: "now",
    sampleBody: "Your chemistry assignment is due tomorrow. Want to start now?",
    allow: "Allow notifications",
    notNow: "Not now",
  },

  /** Onboarding step 9 — the free trial, day by day. Only shown when the store offers one. */
  onboardingTrial: {
    headline: "Here's exactly what happens.",
    body: "No surprises. No guessing when you'll be charged.",
    today: "TODAY",
    day: (day: number) => `DAY ${day}`,
    anytime: "ANYTIME",
    startTitle: "Start your free trial",
    startBody: "Full access to Nexdo Pro. Nothing charged.",
    remindTitle: "We'll remind you",
    remindBody: "A heads-up 2 days before your trial ends — plenty of time to decide.",
    endTitle: "Trial ends",
    endBody: (price: string, yearly: boolean) =>
      `${price}/${yearly ? "year" : "month"} charged — or cancel any time before this to pay nothing.`,
    cancelTitle: "Cancel anytime",
    cancelBody: "Right from Settings. No calls, no forms.",
    next: "Continue",
  },

  /** Onboarding step 10 — the plans, before the account is made. Prices come from the store. */
  onboardingPaywall: {
    headline: "Here's what's included.",
    body: "Free covers the basics. Pro gives Nexdo's AI far more room, every month:",
    bestValue: (percent: number) => `BEST VALUE · SAVE ${percent}%`,
    /** What a Pro month includes, from lib/plan.ts. */
    features: {
      chat: (count: number) => `${count} context notes for AI`,
      media: (count: number) => `${count} photos and documents`,
      voice: (minutes: number) => `${minutes} min of voice notes`,
      live: (minutes: number) => `${minutes} min of Magic mic`,
      assist: (count: number) => `${count} breakdowns and advice`,
    },
  },

  auth: {
    welcomeBack: "Welcome back.",
    signInSubtitle: "Log in to pick up right where you left off.",
    email: "EMAIL",
    password: "PASSWORD",
    logIn: "Log in",
    continue: "Continue",
    useCode: "Use email code instead",
    continueWithEmail: "or continue with email",
    noAccount: "Don't have an account?",
    signUp: "Sign up",
    signUpButton: "Sign Up",
    haveAccount: "I have an account already?",
    terms: "By continuing you agree to Nexdo's Terms and Privacy Policy.",
    invalidCode: "Invalid code. Try again.",
    sendCodeError: "Couldn't send the verification code. Try again.",
    signUpTitle: "Don't lose your plan.",
    signUpSubtitle: (count: number) =>
      count === 1
        ? "Your task is sorted and ready. Create an account to save it and keep going."
        : `${count} tasks are sorted and ready. Create an account to save them and keep going.`,
    // For anyone who reaches sign-up without a plan: from the log-in screen,
    // or when the brain dump had nothing in it to do.
    signUpTitleNoPlan: "Create your account.",
    signUpSubtitleNoPlan: "Keep everything you need to do in one place, and let Nexdo tell you what to tackle first.",
    continueWithGoogle: "Continue with Google",
    continueWithApple: "Continue with Apple",
    checkEmail: "Check your email",
    codeSentTo: "We sent a 6-digit code to",
    somethingWrong: "Something went wrong. Try again.",
    showPassword: "Show password",
    hidePassword: "Hide password",
  },
};
