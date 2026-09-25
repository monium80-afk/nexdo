import type { Translations } from "@/lib/i18n";

// German copy — same shape as en.ts (TypeScript checks it against that file).
// Addresses the user as "du", like most consumer apps in German (lib/ai/language.ts
// asks the AI for the same).

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

// The adjective comes before the noun and has the same form for 1 and many:
// "1 erledigte Aufgabe", "3 erledigte Aufgaben".
const SCOPE_ADJECTIVES = { completed: "erledigte", pending: "offene" } as const;

export const de: Translations = {
  locale: "de-DE",

  common: {
    cancel: "Abbrechen",
    save: "Speichern",
    delete: "Löschen",
    done: "Fertig",
    close: "Schließen",
    tryAgain: "Erneut versuchen",
    aiUnreachable: "Die KI ist nicht erreichbar. Prüfe deine Verbindung und versuch es noch einmal.",
  },

  tabs: {
    next: "Jetzt",
    tasks: "Aufgaben",
    inbox: "Assistent",
    settings: "Einstellungen",
    addTask: "Aufgabe hinzufügen",
  },

  format: {
    duration: (hours: number, mins: number) => {
      const minsLabel = `${mins} Min.`;
      const hoursLabel = `${hours} ${plural(hours, "Stunde", "Stunden")}`;
      if (hours === 0) return minsLabel;
      if (mins === 0) return hoursLabel;
      return `${hoursLabel} ${minsLabel}`;
    },
    budget: (hours: number, mins: number) => {
      if (hours === 0) return `${mins} Min.`;
      return mins === 0 ? `${hours} Std.` : `${hours} Std. ${mins} Min.`;
    },
    taskCount: (count: number) => `${count} ${plural(count, "Aufgabe", "Aufgaben")}`,
    scopedTaskCount: (count, scope) => {
      const noun = plural(count, "Aufgabe", "Aufgaben");
      return scope === "all" ? `${count} ${noun}` : `${count} ${SCOPE_ADJECTIVES[scope]} ${noun}`;
    },
  },

  due: {
    completed: "Erledigt",
    noDeadline: "Keine Frist",
    overdue: "Überfällig",
    daysOverdue: (days: number) => `${days} ${plural(days, "Tag", "Tage")} überfällig`,
    dueAgo: (days: number, time: string) =>
      days === 1 ? `Fällig gestern um ${time}` : `Fällig vor ${days} Tagen um ${time}`,
    dueToday: "Heute fällig",
    dueTodayBy: (time: string) => `Heute fällig bis ${time}`,
    dueTomorrow: "Morgen fällig",
    dueTomorrowAt: (time: string) => `Morgen fällig um ${time}`,
    inDays: (days: number) => `In ${days} Tagen`,
    dueOnAt: (day: string, time: string) => `Fällig am ${day} um ${time}`,
  },

  planTemplate: ["Alles Nötige zusammensuchen", "Die Hauptarbeit erledigen", "Abschließen und prüfen"],

  next: {
    allCaughtUp: "Alles erledigt",
    allCaughtUpBody: "Du hast alles auf deiner Liste abgehakt. Füge eine neue Aufgabe hinzu, um weiterzumachen.",
    addATask: "Aufgabe hinzufügen",
    eyebrow: "NEXDO JETZT",
    heading: "Was kannst du jetzt gerade tun?",
    timeFilter: (duration: string) => `Passt in ${duration}`,
    timeFilterEmpty: (duration: string) => `Nichts passt in ${duration}`,
    timeFilterClear: "Alle anzeigen",
    timeQuestion: "WIE VIEL ZEIT HAST DU?",
    minutesOption: (minutes: number) => `${minutes} Min.`,
    custom: "Andere...",
    minutesPlaceholder: "Minuten, z. B. 50",
    minutesUnit: "Min.",
    energyLabel: "Energie & Konzentration:",
    energy: { ready: "Bereit", low: "Wenig Energie", procrastinating: "Festgefahren" },
    sessionPlan: "SESSION-PLAN",
    total: (duration: string) => `${duration} insgesamt`,
    startSession: (duration: string) => `Session starten (${duration})`,
    swapTasks: "Aufgaben tauschen oder andere wählen",
    stepsCompleted: (done: number, total: number) =>
      `${done}/${total} ${plural(total, "Schritt erledigt", "Schritte erledigt")}`,
    details: "Details",
    rankOf: (rank: number, total: number) => `Nr. ${rank} von ${total} nach Priorität`,
    priorityRank: (rank: number) => `Priorität Nr. ${rank}`,
    startSessionFor: (duration: string) => `Session starten (${duration})`,
    previous: "Zurück",
    nextCard: "Weiter",
    taskComplete: "Aufgabe erledigt",
    pickTasks: "WÄHLE DEINE AUFGABEN",
    useRecommended: "Empfehlung übernehmen",
  },

  session: {
    leave: "Session verlassen",
    taskOf: (index: number, total: number) => `Aufgabe ${index} von ${total}`,
    tasksHeading: "AUFGABEN & TEILAUFGABEN DER SESSION",
    timerTitle: "SESSION-TIMER",
    pause: "Pause",
    resume: "Fortsetzen",
    pauseA11y: "Session-Timer pausieren",
    resumeA11y: "Session-Timer fortsetzen",
    restartA11y: "Session-Timer neu starten",
    remainingOf: (budget: string) => `übrig von ${budget}`,
    overBudget: (budget: string) => `über ${budget} hinaus`,
    of: (total: number) => `von ${total}`,
    switchTo: (title: string) => `Zu ${title} wechseln`,
    aiAdvice: "KI-Tipp",
    closeAdvice: "KI-Tipp schließen",
    readingTask: "Ich sehe mir die Aufgabe an…",
    finishSession: "Fertig — Session beenden",
    nextTask: "Aufgabe erledigt → Nächste Aufgabe",
    aiBreakdown: "KI-Aufteilung",
    resetTimer: "Zurücksetzen",
    pauseTimer: "Pausieren",
    resumeTimer: "Fortsetzen",
    complete: "Erledigt",
    cancelSession: "Session abbrechen",
    cancelTitle: "Diese Session abbrechen?",
    cancelBody:
      "Der Timer stoppt und die bisherige Zeit wird nicht gespeichert. Die Aufgabe selbst bleibt genau so, wie sie ist.",
    keepGoing: "Weitermachen",
    endSession: "Session beenden",
    hideAdvice: "KI-Tipp ausblenden",
    takeAdvice: "KI-Tipp holen",
    stuck: "Ich hänge fest",
  },

  breakdown: {
    eyebrow: "KI-AUFTEILUNG",
    close: "KI-Aufteilung schließen",
    steps: (count: number) => `${count} ${plural(count, "Schritt", "Schritte")}`,
    generating: "Wird erstellt…",
    regenerate: "Neu erstellen",
    breakingDown: "Aufgabe wird aufgeteilt…",
    stepPlaceholder: "Beschreibe den Schritt…",
    addStep: "Schritt hinzufügen",
    confirm: "Diese Schritte übernehmen",
  },

  stuck: {
    title: "WAS HÄLT DICH AUF?",
    reasons: {
      tooBig: "Sie ist zu groß, um anzufangen",
      missing: "Mir fehlt etwas, das ich brauche",
      noFocus: "Ich kann mich gerade nicht darauf konzentrieren",
    },
    parkNote: "Wir legen sie für ein paar Stunden beiseite und bringen dich zur nächsten Aufgabe.",
    talkToAi: "Mit der KI durchsprechen",
  },

  tasks: {
    title: "Aufgaben",
    addTask: "Hinzufügen",
    searchPlaceholder: "Aufgaben durchsuchen...",
    pendingSuffix: " offen, ",
    completedSuffix: " erledigt",
    overdueCount: (count: number) => `• ${count} überfällig`,
    showingPrefix: "",
    showingSuffix: (shown: number, total: number) =>
      ` von ${total} ${plural(total, "Aufgabe", "Aufgaben")} angezeigt`,
    emptyTitle: "Keine Aufgaben gefunden",
    emptyBody: "Probier einen anderen Filter oder Suchbegriff.",
    statusTitle: "STATUS",
    sortTitle: "SORTIEREN NACH",
    status: { all: "Alle", pending: "Offen", completed: "Erledigt", overdue: "Überfällig" },
    sort: { recent: "Zuletzt hinzugefügt", dueDate: "Fälligkeit", priority: "Prioritäts-Score" },
    score: (score: number) => `Score: ${score}`,
    overdueBadge: "ÜBERFÄLLIG",
  },

  taskDetail: {
    notFound: "Aufgabe nicht gefunden",
    goBack: "Zurück",
    eyebrow: "AUFGABENDETAILS",
    scoreLabel: "Score: ",
    postponeTitle: "AUFGABE VERSCHIEBEN",
    currentDeadline: (label: string) => `Aktuelle Frist: „${label}“. Auf später verschieben:`,
    postpone: { oneDay: "+1 Tag (morgen)", threeDays: "+3 Tage", oneWeek: "+1 Woche" },
    customDate: "Anderes Datum...",
    setDate: "Datum festlegen",
    editTask: "Aufgabe bearbeiten",
    due: (label: string) => `Fällig: ${label}`,
    estimate: (duration: string) => `Dauer: ${duration}`,
    rationaleTitle: "KI-Begründung der Priorität",
    generatingAdvice: "Tipp wird erstellt...",
    subtasks: (done: number, total: number) => `Teilaufgaben (${done}/${total})`,
    aiPlan: "KI-Plan",
    addSubtask: "Teilaufgabe hinzufügen...",
    editSubtask: (label: string) => `${label} bearbeiten`,
    deleteSubtask: (label: string) => `${label} löschen`,
    notes: "NOTIZEN",
    contextTitle: "KONTEXT FÜR DIE KI",
    contextBody: "Die KI liest diese Notizen, wenn sie dir Tipps zu dieser Aufgabe gibt oder sie aufteilt.",
    contextPlaceholder: "z. B. Die Recherche habe ich schon erledigt.",
    deleteTask: "Aufgabe löschen",
    saveChanges: "Änderungen speichern",
    deleteConfirmTitle: "Diese Aufgabe löschen?",
    deleteConfirmBody: "Das kann nicht rückgängig gemacht werden.",
    notePlaceholder: "Was sollte die KI über diese Aufgabe wissen?",
    editNote: "Notiz bearbeiten",
    deleteNote: "Notiz löschen",
  },

  form: {
    eyebrow: "MANUELLE EINGABE",
    title: "Neue Aufgabe",
    taskTitle: "TITEL DER AUFGABE",
    titlePlaceholder: "z. B. Laborbericht für Chemie fertigschreiben",
    titleRequired: "Ein Titel ist erforderlich.",
    duration: "GESCHÄTZTE DAUER",
    customDuration: "Eigene Dauer",
    minutesPlaceholder: "Minuten, z. B. 50",
    minutesUnit: "Min.",
    durationError: "Gib eine ganze Zahl an Minuten größer als null ein.",
    deadlineInPast: "Diese Uhrzeit ist schon vorbei — wähle eine spätere.",
    deadline: "FRIST",
    specificDate: "Bestimmtes Datum / Uhrzeit",
    pickDate: "Im Kalender auswählen",
    changeDate: "Ändern",
    priority: "PRIORITÄT",
    priorities: { high: "Hohe Priorität", medium: "Mittlere Priorität", low: "Niedrige Priorität" },
    planSteps: (count: number) => `Planschritte (${count})`,
    optionalPlan: "Optionaler Schrittplan",
    stepPlaceholder: "z. B. Schritt 1: Einleitung entwerfen",
    stepMinutes: (minutes: number) => `${minutes} Min.`,
    notesTitle: "NOTIZEN & KONTEXT (OPTIONAL)",
    notesPlaceholder: "Wichtige Anforderungen, Anweisungen oder Links hinzufügen...",
    openAiChat: "Lieber den KI-Chat nutzen",
    addTask: "Aufgabe hinzufügen",
    deadlines: {
      today: "Heute",
      tomorrow: "Morgen",
      friday: "Diesen Freitag",
      weekend: "Dieses Wochenende",
      nextWeek: "Nächste Woche",
      none: "Keine Frist",
    },
    durationOptions: {
      15: "15 Min.",
      30: "30 Min.",
      45: "45 Min.",
      60: "1 Std.",
      90: "1,5 Std.",
      120: "2 Std.",
      180: "3 Std.+",
    },
    editEyebrow: "AUFGABE BEARBEITEN",
    editTitlePlaceholder: "Titel der Aufgabe",
    editCurrentDeadline: (label: string) => `Aktuelle Frist: ${label}`,
    deadlineRemoved: "Die Frist wird entfernt.",
    newDeadline: (label: string) => `Neue Frist: ${label}`,
    saveChanges: "Änderungen speichern",
  },

  chat: {
    welcome:
      "Willkommen bei deinem Nexdo-Assistenten. Wirf hier deine Gedanken, Aufgaben, Sprachnotizen oder Fotos rein. Du kannst von hier aus auch dein ganzes System steuern — erzähl mir, wie es gerade aussieht („Ich habe nur 30 Minuten“, „Ich schaffe das Projekt dieses Wochenende nicht“ oder „Der Zahnarzttermin ist wichtiger“), und ich passe deinen Plan an.",
    inboxTitle: "Nexdo-Assistent",
    contextSubtitle: "Bitte mich, diese Aufgabe zu analysieren, anzupassen oder zu aktualisieren.",
    activeTasksSuffix: " aktive Aufgaben in der Warteschlange",
    typing: "Schreibt…",
    addAll: (count: number) => `Alle ${count} Aufgaben hinzufügen`,
    yesDoIt: "Ja, mach das",
    openNext: (minutes: number) => `Jetzt öffnen (${minutes} Min.)`,
    starterSuggestions: {
      "capacity-20": "Ich habe gerade nur 20 Minuten",
      "whats-next": "Was soll ich als Nächstes tun?",
      "reschedule-overdue": "Alles Überfällige neu planen",
      "brain-dump": "Ich muss bis Freitag meinen Geschichtsaufsatz fertigschreiben und morgen den Zahnarzt anrufen",
    },
    quickActions: {
      "whats-next": "Hinzufügen",
      "breakdown-top": "Erledigen",
      "quick-win": "Entfernen",
      "overdue-catchup": "Ändern",
      "break-down": "Aufteilen",
      prioritize: "Priorisieren",
    },
    attachmentReplies: {
      photo: "Auf dem Foto konnte ich nichts Lesbares finden — versuch ein schärferes Foto oder tipp es einfach ein.",
      voice: "Die Aufnahme habe ich nicht richtig verstanden — versuch es an einem ruhigeren Ort noch einmal oder tipp es einfach ein.",
      document: "Aus dieser Datei konnte ich keinen Text herausholen — versuch eine andere oder tipp es einfach ein.",
    },
    couldntCatch: "Nicht verstanden",
    couldntTranscribe: "Transkription fehlgeschlagen",
    uploadFailedTitle: "Anhang nicht möglich",
    uploadFailedBody:
      "Deine Dateien konnten nicht hochgeladen werden, daher wurde nichts gesendet. Sie sind noch im Eingabefeld — prüfe deine Verbindung und versuch es noch einmal.",
    uploadPartialBody: (failed: number) =>
      failed === 1
        ? "Eine Datei konnte nicht hochgeladen werden und wurde deshalb nicht mitgeschickt."
        : `${failed} Dateien konnten nicht hochgeladen werden und wurden deshalb nicht mitgeschickt.`,
    complexity: { simple: "einfache", medium: "mittelschwere", complex: "komplexe" },
    taskRead: (title: string, complexity: string, advice: string) =>
      `Meine Einschätzung zu „${title}“: Das ist eine ${complexity} Aufgabe. ${advice}`,
    titlePlaceholder: "Titel der Aufgabe",
    minutesPlaceholder: "Minuten",
    doneEditing: "Bearbeitung beenden",
    editDetails: "Aufgabendetails bearbeiten",
    dismiss: "Verwerfen",
    addTask: "Hinzufügen",
    recordVoice: "Sprachnotiz aufnehmen",
    stopRecording: "Aufnahme beenden",
    takePhoto: "Foto aufnehmen",
    attachDocument: "Dokument anhängen",
    recording: (duration: string) => `Aufnahme… ${duration}`,
    transcribing: "Wird transkribiert…",
    inputPlaceholder: "Aufgaben tippen, sprechen oder fotografieren...",
    attachmentPlaceholder: "Anweisungen hinzufügen (optional)...",
    removeAttachment: "Anhang entfernen",
    documentLabel: "Dokument",
    send: "Nachricht senden",
    micPermissionTitle: "Mikrofonzugriff erforderlich",
    micPermissionBody:
      "Nexdo braucht Zugriff auf das Mikrofon, um Sprachnotizen aufzunehmen. Du kannst ihn in den Einstellungen erlauben.",
    cameraPermissionTitle: "Kamerazugriff erforderlich",
    cameraPermissionBody:
      "Nexdo braucht Zugriff auf die Kamera, um Fotos aufzunehmen. Du kannst ihn in den Einstellungen erlauben.",
    voiceNoteLabel: (duration: string) => `Sprachnotiz (${duration})`,
    photoLabel: "Foto angehängt",
    viewPhoto: "Foto im Vollbild anzeigen",
    videoNotSupportedTitle: "Videos werden nicht unterstützt",
    videoNotSupportedBody: "Nexdo liest Fotos, Sprachnotizen und Dokumente. Schick stattdessen ein Foto oder eine Datei.",
  },

  assistant: {
    foundOne: (title: string) => `Ich habe 1 Aufgabe gefunden: „${title}“. Soll ich sie hinzufügen?`,
    foundMany: (count: number, titles: string) =>
      `Ich habe ${count} Aufgaben gefunden: ${titles}. Soll ich sie hinzufügen?`,
    confirmBulkDelete: (countLabel: string, includesCompleted: boolean) =>
      `Das löscht ${countLabel}${includesCompleted ? " (offene und erledigte)" : ""}. Soll ich weitermachen?`,
    goAhead: "Soll ich das machen?",
    noPendingToComplete: "Du hast keine offenen Aufgaben, die du abhaken könntest.",
    noScopedToDelete: (scope: "completed" | "pending") =>
      `Du hast keine ${scope === "completed" ? "erledigten" : "offenen"} Aufgaben zum Löschen.`,
    noTasksToDelete: "Du hast keine Aufgaben zum Löschen.",
    done: "Erledigt.",
    wontChange: "Kein Problem — ich ändere nichts.",
    nothingToUndo: "Es gibt nichts rückgängig zu machen.",
    undone: "Rückgängig gemacht.",
    added: (title: string) => `„${title}“ wurde zu deinen Aufgaben hinzugefügt.`,
    addedMany: (count: number, titles: string) => `${count} Aufgaben hinzugefügt: ${titles}.`,
    updated: (title: string) => `„${title}“ wurde aktualisiert.`,
    markedDone: (title: string) => `„${title}“ ist als erledigt markiert.`,
    markedAllDone: (countLabel: string) => `Als erledigt markiert: ${countLabel}.`,
    deleted: (title: string) => `„${title}“ wurde gelöscht.`,
    deletedMany: (countLabel: string) => `Gelöscht: ${countLabel}.`,
    loggedContext: (title: string) => `Verstanden — ich habe das bei „${title}“ notiert.`,
    rescheduled: (title: string) => `„${title}“ wurde neu geplant.`,
    skipped: (title: string) => `Verstanden — ich schlage „${title}“ eine Weile nicht mehr vor.`,
    brokeDown: (title: string, count: number) => `„${title}“ wurde in ${count} Schritte aufgeteilt.`,
    redirectNext: (minutes: number) => `Die Jetzt-Seite ist für ${minutes} Minuten vorbereitet.`,
    fallbackTask: "die Aufgabe",
    fallbackYourTask: "deine Aufgabe",
    fallbackThat: "diese",
    whichOne: (titles: string) => `Welche meinst du: ${titles}?`,
    whichDelete: "Welche Aufgabe soll ich löschen?",
    overdueWorkflow: (text: string) => `Ich helfe dir bei „${text}“, ohne vorerst eine Aufgabe zu ändern.`,
    bestNext: (title: string, score: number) =>
      `Dein bester nächster Schritt: „${title}“ — Prioritäts-Score ${score}.`,
    allCaughtUp: "Alles erledigt — gerade ist nichts offen.",
    noTaskFound:
      "Darin konnte ich keine Aufgabe finden — sag mir einfach, was du erledigen musst, z. B. „morgen die Wohnung putzen“.",
    adviceDoNow: (label: string, duration: string) => `Mach das jetzt: ${label} (~${duration}).`,
    adviceJustDo: (title: string, duration: string) => `Leg einfach los — „${title}“ dauert etwa ${duration}.`,
    urgencyHigh: "das ist eine deiner dringendsten Aufgaben",
    urgencyMedium: "die solltest du bald angehen",
    urgencyLow: "es eilt nicht, aber sie steht auf deiner Liste",
    adviceDetail: (score: number, urgency: string) => `Prioritäts-Score ${score}/100 — ${urgency}.`,
  },

  settings: {
    title: "Einstellungen",
    preferences: "NEXDO-EINSTELLUNGEN",

    account: "KONTO",
    signOut: "Abmelden",
    signingOut: "Wird abgemeldet…",
    signOutCleanupError: "Abgemeldet, aber beim Aufräumen der lokalen Daten gab es ein Problem.",
    signOutError: "Abmelden fehlgeschlagen. Versuch es noch einmal.",

    aiChat: "KI-POSTEINGANG",
    autoMode: "Automatikmodus",
    autoModeBody: "Aufgaben sofort hinzufügen und aktualisieren, ohne vorher nachzufragen.",
    clearHistory: "Chatverlauf löschen",
    clearConfirmTitle: "Chatverlauf löschen?",
    clearConfirmBody: "Damit werden alle Nachrichten im KI-Chat entfernt. Deine Aufgaben bleiben unverändert.",
    clear: "Löschen",
    historyCleared: "Chatverlauf gelöscht.",
    historyClearFailed:
      "Auf diesem Gerät gelöscht, aber die synchronisierte Kopie konnte nicht gelöscht werden. Versuch es noch einmal.",

    notifications: "BENACHRICHTIGUNGEN",
    dailyNudge: "Tägliche „Was als Nächstes?“-Erinnerung",
    dailyNudgeBody: "Eine Erinnerung pro Tag mit der Aufgabe, die sich als Nächstes lohnt.",
    nudgeTime: "Erinnern um",
    overdueAlerts: "Hinweise zu überfälligen Aufgaben",
    overdueAlertsBody: "Ein Hinweis, sobald eine Aufgabe ihre Frist überschreitet.",
    notificationsNote: "Auf diesem Gerät gespeichert. Die tägliche Erinnerung kommt mit einem späteren Update.",
    notificationsBlockedTitle: "Benachrichtigungen sind aus",
    notificationsBlockedBody:
      "Erlaube Nexdo in den Einstellungen deines Handys, Benachrichtigungen zu senden, damit du Hinweise zu überfälligen Aufgaben bekommst.",
    openPhoneSettings: "Einstellungen öffnen",

    appearance: "DARSTELLUNG",
    theme: "Design",
    themes: { light: "Hell", dark: "Dunkel", system: "System" },
    language: "Sprache",

    support: "HILFE",
    help: "Hilfe & Feedback",
    helpBody: "Sag uns, was nicht funktioniert oder was du dir wünschst.",
    privacy: "Datenschutzerklärung",
    terms: "Nutzungsbedingungen",
    version: (version: string) => `Nexdo v${version}`,
    linkError: "Der Link konnte nicht geöffnet werden. Versuch es noch einmal.",
  },

  notifications: {
    overdueTitle: (title: string) => `Überfällig: ${title}`,
    overdueBody: "Die Frist ist gerade abgelaufen. Tippe, um sie zu erledigen oder einen neuen Termin zu wählen.",
    overdueChannel: "Überfällige Aufgaben",
  },

  profile: {
    addName: "Füge deinen Namen hinzu",
    editAccount: "Konto bearbeiten",
  },

  account: {
    title: "Konto",
    close: "Kontoeinstellungen schließen",
    changePhoto: "Profilbild ändern",
    photoHint: "JPG oder PNG unter 5 MB",
    photoError: "Dein Bild konnte nicht aktualisiert werden. Versuch es noch einmal.",
    name: "Name",
    namePlaceholder: "Dein Name",
    nameRequired: "Füge deinen Namen hinzu.",
    nameError: "Dein Name konnte nicht gespeichert werden. Versuch es noch einmal.",
    saving: "Wird gespeichert…",
    saved: "Gespeichert",
    email: "E-Mail",
    noEmail: "Keine E-Mail-Adresse in diesem Konto",
    changePassword: "Passwort ändern",
    currentPassword: "Aktuelles Passwort",
    newPassword: "Neues Passwort",
    confirmPassword: "Neues Passwort bestätigen",
    passwordHint: "Mindestens 8 Zeichen.",
    passwordMismatch: "Die beiden Passwörter stimmen nicht überein.",
    passwordUpdated: "Passwort aktualisiert.",
    passwordError: "Dein Passwort konnte nicht geändert werden. Prüfe das aktuelle und versuch es noch einmal.",
    savePassword: "Passwort speichern",
    deleteAccount: "Konto löschen",
    deleteTitle: "Dein Konto löschen?",
    deleteBody:
      "Damit werden dein Nexdo-Konto und alles darin endgültig gelöscht — alle Aufgaben, Chats und Einstellungen, auf allen Geräten. Das kann nicht rückgängig gemacht werden.",
    deleteConfirm: "Konto löschen",
    deleting: "Wird gelöscht…",
    deleteError: "Dein Konto konnte nicht gelöscht werden. Versuch es noch einmal.",
  },

  onboarding: {
    next: "Nächster Schritt",
    getStarted: "Los geht's",
    stickyNotes: ["Zahnarzttermin?", "Prüfung nächste Woche", "einkaufen", "Mail beantworten"],
    headline: "Hör auf zu grübeln, was als Nächstes kommt.",
    body: "Schreib alles auf, was dir durch den Kopf geht. Nexdo ordnet es, erkennt Fristen und sagt dir, was deine Aufmerksamkeit verdient.",
    nextUp: "ALS NÄCHSTES",
    sampleTask: "Chemie-Laborbericht fertigstellen",
    dueTomorrow: "Morgen fällig",
  },

  onboardingSort: {
    headline: "Alles, was dir im Kopf herumschwirrt.\nZieh es in eine Reihenfolge.",
    body: "Zieh die Linie nach unten — und sieh zu, wie aus dem Chaos ein Plan wird.",
    head: "IN DEINEM KOPF",
    plan: "IN DEINEM PLAN",
    priority: { high: "HOCH", medium: "MITTEL", low: "NIEDRIG" },
    dragHandle: "Ziehen, um deine Aufgaben zu sortieren",
  },

  onboardingGoals: {
    headline: "Mal ehrlich — was davon kennst du?",
    body: "Wähle so viele, wie du willst. Hier urteilt niemand.",
    options: [
      "Ich vergesse, was ich erledigen muss",
      "Ich habe zu viel im Kopf",
      "Mir fällt Priorisieren schwer",
      "Ich schiebe große Aufgaben vor mir her",
      "Ich weiß nicht, wo ich anfangen soll",
      "Ich will besser organisiert sein",
    ],
    continue: "Weiter",
  },

  onboardingDump: {
    eyebrow: "PROBIER ES MIT DEINEN ECHTEN AUFGABEN",
    headline: "Was musst du diese Woche erledigen?",
    body: "**Schreib jede Aufgabe auf**, die ansteht — gern durcheinander. Tipp sie ein oder drück aufs Mikro und sprich sie laut aus.",
    placeholder: "Mathe-Hausaufgaben bis Freitag fertig machen\nProf. Weber mailen\nHeute Abend einkaufen…",
    startRecording: "Sprechen",
    stopRecording: "Stopp und aufschreiben",
    transcribing: "Wird aufgeschrieben…",
    organize: "Mit Nexdo ordnen",
  },

  onboardingAnalyzing: {
    headline: "Daraus wird ein Plan…",
    body: "Nexdo analysiert Termine, Dauer, Abhängigkeiten und mentale Belastung.",
    steps: [
      "Einzelne Aufgaben im Text finden",
      "Fristen & Zeitfenster erkennen",
      "Realistischen Aufwand schätzen",
      "Prioritäten & nächsten Schritt berechnen",
    ],
  },

  onboardingPlan: {
    extracted: (count: number) => `${count} ${plural(count, "AUFGABE", "AUFGABEN")} ERKANNT`,
    headline: "Dein Kopf ist schon ein bisschen freier.",
    body: "Nexdo hat konkrete Aufgaben herausgezogen, Fristen erkannt und die Dauer berechnet.",
    nothingFound:
      "Nexdo hat darin nichts zu erledigen gefunden. Sobald alles eingerichtet ist, kannst du selbst Aufgaben hinzufügen.",
    score: (value: number) => `Score ${value}`,
    next: "Womit fange ich an?",
  },

  onboardingFocus: {
    eyebrow: "DIE ENTSCHEIDUNGSMASCHINE",
    headline: "Also… womit fängst du an?",
    body: "Du ordnest deine Aufgaben nicht, um dich danach trotzdem zu fragen, wo du anfangen sollst. **Nexdo trifft die Entscheidung.**",
    nextFocus: "NÄCHSTER FOKUS",
    urgency: (score: number) => `Dringlichkeit ${score} / 100`,
    advice: "KI-TIPP",
    thinking: "Ich überlege mir einen Tipp…",
    nothing:
      "Noch gibt es nichts zu entscheiden. Füge eine Aufgabe hinzu, sobald alles eingerichtet ist, und Nexdo wählt für dich aus.",
    next: "Klingt logisch",
  },

  auth: {
    welcomeBack: "Willkommen zurück.",
    signInSubtitle: "Melde dich an und mach genau da weiter, wo du aufgehört hast.",
    email: "E-MAIL",
    password: "PASSWORT",
    logIn: "Anmelden",
    continueWithEmail: "oder weiter mit E-Mail",
    noAccount: "Noch kein Konto?",
    signUp: "Registrieren",
    signUpButton: "Registrieren",
    haveAccount: "Du hast schon ein Konto?",
    terms: "Mit dem Fortfahren stimmst du den Nutzungsbedingungen und der Datenschutzerklärung von Nexdo zu.",
    invalidCode: "Ungültiger Code. Versuch es noch einmal.",
    sendCodeError: "Der Bestätigungscode konnte nicht gesendet werden. Versuch es noch einmal.",
    signUpTitle: "Verlier deinen Plan nicht.",
    signUpSubtitle: (count: number) =>
      count === 1
        ? "Deine Aufgabe ist sortiert und bereit. Erstelle ein Konto, um sie zu speichern und weiterzumachen."
        : `${count} Aufgaben sind sortiert und bereit. Erstelle ein Konto, um sie zu speichern und weiterzumachen.`,
    signUpTitleNoPlan: "Erstelle dein Konto.",
    signUpSubtitleNoPlan:
      "Behalte alles, was du erledigen musst, an einem Ort — und lass Nexdo entscheiden, womit du anfängst.",
    continueWithGoogle: "Weiter mit Google",
    continueWithApple: "Weiter mit Apple",
    checkEmail: "Sieh in deinen Posteingang",
    codeSentTo: "Wir haben einen 6-stelligen Code gesendet an",
    somethingWrong: "Etwas ist schiefgelaufen. Versuch es noch einmal.",
  },
};
