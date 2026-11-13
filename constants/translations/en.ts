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

  /** Asked once before anything goes to Google's AI (lib/aiConsentPrompt.ts). */
  aiConsent: {
    title: "Use AI with Nexdo?",
    body: "To organize your tasks, Nexdo sends what you type, say or photograph for an AI feature to Google's Gemini AI, which processes it and sends back the result.",
    allow: "Allow",
    notNow: "Not now",
    privacy: "Privacy policy",
  },

  /** The "Undo" toast after finishing or deleting a task (components/UndoToast.tsx). */
  /** What a task's score is (components/ScoreSheet.tsx, from the Tasks page's score pill). */
  scoreInfo: {
    /** The compact score card (2026-11-09). */
    compact: { headline: "Higher score, do it sooner", line: "It goes up as the deadline gets closer.", soon: "Due soon", important: "Important", long: "Long" },
    card: { first: "Do this one first", soon: "Worth doing soon", wait: "This one can wait", means: "A high score means: do it soon.", dueSoon: "It’s due soon", important: "It’s important", takesWhile: "It takes a while" },
    footer2: "Nexdo updates it by itself as deadlines get closer.",
    gotIt: "Got it",
    title: "What's the score?",
    body: "A number from 0 to 100 that tells you what to do first. The higher it is, the sooner the task deserves your time. Nexdo works it out from three things:",
    parts: { soon: "How soon it's due", important: "How important it is", long: "How long it takes" },
    footer: "It updates by itself as deadlines get closer, so the list stays in the right order.",
  },

  undoToast: {
    undo: "Undo",
    done: (title: string) => `Done: ${title}`,
    /** A task done that feeds today's gem (Anim-TaskDone.html). */
    gemBrighter: "Nice! Gem glows brighter",
    doneToday: (done: number, total: number) => `${done} of ${total} tasks done today`,
    deleted: (title: string) => `Deleted: ${title}`,
  },

  tabs: {
    next: "Today",
    tasks: "Tasks",
    settings: "Settings",
    calendar: "Calendar",
  },

  /** Shown in place of a screen that failed to draw (components/CrashScreen.tsx). */
  crash: {
    title: "Something went wrong",
    body: "This screen couldn’t load. Your tasks are safe.",
    retry: "Reload",
  },
  /** Logging in to an existing account with onboarding's brain dump still waiting (hooks/useAuthSync.ts). */
  draftsOnLogIn: {
    title: "Add your brain dump?",
    body: (n: number) => `You listed ${n} tasks before logging in. Add them to your account?`,
    add: "Add them",
    skip: "Skip",
  },
  /** Today's quiet line while changes haven't reached the server for a while. */
  sync: {
    pending: "Not synced yet — your changes are saved on this phone.",
  },
  /** Settings → Preferences: product analytics on or off (PostHog). */
  privacyPrefs: {
    analytics: "Share usage data",
    on: "On",
    off: "Off",
  },

  format: {
    /** "45 min", "1 h", "2 h 15 min" */
    duration: (hours: number, mins: number) => {
      const minsLabel = `${mins} min`;
      const hoursLabel = `${hours} h`;
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
    /** On a Tasks card: just the day, without "Due" (2026-11-03). */
    todayShort: "Today",
    tomorrowShort: "Tomorrow",
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
    routinesTitle: "ROUTINES",
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
    gemNewStar: (days: number) => `New star! ${days} days of showing up.`,
    gemNextStar: (days: number) => `${days} more days of finishing something for the next star`,
    todayProgress: (done: number, total: number) => `${done} of ${total} of today's tasks done`,
    /** When every task for today is done — the bar is full. */
    doneForToday: "Done for today",
    doneForTodayBody: "Everything due today is finished. What's coming up is in your schedule.",
    /** Open tasks exist, but none of them is due today. */
    nothingToday: "Nothing due today",
    nothingTodayBody: "No task is due today. Your schedule shows the other days, and Tasks has everything — tasks without a deadline too.",
    /** Under "Nothing due today", above the best open tasks from any day. */
    upNextBody: "Here's the best next thing, if you have time.",
    openSchedule: "Open schedule",
    /** Beside Open schedule when nothing is due today: the way to every task. */
    seeTasks: "See all tasks",
    /** The page's title, under today's date. */
    today: "Today",
    /** Today's card: what's left and what's done. */
    tasksLeft: (count: number) => `${count} ${plural(count, "task", "tasks")} left`,
    doneOfTotal: (done: number, total: number) => `${done} of ${total} done`,
    /** The switch under the title: today's list (late tasks included), or every open task. */
    viewToday: (count: number) => `Today · ${count}`,
    viewAll: (count: number) => `All tasks · ${count}`,
    /** The 2026-11 redesign's Today page. The top card's pill. */
    doThisFirst: "Do this first",
    /** The card's Start button, and what a screen reader hears with its length. */
    startFocus: "Start focus",
    startFocusFor: (duration: string) => `Start focus (${duration})`,
    /** On the card's info line, before the score. */
    score: "Score",
    /** The routines section: its heading, and its count as [before, the bold number, after]. */
    routinesHeading: "Routines",
    routinesToday: (done: number, total: number): [string, string, string] => ["", String(done), ` of ${total} today`],
    /** Before the routines with no time of day. */
    anytime: "Anytime today",
    /** The quiet Today / All switch beside the +: "All" (each with its count). */
    allShort: "All",
    /** The routines section with none today, and its button. */
    noRoutinesToday: "No routines today. Try “Read every day at 9pm”.",
    addRoutine: "Add a routine",
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
    /** The redesigned page (2026-11-08): the Month view, the titles over each view. */
    month: "Month",
    thisWeekTitle: "This week",
    weekOf: (date: string) => `Week of ${date}`,
    monthTasks: (count: number) => `${count} ${plural(count, "task", "tasks")} this month`,
    yearSubtitle: "Your year in gems",
    /** The labels over a day's two lists (shown in capitals). */
    tasksLabel: "Tasks",
    routinesLabel: "Routines",
    /** The month's key, from a quiet day to a busy one. */
    fewerTasks: "Fewer tasks",
    moreTasks: "More",
    /** In the time column, for a task due on a day but at no set time. */
    allDay: "All day",
    /** A task's length in a day's list: "2 h", "30 min", "1 h 30 min". */
    length: (hours: number, mins: number) => (hours === 0 ? `${mins} min` : mins === 0 ? `${hours} h` : `${hours} h ${mins} min`),
    /** The year's key: a day's gem, from nothing done to everything done. */
    gemLevels: { sleepy: "Sleepy", flicker: "Flicker", steady: "Steady", glowing: "Glowing", blazing: "Blazing" },
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
    cancelBody: "The timer stops. The time so far still counts in Insights, and the task stays exactly as it is.",
    keepGoing: "Keep going",
    endSession: "End session",
    hideAdvice: "Hide AI Advice",
    takeAdvice: "Take AI Advice",
    /** A session on a task with no duration, which has no timer. */
    noTimer: "No timer for this one — tap Complete once it's done.",
    /** The session's button for a photo, document or note about the task. */
  },

  /** A focus session's background sound (Pro; components/FocusSoundPicker.tsx). */
  focusSound: {
    label: "Focus sound",
    names: { off: "Off", rain: "Rain", waves: "Waves", thunder: "Thunderstorm", stream: "Stream", forest: "Forest", fireplace: "Fireplace" },
  },

  /** The Insights page (app/insights.tsx): focus time, tasks done, streak, and your pace (Pro). */
  insights: {
    /** The focus chart's big number: "18 min", "2 h 10 min". */
    focusTotal: (hours: number, minutes: number) => (hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`),
    tasksOf: (done: number, total: number) => `${done} of ${total} tasks done`,
    /** "Finish 1 more and it starts to blaze." — level is the gem level reached next (2–5). */
    nextHint: (n: number, level: number, name: string) => `Finish ${n} more and it ${["", "", "starts to flicker", "holds steady", "starts to glow", "starts to blaze"][level] ?? `turns ${name}`}.`,
    allDone: "Everything done today. It’s blazing.",
    nothingDue: "Nothing due today.",
    daysSoFar: "Your days so far",
    focusedLower: "focused",
    doneLower: "done",
    streakLower: "streak",
    bestStreak: "best streak",
    bestDay: "Best day",
    bestWeek: "Best week",
    thisWeekLower: "this week",
    since: (date: string) => `since ${date}`,
    thisWeek: "This week",
    sessionsTitle: "Sessions",
    sessionsSoFar: "focus sessions so far",
    sessionsTotal: "focus sessions in total",
    paceProgress: (done: number, n: number) => `${done} of ${n}`,
    paceHint: (n: number) => `finish ${n} tasks in focus and Nexdo learns your pace.`,
    title: "Insights",
    subtitle: "Your focus and finished tasks",
    /** Settings' row, and what tapping Today's progress card does. */
    open: "See your Insights",
    openBody: "Focus time, tasks done, your streak and your pace",
    week: "Last 7 days",
    all: "All time",
    focused: "Focused",
    done: "Done",
    streak: "Streak",
    streakDays: (count: number) => `${count} ${plural(count, "day", "days")}`,
    focusChart: "Focus time",
    /** Over the chart, for the bar picked: "Tue, Nov 3 · 1h 20m focused · 3 done". */
    barSummary: (date: string, focus: string, done: number) => `${date} · ${focus} focused · ${done} done`,
    weekOf: (date: string) => `Week of ${date}`,
    today: "Today",
    bestTime: {
      morning: "You focus most in the morning.",
      afternoon: "You focus most in the afternoon.",
      evening: "You focus most in the evening.",
      night: "You focus most at night.",
    },
    sessions: (count: number) => `${count} focus ${plural(count, "session", "sessions")} so far.`,
    empty: "Start a focus session from Today, and your time shows up here.",
    pace: {
      title: "Your pace",
      lockedBody:
        "Nexdo compares how long your tasks really take with the time you give them, and sets new guesses to your pace.",
      learning: (done: number, needed: number) =>
        `Finish ${needed} tasks in a focus session and Nexdo learns your pace — ${done} of ${needed} so far.`,
      /** "1.4×". */
      factor: (value: string) => `${value}×`,
      slower: (value: string) => `Your tasks take about ${value}× the time you give them.`,
      faster: (value: string) => `You finish in about ${value}× the time you give your tasks.`,
      onPace: "You finish tasks in about the time you give them.",
      short: "Tasks of 30 min or less",
      long: "Longer tasks",
      bucketOnPace: "On time",
      adjusting: "Quick add now sets guessed lengths to your pace.",
    },
  },

  breakdown: {
    button: "Break it down",
    contextTitle: "BREAK IT DOWN",
    contextHeadline: "Show Nexdo the task",
    contextBody: "Nexdo reads it and splits the task into real steps. A photo of the instructions works best.",
    photoHint: "The sheet, the instructions, the whiteboard",
    fileHint: "A PDF or a text file",
    sayIt: "Say it",
    sayItHint: "Describe the task in a sentence or two",
    listening: "Listening… tap to stop",
    stopListening: "Stop and use what I said",
    writingItDown: "Writing it down…",
    couldntHear: "Nexdo couldn't catch that. Try again somewhere quieter, or skip.",
    skipContext: "Just break it down",
    eyebrow: "AI BREAKDOWN",
    close: "Close AI breakdown",
    steps: (count: number) => `${count} ${plural(count, "step", "steps")}`,
    generating: "Generating…",
    regenerate: "Regenerate",
    breakingDown: "Breaking this task down…",
    stepPlaceholder: "Describe the step…",
    addStep: "Add step",
    confirm: "Confirm these steps",
    contextPlaceholder: "Anything Nexdo should know? Paste the instructions, or add a photo.",
    send: "Send and break it down",
    skipAndBreak: "Skip and break it down",
    planEyebrow: "Your plan",
    smallSteps: (count: number) => (count === 1 ? "1 small step" : `${count} small steps`),
    startStep: (index: number) => `Start step ${index}`,
    editStep: (label: string) => `Edit "${label}"`,
    saveStep: "Save step",
    addAStep: "Add a step",
  },

  tasks: {
    title: "Tasks",
    addTask: "Add Task",
    searchPlaceholder: "Search tasks...",
    /** The 2026-11 redesign's Tasks page: its title, and the pill above it that opens the sort menu. */
    yourTasks: "Your tasks",
    sortedBy: (sort: string) => `Sorted by ${sort}`,
    pendingSuffix: " pending",
    completedSuffix: " completed",
    overdueCount: (count: number) => `${count} overdue`,
    showingPrefix: "Showing ",
    showingSuffix: (shown: number, total: number) => ` of ${total} tasks`,
    emptyTitle: "No tasks found",
    emptyBody: "Try a different filter or search term.",
    status: { all: "All", pending: "To do", completed: "Done", overdue: "Overdue", noDeadline: "No deadline", archived: "Archived" },
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
    /** The same card on Free, which has no AI. */
    contextLocked: "Tell Nexdo more — a note, a photo, a document — and its AI updates this task's steps, deadline and advice for you. Part of Nexdo Pro.",
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
      /** The user said "Not now" to AI — Try again asks again. */
      consentNeeded: "Nexdo needs your OK to use AI for this. Nothing was changed.",
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
    /** The quick-add line at the top of Add Task (lib/quickAdd.ts). */
    quick: {
      label: "TYPE IT IN ONE LINE",
      placeholder: "e.g. Dentist Friday 3pm every month",
      help: "Write it the way you'd say it: the day, time, how long and any repeat are filled in for you.",
      readAs: "NEXDO READ IT AS",
      titleMissing: "Add what the task is, not just when.",
      moreDetails: "More details",
      aiLocked: "Nexdo AI can understand this — Pro",
      aiRead: "Let Nexdo AI read this",
      aiReading: "Reading…",
      aiNothing: "No new task found in that — try saying what needs doing.",
      changeHint: "Changing a task you already have? Use Magic mic in the tab bar.",
      changeHintLocked: "Changing a task you already have? Magic mic can do that — Pro",
      addTasks: (count: number) => (count === 1 ? "Add Task" : `Add ${count} Tasks`),
      /** Beside a guessed length set to the user's pace (Pro): "45 mins · your pace". */
      yourPace: "your pace",
    },
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

  /** Magic mic — live voice (components/MagicMicOverlay.tsx) — and the tab bar's mic button that opens it. */
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
    hintTitle: "Say what to add or change",
    hintBody: "“Call Mom tomorrow” · “Move the report to Friday”",
    marks: { added: "Just added", updated: "Updated", completed: "Done", removed: "Removed", shown: "On your list" },
    /** Puts back everything Magic mic changed since it opened. */
    discard: "Discard",
    discarded: "Magic mic changes discarded",
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
        body: "What's due today — and anything late — with the task most worth doing on top. Swipe for the others, or switch to All tasks to pick any of them. Tap + at the top to add a task by hand.",
      },
      tasks: {
        title: "All your tasks",
        body: "Everything on your plate, in one list. Tap a task to change it, and tick it off when it's done.",
      },
      calendar: {
        title: "Calendar",
        body: "Your week, day by day — or the whole year. Tap a day to see what's due.",
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
    kindTitle: "TYPE",
    kinds: { routine: "Routine", task: "Recurring task" },
    routineHint: "Listed under your cards on Today. If you miss one, it simply passes.",
    taskHint: "One of your cards on Today, like any task.",
    everyDays: (n: number) => (n === 1 ? "Every day" : `Every ${n} days`),
    everyWeeks: (n: number, days: string) => (n === 1 ? `Every week on ${days}` : `Every ${n} weeks on ${days}`),
    everyMonths: (n: number, day: number) => (n === 1 ? `Every month on day ${day}` : `Every ${n} months on day ${day}`),
    everyYears: (n: number, date: string) => (n === 1 ? `Every year on ${date}` : `Every ${n} years on ${date}`),
    until: (label: string, date: string) => `${label}, until ${date}`,
    /** "Every day at 8:00 AM" — the rule with its time of day. */
    atTime: (label: string, time: string) => `${label} at ${time}`,
    /** The picker's time-of-day row. */
    timeOfDay: "AT",
    anyTime: "Any time",
    setTime: "Set a time",
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
        hours: "h",
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
        hours: "h",
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
    manageError: "Couldn't open your subscription. You can manage it in your App Store or Google Play account.",
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
      minutes < 60 ? `${minutes} min` : minutes < 1440 ? `${minutes / 60} h` : plural(minutes / 1440, "1 day", `${minutes / 1440} days`),
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
      assist: "Break it down",
    },
    minutes: (count: number) => `${count} min`,
    used: {
      chat: "You've used this month's context notes for AI.",
      media: "You've used this month's photos and documents.",
      voice: "You've used this month's voice note minutes.",
      live: "You've used this month's Magic mic minutes.",
      assist: "You've used this month's AI breakdowns.",
    },
    /** Free has no AI at all (since 2026-10-26): the paywall's headline when opened from one of these. */
    proFeature: {
      chat: "Notes for Nexdo's AI come with Nexdo Pro.",
      media: "Photos and documents for Nexdo's AI come with Nexdo Pro.",
      voice: "Voice notes come with Nexdo Pro.",
      live: "Magic mic comes with Nexdo Pro.",
      assist: "AI breakdowns come with Nexdo Pro.",
    },
    /** Settings → Your plan on Free, in place of when the allowance starts again. */
    freeNoAi: "Free is Nexdo by hand: tasks, Today, the Schedule, sessions and reminders. Every AI feature comes with Pro.",
    /** Under a focus session's AI buttons on Free. */
    aiIsPro: "AI help comes with Nexdo Pro.",
    /** Opens the plans from a locked AI feature. */
    seePro: "See Nexdo Pro",
    resets: "Your allowance starts again on the 1st.",
    /** Under an AI feature once few are left (components/AllowanceNote.tsx). */
    left: {
      chat: (count: number) => `${count} context ${plural(count, "note", "notes")} for AI left this month`,
      media: (count: number) => `${count} ${plural(count, "photo or document", "photos and documents")} left this month`,
      voice: (minutes: number) => `${minutes} min of voice notes left this month`,
      live: (minutes: number) => `${minutes} min of Magic mic left this month`,
      assist: (count: number) => `${count} ${plural(count, "breakdown", "breakdowns")} left this month`,
    },
    upgradeHint: "Nexdo's AI is part of Pro. Adding, planning and focusing on tasks by hand stays free.",
    limitTitle: "Monthly limit reached",
    /** Settings → Your plan: what the month has used so far. */
    thisMonth: "This month",
    names: { free: "Free plan", pro: "Nexdo Pro" },
    usedOf: (used: number, limit: string) => `${used} of ${limit}`,
    proOnly: "Pro only",
  },

  /** The Nexdo Pro paywall (app/paywall.tsx). Prices come from the store, never from here. */
  paywall: {
    startTrial: (count: number, unit: TrialUnit) => `Start ${count} ${plural(count, unit, `${unit}s`)} free`,
    working: "One moment…",
    trialTerms: (count: number, unit: TrialUnit, price: string, yearly: boolean) =>
      `${count} ${plural(count, unit, `${unit}s`)} free, then ${price} ${yearly ? "once a year" : "a month"}. Cancel anytime.`,
    terms: (price: string, yearly: boolean) => `${price} a ${yearly ? "year" : "month"}, renewed until you cancel.`,
    seconds: (amount: string) => `${amount} sec`,
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
    /** "Report" under something the AI wrote (components/ReportAiButton.tsx). */
    reportLabel: "Report",
    reportA11y: "Report this AI content",
    reportTitle: "Report AI content",
    reportSubtitle: "Tell us what's wrong with what Nexdo's AI wrote.",
    reportPrefill: (text: string) => `What Nexdo's AI wrote:\n"${text}"\n\nWhat's wrong with it: `,
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
    planningChannel: "Morning nudge",
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
          ? `${Math.round(minutes / 60)} h`
          : `${Math.round(minutes / 1440)} ${plural(Math.round(minutes / 1440), "day", "days")}`,
    dueTomorrowTitle: (title: string) => `Due tomorrow: ${title}`,
    dueTomorrowBody: "Tomorrow, no set time.",
    dueTomorrowAtBody: (time: string) => `Due tomorrow at ${time}.`,
    /** The morning nudge (lib/reminders.ts): the task to start with, and how many more are due that day. */
    dailyTitle: (top: string) => `Start with: ${top}`,
    dailyDueBody: (count: number) => `+ ${count} more due today`,
    dailyOpenBody: "One thing at a time. Tap to begin.",
    /** Two days before a free trial turns into a paid plan (lib/trialReminder.ts). */
    trialEndingTitle: "Your free trial ends in 2 days",
    trialEndingBody: (date: string) =>
      `Nexdo Pro starts on ${date}. Don't want it? Tap here, then Manage subscription, to cancel before then.`,
    /** A focus session's time is up while Nexdo isn't on screen (hooks/useSessionAlarm.ts). */
    sessionEndTitle: "Time's up",
    sessionEndBody: (title: string) =>
      title ? `Your session on "${title}" is done. Finish it or keep going.` : "Your focus session is done.",
  },

  profile: {
    addName: "Add your name",
    editAccount: "Edit your account",
  },

  /** The Account sheet — the one place profile details are edited. */
  /** The 2026-11 redesign: Settings, Account, Feedback, the task edit card and Postpone. */
  redesign: {
    accountButton: "Account",
    manage: "Manage",
    upgrade: "Upgrade",
    freePlan: "Nexdo Free",
    freeBody: "Every AI feature comes with Pro.",
    renews: (date: string) => `Renews ${date}`,
    ends: (date: string) => `Ends ${date}`,
    resetsIn: (days: number) => `resets in ${days} ${days === 1 ? "day" : "days"}`,
    ofMinutes: (count: number) => `/ ${count} min`,
    thisWeek: "THIS WEEK",
    tasksDone: (count: number) => `${count} ${count === 1 ? "task" : "tasks"} done`,
    focused: (time: string) => `${time} focused · see your insights`,
    notifications: "NOTIFICATIONS",
    at: "at",
    reminders: "Reminders",
    remindersBody: "On the due day",
    dailyPlan: "Daily plan",
    dailyPlanBody: "Every morning",
    overdue: "Overdue",
    alertsOn: "Alerts on",
    alertsOff: "Alerts off",
    off: "Off",
    preferences: "PREFERENCES",
    language: "Language",
    appTour: "App tour",
    support: "SUPPORT",
    help: "Help & FAQ",
    changePhoto: "Change photo",
    photoHint: "JPG or PNG, under 5 MB",
    name: "NAME",
    email: "EMAIL",
    save: "Save",
    feedbackSubtitle: "We read every message.",
    feedbackPlaceholder: "What would make Nexdo better for you?",
    addScreenshot: "Add a screenshot",
    feedbackNote: "Your account, app version and phone model are sent with it, so we can reply and fix things faster.",
    send: "Send",
    remindersLabel: "REMINDERS",
    noDateNoReminder: "No date, no reminder",
    postpone: "Postpone",
    pickDay: "Pick a day",
    restore: "Restore purchases",
    remindersHint: "A ping on the day a task is due",
    dailyPlanHint: "The one task to start with, every morning",
    overdueHint: "A heads-up when a task runs late",
    leadTitle: "Tasks with a time — remind me",
    leadAtStart: "At the start",
    leadBefore: (offset: string) => `${offset} before`,
    dateOnlyTitle: "Tasks with only a date — remind me at",
    dailyTimeTitle: "Arrives every day at",
    /** Settings → Reminders, 2026-11 screenshot: the row's line, the preview card, the lead slider. */
    remindersPinged: "Choose when you get pinged",
    previewLabel: "Preview",
    previewTask: "Dentist",
    previewIn: (task: string, offset: string) => `${task} in ${offset}`,
    previewNow: (task: string) => `${task} starts now`,
    previewTomorrow: (task: string) => `${task} tomorrow`,
    previewStarts: (time: string) => `Starts at ${time}`,
    /** The slider's stops: Start, 5 m, 15 m, 30 m, 1 h, 1 day. */
    leadStop: (minutes: number) => {
      if (minutes === 0) return "Start";
      if (minutes < 60) return `${minutes} m`;
      const hours = Math.round(minutes / 60);
      return minutes < 1440 ? `${hours} h` : "1 day";
    },
    /** "15 min", "1 h", "1 day" — in "15 min before" and the preview. */
    leadShort: (minutes: number) => {
      if (minutes < 60) return `${minutes} min`;
      const hours = Math.round(minutes / 60);
      return minutes < 1440 ? `${hours} h` : "1 day";
    },
    timedTitle: "Tasks with a time",
    dateOnlyLabel: "Tasks with only a date",
    dateOnlyHint: "Pinged that morning",
    /** Settings → Notifications: the morning nudge row (2026-11-12). */
    morningNudge: "Morning nudge",
    morningAt: (time: string) => `Every day at ${time}`,
    inMorningNudge: "Listed in your morning nudge",
    previewMorningTask: "Finish the report",
    taskNeedsDate: "Add a date to get reminders",
    remindThisTask: "Remind me about this task",
    remindersWhen: "On its due day, at the time set in Settings, plus before a set time.",
    remindersOffEverywhere: "Reminders are off for every task in Settings.",
    turnOnInSettings: "Turn on in Settings",
    meterLabels: { live: "Magic mic", assist: "Breakdowns", media: "Photos" },
    feedbackTypes: { suggestion: "Idea", bug: "Bug", other: "Other" },
  },

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




  auth: {
    email: "EMAIL",
    password: "PASSWORD",
    logIn: "Log in",
    continue: "Continue",
    useCode: "Use email code instead",
    invalidCode: "Invalid code. Try again.",
    sendCodeError: "Couldn't send the verification code. Try again.",
    checkEmail: "Check your email",
    codeSentTo: "We sent a 6-digit code to",
    somethingWrong: "Something went wrong. Try again.",
    showPassword: "Show password",
    hidePassword: "Hide password",
  },

  /** The focus session page (components/NextTaskCard.tsx, Final-Focus.html). */
  focusPage: {
    eyebrow: "Focus session",
    back: "Back",
    /** Under the clock: "of 30 min". */
    ofLength: (length: string) => `of ${length}`,
    /** Under the ring once the task is done in a session: "18 min of focus · 12 min early" (FocusClockFace). */
    doneMinutes: (minutes: number) => `${minutes} min`,
    doneOfFocus: "of focus",
    doneEarly: (minutes: number) => `${minutes} min early`,
    doneOver: (minutes: number) => `${minutes} min over`,
    doneOnTime: "right on time",
    /** "Step 2: write the introduction". */
    step: (index: number, label: string) => `Step ${index}: ${label}`,
    breakIntoSteps: "Break it into steps",
    sound: "Focus sound",
    stepDone: "Step done",
    stepOf: (index: number, total: number, label: string) => `Step ${index} of ${total}: ${label}`,
  },

  /** The Add task sheet (components/addSheet/, addtask-design/ 2026-11-08). */
  addSheet: {
    placeholder: "Type a task…",
    details: "Details",
    hideDetails: "Hide details",
    date: "Date",
    duration: "Duration",
    repeat: "Repeat",
    priority: "Priority",
    today: "Today",
    anotherDay: "Another day",
    noDate: "No date",
    atSetTime: "At a set time",
    hoursShort: "h",
    minutesShort: "min",
    ends: "Ends",
    ifMissed: "If I miss one",
    keepOpen: "Keep open",
    skip: "Skip",
    showAs: "Show it as",
    taskKind: "Task",
    taskKindHint: "A card on Today with a deadline. Missed ones can stay open.",
    routineKind: "Routine",
    routineKindHint: "A habit on your Routines timeline. No deadline, resets each time.",
    noRepeat: "Don't repeat",
    high: "High",
    medium: "Medium",
    low: "Low",
    highHint: "Needs to happen soon",
    mediumHint: "Important, not urgent",
    lowHint: "Whenever you have time",
    priorityNote: "Priority is one of the things Nexdo uses to sort your list.",
    fromPhoto: "Add from a photo or file",
    takePhoto: "Take a photo",
    takePhotoHint: "A whiteboard, a syllabus, a note",
    choosePhoto: "Choose a photo",
    choosePhotoHint: "From your gallery",
    uploadFile: "Upload a file",
    uploadFileHint: "PDF or document",
    readBy: "Read by Nexdo",
    reading: "Reading…",
    removeFile: "Remove the file",
    addTask: "Add task",
    preview: "Preview of the new task",
    repeats: "Repeats",
    found: (n: number) => (n === 1 ? `Nexdo found 1 task · tap to keep` : `Nexdo found ${n} tasks · tap to keep`),
    addTasks: (n: number) => (n === 1 ? `Add 1 task` : `Add ${n} tasks`),
    busy: (n: number) => (n === 1 ? `1 task due` : `${n} tasks due`),
  },

  /** The onboarding (nexdo-onboarding-final, 2026-11-12): 14 screens, app/onboarding/. */
  onboardingFlow: {
    back: "Back",
    progress: "Onboarding progress",
    continue: "Continue",
    /** A found task's day, in its line ("Tomorrow · 1 h"). */
    today: "Today",
    tomorrow: "Tomorrow",
    noDate: "No date",
    hook: {
      eyebrow: "YOUR HEAD, RIGHT NOW",
      /** The tangled thoughts, as typed in a hurry. */
      thoughts: ["mom bday gift", "lab report!!", "reply to sam", "email the prof…", "dentist???", "gym?", "phone bill"],
      /** The same thoughts once sorted, top task first. */
      tasks: ["Finish the lab report", "Reply to Sam", "Book the dentist", "Gym at 6", "Pay the phone bill"],
      doThisFirst: "Do this first",
      headlineTop: "Stop managing tasks.",
      headlineBottom: "Just do the next one.",
      getStarted: "Get started",
      haveAccount: "I already have an account",
    },
    problem: {
      headline: "Your list isn’t the problem. ",
      highlight: "Picking what’s first is.",
      tasks: [
        ["Finish lab report", "Tomorrow"],
        ["Reply to Sam", "Today"],
        ["Book the dentist", "This week"],
        ["Study for exam", "Friday"],
        ["Buy groceries", "Tonight"],
        ["Call mom", "Sunday"],
        ["Gym", "6 PM"],
        ["Pay phone bill", "The 15th"],
        ["Read chapter 4", "Thursday"],
        ["Clean room", "Weekend"],
        ["Email the prof", "Today"],
        ["Fix bike", "No date"],
      ] as [string, string][],
    },
    picks: {
      headline: "Nexdo picks ",
      highlight: "what comes first.",
      body: "It weighs every task: when it’s due, how long it takes, how much it matters.",
      gym: ["Gym", "Today, 6 PM"] as [string, string],
      reply: ["Reply to Sam", "Today"] as [string, string],
      lab: ["Finish the lab report", "Tomorrow"] as [string, string],
      dentist: ["Book the dentist", "This week"] as [string, string],
      minutes: (count: number) => `${count} min`,
    },
    pains: {
      headline: "What brings you here?",
      options: {
        overwhelmed: "I feel overwhelmed by my list",
        procrastinate: "I procrastinate",
        forget: "I forget things",
        juggling: "I juggle school, work and life",
        focus: "I want to focus better",
        finish: "I start lots, finish little",
      },
    },
    load: {
      headline: "How much is on your mind right now?",
      body: "Slide to a rough guess.",
      stops: { few: "1–5", some: "5–10", many: "10–20", lots: "20+" },
      slider: "How much is on your mind",
    },
    mic: {
      headline: "Tell Nexdo everything on your mind.",
      title: "Let Nexdo hear you",
      body: "So you can talk your tasks out instead of typing. Audio is only used to create your tasks. We never keep the recording.",
      allow: "Allow microphone",
      type: "I’d rather type",
      deniedTitle: "Microphone is off",
      deniedBody: "You can turn it on in your phone’s settings, or type your tasks instead.",
    },
    dump: {
      headline: "Say everything on your mind.",
      body: "Nexdo turns it into tasks while you talk.",
      heard: "FROM WHAT YOU SAID",
      count: (count: number) => (count === 1 ? "1 task" : `${count} tasks`),
      listening: (time: string) => `Listening · ${time}`,
      connecting: "Connecting…",
      done: "I’m done",
      typeInstead: "Type instead",
      talkInstead: "Talk instead",
      typeHeadline: "Type everything on your mind.",
      typeBody: "All in one go is fine. Nexdo turns it into tasks.",
      placeholder: "Finish the lab report tomorrow, reply to Sam, book the dentist…",
      organize: "Turn into tasks",
      organizing: "Sorting it out…",
      timeUp: "That’s the minute. Here’s what Nexdo heard.",
      nothingYet: "Nothing came through yet. Try again, or type instead.",
      couldntStart: "Couldn’t start listening. Try again, or type instead.",
      trialUsed: "The free try was already used on this phone. Type your tasks instead.",
      skip: "Skip for now",
    },
    founder: {
      title: "A note from the founder",
      place: "Montréal",
      initials: "MB",
      quote:
        "I built Nexdo because my mind never felt clear. I knew I had a lot to do, but it was all tangled up in my head. I wanted one really easy place to dump everything into, and then just see what I’ve got to do. I hope it gives you that clarity too.",
      signature: "— Benmouna Mohammed",
    },
    expect: {
      headline: "What to expect.",
      body: "Nexdo lights up the mess and puts it in order.",
      tasks: ["Lab report", "Reply to Sam", "Dentist", "Gym"],
      outcomes: ["Clear head", "Organized", "More done"],
    },
    nudge: {
      before: "A nudge at ",
      after: ", every day.",
      body: "Pick a time. Each morning, Nexdo tells you the one task to start with.",
      changeTime: (time: string) => `Change time, ${time}`,
      app: "Nexdo",
      now: "now",
      sampleTask: "Finish the lab report",
      turnOn: "Turn on reminders",
      notNow: "Not now",
    },
    promise: {
      headline: "Make it a promise.",
      /** "This week, I’ll <first> and <second>." — `second` is moreDone when only one answer was picked. */
      sentence: (first: string, second: string) => `This week, I’ll ${first} and ${second}.`,
      phrases: {
        overwhelmed: "clear my head",
        procrastinate: "stop putting things off",
        forget: "stop letting things slip",
        juggling: "keep school, work and life in order",
        focus: "focus on one thing at a time",
        finish: "finish what I start",
      },
      moreDone: "get more done",
      hold: "Hold to commit",
      committed: "Committed",
      holdLabel: "Press and hold to commit",
    },
    paywall: {
      close: "Close",
      restore: "Restore",
      free: "Free",
      pro: "Pro",
      freeTitle: "Nexdo Free",
      freeBody: "Organize your tasks and days yourself.",
      proTitle: "Nexdo Pro",
      proBody: "All of Free, and Nexdo does the hard work.",
      rows: {
        live: "Magic mic",
        assist: "Break it down",
        media: "Photos & files",
        voice: "Voice notes",
        chat: "Context notes",
        sounds: "Focus sounds",
        insights: "Insights",
      },
      allSounds: (count: number) => `All ${count}`,
      insightsFree: "7 days",
      insightsPro: "All time",
      locked: "Pro",
      yearly: "Yearly",
      monthly: "Monthly",
      perMonth: "/ mo",
      aYear: (price: string) => `${price} a year`,
      billedMonthly: "billed monthly",
      discount: (percent: number) => `−${percent}%`,
      cancelAnytime: "Cancel anytime",
      continueFree: "Continue with Free",
      /** Inside the app, in place of continueFree (the user is already on Free). */
      notNow: "Not now",
      /** The button with Monthly picked (no trial there). */
      subscribe: "Subscribe",
    },
    save: {
      headline: "Save your tasks.",
      body: "Make a free account so they’re safe and on all your devices.",
      notSaved: "Not saved yet",
      google: "Continue with Google",
      apple: "Continue with Apple",
      email: "Continue with email",
      haveAccount: "Already have an account?",
      logIn: "Log in",
      createAccount: "Create account",
    },
    logIn: {
      headline: "Welcome back.",
      body: "Log in to pick up right where you left off.",
      google: "Log in with Google",
      apple: "Log in with Apple",
      email: "Log in with email",
      newHere: "New to Nexdo?",
      createAccount: "Create an account",
    },
  },
};
