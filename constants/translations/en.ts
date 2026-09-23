import type { TaskScope } from "@/lib/taskMeta";

// Every piece of interface copy in the app, in English. fr.ts has to match
// this shape exactly — TypeScript flags any key that's missing there.
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
  },

  /** The generic 3-step plan a new medium/complex task starts with. */
  planTemplate: ["Gather what you need", "Do the core work", "Wrap up and review"],

  next: {
    allCaughtUp: "All caught up",
    allCaughtUpBody: "You've completed everything on your list. Add a new task to keep going.",
    addATask: "Add a task",
    eyebrow: "NEXDO NOW",
    heading: "What can you do right now?",
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
    taskComplete: "Task complete",
    pickTasks: "PICK YOUR TASKS",
    useRecommended: "Use recommended",
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
    pendingSuffix: " pending, ",
    completedSuffix: " completed",
    overdueCount: (count: number) => `• ${count} overdue`,
    showingPrefix: "Showing ",
    showingSuffix: (shown: number, total: number) => ` of ${total} tasks`,
    emptyTitle: "No tasks found",
    emptyBody: "Try a different filter or search term.",
    statusTitle: "STATUS",
    sortTitle: "SORT BY",
    status: { all: "All", pending: "Pending", completed: "Completed", overdue: "Overdue" },
    sort: { recent: "Recently added", dueDate: "Due date", priority: "Priority score" },
    score: (score: number) => `Score: ${score}`,
    overdueBadge: "OVERDUE",
  },

  taskDetail: {
    notFound: "Task not found",
    goBack: "Go back",
    eyebrow: "TASK DETAILS",
    scoreLabel: "Score: ",
    postponeTitle: "POSTPONE TASK",
    currentDeadline: (label: string) => `Current deadline: "${label}". Push to a later date:`,
    postpone: { oneDay: "+1 Day (Tomorrow)", threeDays: "+3 Days", oneWeek: "+1 Week" },
    customDate: "Custom Date...",
    setDate: "Set date",
    editTask: "Edit task",
    due: (label: string) => `Due: ${label}`,
    estimate: (duration: string) => `Est: ${duration}`,
    rationaleTitle: "AI priority rationale",
    generatingAdvice: "Generating advice...",
    subtasks: (done: number, total: number) => `Subtasks (${done}/${total})`,
    aiPlan: "AI plan",
    addSubtask: "Add subtask...",
    editSubtask: (label: string) => `Edit ${label}`,
    deleteSubtask: (label: string) => `Delete ${label}`,
    notes: "NOTES",
    contextTitle: "ADD CONTEXT FOR AI",
    contextBody: "The AI reads these notes when it gives advice on this task or breaks it down.",
    contextPlaceholder: "e.g. I already finished the research.",
    deleteTask: "Delete Task",
    saveChanges: "Save Changes",
    deleteConfirmTitle: "Delete this task?",
    deleteConfirmBody: "This can't be undone.",
    notePlaceholder: "What should the AI know about this task?",
    editNote: "Edit note",
    deleteNote: "Delete note",
  },

  form: {
    eyebrow: "MANUAL ENTRY",
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
  },

  chat: {
    welcome:
      "Welcome to your Nexdo Assistant. Dump your thoughts, tasks, voice notes, or photos. You can also command your entire system here — tell me your situation ('I only have 30 minutes', 'I can't finish the project this weekend', or 'The dentist appointment is more important') and I will adapt your plan.",
    inboxTitle: "Nexdo Assistant",
    contextSubtitle: "Ask me to analyze, adjust, or update this task.",
    activeTasksSuffix: " active tasks in queue",
    typing: "Typing…",
    addAll: (count: number) => `Add all ${count} tasks`,
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
  },

  settings: {
    title: "Settings",
    preferences: "NEXDO PREFERENCES",

    account: "ACCOUNT",
    signOut: "Sign out",
    signingOut: "Signing out…",
    signOutCleanupError: "Signed out, but local data cleanup needs attention.",
    signOutError: "Couldn't sign out. Try again.",

    aiChat: "AI INBOX",
    autoMode: "Auto mode",
    autoModeBody: "Add and update tasks right away, without asking you to confirm first.",
    clearHistory: "Clear chat history",
    clearConfirmTitle: "Clear chat history?",
    clearConfirmBody: "This removes every message in the AI chat. Your tasks won't be affected.",
    clear: "Clear",
    historyCleared: "Chat history cleared.",
    historyClearFailed: "Cleared on this device, but couldn't clear the synced copy. Try again.",

    notifications: "NOTIFICATIONS",
    dailyNudge: 'Daily "what\'s next" nudge',
    dailyNudgeBody: "One reminder a day with the task worth doing next.",
    nudgeTime: "Remind me at",
    overdueAlerts: "Overdue task alerts",
    overdueAlertsBody: "A heads-up when a task passes its deadline.",
    notificationsNote: "Saved on this device. Reminders start arriving in a later update.",

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
    deleteConfirm: "Delete account",
    deleting: "Deleting…",
    deleteError: "Couldn't delete your account. Try again.",
  },

  /** The chrome every onboarding step shares, then step 1's own copy. */
  onboarding: {
    next: "Next step",
    getStarted: "Get Started",
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

  /** Onboarding step 3 — what the user wants help with. Labels are in the same
   *  order as the GOALS ids in app/onboarding-goals.tsx. */
  onboardingGoals: {
    headline: "What do you want Nexdo to help you with?",
    body: "Select all that apply to you right now.",
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

  /** Onboarding step 4 — the brain dump, typed or spoken. */
  onboardingDump: {
    eyebrow: "INTERACTIVE DEMO",
    headline: "What's on your mind right now?",
    body: "Don't organize it. Just dump your messy thoughts here.",
    placeholder: "e.g. Tomorrow I need to finish my math homework, email my professor, buy groceries…",
    startRecording: "Start speaking",
    stopRecording: "Stop and write it down",
    transcribing: "Writing it down…",
    organize: "Organize with Nexdo",
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

  /** Onboarding step 7 — the one task Nexdo picks, and why. */
  onboardingFocus: {
    eyebrow: "THE DECISION ENGINE",
    headline: "So… what should you do first?",
    body: "You don't organize your tasks and then still wonder where to start. **Nexdo makes the decision.**",
    nextFocus: "NEXT FOCUS",
    urgency: (score: number) => `Urgency ${score} / 100`,
    why: "WHY THIS RIGHT NOW?",
    thinking: "Working out why…",
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
    signUpSubtitle: "3 tasks are sorted and ready. Create an account to save them and keep going.",
    plannedTasks: [
      { title: "Buy groceries", when: "Tonight" },
      { title: "Finish math assignment", when: "Friday" },
      { title: "Call dentist", when: "Tomorrow" },
    ],
    continueWithGoogle: "Continue with Google",
    continueWithApple: "Continue with Apple",
    checkEmail: "Check your email",
    codeSentTo: "We sent a 6-digit code to",
    somethingWrong: "Something went wrong. Try again.",
  },
};
