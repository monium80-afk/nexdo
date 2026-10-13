# Nexdo — Full App Audit

Date: 2026-10-12. Code audited: `nexdo-mobile` working tree, which includes 29 files changed since the last commit (`c411ad8`) plus the new `hooks/useToday.ts`. I also cross-checked the website (`nexdo-website`). This was a read-only pass: no code was changed.

---

## 0. What I ran

| Check | Result |
|---|---|
| `npm run typecheck` (tsc) | **0 errors** |
| `npm test` | **335 / 335 pass** (78 suites) |
| `npm run lint` | **1 error**: `components/ContextNoteCard.tsx:54`, a ref written during render (`react-hooks/refs`). See P2-14. |
| Running the app on a phone | Not done. I can't drive your phone from here. Everything below comes from reading the code. Items that need a real device are marked **(verify on phone)**. |

---

## 1. Map of the app (Step 1)

**Navigation**
- Root stack (`app/_layout.tsx`): no page transitions anywhere. Modals: Add Task, Magic mic, Feedback and Paywall.
- Tab bar (`components/TabBar.tsx`): **Today** (`app/(tabs)/index.tsx`) · **Tasks** · **Magic mic button** (opens a modal; padlocked on Free) · **Settings**.
- Other screens: Task Details (`app/task/[id].tsx`), Schedule (week and year, `app/schedule.tsx`), Sign in / Sign up, the Account sheet (inside Settings) and a 3-step app tour over the tab bar.

**Onboarding** (11 screens before you reach the app):
Welcome → Sort demo (drag) → Goals quiz → Brain dump (type or speak; **one free AI run per device**) → Analyzing → Your plan → "What first?" (AI tip) → Notifications → Trial timeline (only if the store offers a trial) → Plans (you can buy **before** creating an account) → Sign up (Google / Apple / email + code) → App tour.

**Data**
- Tasks live on the phone (Zustand + AsyncStorage) and in Supabase (row-level security uses the Clerk token). Realtime keeps devices in sync, and a task saved offline is retried later. Sign-out keeps unsaved tasks for the same account.
- Completed tasks are **deleted automatically after 7 days** (`lib/taskOperations.ts:166`).
- Settings (language, notifications, tour) are **per phone**, not per account.

**AI** (Gemini, only from the server routes on EAS Hosting; the key is never in the app):
- `inbox`: turns text into tasks. **Only onboarding uses it now.** No signed-in screen calls it.
- `extract-text`: reads photos, documents and voice. `next`: advice. `breakdown`: steps. `reassess`: context notes on Task Details. `live-session`: Magic mic token. Also `usage`, `live-usage` and `delete-account`.

**Plan limits**: one table (`lib/plan.ts`). The server checks Pro with RevenueCat (it never just trusts the app), counts usage in Supabase **before** calling Gemini, and gives the count back if the AI fails. Signed-out AI is capped per device, per IP and per day. **This is well built.**

**Notifications**: local only. Due-day reminders are ON by default. Daily planning and overdue alerts are OFF by default. There is also a trial-ending reminder.

**What the plans really contain vs. your description**

| | Your description | What the code does |
|---|---|---|
| "20 / 400 AI messages" | AI messages | The `chat` meter now only counts **context notes on Task Details** (shown as "Context notes for AI"). There is **no typed AI capture** anywhere after onboarding, on Free or Pro. |
| "3 / 50 min voice notes" | voice notes | The server still counts them, but **no screen offers voice notes** any more, and the paywall doesn't list them. |
| 3 / 50 photos & docs | ✔ | Only from Task Details → Add context, or inside a running session. |
| 5 / 100 breakdowns & tips | ✔ | **Only reachable inside a running focus session.** |
| 0 / 50 min Magic mic | ✔ | Matches. |
| $6.99 / $58.99, 3-day trial on yearly | ✔ | Prices and trial come from the store. The onboarding trial screen only shows when the store has a trial. |

**Missing features you named**: neither **"Daily capacity check"** nor **"Reset my week"** exists in the code yet. Settings also doesn't match the structure you listed: there is no "Inbox AI behavior", no "Appearance" (no dark mode) and no "Data" section. It has Account, Your plan, Notifications, Language and Help & Support.

**What's genuinely good** (keep it): server-side limits with refunds, no secret in the app, in-app account deletion, restore purchases on every paywall, honest trial timeline, careful sync and offline saving, reminders that clean themselves up, 5 languages, reduced-motion support, and haptics in the right places. The code quality is high.

---

## 2. Ranked suggestions

Format per item: Type · Where · Problem · Suggestion · Plan · Effort (S under 1 h, M a few hours, L a day or more).

### P0 — Critical (fix before launch)

> **Status 2026-10-12: all six P0 items are fixed in the code (not committed yet).** Type check clean, 335/335 tests pass, and lint shows only the existing P2-14 error. Still to do on a phone: test each fix (see the chat summary) and upload the updated privacy page (`nexdo-website/privacy/`).

**P0-1. No consent before personal data goes to Google's AI**
- Type: Security / Store risk
- Where: Brain dump `app/onboarding-dump.tsx`, `app/onboarding-analyzing.tsx`; Task Details context `components/ContextComposer.tsx`; Magic mic
- Problem: Apple's guideline 5.1.2(i) (updated Nov 2025) says an app must clearly say when personal data goes to a third-party AI and get explicit permission first. The brain dump sends the user's text and voice to Google Gemini before they have agreed to anything; even the "By continuing you agree to Terms" line only comes later, at sign-up. This is a likely rejection, and it is also a consent issue under Quebec's Law 25.
- Suggestion: Show a one-time sheet before the first AI use (the "Organize with Nexdo" tap): "Nexdo uses Google's Gemini AI. What you type, say or photograph is sent to Google to process it. It isn't used to train models. [Privacy] — Allow / Not now." Store the answer. If they choose "Not now", use the offline task splitter that already exists (`extractTasks`). Repeat the one-line notice under the Task Details context box.
- Plan: Both · Effort: S–M

**P0-2. The focus timer is silent when the phone is locked**
- Type: Bug
- Where: `hooks/useSessionAlarm.ts`
- Problem: The "time's up" sound is a JavaScript timer, so it only fires if the app is open. Most people lock their phone or switch apps during a focus session, so the session ends with no signal. This is the core feature, and it fails silently.
- Suggestion: When a session starts or resumes, schedule a local notification for its end time. Cancel it when the session is paused, completed or cancelled, and keep the in-app sound for when the app is open. `lib/notifications.ts` already has everything this needs.
- Plan: Both · Effort: S

**P0-3. The app may open to a blank screen when offline (verify on phone)**
- Type: Bug
- Where: `app/_layout.tsx` (`AccountSetup` renders nothing until Clerk `isLoaded`), `lib/clerk.ts`
- Problem: Clerk's Expo SDK normally needs the network at launch unless its resource cache is turned on. If it doesn't load, the app shows a blank cream screen forever, which looks like a crash. Tasks are stored locally, so offline should work.
- Suggestion: Test it: airplane mode, then a cold start. If the screen is blank, turn on Clerk's offline resource cache option and keep the splash screen up until Clerk is ready (see P2-5).
- Plan: Both · Effort: S to test, S–M to fix

**P0-4. "Manage subscription" has no fallback, yet the app says "cancel from Settings"**
- Type: Monetization / Store risk
- Where: `app/(tabs)/settings.tsx` `handleManageSubscription`, `lib/purchases.ts` `presentCustomerCenter`; copy `onboardingTrial.cancelBody`, `notifications.trialEndingBody`
- Problem: If RevenueCat's Customer Center isn't set up, or fails, the user only gets "Couldn't open your subscription." Meanwhile the trial screen says "Cancel anytime… Right from Settings" and the trial reminder says "Cancel before then from Settings." A user who can't find how to cancel is likely to ask for a refund, leave a 1-star review, or complain to the store.
- Suggestion: If the Customer Center fails, open the store's own page (iOS `https://apps.apple.com/account/subscriptions`, Android `https://play.google.com/store/account/subscriptions?package=com.nexdo.app`). Change the copy to "Cancel in Settings → Manage subscription, or in your App Store / Google Play subscriptions." Confirm the Customer Center is set up in both RevenueCat projects.
- Plan: Pro · Effort: S

**P0-5. iPad support is on, but the app is phone-only**
- Type: Store risk
- Where: `app.json` → `ios.supportsTablet: true`
- Problem: Apple will test on iPad and require iPad screenshots. The layouts (floating tab bar, card stack, fixed sizes) were never designed for iPad, and a broken iPad layout is a common rejection. Removing iPad support after release is painful.
- Suggestion: Set `supportsTablet: false` for v1 (the app still runs on iPad in phone mode), then add real iPad support later if you want it.
- Plan: Both · Effort: S

**P0-6. No way to report bad AI output (Google Play)**
- Type: Store risk
- Where: AI advice (`components/NextTaskCard.tsx`), Breakdown sheet, reassessment report (`components/ReassessmentNotice.tsx`), onboarding plan
- Problem: Google Play's AI-generated content policy requires an in-app way to report or flag offensive AI output without leaving the app. Settings → Send feedback exists, but it isn't next to the AI content.
- Suggestion: Add a small "Report" link (flag icon) on AI advice, breakdown results and the reassessment report. It opens `/feedback` with type "Bug" and the AI text pre-filled.
- Plan: Both · Effort: S–M

---

### P1 — High impact (retention, conversion, first impression)

**P1-1. Overdue tasks disappear from Today, the worst case for a returning user**
- Type: UX / Feature (this is your "Reset my week")
- Where: `app/(tabs)/index.tsx`, `lib/schedule.ts`, `lib/reminders.ts`
- Problem: Today only shows tasks due **today**. A late task stays on its past day and never comes back to Today. Overdue alerts are off by default, and they never fire for date-only deadlines, which is most tasks. Someone back after a week away opens the app and reads **"Nothing due today"** or **"Done for today"** while 10 tasks are overdue. That is the opposite of mental clarity: the app hides the very thing that's causing stress.
- Suggestion: Keep your rule that late tasks stay on their day, but don't hide them:
  1. At the top of Today, show a calm card when anything is overdue: "4 tasks slipped. **Reset my week**". (It replaces the "Nothing due today" state when that applies.)
  2. **Reset my week** sheet: list the overdue tasks, propose new dates spread over the next days (respecting daily capacity once P1-4 exists), and let the user drop any task with one tap. Then: Confirm → one undo toast. This runs entirely on the phone, so it costs **$0** in AI.
  3. Optional: when overdue tasks exist, the daily planning notification says "3 tasks slipped — reset your week?"
- Plan: Both · Effort: M

**P1-2. Today can be empty on day one, so the "aha" moment breaks**
- Type: UX
- Where: `app/(tabs)/index.tsx` (empty states), `app/add.tsx:71` (default deadline "tomorrow"), onboarding drafts
- Problem: In onboarding, the user dumps "email professor, buy groceries" (no dates) and "What should I do first?" picks one. They sign up, land on Today, and see **"Nothing due today"**, because tasks without a date are on no day. The first manual task also defaults to **tomorrow**, so it doesn't show on Today either. The promise "Nexdo makes the decision" is broken on the first screen.
- Suggestion:
  - When nothing is due today, show **"Up next"**: the top-ranked open task from any day or none, with a Start button (`recommendTasks` already ranks every open task). Copy: "Nothing due today. If you have time, this is the best next thing."
  - Make Add Task default to **Today**, or remember the last choice.
  - On the first Today after sign-up, put the task onboarding picked on top.
- Plan: Both · Effort: S–M

**P1-3. There is no typed AI capture after onboarding**
- Type: Feature / Monetization
- Where: new "Quick add with AI" box on Tasks / Add Task; reuses `app/api/inbox+api.ts` and `lib/ai/classifyIntent.ts`
- Problem: Onboarding sells "dump everything, Nexdo organizes it." After sign-up that is gone: Free gets a manual form, and Pro only gets Magic mic, which needs talking (no good in class, at work or on the bus). The "20 / 400 AI messages" in your plan have nothing to be spent on except context notes buried at the bottom of Task Details. Free users never see the AI they signed up for, so they have little reason to upgrade.
- Suggestion: Add a one-line box at the top of Add Task: "Type anything — 'dentist Friday 3pm, finish essay by Monday'". It uses the route and parsing that already exist (and are tested), plus the preview cards from onboarding. It counts against the existing "chat" meter, and the label becomes "AI messages", so the allowance numbers don't change.
- Cost (measured ≈ $0.0015 per message): typical Free use ≈ **$0.03 a month**. Worst case, if all 20 are long multi-task messages, ≈ $0.48. Cap Free messages at about 600 characters and 4 turns with no fragment fan-out, and the worst case drops to ≈ **$0.12**. Pro is unchanged (the meter already allowed 400).
- Plan: Both · Effort: M

**P1-4. Build the Daily capacity check (not built yet)**
- Type: Feature
- Where: Today card (`TodayCard` in `app/(tabs)/index.tsx`), Settings → Notifications or a new "My day" row, onboarding
- Problem: Nothing tells the user that today is impossible. With 7 hours of tasks due today, the bar just says "7 tasks left", which is a stress trigger rather than clarity.
- Suggestion: Ask "How many hours can you usually give your tasks on a weekday?" once (it can replace the Goals quiz, see P1-7), with a default of 4 h. On Today, add up the minutes of today's open tasks. If the total is over capacity, show it on the card: "≈ 6 h planned, you usually have 4 h. **Move 2 tasks to tomorrow?**" The suggested tasks are the lowest-scored ones, and moving them takes one tap with undo. Tasks with "No duration" count as 0. Fully on the phone, so **$0** AI.
- Plan: Both · Effort: M

**P1-5. Breakdown and advice are hidden inside a running session**
- Type: UX / Monetization
- Where: `components/NextTaskCard.tsx` (buttons only render while a session runs), `app/task/[id].tsx`
- Problem: The only way to "Break down" or "Get advice" is to start a focus session first. Most Free users will never find their 5 a month, and Pro's main everyday AI perk is invisible. Breaking a task down is most useful **before** starting, when the task feels too big to begin.
- Suggestion: Add a small "Break down" button on the Today card (under Start session) and on Task Details next to Subtasks. Keep advice inside the session if you like.
- Plan: Both · Effort: S–M

**P1-6. Limits only show in Settings, with no warning before running out**
- Type: Monetization / UX
- Where: AI buttons (Break down, Get advice, Add context, Quick add), `components/PlanUsage.tsx`
- Problem: A Free user only learns about a limit when the paywall pops up. There is no "2 left this month" nearby, which feels like a trap and wastes a good upsell moment.
- Suggestion: Fetch `/api/usage` once per app session, cache it, and refresh it after each AI call. On Free, when 2 or fewer are left, show a small counter on the button ("2 left"). At 0, the button says "Get more with Pro" instead of failing. Pro only sees a counter near the end.
- Plan: Free (mainly) · Effort: M

**P1-7. Onboarding is long, and two screens add friction with no payoff**
- Type: UX
- Where: `app/onboarding-sort.tsx`, `app/onboarding-goals.tsx`
- Problem: There are 11 screens before the app. The **Sort** screen asks you to drag a handle (most people will just tap Next; screen-reader users can't drag). The **Goals** quiz answers are only sent to analytics: nothing in the app changes based on them, so it is a question with no payoff.
- Suggestion: Remove Sort. Replace Goals with one question that the app actually uses: daily capacity (P1-4), or "When should Nexdo give you your plan?" (P1-8). That gives 9 screens, each with a purpose.
- Plan: Both · Effort: S

**P1-8. The "one nudge" promise is off by default**
- Type: UX / Retention
- Where: `app/onboarding-notifications.tsx`, `store/useSettingsStore.ts` (`dailyNudgeEnabled: false`)
- Problem: The notification screen says "One nudge, right when it matters," but after "Allow" the only notifications are due-day reminders, and nothing arrives for tasks without dates. A morning "here's your next thing" is the strongest habit loop a what-to-do-next app has.
- Suggestion: On that screen, add a time row ("Morning plan at 8:30 ▾"). When the user allows notifications, turn on the daily planning note at that time. The text already exists ("Plan your day — 3 tasks due today. Start with…").
- Plan: Both · Effort: S

**P1-9. The app ignores the phone's language**
- Type: UX
- Where: `store/useSettingsStore.ts` (`language: "en"`), `lib/i18n.ts`
- Problem: Everyone starts in English, including French speakers in Quebec (your home market) and German, Spanish and Arabic users. They go through the whole onboarding in English before finding the switch in Settings.
- Suggestion: On first launch, pick the language from the phone's locale (`Intl.DateTimeFormat().resolvedOptions().locale`, no new library needed) if it's one of the 5; otherwise use English.
- Plan: Both · Effort: S

**P1-10. No undo for completing or deleting**
- Type: UX
- Where: Today card "Mark complete", Tasks list checkbox (`components/TaskCard.tsx`), Task Details delete
- Problem: A mis-tap on Mark complete plays a celebration and the task is gone from Today; getting it back means finding it in Tasks. Delete asks for confirmation but can't be undone. Undo is a big part of "no stress".
- Suggestion: Show a 5-second toast, "Done · Undo" / "Deleted · Undo". The store already has `restoreSnapshots`, which Magic mic uses for its undo.
- Plan: Both · Effort: M

**P1-11. Build the release from a commit**
- Type: Release hygiene
- Where: git working tree
- Problem: 29 changed files and 1 new file aren't committed, and build 7 would come from this state. If a store build has a bug, you can't tell exactly which code it was built from.
- Suggestion: Commit and tag (`build-7`) before each store build.
- Plan: — · Effort: S

**P1-12. Prepare for the "account required" review question**
- Type: Store risk
- Where: App Review notes
- Problem: Nexdo can't be used at all without an account. Apple sometimes questions this for to-do apps (guideline 5.1.1(v)). Your answer is solid (sync across devices, Pro tied to the account), but the reviewer has to see it.
- Suggestion: In the review notes, explain the sync and give the review account (`nexdo.review@gmail.com` + password). Confirm "Sign in with Apple" shows on iOS (it is in the code).
- Plan: — · Effort: S

---

### P2 — Medium

**P2-1. Pro feels like "more of the same"**
- Type: Monetization
- Where: Paywall `app/paywall.tsx`
- Problem: Pro is bigger allowances plus Magic mic. Bigger numbers don't excite many people, and Magic mic is the only real "new thing".
- Suggestion: Add Pro perks that cost **$0 in AI**: keep completed-task history beyond 7 days (P2-3), weekly focus stats, smart Reset my week (spread by capacity; the basic version stays free), a home-screen widget (P3-8) and themes. Lead the paywall with outcomes ("Talk your week into a plan", "Never lose track of what slipped") instead of a usage table.
- Plan: Pro · Effort: M–L (per perk)

**P2-2. Raw scores on every card add noise**
- Type: UX / UI
- Where: `components/NextTaskCard.tsx` ("#1 Priority", "Score: 72"), Task Details header, onboarding ("Urgency 72 / 100")
- Problem: Numbers invite second-guessing ("why 72 and not 80?") and make the screen feel like a dashboard. The same idea also has four names: Score, Urgency, Priority score and #1 Priority.
- Suggestion: Replace the number with one plain reason: "**Why first:** due today · high priority · 30 min" (built on the phone from the same inputs). Keep the score only as a sort option on Tasks.
- Plan: Both · Effort: M

**P2-3. Completed tasks are deleted after 7 days**
- Type: UX
- Where: `lib/taskOperations.ts:166`, `hooks/useAuthSync.ts`
- Problem: There is no history and no feeling of progress ("what did I get done this month?"). Some users will be upset to find finished tasks gone. It's documented in the privacy policy, but it's a surprise in the app.
- Suggestion: Keep 90 days, or keep everything for Pro (P2-1). At least add a line in Tasks → Completed: "Completed tasks are cleared after 7 days."
- Plan: Both · Effort: S

**P2-4. Today flashes "All caught up" before tasks load**
- Type: Bug / UI
- Where: `app/(tabs)/index.tsx`
- Problem: On a new phone, or after reinstalling, Today shows "All caught up — add a task" until Supabase answers. For a returning user that's alarming ("where are my tasks?").
- Suggestion: Until the first account read finishes (`whenAccountRead`), show a quiet skeleton card instead of an empty state.
- Plan: Both · Effort: S

**P2-5. Blank screen between the splash screen and the app**
- Type: UI / Performance
- Where: `app/_layout.tsx`
- Problem: The splash hides as soon as the fonts load, but `AccountSetup` draws nothing until Clerk is ready, so a blank cream screen shows on slow networks.
- Suggestion: Hide the splash only once fonts **and** Clerk are loaded.
- Plan: Both · Effort: S

**P2-6. Task Details has no "Mark complete"**
- Type: UX
- Where: `app/task/[id].tsx`
- Problem: The task's own page lets you edit, postpone, delete and start a session, but not finish it. Users have to go back to the list.
- Suggestion: Add a green "Mark complete" next to Start session (and "Reopen" for done tasks).
- Plan: Both · Effort: S

**P2-7. Edits are lost without a warning**
- Type: UX
- Where: Task Details ✕ (`app/task/[id].tsx`), Add Task Cancel / ✕ (`app/add.tsx`)
- Problem: Typing a title or notes and then tapping ✕ throws everything away silently.
- Suggestion: If anything changed, ask "Discard changes?"
- Plan: Both · Effort: S

**P2-8. The Tasks empty state is wrong for new users**
- Type: Copy / UX
- Where: `app/(tabs)/tasks.tsx`, `next.allCaughtUpBody`
- Problem: With zero tasks ever, Tasks says "No tasks found — Try a different filter or search term." Today says "You've completed everything on your list." Both are wrong for someone brand new.
- Suggestion: When there are no tasks at all, show "No tasks yet" with an "Add your first task" button. Only use "No tasks found" when a filter or search is active.
- Plan: Both · Effort: S

**P2-9. Some text fails contrast**
- Type: Accessibility
- Where: `ink.creamSubtle #9C9184` and `orange-500 #F2652A` used as small text on cream (≈ 2.8:1; the minimum is 4.5:1). This includes the date eyebrow on Today, version text, timeline labels, and the **Terms / Privacy / Restore links on the onboarding paywall (11.5 px)**.
- Problem: Hard to read in sunlight and for low vision. Tiny, faint legal links on a paywall can also draw a reviewer's comment.
- Suggestion: Use `creamMuted` or `orange-600` for text, and make paywall links at least 12.5 px in `creamMuted`.
- Plan: Both · Effort: S

**P2-10. Touch targets below 44 pt / 48 dp**
- Type: Accessibility
- Where: Settings switches (`h-10` = 35 dp, because NativeWind rem = 14), small icon buttons, chips
- Problem: Easy to miss, especially for one-handed use.
- Suggestion: Give every control a minimum height of 44 dp, or add `hitSlop` where the visual size must stay.
- Plan: Both · Effort: S–M

**P2-11. Large text sizes are untested (verify on phone)**
- Type: Accessibility
- Where: Card stack (measured heights), tab bar, paywall table, onboarding layouts
- Problem: No `maxFontSizeMultiplier` is set anywhere, and several layouts use fixed sizes. At the phone's largest text setting, things may clip or overlap.
- Suggestion: Test at the maximum font scale on Android and iOS, fix what breaks, and cap the multiplier only on tight elements (tab badges, timer).
- Plan: Both · Effort: M

**P2-12. The Tasks list will slow down as it grows**
- Type: Performance
- Where: `app/(tabs)/tasks.tsx` (`ScrollView` + `.map` with entering, exiting and layout animations per row)
- Problem: Every task is drawn and animated, so with 200+ tasks scrolling and filtering get janky, especially on mid-range Android.
- Suggestion: Switch to `FlatList` (already part of React Native), and only animate rows that change.
- Plan: Both · Effort: M

**P2-13. The plan names don't match what users do**
- Type: Copy / Monetization
- Where: `lib/plan.ts`, `constants/translations/*` (`plan.meters`), paywall, website plans table
- Problem: "Context notes for AI" means nothing to a new user. "Voice notes" are in your plan but not in the app.
- Suggestion: Once Quick add exists (P1-3), rename the meter to "AI messages (quick add & notes)". Either remove voice notes from the plan, or add a "hold to talk" button to Quick add that uses the voice meter (3 min Free is cheap, ≈ $0.005, and gives a taste of Magic mic).
- Plan: Both · Effort: S (rename) / M (voice)

**P2-14. Lint error: ref written during render**
- Type: Bug (code quality)
- Where: `components/ContextNoteCard.tsx:54`
- Problem: With the React Compiler on, writing `ref.current` during render can make the compiler skip or break optimisations for this component, so the edit callback could go stale.
- Suggestion: Move the assignment into an effect (`useEffect(() => { ref.current = onEditingChange })`) or use the event-handler pattern.
- Plan: Both · Effort: S

**P2-15. No message for failed payments or expired Pro**
- Type: Monetization
- Where: Settings → Your plan, `store/useSubscriptionStore.ts`
- Problem: When a renewal fails, Pro quietly continues through the store's grace period and then quietly disappears. The user doesn't know why Magic mic is suddenly locked.
- Suggestion: If RevenueCat reports a billing issue, show a banner: "Payment failed — update it to keep Pro." When Pro ends, show a one-time "Your Pro ended" card with a resubscribe button.
- Plan: Pro · Effort: S–M

**P2-16. No data export**
- Type: Feature / Legal
- Where: Settings
- Problem: Quebec's Law 25 gives people a right to get their data in a common format. Users moving from Todoist also look for import and export.
- Suggestion: Settings → "Export my tasks" (a CSV or JSON file made on the phone and shared with the share sheet). Or, at minimum, handle it by email request and say so in the privacy policy.
- Plan: Both · Effort: M

**P2-17. Clean up the copy**
- Type: Copy
- Where: `constants/translations/en.ts` (and the other languages)
- Problems found:
  - `auth.haveAccount`: "I have an account already?" reads oddly. Use "I already have an account".
  - Mixed capitalisation: "Add Task", "Start Session", "Save Changes", "Pause Timer", "High Priority" vs "Add a task", "Start session". Pick sentence case everywhere.
  - `onboardingAnalyzing.body` claims "dependencies, and cognitive load", which the app doesn't analyse. Use "dates, durations and priorities".
  - `settings.subtitle` "Customize your experience" is filler. Drop it.
  - `tasks.showingSuffix` always says "tasks" (so you get "Showing 1 of 1 tasks").
  - `paywall.subtitle` says "Nexdo already organized your 5 tasks" even when the user typed them by hand. Use "Your 5 tasks are in Nexdo."
  - "AI Advice" / "AI ADVICE" / "Get advice", and "Break down" / "AI Breakdown" / "Breakdowns and advice": one name each.
  - `help: "FAQ / Help"` → "Help & FAQ".
- Plan: Both · Effort: S

**P2-18. No dark mode, and no "Appearance" setting**
- Type: UI / Feature
- Where: `app.json` (`userInterfaceStyle: "light"`), the theme is saved but not applied (`useSettingsStore.theme`)
- Problem: Many people expect dark mode, especially at night when planning tomorrow. It's in your intended Settings structure but not built.
- Suggestion: Build it after launch. It touches every color token (`global.css` + `colors.ts`). Until then, don't show an Appearance setting.
- Plan: Both · Effort: L

---

### P3 — Nice to have / polish

**P3-1. Dead code from the old AI chat and sessions**
- Type: Code
- Where: `translations` (`chat`, `assistant`, most of `ops`), `colors.quickAction`, `types/chat.ts`, session store `energy`, `dropTask`, `extendMinutes`, `focusTask`, `t.session.stuck`, the "Assistant" wording in `lib/serverAccount.ts`
- Problem: Makes the code harder to change, and the translations carry unused strings.
- Suggestion: Remove anything that nothing imports. Keep the onboarding voice strings.
- Plan: — · Effort: S

**P3-2. The Magic mic screen redraws the whole list every second**
- Type: Performance
- Where: `app/live-voice.tsx` (`now` state in the main component)
- Problem: The clock tick re-renders every task card while the mic is streaming.
- Suggestion: Move the clock into its own small component.
- Plan: Pro · Effort: S

**P3-3. Settings belong to the phone, not the account**
- Type: UX
- Where: `store/useSettingsStore.ts`
- Problem: A new phone means setting notifications and language again, and a second account on the same phone inherits the first account's settings.
- Suggestion: Save the settings with the account (one small table, or Clerk `unsafeMetadata`). Ask first, since it means a schema change.
- Plan: Both · Effort: M

**P3-4. The monthly reset uses UTC**
- Type: Copy / Bug (minor)
- Where: `lib/serverPlan.ts` `usageMonth`, `plan.resets` "starts again on the 1st"
- Problem: In Quebec (UTC−4/−5), the allowance resets on the evening of the last day of the month.
- Suggestion: Say "resets at the start of each month (UTC)", or ignore it. Minor.
- Plan: Both · Effort: S

**P3-5. Version numbering is set in two places**
- Type: Release
- Where: `eas.json` (`appVersionSource: "remote"`, `autoIncrement`) vs `app.json` `versionCode: 7` plus the local build script
- Problem: An EAS build ignores the local versionCode, so the two counters can drift apart and an upload gets rejected for a duplicate code.
- Suggestion: Pick one source (local, since you build Android locally).
- Plan: — · Effort: S

**P3-6. Focus feels unrewarded after the confetti**
- Type: Feature
- Where: Today card / Settings
- Problem: There's no memory of focus time ("2 h 15 focused today, 4-day streak"). It's a cheap, satisfying, very "clarity" detail.
- Suggestion: Store each finished session's minutes on the phone, and show a line on the Today card plus a small weekly view (a Pro perk candidate).
- Plan: Both / Pro · Effort: M

**P3-7. The focus session can't be seen from the lock screen**
- Type: Feature
- Where: Sessions
- Problem: Once the phone is locked, there's no visible timer.
- Suggestion: Android: an ongoing notification showing the end time. iOS: a Live Activity, which needs native work.
- Plan: Both · Effort: M (Android) / L (iOS)

**P3-8. Home-screen widget: "Your next task"**
- Type: Feature
- Where: New native widget
- Problem: The most direct expression of "always know what to do next" is a widget showing the top task and a Start button. Todoist's widget is a list, so this would be a real difference.
- Suggestion: Build it after launch. It's a strong Pro perk.
- Plan: Pro (suggested) · Effort: L

**P3-9. No win-back after a trial or Pro ends**
- Type: Monetization
- Where: `lib/purchases.ts`
- Problem: Nothing happens when a trial ends without converting.
- Suggestion: Later, a single gentle message ("Your trial ended — here's what you did with Pro: 12 min of Magic mic, 8 breakdowns"). Nothing pushy.
- Plan: Free · Effort: S–M

**P3-10. The onboarding "Sort" grip can't be used with a screen reader**
- Type: Accessibility
- Where: `app/onboarding-sort.tsx`
- Problem: It is marked `adjustable` but has no accessibility actions. (This goes away if you remove the screen, see P1-7.)
- Suggestion: Remove the screen, or add increment and decrement actions.
- Plan: Both · Effort: S

---

## 3. Persona walk-through (short)

- **New Free user**: Strong, honest onboarding with a real AI moment (the brain dump), but long (P1-7), with no AI consent (P0-1) and English-only by default (P1-9). After sign-up, Today can be empty (P1-2), the AI they just saw is gone (P1-3), and breakdowns are hidden (P1-5).
- **Free user hitting a limit**: The server handles it well (no double charging, refunds on failure), and the paywall opens naming what ran out. But there's no warning beforehand (P1-6), and the paywall pitches bigger numbers rather than outcomes (P2-1).
- **Pro user**: Magic mic is impressive and well protected. There's no typed AI capture (P1-3), the timer is silent when locked (P0-2), and "Manage subscription" can dead-end (P0-4).
- **Back after a week away**: Sync and reminders recover correctly. But overdue tasks are hidden from Today (P1-1), finished tasks from last week are already deleted (P2-3), and there is no "welcome back, let's reset" moment. This is the persona where Nexdo most needs "Reset my week".

---

## 4. Top 10 to do first (in order)

1. **AI consent sheet** before the first Gemini call (P0-1) and the **Report** link on AI output (P0-6). These are store rules.
2. **Focus timer notification** when the phone is locked (P0-2).
3. **Offline cold-start test** in airplane mode, and fix if blank (P0-3), plus keeping the splash until ready (P2-5).
4. **Manage subscription fallback** and correct the "cancel from Settings" copy (P0-4).
5. **Set `supportsTablet: false`** for v1 (P0-5).
6. **Overdue card + Reset my week** on Today (P1-1).
7. **Today never empty**: an "Up next" fallback, and Add Task defaulting to Today (P1-2).
8. **Break down on the Today card and Task Details**, plus **"x left" counters** (P1-5, P1-6).
9. **Daily capacity check**, asked in onboarding in place of the Goals quiz, then remove the Sort screen (P1-4, P1-7).
10. **Quick add with AI** (typed brain dump on the existing allowance) (P1-3).

## 5. Quick wins (high impact, effort S)

- P0-2 Focus timer end notification
- P0-3 Offline launch test (the fix may be S–M)
- P0-4 Manage subscription fallback + copy
- P0-5 `supportsTablet: false`
- P1-2 (part) Add Task default deadline → Today
- P1-7 Remove the Sort screen; turn Goals into one useful question
- P1-8 Turn on the morning plan when notifications are allowed
- P1-9 Use the phone's language on first launch
- P1-11 Commit + tag before building
- P1-12 App Review notes + demo account
- P2-4 Skeleton instead of "All caught up" while loading
- P2-5 Keep the splash until Clerk is ready
- P2-6 "Mark complete" on Task Details
- P2-8 Correct empty states for new users
- P2-9 Contrast fixes (text colors, paywall links)
- P2-14 Lint error fix

## 6. Questions for me (decide before building)

1. **Overdue on Today**: is a card at the top of Today ("4 tasks slipped — Reset my week") OK while late tasks still stay on their own day? Or do you want overdue tasks shown in Today's list itself?
2. **Reset my week**: Free, Pro, or basic on Free with "smart spread by capacity" on Pro? Should it only move overdue tasks, or also rebalance an overloaded week?
3. **Daily capacity**: one number for every day, or weekdays vs weekends? Default 4 h? Ask in onboarding?
4. **Quick add with AI for Free**: OK to share the existing 20 a month with context notes, with the caps that keep the worst case ≈ $0.12 per Free user per month? Or would you rather give Free 10?
5. **Voice notes in the plan**: remove them from the plan, or add "hold to talk" to Quick add (Free 3 min, Pro 50 min)?
6. **iPad**: OK to ship iOS v1 as phone-only (`supportsTablet: false`)?
7. **Settings structure**: you listed "Inbox AI behavior", "Appearance" and "Data". What should "Inbox AI behavior" contain? Is dark mode wanted for v1 or later? Should "Data" hold export?
8. **Completed tasks**: keep the 7-day auto-delete, raise it to 90 days, or make longer history a Pro perk?
9. **Scores**: OK to hide the number on cards and show a plain "why first" line instead?
10. **iOS store setup**: are the App Store Connect products (monthly, and yearly with the 3-day trial) and RevenueCat's iOS offering + Customer Center already set up? The release script is Android-only, so I can't confirm iOS from the code.
11. **Pending migration**: my notes from 10-11 say the feedback-lock migration (`supabase/migrations/20261011000000_feedback_account_lock.sql`) needed to be run by you in Supabase. Has it been run?
12. **Onboarding length**: OK to remove the Sort demo and replace the Goals quiz with the capacity question?
