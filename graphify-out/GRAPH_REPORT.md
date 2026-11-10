# Graph Report - nexdo-mobile  (2026-11-10)

## Corpus Check
- Large corpus: 471 files · ~501,067 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder.

## Summary
- 2569 nodes · 8468 edges · 142 communities (114 shown, 28 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 64 edges (avg confidence: 0.83)
- Token cost: 248,780 input · 9,000 output

## Community Hubs (Navigation)
- Account & Feedback Sheets
- Onboarding Goals & Paywall
- Sign-in & Sign-up
- Add Task Sheet
- Tab Layout & Magic Mic Overlay
- Task Sync & Notifications
- Task Cards & Focus Sounds
- Magic Mic Change Tracking
- Deadlines & Local Dates
- Insights & Focus Log
- Translations
- AI Route Responses
- Root Screens & Redirects
- Recurrence Rules
- Onboarding Plan & App Tour
- Tasks Tab List
- Task Details Screen
- Gemini Errors & Store Tests
- Date Phrase Parsing
- Inbox AI Classifier
- Task Operations
- Repeat Phrase Parsing
- Attachment Text Extraction
- App Config (app.json)
- Priority Scoring
- Intent Classification
- Server Plan Limits
- Calendar Tab
- Reminder Scheduling
- Expo Dependencies
- AI Consent
- Paywall & Plan Usage
- Live Voice Tools
- Task Reassessment Pipeline
- Live Voice Hook & Context
- Native Dependencies
- Gemini Client & Caching
- Settings Tab
- Anonymous Trial AI Limits
- Schedule Month/Week Views
- Break It Down AI
- Live Session Prompt
- Root Layout & Clerk
- API POST Handlers
- Gem Mascot Drawing
- RevenueCat Purchases
- Account Deletion & Daily AI Limits
- Live Voice Protocol
- Task Extraction
- Quick Add Parsing
- Reassessment Apply
- Free Trial Reminder
- Sound Assets
- Context Notes & Files
- Breakdown Context Sheet
- Planning & Step Spreading
- Focus Sound Generator Script
- Breakdown Checklist UI
- Focus Clock Face
- Lint & Dev Dependencies
- AGENTS
- GenerateAdvice
- Metro.config
- FocusSound
- UseSessionStore
- OperationMessages
- Push-server-env
- React-native
- Noop
- Button
- ReassessmentNotice
- CompletedOverlay
- DESIGN
- NEXDO PLACEMENT AUDIT
- Ru
- Fetch
- Ar
- LiveProtocol
- UseSettingsStore
- NEXDO AUDIT
- Package
- Posthog-self-driving-report
- Es
- DESIGN (2)
- AiTrial
- NEXDO AUDIT (2)
- Make-sounds
- LiveVoice.test
- AGENTS (2)
- NEXDO AUDIT (3)
- De
- UseAuthSync
- SessionPlan
- Tsconfig
- Alias-loader
- ParseDate
- NEXDO PLACEMENT AUDIT (2)
- React-native (2)
- AGENTS (3)
- NEXDO AUDIT (4)
- APP REVIEW NOTES
- LiveVoiceTools.test
- NEXDO PLACEMENT AUDIT (3)
- Openai
- Openai (2)
- Package (2)
- Openai (3)
- Openai (4)
- Openai (5)
- Openai (6)
- Openai (7)
- SoundWaves
- NEXDO AUDIT (5)
- Images
- Package (3)
- Async-storage
- Api-specs-context
- Execute-request
- Extract-endpoint-detail
- Extract-tag-endpoints
- Images.d
- Sounds.d
- Api-specs-context (2)
- Execute-request (2)
- Extract-endpoint-detail (2)
- Extract-tag-endpoints (2)
- NEXDO PLACEMENT AUDIT (4)
- Package (4)
- Package (5)
- Package (6)
- Package (7)
- Package (8)
- Package (9)
- Package (10)
- Package (11)

## God Nodes (most connected - your core abstractions)
1. `useTranslation()` - 153 edges
2. `AnimatedPressable()` - 130 edges
3. `react-native` - 109 edges
4. `useRtlText()` - 101 edges
5. `useTaskStore` - 93 edges
6. `useColors()` - 90 edges
7. `react` - 85 edges
8. `Task` - 62 edges
9. `TaskDetail()` - 53 edges
10. `toLocalDateKey()` - 49 edges

## Surprising Connections (you probably didn't know these)
- `Input Fields & Prompt Bars (voice, camera, submit)` --semantically_similar_to--> `P1-2 Tab-bar + Add button with capture sheet`  [INFERRED] [semantically similar]
  design-reference/stitch/DESIGN.md → NEXDO_PLACEMENT_AUDIT.md
- `SSOCallback()` --calls--> `useColors()`  [EXTRACTED]
  app/(auth)/sso-callback.tsx → hooks/useTheme.ts
- `TasksListScreen()` --indirect_call--> `isListed()`  [INFERRED]
  app/(tabs)/tasks.tsx → lib/taskOperations.ts
- `DurationDetail()` --indirect_call--> `pad()`  [INFERRED]
  components/addSheet/AddSheetDetails.tsx → lib/localDate.ts
- `AddTaskSheet()` --indirect_call--> `pickContextDocument()`  [INFERRED]
  components/addSheet/AddTaskSheet.tsx → lib/pickContextFile.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Store review compliance (consent, AI report, account-required answer, review account)** — nexdo_audit_p0_ai_consent, nexdo_audit_p0_report_ai_output, nexdo_audit_p1_account_required_review, app_review_notes_ai_consent, app_review_notes_review_account [INFERRED 0.85]
- **Server-side AI gating (API routes, Gemini, plan limits, RevenueCat)** — agents_api_routes, agents_gemini, nexdo_audit_plan_limits, agents_revenuecat, lib_serverplan [INFERRED 0.85]
- **Returning-user clarity (Reset my week, daily capacity, Today never empty)** — nexdo_audit_p1_reset_my_week, nexdo_audit_p1_daily_capacity, nexdo_audit_p1_today_empty, nexdo_audit_mental_clarity_positioning [INFERRED 0.75]
- **Capture flow redesign (+ button, capture sheet, voice/photo, stay on Today)** — nexdo_placement_audit_p1_1_stay_on_today, nexdo_placement_audit_p1_2_add_capture_sheet, nexdo_placement_audit_p1_3_voice_photo_capture, nexdo_placement_audit_p2_1_mic_returns [INFERRED 0.85]
- **Warm Focus palette roles** — design_reference_stitch_design_primary_color, design_reference_stitch_design_secondary_charcoal, design_reference_stitch_design_tertiary_sage, design_reference_stitch_design_neutral_canvas [EXTRACTED 1.00]
- **PostHog findings pipeline into Self-driving inbox** — posthog_self_driving_report_scout_troop, posthog_self_driving_report_replay_vision_scanners, posthog_self_driving_report_signal_sources, posthog_self_driving_report_self_driving_inbox [EXTRACTED 1.00]

## Communities (142 total, 28 thin omitted)

### Community 0 - "Account & Feedback Sheets"
Cohesion: 0.07
Nodes (46): SSOCallback(), Feedback(), FEEDBACK_TYPES, AccountSheet(), AccountSheetProps, ICONS, SheetIcon(), WHEEL_HEIGHT (+38 more)

### Community 1 - "Onboarding Goals & Paywall"
Cohesion: 0.09
Nodes (48): CARD_SHADOW, OnboardingFocus(), Goal, GoalRow(), GOALS, OnboardingGoals(), SCROLL_BLEED, SCROLL_CONTENT (+40 more)

### Community 2 - "Sign-in & Sign-up"
Cohesion: 0.10
Nodes (44): REVEAL_LAYOUT, SignIn(), styles, PLAN_DOTS, REVEAL_LAYOUT, SignUp(), sortByPriority(), styles (+36 more)

### Community 3 - "Add Task Sheet"
Cohesion: 0.08
Nodes (53): DateDetail(), dateValue(), DayCalendar(), defaultTime(), DetailCard(), DetailKey, DetailsList(), DURATION_SHORTCUTS (+45 more)

### Community 4 - "Tab Layout & Magic Mic Overlay"
Cohesion: 0.06
Nodes (48): TabsLayout(), GemMascot(), AppIconName, cardEntering, ENTER_EASING, Flight, FlightKind, FlyingCard() (+40 more)

### Community 5 - "Task Sync & Notifications"
Cohesion: 0.07
Nodes (51): analyzeTaskComplexity(), isUntouchedTemplatePlan(), clearAllNotifications(), normalizeRecurrence(), deadlineFromRow(), deleteTaskRow(), deleteTaskRows(), deleteTaskRowsIfUnchanged() (+43 more)

### Community 6 - "Task Cards & Focus Sounds"
Cohesion: 0.08
Nodes (45): FocusSoundPicker(), SOUND_ICON, SoundIcon(), AppIcon(), MicTaskCard(), CardBounds, CELEBRATION_MS, DonePill() (+37 more)

### Community 7 - "Magic Mic Change Tracking"
Cohesion: 0.08
Nodes (37): ShownTask, changedTaskIds(), discardSnapshots(), hasChanged(), MicChange, micChanges(), MicMark, Snapshot (+29 more)

### Community 8 - "Deadlines & Local Dates"
Cohesion: 0.09
Nodes (41): ReassessResponseBody, en, applyPickedDateTime(), deadlineFromDate(), deadlineFromInstant(), deadlineInstant(), deadlineOnThisPhone(), deviceTimeZone() (+33 more)

### Community 9 - "Insights & Focus Log"
Cohesion: 0.08
Nodes (45): bestStreak(), DARK_SHADOW, dayLevels(), DIAMOND, Eyebrow(), FocusChart(), Gem(), GEM_COLORS (+37 more)

### Community 10 - "Translations"
Cohesion: 0.06
Nodes (36): bn, SHIFT_UNITS, ShiftUnit, TRIAL_UNITS, fr, plural(), SCOPE_ADJECTIVES, shiftLength() (+28 more)

### Community 11 - "AI Route Responses"
Cohesion: 0.13
Nodes (44): parseBody(), parseBody(), fallbackResponse(), normalizeResponse(), POST(), RESPONSE_SCHEMA, cleanText(), deadlineLanguageNote() (+36 more)

### Community 12 - "Root Screens & Redirects"
Cohesion: 0.09
Nodes (31): Add(), AuthLayout(), centerOf(), EmptyStateButton(), FocusCardState, FocusCardTransition(), Next(), reachFrom() (+23 more)

### Community 13 - "Recurrence Rules"
Cohesion: 0.10
Nodes (40): FREQUENCIES, WEEK_ORDER, dayNumber(), keyParts(), anchorRuleOnOrAfter(), buildNextOccurrence(), buildOccurrence(), buildRule() (+32 more)

### Community 14 - "Onboarding Plan & App Tour"
Cohesion: 0.08
Nodes (37): AnalyzingMark(), AnalyzingStep(), AnimatedPath, OnboardingAnalyzing(), OnboardingPlan(), PlanCard(), SCROLL_BLEED, SCROLL_CONTENT (+29 more)

### Community 15 - "Tasks Tab List"
Cohesion: 0.08
Nodes (37): compareBySort(), COUNT_IN, COUNT_OUT, LANDED_EDGE, REST_SLIDE, RollingCount(), SORT_VALUES, sortTasks() (+29 more)

### Community 16 - "Task Details Screen"
Cohesion: 0.11
Nodes (38): chooseScope(), dayLabel(), POSTPONE_OPTIONS, postponeDeadline(), ruleToInput(), TaskDetail(), Chip(), MetaPill() (+30 more)

### Community 17 - "Gemini Errors & Store Tests"
Cohesion: 0.06
Nodes (12): InboxRequestBody, GeminiTimeoutError, apiCalls, apiPost(), Handler, handler(), fakeDb, Filter (+4 more)

### Community 18 - "Date Phrase Parsing"
Cohesion: 0.07
Nodes (39): addDays(), calendarDay(), COUNT_WORDS, DATE_WORD_PATTERN, DateRange, dayEnd(), dayStart(), extractTimeOfDay() (+31 more)

### Community 19 - "Inbox AI Classifier"
Cohesion: 0.08
Nodes (37): ACTION_SCHEMA, ACTION_TYPE_ENUM, AskModel, classifyFragmentsIndependently(), classifyOneInstruction(), fallbackResponse(), FILTER_SCHEMA, finiteNumber() (+29 more)

### Community 20 - "Task Operations"
Cohesion: 0.11
Nodes (38): DateShift, resolveDeadlineInput(), openOccurrence(), seriesOccurrences(), addMonths(), archiveTaskDelta(), clampMinutes(), COMPLETED_RETENTION_DAYS (+30 more)

### Community 21 - "Repeat Phrase Parsing"
Cohesion: 0.06
Nodes (29): compiled, DE_UNIT, EN_LIST, EN_UNIT, english, ES_LIST, ES_UNIT, findRepeat() (+21 more)

### Community 22 - "Attachment Text Extraction"
Cohesion: 0.09
Nodes (27): ExtractTextRequestBody, ExtractTextResponseBody, BLOCK_LABEL, ExtractedAttachment, DEFAULT_MIME_TYPE, extractAttachmentsText(), extractAttachmentText(), extractionKind() (+19 more)

### Community 23 - "App Config (app.json)"
Cohesion: 0.05
Nodes (36): backgroundColor, foregroundImage, monochromeImage, adaptiveIcon, blockedPermissions, package, predictiveBackGestureEnabled, softwareKeyboardLayoutMode (+28 more)

### Community 24 - "Priority Scoring"
Cohesion: 0.10
Nodes (32): clamp(), computeScore(), daysUntil(), EFFORT_CURVE, effortScore(), importanceScore(), onCurve(), PRIORITY_WEIGHTS (+24 more)

### Community 25 - "Intent Classification"
Cohesion: 0.10
Nodes (34): InboxResponseBody, stripAttachmentBlocks(), askAboutDate(), askWhich(), buildAliases(), buildChanges(), BULK_KIND, bulkTarget() (+26 more)

### Community 26 - "Server Plan Limits"
Cohesion: 0.12
Nodes (29): POST(), UsageResponseBody, PLAN_HEADER, PlanLimitBody, PRO_ENTITLEMENT, asRecord(), checkPlan(), checkPlanAllowance() (+21 more)

### Community 27 - "Calendar Tab"
Cohesion: 0.15
Nodes (27): CalendarTab(), ModePills(), plansBetween(), ScheduleMode, weekRange(), longDay(), ScheduleMonth(), capitalize() (+19 more)

### Community 28 - "Reminder Scheduling"
Cohesion: 0.10
Nodes (31): handleTap(), preferencesKey(), reconcileNow(), reminderKey(), useNotifications(), whenTasksLoaded(), CHANNEL_IDS, COMPLETE_ACTION_ID (+23 more)

### Community 29 - "Expo Dependencies"
Cohesion: 0.06
Nodes (32): dependencies, @clerk/expo@^4.14.2, expo-asset@~58.0.18, expo-audio@~58.0.10, expo-blur@~58.0.5, expo-haptics@~58.0.7, expo-linking@~58.0.14, expo-notifications@~58.1.6 (+24 more)

### Community 30 - "AI Consent"
Cohesion: 0.12
Nodes (25): LiveUsageRequestBody, AiConsentError, hasAiConsent(), Answer, ask(), requestAiConsent(), AI_PATHS, apiPost() (+17 more)

### Community 31 - "Paywall & Plan Usage"
Cohesion: 0.15
Nodes (23): CENTERED_RTL, CompareRow(), FOOTER_SHADOW, Paywall(), PaywallScreen(), PlanUsage(), PaywallReason, PRO_EXTRAS (+15 more)

### Community 32 - "Live Voice Tools"
Cohesion: 0.11
Nodes (29): InboxAction, InboxActionType, InboxFilter, InboxRecurrence, BULK_TYPES, callKey(), capture(), createLiveToolRunner() (+21 more)

### Community 33 - "Task Reassessment Pipeline"
Cohesion: 0.09
Nodes (19): ReassessRequestBody, ReassessmentChange, recalcAll(), ReassessState, at(), Case, CASES, changedFields() (+11 more)

### Community 34 - "Live Voice Hook & Context"
Cohesion: 0.14
Nodes (24): LiveSessionRequestBody, useLiveVoice(), completedLabelFor(), describeNow(), selectRelevantTasks(), significantWords(), startOfDay(), taskToContext() (+16 more)

### Community 35 - "Native Dependencies"
Cohesion: 0.07
Nodes (27): expo-auth-session@~58.0.15, expo-constants@~58.0.13, expo-dev-client@~58.0.16, expo-document-picker@~58.0.4, expo-symbols@~58.0.4, expo-web-browser@~58.0.7, react-native-purchases-ui@^10.10.2, react-native-screens@~4.30.0 (+19 more)

### Community 36 - "Gemini Client & Caching"
Cohesion: 0.15
Nodes (25): acquirePromptCache(), cacheDisplayName(), cacheRequest(), cacheUnavailableUntil, callGemini(), createLiveSessionToken(), fetchBefore(), findPromptCache() (+17 more)

### Community 37 - "Settings Tab"
Cohesion: 0.13
Nodes (24): CARD_METERS, dateToTime(), daysToReset(), Eyebrow(), initials(), LeadSlider(), MiniSwitch(), NotificationRow() (+16 more)

### Community 38 - "Anonymous Trial AI Limits"
Cohesion: 0.13
Nodes (22): ALLOWED_MIME_TYPES, contextInstruction(), DESCRIPTION_LANGUAGE, estimatedVoiceSeconds(), focusNote(), INSTRUCTIONS, KINDS, MAX_BYTES_PER_SECOND (+14 more)

### Community 39 - "Schedule Month/Week Views"
Cohesion: 0.16
Nodes (22): BUSY_COUNT, BUSY_FILL, busyLevel(), KEY_FILLS, MonthRow(), WEEK_ORDER, CARD_SHADOW, DARK_CARD_SHADOW (+14 more)

### Community 40 - "Break It Down AI"
Cohesion: 0.12
Nodes (18): BreakdownRequestBody, BreakdownResponseBody, BreakdownStatus, useTaskAiAssist(), withWaitingNote(), createSubtaskId(), generatePlan(), SPLIT_RATIOS (+10 more)

### Community 41 - "Live Session Prompt"
Cohesion: 0.11
Nodes (20): DELETE_SCOPE, DETAILS, FILTER, FUNCTIONS, liveSetup(), MINUTES_DELTA, REPEAT, SHIFT (+12 more)

### Community 42 - "Root Layout & Clerk"
Cohesion: 0.10
Nodes (20): AccountSetup(), AccountSync(), RootLayout(), unstable_settings, publishableKey, resourceCache, watchCompletions(), configureNotifications() (+12 more)

### Community 43 - "API POST Handlers"
Cohesion: 0.23
Nodes (19): normalizeSteps(), POST(), RESPONSE_SCHEMA, POST(), POST(), POST(), POST(), GeminiJsonSchema (+11 more)

### Community 44 - "Gem Mascot Drawing"
Cohesion: 0.12
Nodes (20): AnimatedCircle, AnimatedEllipse, AnimatedPath, BRONZE, Facets, FlashGlow(), FRAMES, GemArt() (+12 more)

### Community 45 - "RevenueCat Purchases"
Cohesion: 0.18
Nodes (21): setTrialReminder(), configure(), enqueue(), errorCode(), identifyPurchaser(), isOffline(), isTestStore, loadProPlans() (+13 more)

### Community 46 - "Account Deletion & Daily AI Limits"
Cohesion: 0.20
Nodes (17): DeleteAccountErrorBody, DeleteAccountResponseBody, POST(), AiRoute, claimUserCall(), DAILY_LIMITS, deleteAccountData(), deleteClerkUser() (+9 more)

### Community 47 - "Live Voice Protocol"
Cohesion: 0.12
Nodes (17): LiveSessionResponseBody, LiveEvent, CONNECT_TIMEOUT_MS, INITIAL_STATE, LiveAudioBuffer, LiveVoice, LiveVoiceDeps, LiveVoiceProblem (+9 more)

### Community 48 - "Task Extraction"
Cohesion: 0.16
Nodes (17): fillMissingTaskFields(), isTaskPriority(), cleanTitle(), CLOCK, createCandidateId(), DATE_PHRASE_PATTERN, DURATION_WORDS, extractTasks() (+9 more)

### Community 49 - "Quick Add Parsing"
Cohesion: 0.14
Nodes (18): ParsedDeadline, bare(), DATE_CONNECTORS, DATE_TRAILERS, DURATION_CONNECTORS, escapeForRegExp(), locatePhrases(), markedPhrases() (+10 more)

### Community 50 - "Reassessment Apply"
Cohesion: 0.23
Nodes (19): ProposedStep, ReassessmentUpdate, deadlineOf(), sameDeadline(), applyReassessment(), byOrder(), describeReassessment(), describeSubtaskChanges() (+11 more)

### Community 51 - "Free Trial Reminder"
Cohesion: 0.14
Nodes (12): asTrial(), FreeTrial, storeTrial(), TRIAL_UNITS, TRIAL_REMINDER_LEAD_DAYS, trialLengthInDays(), trialReminderDay(), trialReminderTime() (+4 more)

### Community 52 - "Sound Assets"
Cohesion: 0.11
Nodes (5): sounds, playerFor(), players, SoundName, SOURCES

### Community 53 - "Context Notes & Files"
Cohesion: 0.20
Nodes (16): ContextSubmission, capContextNotes(), composeFileNote(), ContextFileKind, MARKERS, MAX_CONTEXT_NOTE_LENGTH, MAX_CONTEXT_NOTES_TOTAL, MAX_FILE_TEXT_LENGTH (+8 more)

### Community 54 - "Breakdown Context Sheet"
Cohesion: 0.25
Nodes (14): BottomSheet(), BreakdownContextSheet(), Phase, ContextComposer(), showPlanLimit(), checked(), DOCUMENT_TYPES, IMAGE_TYPES (+6 more)

### Community 55 - "Planning & Step Spreading"
Cohesion: 0.17
Nodes (16): daysBetweenKeys(), LocalDate, ordered(), PlanSummary, spreadSteps(), StepSuggestion, summarizePlan(), isActionable() (+8 more)

### Community 56 - "Focus Sound Generator Script"
Cohesion: 0.16
Nodes (12): biquad(), bird(), burst(), drawRain(), mixAtPeak(), OUT, peakOf(), pole() (+4 more)

### Community 57 - "Breakdown Checklist UI"
Cohesion: 0.26
Nodes (13): AddItemField(), BreakdownSheet(), draftOf(), newStepId(), withNewSteps(), IconButton(), PrimaryButton(), ChecklistRow() (+5 more)

### Community 58 - "Focus Clock Face"
Cohesion: 0.17
Nodes (15): AnimatedCircle, AnimatedPath, CONF_EASE, CONFETTI, ConfettiPiece(), EASE, EASE_IN_OUT, EASE_OUT (+7 more)

### Community 59 - "Lint & Dev Dependencies"
Cohesion: 0.13
Nodes (15): { defineConfig }, expoConfig, devDependencies, eslint@^9.25.0, eslint-config-expo@~58.0.4, @expo/ngrok@^4.1.0, @tailwindcss/postcss@^4.3.3, @types/react@~19.3.0 (+7 more)

### Community 60 - "AGENTS"
Cohesion: 0.15
Nodes (8): AGENTS.md (agent instructions), Folder architecture (app, components, constants, data, hooks, lib, store, types, assets), Validation: npm run lint / typecheck / test, Nexdo AI task management app (teaching project), CLAUDE.md (imports AGENTS.md), P2-18 Dark mode / Appearance setting, P2-14 Lint error: ref written during render (ContextNoteCard), P3-1 Dead code from old AI chat

### Community 61 - "GenerateAdvice"
Cohesion: 0.23
Nodes (11): NextRequestBody, NextResponseBody, adviceCache, cacheAdvice(), escapeAdviceText(), generateAdvice(), generateAdviceHeuristic(), offlineAdvice() (+3 more)

### Community 62 - "Metro.config"
Cohesion: 0.15
Nodes (10): config, { getDefaultConfig }, nativewindConfig, path, reactNativeShim, { withNativewind }, expo@~58.0.20, nativewind@5.0.0-preview.4 (+2 more)

### Community 63 - "FocusSound"
Cohesion: 0.24
Nodes (11): useFocusSound(), fadeTo(), FOCUS_SOUNDS, FocusSoundName, playFocusSound(), Playing, SOURCES, stop() (+3 more)

### Community 64 - "UseSessionStore"
Cohesion: 0.29
Nodes (8): useSessionAlarm(), logEndedSession(), setSessionEndReminder(), isRecording(), logEnd(), sessionElapsedMs(), SessionStore, useSessionStore

### Community 65 - "OperationMessages"
Cohesion: 0.27
Nodes (12): describeConfirmation(), describeOperationResult(), describeTaskList(), formatWhen(), nextPart(), previewTitles(), single(), when() (+4 more)

### Community 66 - "Push-server-env"
Cohesion: 0.17
Nodes (10): buildNames, env, envValue(), file, folder, lastLine, lines, only (+2 more)

### Community 67 - "React-native"
Cohesion: 0.17
Nodes (9): browser, Alert, alertCalls, Appearance, I18nManager, listeners, NativeModules, Platform (+1 more)

### Community 68 - "Noop"
Cohesion: 0.17
Nodes (5): extractAttachmentText(), FileReader, posthog, readFile(), setFileReader()

### Community 69 - "Button"
Cohesion: 0.29
Nodes (9): ButtonProps, FeatherIconName, ICON_BUTTONS, SIZES, TEXT_TONES, TextButton(), FormSection(), SectionAction (+1 more)

### Community 70 - "ReassessmentNotice"
Cohesion: 0.29
Nodes (11): SecondaryButton(), changeLines(), Copy, Line(), noteLine(), NoticeCard(), QuotedNote(), ReassessmentNotice() (+3 more)

### Community 71 - "CompletedOverlay"
Cohesion: 0.21
Nodes (11): AnimatedPath, CompletedOverlay(), CONFETTI, Confetti(), CONFETTI_COLORS, ConfettiPiece, DISC_SPRING, OverlayOrigin (+3 more)

### Community 72 - "DESIGN"
Cohesion: 0.17
Nodes (9): Warm Focus Design System (Stitch DESIGN.md), Elevation via tonal nesting and warm ambient shadows, Layout & Spacing (44x44 touch targets), Input Fields & Prompt Bars (voice, camera, submit), Shapes (rounded cards, pill elements, 6px checkboxes), Typography (DM Sans headlines, Plus Jakarta Sans body), Free vs Pro placement, Magic Mic (live voice) (+1 more)

### Community 73 - "NEXDO PLACEMENT AUDIT"
Cohesion: 0.17
Nodes (6): Add Task Modal, Current Navigation Tree, Schedule Screen, Settings Screen, Task Details Screen, Tasks Screen

### Community 74 - "Ru"
Cohesion: 0.29
Nodes (10): daysWord(), hoursWord(), plural(), ru, ShiftUnit, shiftUnit(), tasks(), tasksAcc() (+2 more)

### Community 75 - "Fetch"
Cohesion: 0.31
Nodes (7): CACHE_DIRECTORY, fetchCached(), getExpires(), hashUrl(), loadCacheEntry(), parseMaxAge(), saveCacheEntry()

### Community 76 - "Ar"
Cohesion: 0.29
Nodes (8): ar, counted(), SCOPE_ADJECTIVES, shiftLength(), ShiftUnit, tasksObject(), tasksSubject(), trialLength()

### Community 77 - "LiveProtocol"
Cohesion: 0.47
Nodes (8): asRecord(), audioLevel(), decodeUtf8(), encodeBase64(), parseServerMessage(), toMonoPcm16(), toolCallOf(), createLiveVoice()

### Community 78 - "UseSettingsStore"
Cohesion: 0.24
Nodes (8): ReminderPreferences, APP_LANGUAGES, deviceLanguage(), languageFromLocale(), phoneLocales(), SettingsStore, FOCUS_SOUND_CHOICES, ThemePreference

### Community 79 - "NEXDO AUDIT"
Cohesion: 0.20
Nodes (9): P1-4 Daily capacity check, P1-8 Daily planning nudge on by default, P1-7 Shorten onboarding (remove Sort, replace Goals), P1-1 Overdue card + Reset my week, P2-3 Completed tasks deleted after 7 days, P2-1 Pro perks at $0 AI cost, P3-6 Focus time memory / streaks, P3-8 Home-screen 'Your next task' widget (+1 more)

### Community 80 - "Package"
Cohesion: 0.20
Nodes (10): scripts, android, deploy:server, eval:reassess, ios, lint, start, test (+2 more)

### Community 81 - "Posthog-self-driving-report"
Cohesion: 0.24
Nodes (10): PostHog Self-driving Setup Report, Error Tracking, PostHog Follow-ups, GitHub Issues responder (dormant), Replay Vision Scanners (onboarding breakage, task-flow frustration), Scout Troop (3 of 27 enabled), PostHog Self-driving Inbox, Session Replay (+2 more)

### Community 82 - "Es"
Cohesion: 0.28
Nodes (7): es, plural(), SCOPE_ADJECTIVES, shiftLength(), ShiftUnit, TRIAL_UNITS, trialLength()

### Community 83 - "DESIGN (2)"
Cohesion: 0.25
Nodes (9): Buttons (Primary terracotta, Charcoal AI, Ghost), Material-style Color Tokens, Neutral Cream Canvas #F4EFE6, Primary Burnt Terracotta #A83301, Secondary Obsidian Charcoal #1D1A18, Selector Chips & Time Pills, Subtask Items & Checkboxes, Task & Session Cards (+1 more)

### Community 84 - "AiTrial"
Cohesion: 0.42
Nodes (8): createTrialId(), getTrialId(), isTrialRecord(), isTrialUsed(), loadRecord(), markTrialUsed(), saveRecord(), TrialRecord

### Community 85 - "NEXDO AUDIT (2)"
Cohesion: 0.22
Nodes (9): Nexdo Full App Audit (2026-10-12), P0-2 Focus timer silent when phone locked, P0-5 iPad support off (supportsTablet false), P1-9 Follow the phone's language, P1-11 Build releases from a tagged commit, P1-2 Today empty on day one (Up next fallback), P2-9..11 Accessibility: contrast, touch targets, large text, P2-2 Replace raw scores with 'Why first' reason (+1 more)

### Community 86 - "Make-sounds"
Cohesion: 0.22
Nodes (4): BELL, MARIMBA, note(), OUT

### Community 87 - "LiveVoice.test"
Cohesion: 0.25
Nodes (4): FakeSocket, flush(), listening(), setup()

### Community 88 - "AGENTS (2)"
Cohesion: 0.29
Nodes (8): Expo Router API routes on EAS Hosting, Gemini AI (server-only), PostHog analytics, Server-only libs (lib/server*.ts, lib/ai/gemini.ts), Tech stack (Expo, RN, TS, Expo Router, NativeWind, Zustand, AsyncStorage), Zustand stores with AsyncStorage persist, README.md (Expo starter readme), Expo file-based routing / create-expo-app

### Community 89 - "NEXDO AUDIT (3)"
Cohesion: 0.25
Nodes (8): RevenueCat (Nexdo Pro subscriptions), Free = no AI; Pro = AI features with monthly allowances, Break it down (AI task breakdown), Magic mic (Live voice), P0-4 Manage subscription fallback, P1-5 Breakdown/advice hidden in running session, P1-10 Undo for complete/delete (restoreSnapshots), P2-15 Failed payment / expired Pro messaging

### Community 90 - "De"
Cohesion: 0.32
Nodes (7): de, plural(), SCOPE_ADJECTIVES, shiftLength(), ShiftUnit, TRIAL_UNITS, trialLength()

### Community 91 - "UseAuthSync"
Cohesion: 0.43
Nodes (7): claimOnboardingDrafts(), isNewAccount(), RETRY_DELAYS_MS, useAuthSync(), setApiTokenGetter(), setClerkTokenGetter(), waitForOnboardingHydration()

### Community 92 - "SessionPlan"
Cohesion: 0.29
Nodes (6): buildSessionPlan(), COMPLEXITY_WEIGHT, ENERGY_LEVELS, EnergyLevel, orderForEnergy(), TIME_OPTIONS

### Community 93 - "Tsconfig"
Cohesion: 0.25
Nodes (7): expo/tsconfig.base, compilerOptions, paths, strict, exclude, extends, include

### Community 94 - "Alias-loader"
Cohesion: 0.29
Nodes (5): EXTENSIONS, findFile(), resolve(), root, STUBS

### Community 95 - "ParseDate"
Cohesion: 0.43
Nodes (7): resolveDeadline(), hasExplicitTime(), isAmbiguousDate(), looksLikeDate(), normalizeDatePhrase(), parseDeadlinePhrase(), readNumericDate()

### Community 96 - "NEXDO PLACEMENT AUDIT (2)"
Cohesion: 0.29
Nodes (5): Daily Capacity Check (not built), Focus Session, Reset My Week, Today Screen, Custom Scout Candidates (onboarding conversion, next-task acceptance)

### Community 97 - "React-native (2)"
Cohesion: 0.29
Nodes (5): react-native-css@3.1.0-rc.0, react-native-css, css, merged, reactNative

### Community 98 - "AGENTS (3)"
Cohesion: 0.33
Nodes (6): Clerk authentication, Supabase database, storage and realtime sync, supabase/schema.sql + migrations (ask before schema changes), P0-3 Blank screen when offline (Clerk not loaded), P2-4 / P2-5 Loading skeleton and splash until Clerk ready, P3-3 Settings per account, not per phone

### Community 99 - "NEXDO AUDIT (4)"
Cohesion: 0.33
Nodes (5): AI consent prompt ("Use AI with Nexdo?") + Report link, P0-1 AI consent before sending data to Gemini, P0-6 Report bad AI output (Google Play policy), P2-16 Data export (Law 25), Quebec Law 25

### Community 100 - "APP REVIEW NOTES"
Cohesion: 0.40
Nodes (5): App Review notes (App Store / Play), In-app and web account deletion, Microphone / camera / photos permissions (asked on first use), Review account nexdo.review@gmail.com (password sign-in), P1-12 Prepare 'account required' review answer

### Community 101 - "LiveVoiceTools.test"
Cohesion: 0.40
Nodes (4): LiveToolCall, byTitle(), tasks(), withGym()

### Community 102 - "NEXDO PLACEMENT AUDIT (3)"
Cohesion: 0.33
Nodes (6): Nexdo Placement Audit (2026-10-12), NEXDO_AUDIT.md, Proposed Navigation Map, Open Questions for User, Scorecard: 11 Placement Checks, Taps to Each Main Feature

### Community 103 - "Openai"
Cohesion: 0.40
Nodes (4): interface, default_prompt, display_name, short_description

### Community 104 - "Openai (2)"
Cohesion: 0.40
Nodes (4): interface, default_prompt, display_name, short_description

### Community 105 - "Package (2)"
Cohesion: 0.40
Nodes (4): name, private, type, version

### Community 106 - "Openai (3)"
Cohesion: 0.40
Nodes (4): interface, default_prompt, display_name, short_description

### Community 107 - "Openai (4)"
Cohesion: 0.40
Nodes (4): interface, default_prompt, display_name, short_description

### Community 108 - "Openai (5)"
Cohesion: 0.40
Nodes (4): interface, default_prompt, display_name, short_description

### Community 109 - "Openai (6)"
Cohesion: 0.40
Nodes (4): interface, default_prompt, display_name, short_description

### Community 110 - "Openai (7)"
Cohesion: 0.40
Nodes (4): interface, default_prompt, display_name, short_description

### Community 111 - "SoundWaves"
Cohesion: 0.50
Nodes (4): BAR_WEIGHTS, SOUND_WAVES_WIDTH, SoundWaves(), WaveBar()

### Community 112 - "NEXDO AUDIT (5)"
Cohesion: 0.50
Nodes (5): AI routes: inbox, extract-text, next, breakdown, reassess, live-session, usage, App map: navigation, onboarding (11 screens), data, AI routes, P1-6 'x left' usage counters before running out, P1-3 Typed AI quick add after onboarding, Server-side plan limits with refunds (lib/plan.ts)

### Community 114 - "Package (3)"
Cohesion: 0.67
Nodes (3): overrides, lightningcss, react-native-css

## Knowledge Gaps
- **51 isolated node(s):** `expo/tsconfig.base`, `PostHog analytics`, `Folder architecture (app, components, constants, data, hooks, lib, store, types, assets)`, `Zustand stores with AsyncStorage persist`, `Server-only libs (lib/server*.ts, lib/ai/gemini.ts)` (+46 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 862 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **28 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react-native` connect `Account & Feedback Sheets` to `Onboarding Goals & Paywall`, `Sign-in & Sign-up`, `Add Task Sheet`, `Tab Layout & Magic Mic Overlay`, `Task Cards & Focus Sounds`, `Insights & Focus Log`, `Root Screens & Redirects`, `Recurrence Rules`, `Onboarding Plan & App Tour`, `Tasks Tab List`, `Task Details Screen`, `Attachment Text Extraction`, `Calendar Tab`, `Reminder Scheduling`, `Expo Dependencies`, `AI Consent`, `Paywall & Plan Usage`, `Live Voice Hook & Context`, `Native Dependencies`, `Settings Tab`, `Schedule Month/Week Views`, `Root Layout & Clerk`, `Gem Mascot Drawing`, `RevenueCat Purchases`, `Breakdown Context Sheet`, `Breakdown Checklist UI`, `Focus Clock Face`, `FocusSound`, `React-native`, `Button`, `ReassessmentNotice`, `CompletedOverlay`, `UseSettingsStore`, `UseAuthSync`, `React-native (2)`, `SoundWaves`?**
  _High betweenness centrality (0.060) - this node is a cross-community bridge._
- **What connects `expo/tsconfig.base`, `PostHog analytics`, `Folder architecture (app, components, constants, data, hooks, lib, store, types, assets)` to the rest of the system?**
  _51 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Account & Feedback Sheets` be split into smaller, more focused modules?**
  _Cohesion score 0.07289002557544758 - nodes in this community are weakly interconnected._
- **Why does `Task` connect `Magic Mic Change Tracking` to `Account & Feedback Sheets`, `Tab Layout & Magic Mic Overlay`, `Task Sync & Notifications`, `Task Cards & Focus Sounds`, `Deadlines & Local Dates`, `Insights & Focus Log`, `Translations`, `Root Screens & Redirects`, `Recurrence Rules`, `Tasks Tab List`, `Task Details Screen`, `Gemini Errors & Store Tests`, `Task Operations`, `Priority Scoring`, `Intent Classification`, `Reminder Scheduling`, `Live Voice Tools`, `Task Reassessment Pipeline`, `Live Voice Hook & Context`, `Schedule Month/Week Views`, `Break It Down AI`, `Reassessment Apply`, `Breakdown Context Sheet`, `Planning & Step Spreading`, `Breakdown Checklist UI`, `GenerateAdvice`, `OperationMessages`, `SessionPlan`?**
  _High betweenness centrality (0.040) - this node is a cross-community bridge._
- **Should `Onboarding Goals & Paywall` be split into smaller, more focused modules?**
  _Cohesion score 0.0898995240613432 - nodes in this community are weakly interconnected._
- **Why does `useTranslation()` connect `Sign-in & Sign-up` to `Account & Feedback Sheets`, `Onboarding Goals & Paywall`, `Add Task Sheet`, `Tab Layout & Magic Mic Overlay`, `Task Cards & Focus Sounds`, `Insights & Focus Log`, `Root Screens & Redirects`, `Recurrence Rules`, `Onboarding Plan & App Tour`, `Tasks Tab List`, `Task Details Screen`, `Intent Classification`, `Calendar Tab`, `Paywall & Plan Usage`, `Settings Tab`, `Schedule Month/Week Views`, `Breakdown Context Sheet`, `Breakdown Checklist UI`, `Focus Clock Face`, `ReassessmentNotice`, `CompletedOverlay`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Should `Sign-in & Sign-up` be split into smaller, more focused modules?**
  _Cohesion score 0.10437158469945355 - nodes in this community are weakly interconnected._