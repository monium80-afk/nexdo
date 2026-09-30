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
    next: "Next",
    tasks: "Tasks",
    inbox: "Assistant",
    settings: "Settings",
    addTask: "Add task",
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
    eyebrow: "NEXDO NOW",
    heading: "What can you do right now?",
    /** Before the score number on the Next card, which is set in its own colour. */
    scoreLabel: "Score: ",
    timeFilter: (duration: string) => `Fits in ${duration}`,
    timeFilterEmpty: (duration: string) => `Nothing fits in ${duration}`,
    timeFilterClear: "Show all",
    timeQuestion: "HOW MUCH TIME HAVE YOU GOT?",
    minutesOption: (minutes: number) => `${minutes} min`,
    custom: "Custom...",
    minutesPlaceholder: "Minutes, e.g. 50",
    minutesUnit: "min",
    energyLabel: "Energy & focus level:",
    energy: { ready: "Ready", low: "Low energy", procrastinating: "Stuck" },
    sessionPlan: "SESSION PLAN",
    total: (duration: string) => `${duration} total`,
    startSession: (duration: string) => `Start session (${duration})`,
    swapTasks: "Swap or pick different tasks",
    stepsCompleted: (done: number, total: number) => `${done}/${total} steps completed`,
    details: "Details",
    rankOf: (rank: number, total: number) => `#${rank} of ${total} in priority`,
    priorityRank: (rank: number) => `#${rank} Priority`,
    startSessionFor: (duration: string) => `Start Session (${duration})`,
    previous: "Previous",
    nextCard: "Next",
    /** Beside the "1 / 12" counter above the card stack. */
    tasksPrioritized: "Tasks prioritized",
    /** The card's Start button — its length sits beside it, not inside the label. */
    startSessionLabel: "Start session",
    breakDown: "Break down",
    getAdvice: "Get advice",
    /** Under Start session on the Next card: finishes the task without a session. */
    markComplete: "Mark complete",
    taskComplete: "Task complete",
    pickTasks: "PICK YOUR TASKS",
    useRecommended: "Use recommended",
    /** Under a task's title when it has a plan: the step to do next. */
    nextStep: (label: string) => `Next step: ${label}`,
    /** In place of the rank when the user put this task first. */
    pinned: "Pinned first",
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

  stuck: {
    title: "WHAT'S IN THE WAY?",
    reasons: {
      tooBig: "It's too big to start",
      missing: "I'm missing something I need",
      noFocus: "I can't focus on it right now",
    },
    parkNote: "We'll park it for a few hours and move you to the next task.",
    talkToAi: "Talk it through with AI",
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
    statusTitle: "STATUS",
    sortTitle: "SORT BY",
    status: { all: "All", pending: "Pending", completed: "Completed", overdue: "Overdue", archived: "Archived" },
    sort: { recent: "Recently added", dueDate: "Due date", priority: "Priority score" },
    score: (score: number) => `Score: ${score}`,
    overdueBadge: "OVERDUE",
  },

  taskDetail: {
    notFound: "Task not found",
    goBack: "Go back",
    postponeTitle: "POSTPONE TASK",
    currentDeadline: (label: string) => `Current deadline: "${label}". Push to a later date:`,
    postpone: { oneDay: "+1 Day (Tomorrow)", threeDays: "+3 Days", oneWeek: "+1 Week" },
    customDate: "Custom Date...",
    setDate: "Set date",
    editTask: "Edit task",
    rationaleTitle: "AI priority rationale",
    generatingAdvice: "Generating advice...",
    subtasks: (done: number, total: number) => `Subtasks (${done}/${total})`,
    aiPlan: "AI plan",
    addSubtask: "Add subtask...",
    editSubtask: (label: string) => `Edit ${label}`,
    deleteSubtask: (label: string) => `Delete ${label}`,
    notes: "NOTES",
    contextTitle: "ADD CONTEXT FOR AI",
    contextBody: "Tell Nexdo more about this task. It reassesses the time, steps, deadline and advice, and shows you what it changed.",
    contextPlaceholder: "e.g. I already finished the research.",
    deleteTask: "Delete Task",
    saveChanges: "Save Changes",
    deleteConfirmTitle: "Delete this task?",
    deleteConfirmBody: "This can't be undone.",
    notePlaceholder: "What should the AI know about this task?",
    editNote: "Edit note",
    deleteNote: "Delete note",
    repeatEyebrow: "REPEATS",
    notRepeating: "This task doesn't repeat.",
    setRepeat: "Make it repeat",
    editRepeat: "Change",
    saveRepeat: "Save repeat",
    stopRepeating: "Stop repeating",
    stopRepeatingTitle: "Stop repeating?",
    stopRepeatingBody: "This task stays on your list as a one-off. No new occurrences will be created; past ones are kept.",
    occurrenceNote: "Completing this occurrence schedules the next one.",
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
    organizeTitle: "ORGANIZE",
    pin: "Put first on Next",
    unpin: "Unpin from Next",
    archive: "Archive",
    restore: "Restore",
    archivedNote: "Archived — hidden from your list, reminders and Next until you restore it.",
    /** The plan summary above the subtasks. */
    planLeft: (steps: number, duration: string) => `${steps} ${plural(steps, "step", "steps")} left · ${duration}`,
    planPerDay: (duration: string, day: string) => `About ${duration} a day to finish by ${day}.`,
    planOverdue: "Past its deadline — the steps left are all due now.",
    /** A suggested day for a step — a suggestion, not a booking in a calendar. */
    suggestedDay: (day: string) => `Suggested: ${day}`,
    today: "Today",
    tomorrow: "Tomorrow",
  },

  form: {
    title: "Add New Task",
    subtitle: "Turn your thoughts into progress",
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
    planSteps: (count: number) => `Plan Steps (${count})`,
    optionalPlan: "Optional step plan",
    stepPlaceholder: "e.g. Step 1: Draft the introduction",
    stepMinutes: (minutes: number) => `${minutes}m`,
    notesTitle: "NOTES & CONTEXT (OPTIONAL)",
    notesPlaceholder: "Add key requirements, instructions, or links...",
    openAiChat: "Open AI Chat instead",
    addTask: "Add Task",
    deadlines: {
      today: "Today",
      tomorrow: "Tomorrow",
      friday: "This Friday",
      weekend: "This Weekend",
      nextWeek: "Next Week",
      none: "No deadline",
    },
    durationOptions: { 15: "15m", 30: "30m", 45: "45m", 60: "1h", 90: "1.5h", 120: "2h", 180: "3h+" } as Record<
      number,
      string
    >,
    editEyebrow: "EDIT TASK",
    editTitlePlaceholder: "Task title",
    editCurrentDeadline: (label: string) => `Current deadline: ${label}`,
    deadlineRemoved: "The deadline will be removed.",
    newDeadline: (label: string) => `New deadline: ${label}`,
    saveChanges: "Save changes",
    /** A deadline is a day; a time is only added when the user wants one. */
    addTime: "Add a time",
    removeTime: "No set time",
  },

  chat: {
    welcome:
      "Welcome to your Nexdo Assistant. Dump your thoughts, tasks, voice notes, or photos. You can also command your entire system here — tell me your situation ('I only have 30 minutes', 'I can't finish the project this weekend', or 'The dentist appointment is more important') and I will adapt your plan.",
    inboxTitle: "Nexdo Assistant",
    contextSubtitle: "Ask me to analyze, adjust, or update this task.",
    activeTasksSuffix: " active tasks in queue",
    typing: "Typing…",
    addAll: (count: number) => `Add all ${count} tasks`,
    /** Above the cards for tasks the AI pulled out of a message — they aren't added yet. */
    foundTasks: (count: number) => `Found ${count} ${plural(count, "task", "tasks")}`,
    yesDoIt: "Yes, do it",
    openNext: (minutes: number) => `Open Next (${minutes} min)`,
    starterSuggestions: {
      "capacity-20": "I only have 20 minutes right now",
      "whats-next": "What should I do next?",
      "reschedule-overdue": "Reschedule everything overdue",
      "brain-dump": "I need to finish my history essay by Friday and call the dentist tomorrow",
    } as Record<string, string>,
    quickActions: {
      "whats-next": "Add",
      "breakdown-top": "Mark complete",
      "quick-win": "Remove",
      "overdue-catchup": "Change",
      "break-down": "Break down",
      prioritize: "Prioritize",
    } as Record<string, string>,
    attachmentReplies: {
      photo: "I couldn't find anything readable in that photo — try a clearer shot, or type it instead.",
      voice: "I couldn't quite catch that recording — try again somewhere quieter, or type it instead.",
      document: "I couldn't pull any text out of that file — try a different one, or type it instead.",
    },
    attachmentReadFailed: "Something went wrong while reading that file — please try sending it again in a moment.",
    couldntCatch: "Couldn't catch that",
    couldntTranscribe: "Couldn't transcribe",
    uploadFailedTitle: "Couldn't attach that",
    uploadFailedBody:
      "Your files couldn't be uploaded, so nothing was sent. They're still in the box — check your connection and try again.",
    uploadPartialBody: (failed: number) =>
      failed === 1
        ? "One file couldn't be uploaded, so it was left out of this message."
        : `${failed} files couldn't be uploaded, so they were left out of this message.`,
    complexity: { simple: "simple", medium: "medium", complex: "complex" },
    taskRead: (title: string, complexity: string, advice: string) =>
      `Here's my read on "${title}" — it's a ${complexity} task. ${advice}`,
    // Draft preview card
    titlePlaceholder: "Task title",
    minutesPlaceholder: "Minutes",
    doneEditing: "Done editing",
    editDetails: "Edit task details",
    dismiss: "Dismiss",
    addTask: "Add Task",
    // Input bar
    recordVoice: "Record voice note",
    stopRecording: "Stop recording",
    takePhoto: "Take a photo",
    attachDocument: "Attach a document",
    recording: (duration: string) => `Recording… ${duration}`,
    transcribing: "Transcribing…",
    inputPlaceholder: "Type, speak, or take a picture of tasks...",
    attachmentPlaceholder: "Add instructions (optional)...",
    removeAttachment: "Remove attachment",
    documentLabel: "Document",
    send: "Send message",
    micPermissionTitle: "Microphone access needed",
    micPermissionBody: "Nexdo needs microphone access to record voice notes. You can enable it in Settings.",
    cameraPermissionTitle: "Camera access needed",
    cameraPermissionBody: "Nexdo needs camera access to capture photos. You can enable it in Settings.",
    voiceNoteLabel: (duration: string) => `Voice note (${duration})`,
    photoLabel: "Photo attached",
    viewPhoto: "View photo full screen",
    videoNotSupportedTitle: "Videos aren't supported",
    videoNotSupportedBody: "Nexdo reads photos, voice notes and documents. Send a photo or a file instead.",
  },

  /** Live voice (app/live-voice.tsx) and the tab bar's mic button that opens it. */
  live: {
    open: "Talk to add or change tasks",
    title: "Live voice",
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
      unavailable: "Couldn't start live voice. Check your connection and try again.",
      connection: "The connection dropped. What you'd already said still counts.",
      timeLimit: "Live voice stops after 5 minutes — tap Talk again to keep going.",
      silence: "Stopped listening after a quiet moment — tap Talk again to keep going.",
    },
  },

  /** What the assistant says when the app itself (not the AI model) writes the reply. */
  assistant: {
    foundOne: (title: string) => `I found 1 task: "${title}". Want me to add it?`,
    foundMany: (count: number, titles: string) => `I found ${count} tasks: ${titles}. Want me to add them?`,
    confirmBulkDelete: (countLabel: string, includesCompleted: boolean) =>
      `This will delete ${countLabel}${includesCompleted ? " (pending and completed)" : ""}. Go ahead?`,
    goAhead: "Want me to go ahead with that?",
    noPendingToComplete: "You don't have any pending tasks to mark as done.",
    noScopedToDelete: (scope: "completed" | "pending") => `You don't have any ${scope} tasks to delete.`,
    noTasksToDelete: "You don't have any tasks to delete.",
    done: "Done.",
    wontChange: "No worries — I won't make that change.",
    nothingToUndo: "There's nothing to undo.",
    undone: "Undone.",
    added: (title: string) => `Added "${title}" to your tasks.`,
    addedMany: (count: number, titles: string) => `Added ${count} tasks: ${titles}.`,
    updated: (title: string) => `Updated "${title}".`,
    markedDone: (title: string) => `Marked "${title}" as done.`,
    markedAllDone: (countLabel: string) => `Marked ${countLabel} as done.`,
    deleted: (title: string) => `Deleted "${title}".`,
    deletedMany: (countLabel: string) => `Deleted ${countLabel}.`,
    loggedContext: (title: string) => `Got it — logged that on "${title}".`,
    rescheduled: (title: string) => `Rescheduled "${title}".`,
    skipped: (title: string) => `Got it — I'll hold off suggesting "${title}" for a bit.`,
    brokeDown: (title: string, count: number) => `Broke "${title}" into ${count} steps.`,
    redirectNext: (minutes: number) => `Set up the Next page for ${minutes} minutes.`,
    fallbackTask: "task",
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
    preferences: "NEXDO PREFERENCES",

    account: "ACCOUNT",
    signOut: "Sign out",
    signingOut: "Signing out…",
    signOutCleanupError: "Signed out, but local data cleanup needs attention.",
    signOutError: "Couldn't sign out. Try again.",
    unsavedTasksTitle: "Some tasks aren't saved yet",
    unsavedTasksBody: (count: number) =>
      `${count === 1 ? "1 task hasn't" : `${count} tasks haven't`} reached your account yet — check your connection. If you sign out now, ${count === 1 ? "it stays" : "they stay"} safe on this phone and ${count === 1 ? "is" : "are"} saved the next time you sign in here, but won't show on other devices until then.`,
    signOutAnyway: "Sign out anyway",

    pro: "NEXDO PRO",
    upgrade: "Upgrade to Nexdo Pro",
    upgradeBody: "Monthly or yearly — cancel anytime.",
    upgradeError: "Couldn't open the upgrade screen. Check your connection and try again.",
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

    aiChat: "AI INBOX",
    autoMode: "Auto mode",
    autoModeBody: "Add and update tasks right away, without asking you to confirm first.",
    voiceButton: "Talk instead of type",
    voiceButtonBody: "The middle button of the tab bar becomes a microphone that opens Live voice, instead of the Add Task form.",
    clearHistory: "Clear chat history",
    clearConfirmTitle: "Clear chat history?",
    clearConfirmBody: "This removes every message in the AI chat. Your tasks won't be affected.",
    clear: "Clear",
    historyCleared: "Chat history cleared.",
    historyClearFailed: "Cleared on this device, but couldn't clear the synced copy. Try again.",

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

    appearance: "APPEARANCE",
    theme: "Theme",
    themes: { light: "Light", dark: "Dark", system: "System" },
    language: "Language",

    support: "SUPPORT",
    help: "Help & send feedback",
    helpBody: "Tell us what's broken or what you'd like next.",
    privacy: "Privacy policy",
    terms: "Terms of service",
    version: (version: string) => `Nexdo v${version}`,
    linkError: "Couldn't open that link. Try again.",
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
    dueAtBody: (time: string) => `Due today at ${time}.`,
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
      "This permanently deletes your Nexdo account and everything on it — every task, chat and setting, on every device. It can't be undone.",
    deleteProNote:
      "Deleting your account doesn't cancel Nexdo Pro. Cancel it in your App Store or Google Play subscriptions first, or it keeps renewing.",
    deleteConfirm: "Delete account",
    deleting: "Deleting…",
    deleteError: "Couldn't delete your account. Try again.",
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
    trialUsedCta: "Create my account",
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

  auth: {
    welcomeBack: "Welcome back.",
    signInSubtitle: "Log in to pick up right where you left off.",
    email: "EMAIL",
    password: "PASSWORD",
    logIn: "Log in",
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
