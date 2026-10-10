import type { Translations } from "@/lib/i18n";
import type { TrialUnit } from "@/lib/plan";

// Arabic copy — same shape as en.ts (TypeScript checks it against that file).

/**
 * Arabic counts a noun three ways: 2 has its own dual word that already carries
 * the number, 3–10 take the plural ("3 مهام"), and everything else takes the
 * singular ("1 مهمة", "11 مهمة").
 */
const counted = (count: number, one: string, few: string, two: string) => {
  if (count === 2) return two;
  const rest = count % 100;
  return `${count} ${rest >= 3 && rest <= 10 ? few : one}`;
};

// Non-human plurals in Arabic take feminine singular agreement, so one form of
// each adjective covers "مهمة مكتملة" and "مهام مكتملة" alike.
const SCOPE_ADJECTIVES = { completed: "مكتملة", pending: "قيد الانتظار" } as const;

/** Tasks as the object of a verb ("حذفت مهمتين") — the dual changes form there. */
const tasksObject = (count: number) => counted(count, "مهمة", "مهام", "مهمتين");
const tasksSubject = (count: number) => counted(count, "مهمة", "مهام", "مهمتان");

type ShiftUnit = "minutes" | "hours" | "days" | "weeks" | "months";

/** "بمقدار أسبوعين" — how far a bulk move pushed the deadlines. */
const shiftLength = (amount: number, unit: ShiftUnit) => {
  const size = Math.abs(amount);
  const label = {
    minutes: counted(size, "دقيقة", "دقائق", "دقيقتين"),
    hours: counted(size, "ساعة", "ساعات", "ساعتين"),
    days: counted(size, "يوم", "أيام", "يومين"),
    weeks: counted(size, "أسبوع", "أسابيع", "أسبوعين"),
    months: counted(size, "شهر", "أشهر", "شهرين"),
  }[unit];
  return `بمقدار ${label}`;
};

/** "3 أيام" — how long a free trial lasts. */
const trialLength = (count: number, unit: TrialUnit) =>
  ({
    day: counted(count, "يوم", "أيام", "يومين"),
    week: counted(count, "أسبوع", "أسابيع", "أسبوعين"),
    month: counted(count, "شهر", "أشهر", "شهرين"),
    year: counted(count, "سنة", "سنوات", "سنتين"),
  })[unit];

/** The unit beside the repeat stepper's number: singular for 1, dual for 2, plural for 3–10. */
const stepperUnit = (n: number, one: string, few: string, two: string) => {
  if (n === 2) return two;
  const rest = n % 100;
  return rest >= 3 && rest <= 10 ? few : one;
};

export const ar: Translations = {
  // Gregorian calendar and Western digits, so dates match the numbers the rest
  // of the app prints. Plain "ar" would give Arabic-Indic digits (٢٥), and
  // "ar-SA" would switch deadlines to the Hijri calendar.
  locale: "ar-u-ca-gregory-nu-latn",

  common: {
    cancel: "إلغاء",
    save: "حفظ",
    delete: "حذف",
    done: "تم",
    close: "إغلاق",
    tryAgain: "أعد المحاولة",
    aiUnreachable: "تعذّر الوصول إلى الذكاء الاصطناعي. تحقق من اتصالك وأعد المحاولة.",
  },

  tabs: {
    next: "اليوم",
    tasks: "المهام",
    settings: "الإعدادات",
  },

  format: {
    duration: (hours: number, mins: number) => {
      const minsLabel = `${mins} دقيقة`;
      const hoursLabel = counted(hours, "ساعة", "ساعات", "ساعتان");
      if (hours === 0) return minsLabel;
      if (mins === 0) return hoursLabel;
      return `${hoursLabel} و${minsLabel}`;
    },
    budget: (hours: number, mins: number) => {
      if (hours === 0) return `${mins} د`;
      return mins === 0 ? `${hours} س` : `${hours} س ${mins} د`;
    },
    noDuration: "بلا مدة",
    taskCount: (count: number) => counted(count, "مهمة", "مهام", "مهمتان"),
    scopedTaskCount: (count, scope) => {
      const label = counted(count, "مهمة", "مهام", "مهمتان");
      return scope === "all" ? label : `${label} ${SCOPE_ADJECTIVES[scope]}`;
    },
  },

  due: {
    completed: "مكتملة",
    noDeadline: "بلا موعد",
    overdue: "متأخرة",
    daysOverdue: (days: number) => `متأخرة ${counted(days, "يوم", "أيام", "يومين")}`,
    dueAgo: (days: number, time: string) =>
      days === 1
        ? `كانت مستحقة أمس عند ${time}`
        : `كانت مستحقة قبل ${counted(days, "يوم", "أيام", "يومين")} عند ${time}`,
    dueToday: "مستحقة اليوم",
    dueTodayBy: (time: string) => `مستحقة اليوم قبل ${time}`,
    dueTomorrow: "مستحقة غدًا",
    dueTomorrowAt: (time: string) => `مستحقة غدًا عند ${time}`,
    inDays: (days: number) => `بعد ${counted(days, "يوم", "أيام", "يومين")}`,
    dueOnAt: (day: string, time: string) => `مستحقة ${day} عند ${time}`,
    dueOn: (day: string) => `مستحقة ${day}`,
    dueAgoDay: (days: number) =>
      days === 1 ? "كانت مستحقة أمس" : `كانت مستحقة قبل ${counted(days, "يوم", "أيام", "يومين")}`,
    archived: "مؤرشفة",
    skipped: "متخطّاة",
  },

  planTemplate: ["اجمع ما تحتاجه", "أنجز العمل الأساسي", "أنهِ وراجع"],

  next: {
    allCaughtUp: "كل شيء مُنجز",
    allCaughtUpBody: "أنجزت كل ما في قائمتك. أضف مهمة جديدة للمتابعة.",
    addATask: "أضف مهمة",
    scoreLabel: "الدرجة: ",
    custom: "مدة أخرى...",
    minutesPlaceholder: "الدقائق، مثلاً 50",
    minutesUnit: "دقيقة",
    energy: { ready: "جاهز", low: "طاقة منخفضة", procrastinating: "متعثر" },
    sessionPlan: "خطة الجلسة",
    total: (duration: string) => `${duration} إجمالاً`,
    startSession: (duration: string) => `ابدأ الجلسة (${duration})`,
    details: "التفاصيل",
    priorityRank: (rank: number) => `الأولوية رقم ${rank}`,
    startSessionFor: (duration: string) => `ابدأ الجلسة (${duration})`,
    previous: "السابقة",
    nextCard: "التالية",
    startSessionLabel: "ابدأ الجلسة",
    resumeSession: "العودة إلى الجلسة",
    breakDown: "تقسيم",
    getAdvice: "اطلب نصيحة",
    markComplete: "تحديد كمكتملة",
    taskComplete: "اكتملت المهمة",
    pinned: "مثبّتة أولًا",
    schedule: "الجدول",
    todayProgress: (done: number, total: number) => `اليوم: أُنجز ${done} من ${total}`,
    doneForToday: "انتهيت لهذا اليوم",
    doneForTodayBody: "أنجزت كل ما كان مستحقًا اليوم. ما يأتي بعده في جدولك.",
    nothingToday: "لا شيء مستحق اليوم",
    nothingTodayBody: "لا توجد مهمة موعدها اليوم. يعرض جدولك الأيام الأخرى، وفي «المهام» تجد كل مهامك، ومنها التي بلا موعد نهائي.",
    openSchedule: "فتح الجدول",
    seeTasks: "عرض كل المهام",
    today: "اليوم",
    tasksLeft: (count: number) => `المتبقي: ${tasksSubject(count)}`,
    doneOfTotal: (done: number, total: number) => `أُنجز ${done} من ${total}`,
  },

  schedule: {
    title: "الجدول",
    summary: (count: number, duration: string) => `المستحق: ${tasksSubject(count)} · ${duration}`,
    summaryCount: (count: number) => `المستحق: ${tasksSubject(count)}`,
    week: "أسبوع",
    year: "سنة",
    previousWeek: "الأسبوع السابق",
    nextWeek: "الأسبوع التالي",
    thisWeek: "العودة إلى هذا الأسبوع",
    previousYear: "السنة السابقة",
    nextYear: "السنة التالية",
    thisYear: "العودة إلى هذه السنة",
    today: "اليوم",
    stepOf: (step: number, total: number, label: string) => `الخطوة ${step} من ${total}: ${label}`,
    nothingDue: "لا شيء مستحق في هذا اليوم",
    done: "المنجزة",
  },

  session: {
    leave: "الخروج من الجلسة",
    taskOf: (index: number, total: number) => `المهمة ${index} من ${total}`,
    tasksHeading: "مهام الجلسة والمهام الفرعية",
    timerTitle: "مؤقت الجلسة",
    pause: "إيقاف مؤقت",
    resume: "متابعة",
    pauseA11y: "إيقاف مؤقت الجلسة",
    resumeA11y: "متابعة مؤقت الجلسة",
    restartA11y: "إعادة تشغيل مؤقت الجلسة",
    remainingOf: (budget: string) => `متبقية من ${budget}`,
    overBudget: (budget: string) => `تجاوزت ${budget}`,
    of: (total: number) => `من ${total}`,
    switchTo: (title: string) => `الانتقال إلى ${title}`,
    aiAdvice: "نصيحة الذكاء الاصطناعي",
    closeAdvice: "إغلاق نصيحة الذكاء الاصطناعي",
    readingTask: "جارٍ قراءة هذه المهمة…",
    finishSession: "تم — إنهاء الجلسة",
    nextTask: "أنهيت هذه المهمة ← المهمة التالية",
    aiBreakdown: "تقسيم بالذكاء الاصطناعي",
    resetTimer: "إعادة تعيين",
    pauseTimer: "إيقاف المؤقت",
    resumeTimer: "متابعة المؤقت",
    complete: "إكمال",
    cancelSession: "إلغاء الجلسة",
    cancelTitle: "هل تريد إلغاء هذه الجلسة؟",
    cancelBody: "سيتوقف المؤقت ولن يُحفظ الوقت الذي قضيته. أما المهمة فتبقى كما هي.",
    keepGoing: "المتابعة",
    endSession: "إنهاء الجلسة",
    hideAdvice: "إخفاء النصيحة",
    takeAdvice: "اطلب نصيحة الذكاء الاصطناعي",
    stuck: "أنا متعثر",
    noTimer: "لا مؤقّت لهذه المهمة — اضغط إكمال عند إنجازها.",
    addContext: "إضافة سياق",
    contextIntro: "أرِ Nexdo ما تعمل عليه — صورة للتعليمات أو مستندًا أو ملاحظة. سيحدّث خطوات هذه المهمة ونصيحتها.",
  },

  breakdown: {
    eyebrow: "تقسيم بالذكاء الاصطناعي",
    close: "إغلاق التقسيم",
    steps: (count: number) => counted(count, "خطوة", "خطوات", "خطوتان"),
    generating: "جارٍ التوليد…",
    regenerate: "إعادة التوليد",
    breakingDown: "جارٍ تقسيم هذه المهمة…",
    stepPlaceholder: "اكتب وصف الخطوة…",
    addStep: "أضف خطوة",
    confirm: "تأكيد هذه الخطوات",
  },

  tasks: {
    title: "المهام",
    addTask: "أضف مهمة",
    searchPlaceholder: "ابحث في المهام...",
    pendingSuffix: " قيد الانتظار",
    completedSuffix: " مكتملة",
    overdueCount: (count: number) => `${count} متأخرة`,
    showingPrefix: "عرض ",
    showingSuffix: (shown: number, total: number) => ` من أصل ${total} مهمة`,
    emptyTitle: "لا توجد مهام",
    emptyBody: "جرّب عامل تصفية آخر أو كلمة بحث مختلفة.",
    status: { all: "الكل", pending: "قيد الانتظار", completed: "مكتملة", overdue: "متأخرة", noDeadline: "بلا موعد", archived: "مؤرشفة" },
    sort: { recent: "الأحدث إضافة", dueDate: "موعد الاستحقاق", priority: "درجة الأولوية" },
    score: (score: number) => `الدرجة: ${score}`,
  },

  taskDetail: {
    notFound: "المهمة غير موجودة",
    goBack: "رجوع",
    postponeTitle: "تأجيل",
    postpone: { oneDay: "+يوم", threeDays: "+3 أيام", oneWeek: "+أسبوع" },
    customDate: "اختر تاريخًا",
    setDate: "تأكيد التاريخ",
    editTask: "تعديل المهمة",
    subtasksTitle: "المهام الفرعية",
    addSubtask: "أضف مهمة فرعية...",
    editSubtask: (label: string) => `تعديل ${label}`,
    deleteSubtask: (label: string) => `حذف ${label}`,
    notes: "ملاحظات",
    contextTitle: "أضف سياقًا للذكاء الاصطناعي",
    contextPlaceholder: "مثلاً: أنهيت البحث بالفعل.",
    deleteTask: "حذف المهمة",
    saveChanges: "حفظ التغييرات",
    deleteConfirmTitle: "حذف هذه المهمة؟",
    deleteConfirmBody: "لا يمكن التراجع عن هذا.",
    notePlaceholder: "ما الذي يجب أن يعرفه الذكاء الاصطناعي عن هذه المهمة؟",
    editNote: "تعديل الملاحظة",
    deleteNote: "حذف الملاحظة",
    repeatEyebrow: "التكرار",
    setRepeat: "اجعلها تتكرر",
    editRepeat: "تغيير",
    stopRepeating: "إيقاف التكرار",
    stopRepeatingTitle: "إيقاف التكرار؟",
    stopRepeatingBody: "تبقى المهمة في قائمتك كمهمة لمرة واحدة. لن تُنشأ تكرارات جديدة، وتبقى السابقة محفوظة.",
    editScopeTitle: "تغيير مهمة متكررة",
    editScopeBody: "تطبيق هذه التغييرات على…",
    scopeThis: "هذا التكرار فقط",
    scopeFuture: "هذا وما يليه",
    scopeSeries: "كلها، بما فيها السابقة",
    deleteScopeTitle: "حذف مهمة متكررة",
    deleteScopeBody: "تخطي هذا التكرار فقط (يحل التالي مكانه)، أم حذف كل التكرارات بما فيها السابقة؟",
    deleteThisOccurrence: "هذا التكرار",
    deleteWholeSeries: "السلسلة كلها",
    adviceTitle: "نصيحة الذكاء الاصطناعي",
    reassess: {
      running: "يعيد Nexdo تقييم هذه المهمة…",
      updatedTitle: "حُدّثت المهمة بناءً على السياق الجديد",
      upToDate: "مهمتك محدّثة. لم تكن هناك حاجة لتغيير أي من تفاصيلها.",
      clarifyTitle: "يحتاج Nexdo إلى توضيح واحد",
      answerPlaceholder: "أجب Nexdo…",
      deadlineUnclear: "ما الموعد النهائي الجديد لهذه المهمة؟ لم يتمكن Nexdo من تحديد تاريخ دقيق من ملاحظتك.",
      aiFailed: "تعذّر على Nexdo إعادة تقييم هذه المهمة الآن. لم يتغيّر شيء.",
      saveFailed: "تعذّر على Nexdo حفظ التغييرات. لم يتغيّر شيء.",
      keptUserEdits: "تم تجاهل بعض الاقتراحات لأنك غيّرت التفاصيل نفسها بينما كان Nexdo يعمل.",
      discard: "تجاهل الملاحظة",
      dismiss: "إخفاء",
      title: (from: string, to: string) => `العنوان: «${from}» ← «${to}»`,
      description: { added: "الوصف: أُضيف", updated: "الوصف: حُدّث", removed: "الوصف: حُذف" },
      deadline: (from: string, to: string) => `الموعد النهائي: ${from} ← ${to}`,
      deadlineUnchanged: "الموعد النهائي: دون تغيير",
      duration: (from: string, to: string) => `المدة المقدّرة: ${from} ← ${to}`,
      priority: (from: string, to: string) => `الأولوية: ${from} ← ${to}`,
      levels: { critical: "حرجة", high: "عالية", medium: "متوسطة", low: "منخفضة" },
      score: (from: number, to: number) => `نقاط المهمة: ${from} ← ${to}`,
      subtasks: (parts: string[]) => `المهام الفرعية: حُدّثت (${parts.join("، ")})`,
      subtaskParts: {
        added: (count: number) => `أُضيف ${count}`,
        removed: (count: number) => `حُذف ${count}`,
        completed: (count: number) => `اكتمل ${count}`,
        renamed: (count: number) => `أُعيدت تسمية ${count}`,
        retimed: (count: number) => `أُعيد تقدير ${count}`,
        reordered: "أُعيد ترتيبها",
      },
      advice: { added: "نصيحة الذكاء الاصطناعي: أُضيفت", revised: "نصيحة الذكاء الاصطناعي: عُدّلت" },
    },
    reminderAt: (when: string) => `التذكير: ${when}`,
    reminderNoDeadline: "لا تذكير — لا موعد نهائي لهذه المهمة.",
    reminderNoneLeft: "لم يبقَ أي تذكير قبل الموعد النهائي.",
    reminderMuted: "التذكيرات متوقفة لهذه المهمة.",
    reminderOffInSettings: "تذكيرات المواعيد متوقفة في الإعدادات.",
    muteReminders: "إيقاف",
    unmuteReminders: "تشغيل",
    restore: "استعادة",
    planLeft: (steps: number, duration: string) => `${counted(steps, "خطوة", "خطوات", "خطوتان")} متبقية · ${duration}`,
    today: "اليوم",
    tomorrow: "غدًا",
    switchSessionTitle: "تبديل الجلسة؟",
    switchSessionBody: "هناك جلسة جارية على مهمة أخرى. بدء هذه الجلسة ينهيها، ولن يُحفظ مؤقّتها.",
    switchSession: "ابدأ هذه",
    stepsLeft: (steps: number) => `${counted(steps, "خطوة", "خطوات", "خطوتان")} متبقية`,
    attach: {
      addPhoto: "إضافة صورة",
      takePhoto: "التقاط صورة",
      addDocument: "إضافة ملف",
      photo: "صورتك",
      document: "مستندك",
      hint: "يقرؤه Nexdo ويحدّث المهمة. لا يُحتفظ بالملف نفسه.",
      notePlaceholder: "هل هناك ما يجب أن يعرفه Nexdo عنه؟ (اختياري)",
      remove: "إزالة الملف",
      tooBig: "هذا الملف كبير جدًا. يقرأ Nexdo ملفات حتى 6 ميغابايت.",
      unsupported: "يستطيع Nexdo قراءة الصور وملفات PDF والملفات النصية.",
      pickFailed: "تعذّر فتح هذا الملف. أعد المحاولة.",
      /** The camera was refused, now or before. */
      cameraDenied: "يحتاج نكسدو إلى الكاميرا لالتقاط صورة. يمكنك السماح بذلك من إعدادات هاتفك.",
      readingPhoto: "يقرأ Nexdo صورتك…",
      readingDocument: "يقرأ Nexdo مستندك…",
      readFailed: "تعذّر على Nexdo قراءة هذا الملف. لم يتغير شيء.",
      emptyPhoto: "لم يجد Nexdo ما يمكن قراءته في هذه الصورة. جرّب صورة أوضح.",
      emptyDocument: "لم يجد Nexdo ما يمكن قراءته في هذا الملف.",
      fromPhoto: "من صورة",
      fromDocument: "من مستند",
      showMore: "عرض المزيد",
      showLess: "عرض أقل",
    },
  },

  form: {
    title: "مهمة جديدة",
    taskTitle: "عنوان المهمة",
    titlePlaceholder: "مثلاً: إنهاء تقرير مختبر الكيمياء العضوية",
    titleRequired: "عنوان المهمة مطلوب.",
    duration: "المدة المقدّرة",
    customDuration: "مدة مخصصة",
    minutesPlaceholder: "الدقائق، مثلاً 50",
    minutesUnit: "دقيقة",
    durationError: "أدخل عدد دقائق صحيحًا أكبر من صفر.",
    deadlineInPast: "هذا الوقت قد مضى — اختر وقتًا لاحقًا.",
    deadline: "الموعد النهائي",
    specificDate: "تاريخ / وقت محدد",
    pickDate: "اختر من التقويم",
    changeDate: "تغيير",
    priority: "مستوى الأولوية",
    priorities: { high: "أولوية عالية", medium: "أولوية متوسطة", low: "أولوية منخفضة" },
    optional: "اختياري",
    planSteps: "خطوات الخطة",
    stepPlaceholder: "مثلاً: الخطوة 1: كتابة المقدمة",
    notesTitle: "ملاحظات وسياق",
    notesPlaceholder: "أضف المتطلبات الأساسية أو التعليمات أو الروابط...",
    addTask: "أضف المهمة",
    deadlines: {
      today: "اليوم",
      tomorrow: "غدًا",
      friday: "الجمعة القادمة",
      none: "بلا موعد",
    },
    durationOptions: {
      15: "15 د",
      30: "30 د",
      45: "45 د",
      60: "ساعة",
      90: "ساعة ونصف",
      120: "ساعتان",
      180: "3 ساعات+",
      0: "بلا مدة",
    },
    editEyebrow: "تعديل المهمة",
    editTitlePlaceholder: "عنوان المهمة",
    editCurrentDeadline: (label: string) => `الموعد الحالي: ${label}`,
    deadlineRemoved: "سيُحذف الموعد النهائي.",
    newDeadline: (label: string) => `الموعد الجديد: ${label}`,
    addTime: "إضافة وقت",
    removeTime: "بلا وقت محدد",
  },

  chat: {
    attachmentReplies: {
      voice: "لم ألتقط هذا التسجيل جيدًا — أعد المحاولة في مكان أهدأ، أو اكتبها بدلاً من ذلك.",
    },
    couldntCatch: "لم أفهم ذلك",
    couldntTranscribe: "تعذّر التفريغ النصي",
    micPermissionTitle: "مطلوب الوصول إلى الميكروفون",
    micPermissionBody: "يحتاج نكسدو إلى الميكروفون لتسجيل الملاحظات الصوتية. يمكنك السماح بذلك من الإعدادات.",
    voiceNoteLabel: (duration: string) => `ملاحظة صوتية (${duration})`,
  },

  live: {
    open: "تحدّث لإضافة المهام أو تعديلها",
    openLocked: "الميكروفون السحري — ضمن نكسدو برو",
    title: "الميكروفون السحري",
    connecting: "جارٍ الاتصال…",
    listening: (clock: string) => `أستمع · ${clock}`,
    finishing: "ألتقط كلماتك الأخيرة…",
    stopped: "متوقف",
    undo: "تراجع",
    yourTasks: "مهامك",
    emptyTitle: "لا توجد مهام مفتوحة",
    emptyBody: "قل مهمة وستظهر هنا.",
    marks: { added: "أُضيفت الآن", updated: "عُدّلت", completed: "أُنجزت" },
    stop: "إيقاف الاستماع",
    talkAgain: "تحدّث مجددًا",
    done: "تم",
    problems: {
      permission: "يحتاج نكسدو إلى الميكروفون ليسمعك. يمكنك السماح بذلك من الإعدادات.",
      unavailable: "تعذّر بدء الميكروفون السحري. تحقق من اتصالك وأعد المحاولة.",
      connection: "انقطع الاتصال. ما قلته قبل ذلك ما زال محسوبًا.",
      timeLimit: "يتوقف الميكروفون السحري بعد 5 دقائق — اضغط «تحدّث مجددًا» للمتابعة.",
      silence: "توقف الاستماع بعد لحظة صمت — اضغط «تحدّث مجددًا» للمتابعة.",    },
  },

  tour: {
    next: "التالي",
    done: "فهمت",
    skip: "تخطَّ",
    stepOf: (step: number, total: number) => `الخطوة ${step} من ${total}`,
    steps: {
      next: {
        title: "اليوم",
        body: "ما هو مستحق اليوم، والمهمة الأجدر بالإنجاز في الأعلى. اسحب لرؤية البقية، أو اضغط «ابدأ الجلسة» لتركّز.",
      },
      tasks: {
        title: "كل مهامك",
        body: "كل ما عليك في قائمة واحدة. زر «أضف مهمة» يضيف مهمة يدويًا؛ اضغط على مهمة لتعديلها، وعلّمها عند إنجازها.",
      },
      voice: {
        title: "الميكروفون السحري",
        body: "اضغط على الميكروفون وتحدّث فقط — يضيف نكسدو المهام ويعدّلها أثناء كلامك.",
      },
      voiceLocked: {
        title: "الميكروفون السحري",
        body: "اضغط على الميكروفون وتحدّث فقط — يضيف نكسدو المهام ويعدّلها أثناء كلامك. ضمن نكسدو برو.",
      },
    },
  },

  assistant: {
    foundOne: (title: string) => `وجدت مهمة واحدة: «${title}». هل أضيفها؟`,
    foundMany: (count: number, titles: string) =>
      `وجدت ${counted(count, "مهمة", "مهام", "مهمتين")}: ${titles}. هل أضيفها؟`,
    goAhead: "هل تريد مني أن أتابع؟",
    done: "تم.",
    wontChange: "لا مشكلة — لن أغيّر شيئًا.",
    nothingToUndo: "لا يوجد ما يمكن التراجع عنه.",
    undone: "تم التراجع.",
    added: (title: string) => `أضفت «${title}» إلى مهامك.`,
    addedMany: (count: number, titles: string) => `أضفت ${counted(count, "مهمة", "مهام", "مهمتين")}: ${titles}.`,
    updated: (title: string) => `حدّثت «${title}».`,
    markedDone: (title: string) => `حدّدت «${title}» كمنجزة.`,
    deleted: (title: string) => `حذفت «${title}».`,
    deletedMany: (countLabel: string) => `حذفت ${countLabel}.`,
    loggedContext: (title: string) => `فهمت — سجّلت ذلك على «${title}».`,
    rescheduled: (title: string) => `أعدت جدولة «${title}».`,
    skipped: (title: string) => `فهمت — لن أقترح «${title}» لبعض الوقت.`,
    brokeDown: (title: string, count: number) => `قسّمت «${title}» إلى ${counted(count, "خطوة", "خطوات", "خطوتين")}.`,
    redirectNext: (minutes: number) => `جهّزت صفحة «اليوم» لمدة ${minutes} دقيقة.`,
    fallbackYourTask: "مهمتك",
    fallbackThat: "هذه",
    whichOne: (titles: string) => `أيها تقصد: ${titles}؟`,
    whichDelete: "أي مهمة أحذف؟",
    overdueWorkflow: (text: string) => `سأساعدك في «${text}» دون تغيير أي مهمة الآن.`,
    bestNext: (title: string, score: number) => `أفضل خطوة تالية لك هي «${title}» — درجة الأولوية ${score}.`,
    allCaughtUp: "كل شيء مُنجز — لا يوجد شيء قيد الانتظار الآن.",
    noTaskFound: "لم أجد مهمة في ذلك — جرّب أن تسمّي ما تريد فعله، مثل «تنظيف المنزل غدًا».",
    adviceDoNow: (label: string, duration: string) => `افعل هذا الآن: ${label} (~${duration}).`,
    adviceJustDo: (title: string, duration: string) => `ابدأ فحسب — «${title}» تستغرق حوالي ${duration}.`,
    adviceKeepUp: (title: string) => `واصل «${title}» طوال اليوم، وضع علامة عليها عند إنجازها.`,
    adviceStartWith: (label: string) => `افعل هذا الآن: ${label}.`,
    urgencyHigh: "هذه من أكثر مهامك إلحاحًا",
    urgencyMedium: "من الجدير الشروع فيها قريبًا",
    urgencyLow: "لا داعي للعجلة، لكنها على قائمتك",
    adviceDetail: (score: number, urgency: string) => `درجة الأولوية ${score}/100 — ${urgency}.`,
    notSavedYet: "إنها على هذا الهاتف لكنها لم تُحفظ في حسابك بعد — سيواصل Nexdo المحاولة.",
  },

  recurrence: {
    everyDays: (n: number) => (n === 1 ? "كل يوم" : `كل ${counted(n, "يوم", "أيام", "يومين")}`),
    everyWeeks: (n: number, days: string) =>
      n === 1 ? `كل أسبوع: ${days}` : `كل ${counted(n, "أسبوع", "أسابيع", "أسبوعين")}: ${days}`,
    everyMonths: (n: number, day: number) =>
      n === 1 ? `كل شهر في اليوم ${day}` : `كل ${counted(n, "شهر", "أشهر", "شهرين")} في اليوم ${day}`,
    everyYears: (n: number, date: string) =>
      n === 1 ? `كل سنة في ${date}` : `كل ${counted(n, "سنة", "سنوات", "سنتين")} في ${date}`,
    until: (label: string, date: string) => `${label}، حتى ${date}`,
    title: "التكرار",
    frequencies: { none: "لا يتكرر", daily: "يوميًا", weekly: "أسبوعيًا", monthly: "شهريًا", yearly: "سنويًا" },
    every: "كل",
    unit: (frequency: "daily" | "weekly" | "monthly" | "yearly", n: number) =>
      ({
        daily: stepperUnit(n, "يوم", "أيام", "يومين"),
        weekly: stepperUnit(n, "أسبوع", "أسابيع", "أسبوعين"),
        monthly: stepperUnit(n, "شهر", "أشهر", "شهرين"),
        yearly: stepperUnit(n, "سنة", "سنوات", "سنتين"),
      })[frequency],
    decrease: "تكرار أقل",
    increase: "تكرار أكثر",
    onDays: "في أيام",
    ends: "ينتهي",
    endsNever: "أبدًا",
    endsOn: "في تاريخ",
    summary: (label: string) => `يتكرر: ${label}`,
    firstOn: (when: string) => `الأولى: ${when}`,
    ifMissed: "إذا فاتت إحداها",
    missedKeep: "إبقاؤها مفتوحة",
    missedSkip: "تخطيها",
    missedKeepHint: "تبقى المرة الفائتة مفتوحة إلى أن تنجزها، وتنتظر التالية.",
    missedSkipHint: "تُعلَّم المرة الفائتة كمتخطّاة عندما يحين موعد التالية.",
  },

  ops: {
    joinList: (items: string[]) =>
      items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join("، ")} و${items[items.length - 1]}`,
    andMore: (list: string, more: number) => `${list} و${counted(more, "مهمة أخرى", "مهام أخرى", "مهمتان أخريان")}`,
    quote: (title: string) => `«${title}»`,
    nextOccurrence: (when: string) => `موعد التالية: ${when}.`,
    seriesEnded: "كانت هذه الأخيرة في السلسلة.",
    alreadyDone: (title: string) => `«${title}» محددة كمنجزة بالفعل، لذا لم يتغير شيء.`,
    alreadyOpen: (title: string) => `«${title}» مفتوحة بالفعل، لذا لم يتغير شيء.`,
    noDeadlineToMove: (title: string) => `ليس لـ«${title}» موعد نهائي لتأجيله، لذا تركتها كما هي.`,
    invalidChange: (title: string) => `لم أتمكن من تطبيق هذا التغيير على «${title}»، لذا لم يتغير شيء.`,
    nothingChanged: (title: string) => `«${title}» هكذا بالفعل — لم يتغير شيء.`,
    reopened: (title: string) => `أعدت فتح «${title}» — عادت إلى قائمتك.`,
    skippedOccurrence: (title: string, when?: string) =>
      `تخطيت هذا التكرار من «${title}».${when ? ` موعد التالي: ${when}.` : " كان هذا الأخير في السلسلة."}`,
    deletedSeries: (title: string, count: number) =>
      `حذفت سلسلة «${title}» بالكامل (${counted(count, "تكرار", "تكرارات", "تكراران")}).`,
    endedSeries: (title: string) => `لن تتكرر «${title}» بعد الآن. التكرارات السابقة محفوظة.`,
    updatedCompleted: (title: string) => `حدّثت «${title}» — وما زالت محددة كمنجزة.`,
    nowDue: (when: string) => `الموعد النهائي الجديد: ${when}.`,
    stoppedRepeating: (title: string) => `لن تتكرر «${title}» بعد الآن — أصبحت مهمة لمرة واحدة.`,
    nowRepeats: (title: string, rule: string) => `أصبحت «${title}» تتكرر (${rule}).`,
    completedMany: (n: number) => `حدّدت ${tasksObject(n)} كمنجزة.`,
    reopenedMany: (n: number) => `أعدت فتح ${tasksObject(n)}.`,
    updatedMany: (n: number) => `حدّثت ${tasksObject(n)}.`,
    shiftedMany: (n: number, amount: number, unit: ShiftUnit) =>
      `${amount > 0 ? "أخّرت" : "قدّمت"} المواعيد النهائية لـ${tasksObject(n)} ${shiftLength(amount, unit)}.`,
    someStillCompleted: (n: number) =>
      n === 1 ? "ما زالت واحدة منها محددة كمنجزة." : `ما زالت ${tasksSubject(n)} منها محددة كمنجزة.`,
    deletedMany: (n: number) => `حذفت ${tasksObject(n)}.`,
    noDeadlineSkipped: (n: number) =>
      n === 1 ? "مهمة واحدة ليس لها موعد نهائي، فتركتها كما هي." : `${tasksSubject(n)} بلا موعد نهائي، فتركتها كما هي.`,
    alreadyDoneMany: (n: number) => (n === 1 ? "واحدة كانت منجزة بالفعل." : `${tasksSubject(n)} كانت منجزة بالفعل.`),
    alreadyOpenMany: (n: number) => (n === 1 ? "واحدة كانت مفتوحة بالفعل." : `${tasksSubject(n)} كانت مفتوحة بالفعل.`),
    nothingChangedMany: "هذه المهام هكذا بالفعل — لم يتغير شيء.",
    notFound: "لم أجد هذه المهمة — ربما حُذفت. لم يتغير شيء.",
    whichDates: "لم أفهم أي تواريخ تقصد — هل يمكنك قولها بطريقة أخرى؟ لم يتغير شيء.",
    whichTasks: "لم أفهم أي مهام تقصد — هل يمكنك تحديدها؟ لم يتغير شيء.",
    nothingMatched: "لا توجد مهام مطابقة، لذا لم يتغير شيء.",
    someNotFound: (n: number) => (n === 1 ? "لم أجد مهمة واحدة." : `لم أجد ${tasksObject(n)}.`),
    confirmComplete: (n: number, titles: string) => `هل أحدد ${tasksObject(n)} كمنجزة؟ ${titles}.`,
    confirmReopen: (n: number, titles: string) => `هل أعيد فتح ${tasksObject(n)}؟ ${titles}.`,
    confirmDelete: (n: number, titles: string, includesCompleted: boolean) =>
      `هل أحذف ${tasksObject(n)}${includesCompleted ? " (بما فيها المنجزة)" : ""}؟ ${titles}.`,
    confirmDeleteSeries: (title: string) => `هل أحذف كل تكرارات «${title}»، بما فيها السابقة؟`,
    confirmShift: (n: number, titles: string, amount: number, unit: ShiftUnit) =>
      `هل ${amount > 0 ? "أؤخّر" : "أقدّم"} المواعيد النهائية لـ${tasksObject(n)} ${shiftLength(amount, unit)}؟ ${titles}.`,
    confirmUpdate: (n: number, titles: string) => `هل أغيّر ${tasksObject(n)}؟ ${titles}.`,
    askEditScope: (title: string, rule: string) =>
      `«${title}» تتكرر (${rule}). هل أغيّر هذا التكرار فقط، أم هذا وكل ما يليه؟`,
    askDeleteScope: (title: string, rule: string) =>
      `«${title}» تتكرر (${rule}). هل أتخطى هذا التكرار فقط، أم أوقف السلسلة من هنا (مع إبقاء السابقة)، أم أحذف السلسلة كلها؟`,
    askEditScopeMany: (n: number) =>
      `${tasksSubject(n)} من هذه تتكرر. هل يُطبَّق التغيير على التكرارات الحالية فقط، أم على التالية أيضًا؟`,
    askDeleteScopeMany: (n: number) =>
      `${tasksSubject(n)} من هذه تتكرر. هل أتخطى التكرارات الحالية فقط، أم أحذف السلسلة كلها؟`,
    listHeader: (n: number) => (n === 1 ? "مهمة واحدة مطابقة:" : `${tasksSubject(n)} مطابقة:`),
    repeatingUpdateNote: "في المهام المتكررة، يتغير التكرار الحالي فقط.",
    repeatingDeleteNote: "المهام المتكررة بينها ستتوقف عن التكرار.",
    listEmpty: "لا توجد مهام مطابقة.",
    listMore: (n: number) => `…و${counted(n, "مهمة أخرى", "مهام أخرى", "مهمتان أخريان")}.`,
    completedOn: (when: string) => `أُنجزت في ${when}`,
    dueOn: (when: string) => `موعدها ${when}`,
    overdueSince: (when: string) => `متأخرة منذ ${when}`,
    dateUnclear: (phrase: string) =>
      `لم أتمكن من معرفة التاريخ المقصود بـ«${phrase}»، لذلك لم أُضف شيئًا بعد. أي يوم هو؟ (مثلًا «4 مارس».)`,
    archived: (title: string) => `تمت أرشفة «${title}».`,
    restored: (title: string) => `تمت استعادة «${title}» — عادت إلى قائمتك.`,
  },

  settings: {
    title: "الإعدادات",
    subtitle: "خصّص تجربتك",

    account: "الحساب",
    signOut: "تسجيل الخروج",
    signingOut: "جارٍ تسجيل الخروج…",
    signOutCleanupError: "تم تسجيل الخروج، لكن تنظيف البيانات المحلية يحتاج إلى مراجعة.",
    signOutError: "تعذّر تسجيل الخروج. أعد المحاولة.",
    unsavedTasksTitle: "بعض المهام لم تُحفظ بعد",
    unsavedTasksBody: (count: number) =>
      `${count === 1 ? "مهمة واحدة لم تصل" : `${count} مهام لم تصل`} إلى حسابك بعد — تحقّق من اتصالك. إذا سجّلت الخروج الآن فستبقى آمنة على هذا الهاتف وتُحفظ عند تسجيل دخولك التالي هنا، لكنها لن تظهر على أجهزتك الأخرى حتى ذلك الحين.`,
    signOutAnyway: "تسجيل الخروج على أي حال",

    plan: "خطتك",
    upgrade: "الترقية إلى نكسدو برو",
    upgradeBody: "شهريًا أو سنويًا — يمكنك الإلغاء في أي وقت.",
    restorePurchases: "استعادة المشتريات",
    restoring: "جارٍ الاستعادة…",
    restoreDone: "عاد نكسدو برو إلى هذا الحساب.",
    restoreNothing: "لم يُعثر على أي شراء لنكسدو برو في حساب المتجر على هذا الهاتف.",
    restoreOffline: "أنت غير متصل. اتصل بالإنترنت وأعد المحاولة.",
    restoreError: "تعذّرت استعادة المشتريات. أعد المحاولة.",
    manageSubscription: "إدارة الاشتراك",
    manageError: "تعذّر فتح اشتراكك. أعد المحاولة.",
    proActive: "نكسدو برو مفعّل.",
    proRenews: (date: string) => `نكسدو برو · يتجدّد في ${date}`,
    proEnds: (date: string) => `نكسدو برو · ينتهي في ${date}`,

    notifications: "الإشعارات",
    dailyNudge: "تخطيط اليوم",
    dailyNudgeBody: "ملاحظة واحدة كل يوم: ما المستحق ومن أين تبدأ. منفصلة عن تذكيرات المواعيد.",
    nudgeTime: "ذكّرني عند",
    overdueAlerts: "تنبيهات المهام المتأخرة",
    overdueAlertsBody: "تنبيه فور تجاوز مهمة ذات وقت محدد موعدها النهائي.",
    notificationsNote: "تُجدول التذكيرات على هذا الهاتف. المهمة التي لا موعد لها لا تصلها أي تذكيرات.",
    notificationsBlockedTitle: "الإشعارات متوقفة",
    notificationsBlockedBody: "اسمح لـ Nexdo بإرسال الإشعارات من إعدادات هاتفك لتصلك التذكيرات.",
    openPhoneSettings: "فتح الإعدادات",
    deadlineReminders: "تذكيرات المواعيد",
    deadlineRemindersBody: "في يوم استحقاق المهمة. المهمة التي لا وقت محدد لها يُذكَّر بها في الوقت أدناه.",
    reminderTime: "وقت التذكير",
    beforeDeadline: "وأيضًا قبل وقت محدد",
    offsetChip: (minutes: number) =>
      minutes < 60 ? `${minutes} د` : minutes < 1440 ? counted(minutes / 60, "ساعة", "ساعات", "ساعتان") : counted(minutes / 1440, "يوم", "أيام", "يومان"),
    importantReminder: "تذكير إضافي للأولوية العالية",
    importantReminderBody: "في اليوم السابق، في وقت التذكير.",
    notificationsDenied: "إشعارات Nexdo متوقفة في إعدادات الهاتف، لذلك لا يمكن أن يصل أي تذكير.",

    language: "اللغة",

    support: "المساعدة والدعم",
    help: "الأسئلة الشائعة / المساعدة",
    helpBody: "إجابات الأسئلة الشائعة، أو تواصل معنا.",
    tour: "جولة في التطبيق",
    tourBody: "نظرة سريعة على نكسدو.",
    sendFeedback: "إرسال ملاحظات",
    privacy: "سياسة الخصوصية",
    terms: "شروط الاستخدام",
    version: (version: string) => `نكسدو الإصدار ${version}`,
    linkError: "تعذّر فتح هذا الرابط. أعد المحاولة.",
  },

  plan: {
    meters: {
      chat: "ملاحظات السياق للذكاء الاصطناعي",
      media: "الصور والمستندات",
      voice: "الملاحظات الصوتية",
      live: "الميكروفون السحري",
      assist: "التقسيمات والنصائح",
    },
    minutes: (count: number) => `${count} د`,
    used: {
      chat: "استخدمت ملاحظات السياق للذكاء الاصطناعي لهذا الشهر.",
      media: "استخدمت الصور والمستندات المتاحة لهذا الشهر.",
      voice: "استخدمت دقائق الملاحظات الصوتية لهذا الشهر.",
      live: "استخدمت دقائق الميكروفون السحري لهذا الشهر.",
      assist: "استخدمت التقسيمات والنصائح المتاحة لهذا الشهر.",
    },
    liveProOnly: "الميكروفون السحري متاح مع نكسدو برو.",
    resets: "يتجدّد رصيدك في اليوم الأول من الشهر.",
    upgradeHint: "نكسدو برو يمنحك أكثر بكثير كل شهر — وإضافة المهام يدويًا مجانية دائمًا.",
    limitTitle: "بلغت الحد الشهري",
    thisMonth: "هذا الشهر",
    names: { free: "الخطة المجانية", pro: "نكسدو برو" },
    usedOf: (used: number, limit: string) => `${used} من ${limit}`,
    proOnly: "برو فقط",
  },

  paywall: {
    close: "إغلاق",
    title: "دع نكسدو يفكّر أكثر عنك.",
    subtitle: (taskCount: number) =>
      taskCount === 0
        ? "برو يمنح الذكاء الاصطناعي مساحة ليخطّط مهامك معك."
        : `رتّب نكسدو ${tasksObject(taskCount)} لك بالفعل. برو يمنح الذكاء الاصطناعي مساحة ليواصل التخطيط معك.`,
    yearly: "سنوي",
    monthly: "شهري",
    save: (percent: number) => `وفّر ${percent}%`,
    aMonth: (price: string) => `${price} شهريًا`,
    perMonth: "شهريًا",
    eachMonth: "كل شهر",
    free: "مجاني",
    pro: "برو",
    unlimitedNote: "إضافة المهام يدويًا وصفحة «اليوم» والتذكيرات غير محدودة في الخطتين.",
    startTrial: (count: number, unit: TrialUnit) => `ابدأ تجربة مجانية لمدة ${trialLength(count, unit)}`,
    subscribe: "اشترك في نكسدو برو",
    working: "لحظة…",
    trialTerms: (count: number, unit: TrialUnit, price: string, yearly: boolean) =>
      `مجانًا لمدة ${trialLength(count, unit)}، ثم ${price} ${yearly ? "سنويًا" : "شهريًا"}. يمكنك الإلغاء في أي وقت.`,
    terms: (price: string, yearly: boolean) => `${price} ${yearly ? "سنويًا" : "شهريًا"}، ويتجدّد حتى تلغيه.`,
    continueFree: "المتابعة بالخطة المجانية",
    restore: "استعادة المشتريات",
    termsLink: "الشروط",
    privacyLink: "الخصوصية",
    loading: "جارٍ تحميل الخطط…",
    loadError: "تعذّر تحميل الخطط. تحقّق من اتصالك وأعد المحاولة.",
    retry: "أعد المحاولة",
    purchaseError: "لم تكتمل عملية الشراء. أعد المحاولة.",
    purchasePending: "عملية الشراء بانتظار الموافقة. سيُفعَّل نكسدو برو فور تأكيدها.",
    offline: "أنت غير متصل. اتصل بالإنترنت وأعد المحاولة.",
    welcomeTitle: "أنت الآن على نكسدو برو",
    welcomeBody: "رصيدك الشهري الجديد جاهز.",
  },

  feedback: {
    title: "إرسال ملاحظات",
    subtitle: "ساعدنا على تحسين نكسدو.",
    typeLabel: "نوع الملاحظات",
    types: { suggestion: "اقتراح", bug: "خلل", general: "ملاحظات عامة", other: "أخرى" },
    messageLabel: "رسالتك",
    messagePlaceholder: "أخبرنا بما تريد…",
    messageRequired: "اكتب رسالة أولاً.",
    optional: "اختياري",
    screenshotLabel: "لقطة شاشة",
    addScreenshot: "إرفاق لقطة شاشة",
    screenshotAttached: "تم إرفاق لقطة الشاشة",
    viewScreenshot: "عرض لقطة الشاشة",
    removeScreenshot: "إزالة لقطة الشاشة",
    screenshotInvalid: "لا يمكن إرفاق هذه الصورة. اختر لقطة شاشة أو صورة أصغر من 5 ميغابايت.",
    screenshotError: "تعذّر رفع لقطة الشاشة. أعد المحاولة، أو أزلها وأرسل بدونها.",
    privacyNote: "تُرسل مع حسابك في نكسدو وإصدار التطبيق ونوع الهاتف، فلا حاجة لإضافة بريدك الإلكتروني.",
    submit: "إرسال الملاحظات",
    sending: "جارٍ الإرسال…",
    success: "شكراً لملاحظاتك.",
    successBody: "نقرأ كل رسالة، وهي تساعدنا في تحديد ما نصلحه ونبنيه بعد ذلك.",
    error: "تعذر إرسال ملاحظاتك. تحقق من اتصالك وحاول مجدداً.",
    rateLimited: "أرسلت ملاحظات كثيرة في وقت قصير. حاول مرة أخرى بعد قليل.",
  },

  notifications: {
    overdueTitle: (title: string) => `متأخرة: ${title}`,
    overdueBody: "انتهى موعدها النهائي للتو. اضغط لإنجازها أو لاختيار موعد جديد.",
    overdueChannel: "المهام المتأخرة",
    remindersChannel: "تذكيرات المهام",
    planningChannel: "تخطيط اليوم",
    completeAction: "تعليم كمنجزة",
    dueTodayTitle: (title: string) => `مستحقة اليوم: ${title}`,
    dueTodayBody: "بلا وقت محدد — أي وقت اليوم يناسب.",
    dueNowTitle: (title: string) => `حان وقتها: ${title}`,
    dueNowBody: (time: string) => `موعدها اليوم عند ${time}.`,
    dueInBody: (offset: string, time: string) => `مستحقة بعد ${offset}، عند ${time}.`,
    offsetLabel: (minutes: number) =>
      minutes < 60
        ? counted(minutes, "دقيقة", "دقائق", "دقيقتين")
        : minutes < 1440
          ? counted(Math.round(minutes / 60), "ساعة", "ساعات", "ساعتين")
          : counted(Math.round(minutes / 1440), "يوم", "أيام", "يومين"),
    dueTomorrowTitle: (title: string) => `مستحقة غدًا: ${title}`,
    dueTomorrowBody: "غدًا، بلا وقت محدد.",
    dueTomorrowAtBody: (time: string) => `مستحقة غدًا عند ${time}.`,
    dailyTitle: "خطّط ليومك",
    dailyDueBody: (count: number, top: string) =>
      `${tasksSubject(count)} مستحقة اليوم.${top ? ` ابدأ بـ«${top}».` : ""}`,
    dailyOpenBody: (count: number, top: string) =>
      `${tasksSubject(count)} مفتوحة.${top ? ` ابدأ بـ«${top}».` : ""}`,
    trialEndingTitle: "تنتهي تجربتك المجانية بعد يومين",
    trialEndingBody: (date: string) => `يبدأ نكسدو برو يوم ${date}. لا تريده؟ ألغِه قبل ذلك من الإعدادات.`,
  },

  profile: {
    addName: "أضف اسمك",
    editAccount: "تعديل حسابك",
  },

  account: {
    title: "الحساب",
    close: "إغلاق إعدادات الحساب",
    changePhoto: "تغيير صورة الملف الشخصي",
    photoHint: "JPG أو PNG أقل من 5 ميغابايت",
    photoError: "تعذّر تحديث صورتك. أعد المحاولة.",
    name: "الاسم",
    namePlaceholder: "اسمك",
    nameRequired: "أضف اسمك.",
    nameError: "تعذّر حفظ اسمك. أعد المحاولة.",
    saving: "جارٍ الحفظ…",
    saved: "تم الحفظ",
    email: "البريد الإلكتروني",
    noEmail: "لا يوجد بريد إلكتروني على هذا الحساب",
    changePassword: "تغيير كلمة المرور",
    currentPassword: "كلمة المرور الحالية",
    newPassword: "كلمة المرور الجديدة",
    confirmPassword: "تأكيد كلمة المرور الجديدة",
    passwordHint: "استخدم 8 أحرف على الأقل.",
    passwordMismatch: "كلمتا المرور غير متطابقتين.",
    passwordUpdated: "تم تحديث كلمة المرور.",
    passwordError: "تعذّر تغيير كلمة المرور. تحقق من كلمة المرور الحالية وأعد المحاولة.",
    savePassword: "حفظ كلمة المرور",
    deleteAccount: "حذف الحساب",
    deleteTitle: "حذف حسابك؟",
    deleteBody:
      "سيحذف هذا نهائيًا حساب نكسدو وكل ما فيه — كل مهمة وإعداد، على كل أجهزتك. لا يمكن التراجع عن ذلك.",
    deleteProNote:
      "حذف حسابك لا يلغي اشتراك نكسدو برو. ألغِه أولًا من اشتراكاتك في App Store أو Google Play، وإلا فسيستمر في التجدّد.",
    deleteConfirm: "حذف الحساب",
    deleting: "جارٍ الحذف…",
    deleteError: "تعذّر حذف حسابك. أعد المحاولة.",
    deletePartialError: "تعذّر إكمال حذف حسابك — حُذف جزء من بياناتك بالفعل، لكن الحساب ما زال موجودًا. أعد المحاولة لإكمال الحذف.",
  },

  onboarding: {
    next: "الخطوة التالية",
    getStarted: "لنبدأ",
    haveAccount: "لدي حساب بالفعل",
    stickyNotes: ["موعد طبيب الأسنان؟", "امتحان الأسبوع القادم", "التسوّق", "الرد على البريد"],
    headline: "كفى حيرة بشأن ما تفعله تاليًا.",
    body: "أفرغ كل ما يشغل بالك. ينظّمه نكسدو ويكتشف المواعيد النهائية ويخبرك بما يستحق انتباهك.",
    nextUp: "التالي",
    sampleTask: "إنهاء تقرير مختبر الكيمياء",
    dueTomorrow: "مستحقة غدًا",
  },

  onboardingSort: {
    headline: "كل ما يدور في رأسك.\nاسحبه ليصبح مرتّبًا.",
    body: "اسحب الخط إلى الأسفل — وشاهد الفوضى ترتّب نفسها في خطة.",
    head: "في رأسك",
    plan: "في خطتك",
    priority: { high: "عالية", medium: "متوسطة", low: "منخفضة" },
    dragHandle: "اسحب لترتيب مهامك",
  },

  onboardingGoals: {
    headline: "بصراحة، أيٌّ من هذه يشبهك؟",
    body: "اختر ما تشاء منها. لا أحد يحكم عليك هنا.",
    options: [
      "أنسى ما عليّ فعله",
      "لديّ الكثير في ذهني",
      "أجد صعوبة في ترتيب الأولويات",
      "أماطل في المهام الكبيرة",
      "لا أعرف من أين أبدأ",
      "أريد أن أكون أكثر تنظيمًا",
    ],
    continue: "متابعة",
  },

  onboardingDump: {
    eyebrow: "جرّبه بمهامك الحقيقية",
    headline: "ما الذي عليك إنجازه هذا الأسبوع؟",
    body: "**عدّد كل مهامك**، ولو بلا ترتيب. اكتبها، أو اضغط على الميكروفون وقُلها بصوتك.",
    placeholder: "إنهاء واجب الرياضيات قبل الجمعة\nمراسلة الأستاذ\nالتسوّق الليلة…",
    startRecording: "ابدأ التحدّث",
    stopRecording: "أوقف وفرّغ الكلام",
    transcribing: "جارٍ التفريغ…",
    organize: "نظّمها مع نكسدو",
    trialUsedHeadline: "لقد جرّبت الذكاء الاصطناعي في نكسدو من قبل",
    trialUsedBody: "التجربة المجانية **مرة واحدة لكل جهاز**. أنشئ حسابك لتحتفظ بمهامك وتواصل التنظيم بالذكاء الاصطناعي.",
    trialUsedCta: "متابعة",
  },

  onboardingAnalyzing: {
    headline: "نحوّل ذلك إلى خطة…",
    body: "يحلّل نكسدو التواريخ والمدد والترابطات والجهد الذهني.",
    steps: [
      "تحديد المهام المنفصلة في النص",
      "كشف المواعيد والنوافذ الزمنية",
      "تقدير الجهد الواقعي",
      "حساب درجات الأولوية والخطوة التالية",
    ],
  },

  onboardingPlan: {
    extracted: (count: number) => `${counted(count, "مهمة مستخرجة", "مهام مستخرجة", "مهمتان مستخرجتان")}`,
    headline: "ذهنك أصبح أوضح قليلًا.",
    body: "استخرج نكسدو مهامّ محدّدة، وحدّد المواعيد، وحسب المدد.",
    nothingFound: "لم يجد نكسدو ما يمكن فعله في ذلك. يمكنك إضافة المهام بنفسك بعد الإعداد.",
    score: (value: number) => `الدرجة ${value}`,
    next: "بماذا أبدأ؟",
  },

  onboardingFocus: {
    eyebrow: "محرّك القرار",
    headline: "إذن… بماذا تبدأ؟",
    body: "أنت لا ترتّب مهامك لتظلّ بعدها حائرًا من أين تبدأ. **نكسدو يتّخذ القرار.**",
    nextFocus: "التركيز التالي",
    urgency: (score: number) => `الإلحاح ${score} / 100`,
    advice: "نصيحة الذكاء الاصطناعي",
    thinking: "جارٍ تحضير نصيحة…",
    nothing: "لا شيء لتقرّره بعد. أضف مهمة بعد الإعداد وسيختار نكسدو لك.",
    next: "منطقي",
  },

  onboardingNotify: {
    headline: "تذكير واحد، في الوقت المناسب تمامًا.",
    body: "لا خمسين إشعارًا. فقط الإشعار الذي يبقيك على المسار.",
    sampleTime: "الآن",
    sampleBody: "واجب الكيمياء مطلوب غدًا. هل تريد أن تبدأ الآن؟",
    allow: "السماح بالإشعارات",
    notNow: "ليس الآن",
  },

  onboardingTrial: {
    headline: "إليك ما سيحدث بالضبط.",
    body: "بلا مفاجآت، وبلا تخمين لموعد الدفع.",
    today: "اليوم",
    day: (day: number) => `اليوم ${day}`,
    anytime: "في أي وقت",
    startTitle: "ابدأ تجربتك المجانية",
    startBody: "وصول كامل إلى نكسدو برو، دون أي رسوم.",
    remindTitle: "سنذكّرك",
    remindBody: "تنبيه قبل انتهاء التجربة بيومين — وقت كافٍ لتقرّر.",
    endTitle: "تنتهي التجربة",
    endBody: (price: string, yearly: boolean) =>
      `يُخصم ${price} ${yearly ? "سنويًا" : "شهريًا"} — أو ألغِ قبل ذلك ولن تدفع شيئًا.`,
    cancelTitle: "ألغِ في أي وقت",
    cancelBody: "مباشرةً من الإعدادات، بلا مكالمات ولا نماذج.",
    next: "متابعة",
  },

  onboardingPaywall: {
    headline: "إليك ما يتضمّنه الاشتراك.",
    body: "الخطة المجانية تغطّي الأساسيات، أما برو فيمنح ذكاء نكسدو مساحة أكبر بكثير، كل شهر:",
    bestValue: (percent: number) => `القيمة الأفضل · وفّر ${percent}%`,
    features: {
      chat: (count: number) => `${count} من ملاحظات السياق للذكاء الاصطناعي`,
      media: (count: number) => `${count} من الصور والمستندات`,
      voice: (minutes: number) => `${minutes} دقيقة من الملاحظات الصوتية`,
      live: (minutes: number) => `${minutes} دقيقة من الميكروفون السحري`,
      assist: (count: number) => `${count} من التقسيمات والنصائح`,
    },
  },

  auth: {
    welcomeBack: "أهلاً بعودتك.",
    signInSubtitle: "سجّل الدخول لتكمل من حيث توقفت.",
    email: "البريد الإلكتروني",
    password: "كلمة المرور",
    logIn: "تسجيل الدخول",
    continue: "متابعة",
    useCode: "استخدم رمز البريد الإلكتروني بدلاً من ذلك",
    continueWithEmail: "أو تابع بالبريد الإلكتروني",
    noAccount: "ليس لديك حساب؟",
    signUp: "إنشاء حساب",
    signUpButton: "إنشاء حساب",
    haveAccount: "لديك حساب بالفعل؟",
    terms: "بالمتابعة فإنك توافق على شروط نكسدو وسياسة الخصوصية.",
    invalidCode: "رمز غير صالح. أعد المحاولة.",
    sendCodeError: "تعذّر إرسال رمز التحقق. أعد المحاولة.",
    signUpTitle: "لا تفقد خطتك.",
    // Two takes the dual all the way through; every other count agrees in the
    // feminine singular, as non-human plurals do.
    signUpSubtitle: (count: number) =>
      count === 2
        ? "مهمتان مرتبتان وجاهزتان. أنشئ حسابًا لحفظهما والمتابعة."
        : `${counted(count, "مهمة", "مهام", "مهمتان")} مرتبة وجاهزة. أنشئ حسابًا لحفظها والمتابعة.`,
    signUpTitleNoPlan: "أنشئ حسابك.",
    signUpSubtitleNoPlan: "اجمع كل ما عليك فعله في مكان واحد، ودع نكسدو يخبرك بماذا تبدأ.",
    continueWithGoogle: "تابع باستخدام Google",
    continueWithApple: "تابع باستخدام Apple",
    checkEmail: "تحقق من بريدك الإلكتروني",
    codeSentTo: "أرسلنا رمزًا من 6 أرقام إلى",
    somethingWrong: "حدث خطأ ما. أعد المحاولة.",
    showPassword: "إظهار كلمة المرور",
    hidePassword: "إخفاء كلمة المرور",
  },
};
