# Nexdo — Placement audit

**Date:** 2026-10-12 · **Code read:** commit `005d05f` (clean tree) · **Scope:** where features, buttons, menus and screens sit. Nothing else.

**Read-only.** No code was changed. Nothing here gets built until you pick items.

**How I checked:** I read every screen and the shared components, and counted taps from the code. I did not test on the phone. "Taps" means taps from the screen the app opens on, which is **Today** for a signed-in user. Typing is not counted.

**Kept as decided:** categories and the AI chat stay removed. Breakdown and tips stay inside focus sessions (your call on 10-12, P1-5 in `NEXDO_AUDIT.md`). I only suggest a hint about them, not moving them.

---

## 1. Current map

### 1.1 Navigation tree

```
Root stack (app/_layout.tsx) — no page animations anywhere
│
├─ Signed out → onboarding stack
│    onboarding → -sort → -goals → -dump → -analyzing → -plan → -focus
│    → -notifications → -trial → -paywall → (auth)/sign-up
│    (auth)/sign-in · (auth)/sign-up · (auth)/sso-callback
│
├─ (tabs) — custom tab bar (components/TabBar.tsx), 4 equal slots
│    ├─ [1] Today ............ app/(tabs)/index.tsx
│    │      ├─ sheet: Reset my week (components/ResetWeekSheet.tsx), only when tasks slipped
│    │      ├─ overlay: Focus session (full screen inside Today; tab bar stays on)
│    │      │     ├─ sheet: AI Breakdown (components/BreakdownSheet.tsx)
│    │      │     └─ sheet: Add context (components/ContextSheet.tsx)
│    │      └─ overlay: first-run tour (components/AppTour.tsx), over the tab bar
│    ├─ [2] Tasks ............ app/(tabs)/tasks.tsx
│    │      └─ dropdowns: Filter, Sort (components/DropdownMenu.tsx)
│    ├─ [3] Magic mic button (not a tab) → modal live-voice, or the paywall on Free
│    └─ [4] Settings ......... app/(tabs)/settings.tsx
│           └─ sheet: Account (components/AccountSheet.tsx)
│
├─ push:  task/[id] ...... Task Details (app/task/[id].tsx)
├─ push:  schedule ....... Schedule, Week | Year (app/schedule.tsx)
├─ modal: add ............ Add Task (app/add.tsx)
├─ modal: live-voice ..... Magic mic (app/live-voice.tsx)
├─ modal: paywall ........ Nexdo Pro (app/paywall.tsx)
└─ modal: feedback ....... Send feedback / Report AI (app/feedback.tsx)

On every page: Undo toast (components/UndoToast.tsx)
Notification taps: task reminder → Task Details ("Mark as done" action completes it);
                   daily planning → Today (hooks/useNotifications.ts, lib/reminders.ts:243)
```

### 1.2 What is on each screen

**Today**: `app/(tabs)/index.tsx`, cards in `components/NextTaskCard.tsx` and `components/NextTaskCardStack.tsx`

| Element | Position | Where in code |
|---|---|---|
| Date + "Today" title | top left | index.tsx:514 |
| **Schedule** chip | top right | index.tsx:526 |
| Progress card ("3 tasks left", "2 of 5 done", bar) | under the title | index.tsx:200 |
| "N tasks slipped" card + orange **Reset** button | under progress, only when late tasks exist | index.tsx:256, 538 |
| "Nothing due today, here's the best next thing" | under the header, when nothing is due today | index.tsx:545 |
| Card: "#1 Priority" / "Pinned first" pill + "Score: 72" pill | top of card | NextTaskCard.tsx:705 |
| Card: title (tap → Task Details) | card | NextTaskCard.tsx:735 |
| Card: deadline + length | card | NextTaskCard.tsx:749 |
| **Start session** (orange) | card, bottom | NextTaskCard.tsx:869 |
| **Mark complete** (green tint) | under Start | NextTaskCard.tsx:876 |
| Swipe left/right → next card (cycles, changes nothing) | gesture on the card | NextTaskCardStack.tsx:557 |
| **Previous / Next** buttons | under the stack | NextTaskCardStack.tsx:671 |
| Empty state: **Add a task** or **Open schedule** | middle, only when no card | index.tsx:588 |
| No add button | while there are cards | — |

**Focus session**: same card in `focusMode`, full screen over Today

| Element | Position | Where |
|---|---|---|
| Rank, score, title (tap → Task Details), deadline/length | top | NextTaskCard.tsx:702 |
| Steps checklist (if the task has steps) | under the title | NextTaskCard.tsx:789 |
| Timer ring · Pause/Resume · **Complete** | middle | NextTaskCard.tsx:278 |
| Cancel session (asks first) | under the timer | NextTaskCard.tsx:339 |
| **Break down** · **Get advice** + "N left" note | under that | NextTaskCard.tsx:828 |
| **Add context** (note, photo, document) | under that | NextTaskCard.tsx:857 |
| Advice panel + Report | bottom | NextTaskCard.tsx:894 |
| Tab bar still on screen and active | bottom | index.tsx:150 |
| No "minimize"/back-to-cards button | — | — |

**Tasks**: `app/(tabs)/tasks.tsx`

| Element | Position | Where |
|---|---|---|
| Search icon | header, top right | tasks.tsx:142 |
| **Add Task** (orange) | header, top right | tasks.tsx:143 |
| "12 pending · 4 completed · 2 overdue" | header | tasks.tsx:163 |
| Filter chip (All / Pending / Completed / Overdue / No deadline) | left, under the header | tasks.tsx:199 |
| Sort chip (Recently added / Due date / Priority score) | right | tasks.tsx:208 |
| "Showing X of Y tasks" | under the chips | tasks.tsx:218 |
| Task card: checkbox **left**, tap body → Task Details | list | components/TaskCard.tsx:256 |
| Pending-count badge on the Tasks tab icon | tab bar | TabBar.tsx:119 |

**Add Task** (modal): `app/add.tsx`

| Element | Position |
|---|---|
| X close | top right (add.tsx:202) |
| Title | top |
| Duration chips + Custom | 2nd |
| Deadline chips (default Today) + Pick a date | 3rd |
| **Repeats** picker | 4th (always shown) |
| Priority (default Medium) | 5th |
| "Optional" → Plan steps, Notes | 6th |
| Cancel · **Add Task** | bottom tray (add.tsx:376) |
| After saving → **always the Tasks tab** | add.tsx:188 |

**Task Details** (push): `app/task/[id].tsx`

| Element | Position |
|---|---|
| Edit (pencil), X | header, top right (:501, :509) |
| Deadline, time, length, score | header |
| **Start / Resume session** | header (:551) |
| Postpone: +1 day / +3 days / +1 week / Pick a date | 1st card (:579) |
| Reminder line + Mute | same card (:605) |
| Repeats: Make it repeat / Change / Stop repeating | 2nd card (:623) |
| Subtasks, each row with ✎ and 🗑, + Add subtask | middle (:667) |
| Notes (read-only) | (:748) |
| AI advice + Report | (:759) |
| Add context for AI: notes, text box, photo/document/camera, "N left" | bottom of a long scroll (:774) |
| **Delete Task** (red) · **Save Changes** | bottom tray, side by side (:828) |
| Edit mode: title, duration, deadline only. **No priority, no notes** | components/TaskEditPanel.tsx:26 |

**Schedule** (push): `app/schedule.tsx`. X top right; ‹ week › and Week | Year in the header; day strip with dots (red = late); the day's tasks with the checkbox on the **right** (components/ScheduleItemRow.tsx:142); a Done list; a year calendar.

**Magic mic** (modal): `app/live-voice.tsx`. X top right; status line; your task list (tapping a task does nothing, the checkbox works); bottom: Undo · Stop, then Talk again · Done. Opening it first switches to the Tasks tab, and closing goes to Tasks (TabBar.tsx:74, live-voice.tsx:147).

**Paywall** (modal): `app/paywall.tsx`. X top right; headline (names what ran out); plan picker; Free vs Pro table; "Continue with Free"; Restore · Terms · Privacy; bottom tray: Start trial / Get Nexdo Pro.

**Settings**: `app/(tabs)/settings.tsx`, in this order:
1. **Account**: profile card (→ Account sheet), then a **big red Sign out card** right under it (:497)
2. **Your plan**: usage card; Upgrade + Restore (Free) or Manage subscription (Pro)
3. **Notifications**: deadline reminders (+ time, "also before", extra for high priority), daily planning (+ time), overdue alerts
4. **AI**: one switch, "AI features"
5. **Language**: 5 chips
6. **Help & Support**: FAQ, App tour, Send feedback, Privacy, Terms, version

Account sheet: photo, name, email (read-only), Change password, **Delete account** (red text, asks first) at the bottom (AccountSheet.tsx:373).

### 1.3 Taps to each main feature today

| Feature | Taps from Today | Path |
|---|---|---|
| Complete the top task | **1** | Mark complete |
| Start focus on the top task | **1** | Start session |
| See the next task | **1** | swipe or Next |
| Add a task by hand | **3** | Tasks tab → Add Task (top right) → Add Task |
| Magic mic (Pro) | **1** | tab bar mic (also moves you to Tasks) |
| Magic mic (Free) | 1 → paywall | padlocked mic |
| Voice note → tasks | **not possible** | only in onboarding |
| Photo/document → tasks | **not possible** | only as context for a task that already exists |
| Photo/document as context for a task | 5 | title → Task Details → scroll to bottom → attach → pick → send |
| Break down a task | 3 | Start session → Break down → Confirm |
| Get advice | 2 | Start session → Get advice |
| Reset my week | 2 | Slipped card Reset → Reset my week (only when tasks slipped) |
| Daily capacity check | — | not in the code |
| Schedule | **1** | Schedule chip |
| Postpone a task | 2 (+1 to leave) | title → +1 day → X |
| Edit title/duration/deadline | 3 | title → pencil → Save Changes |
| Change priority | **not possible** after creation | — |
| Delete a task | 3 | title → Delete Task → confirm |
| Complete from the list | 2 | Tasks tab → checkbox |
| Search | 2 | Tasks tab → search |
| Filter / sort | 3 | Tasks tab → chip → option |
| Plan usage / Upgrade | 1 / 2 | Settings (→ Upgrade) |
| Sign out | **2** | Settings → Sign out (no question if everything is saved) |
| Delete account | 4 | Settings → profile → Delete account → confirm |
| Send feedback / App tour | 2 | Settings → scroll → row |

---

## 2. Scorecard: the 11 checks

| # | Check | Verdict | Main problem | Fix |
|---|---|---|---|---|
| 1 | Frequency vs reach | **Needs work** | Complete, Start and Next are 1 tap, which is good. But **adding a task** is 3 taps, top right, never on Today. The best tab-bar slot holds a feature 98% of users can't use (padlocked mic). | P1-2 |
| 2 | Logic | Mostly good | Priority can't be edited after creation. Users will look for it under Edit. | P2-4 |
| 3 | Hidden features | **Bad** | Voice notes and photos as task input exist only in onboarding. "Pinned first" has no button. Breakdown/tips are only findable by starting a session. | P1-3, P3-7, P3-8 |
| 4 | Duplicates and clutter | OK | Task Details is long but ordered well. Small clutter: ✎+🗑 on every subtask, "Showing X of Y", Add Task has both X and Cancel. | P3-2, P3-3 |
| 5 | Grouping | Good | Session tools sit together. Postpone and reminder share a card. Settings mixes "Your plan" outside Account. | P2-10 |
| 6 | Flow | **Needs work** | Add Task and Magic mic both drop you on **Tasks**, not back where you were. X on Task Details silently drops edits. No way to leave a focus session without cancelling it. | P1-1, P2-1, P2-3, P2-9 |
| 7 | Capacity check / Reset my week | Reset: good spot, too few doors. Capacity: not built. | | §4, P2-8 |
| 8 | Free vs Pro | Mostly good | Limit notes appear at the moment of need. The one weak spot is the permanent padlock in the prime slot. | §5, P1-2 |
| 9 | Destructive actions | **Needs work** | Sign out is the first row in Settings, in big red, with no question. Delete Task sits next to Save. | P2-2, P3-1 |
| 10 | Consistency | Needs work | Checkbox is left in Tasks but right in Schedule. Pushed pages use X like modals. | P2-7, P3-5 |
| 11 | Platform habits | Mostly good | Bottom sheets, alerts and Android back are handled well. iOS users expect ‹ on pushed pages and Sign out at the bottom of Settings. | P2-2, P3-5 |

---

## 3. Suggestions, ranked

Inside each level: big impact + small effort first.

### P1: High impact (the main daily flow)

#### P1-1 · Stay on Today after adding a task
- **Element:** where Add Task lands after saving
- **Now:** always jumps to the Tasks tab, even when opened from Today's "Add a task" (`app/add.tsx:188-192`).
- **Move to:** close the form and go back to wherever it was opened. Show the existing toast with where the task went: "Added to Today" or "Added · due Fri".
- **Why:** Today is the heart of the app. Adding a task currently throws you into the full list, which is the Todoist-like screen. Since Today only shows tasks due today, the toast also answers "where did my task go?".
- **Effort:** S

#### P1-2 · One "Add" button in the tab bar, opening a capture sheet (it takes the mic's slot)
- **Element:** tab bar slot 3 (Magic mic), the Tasks header's Add Task, Today's empty-state "Add a task"
- **Now:** the mic sits in slot 3 (`components/TabBar.tsx:269`). On Free it wears a padlock and opens the paywall. Adding by hand only starts from the Tasks header, top right (`app/(tabs)/tasks.tsx:143`). That is 2 taps from Today and out of thumb reach. Today has no add button at all while it shows cards.
- **Move to:** slot 3 becomes an orange **+** coin (same size and place as the mic now). Tapping it opens a bottom sheet called "Add":
  1. A focused text field, "What needs doing?", with small chips under it (Today · 45 min · Medium) and an **Add** button. One line, one tap.
  2. Three big buttons: **Magic mic** (padlock + "Pro" on Free), **Voice note**, **Photo or document** (see P1-3).
  3. **More options ›** opens the full Add Task form with the typed title carried over.

  The Tasks header loses its big Add Task button (or keeps a small + icon, see Question 1). Today's empty-state button opens the same sheet. Optional extra for Pro: long-press + opens Magic mic directly.
- **Why:** the most common input action becomes one thumb tap from every tab. All the ways to add sit in one place, and that place is the moment of need for Magic mic, so the upsell shows exactly when someone wants to add. Free users stop seeing a locked feature in the best spot of the app. Cost: Magic mic goes from 1 tap to 2 for Pro users (1 with long-press).
- **Effort:** M

#### P1-3 · Bring back voice notes and photos/documents as ways to add tasks, inside the capture sheet
- **Element:** voice note → tasks, photo/document → tasks
- **Now:** these only exist in the onboarding brain dump (`app/onboarding-dump.tsx` → `app/onboarding-analyzing.tsx`, through `/api/extract-text` and `/api/inbox`). No screen offers them after sign-up. `lib/plan.ts:36-41` notes that voice notes "aren't offered" since the chat went. Photos and documents only attach to tasks that already exist (bottom of Task Details, or a session's Add context).
- **Move to:** the capture sheet's **Voice note** and **Photo or document** buttons. Record or pick → the same transcribe → inbox pipeline as onboarding → a short review list ("Nexdo found 3 tasks · Add all") → back to Today with the toast from P1-1.
- **Why:** you list these as main ways to add tasks, but users only get them during the first five minutes. It also gives Free users an AI way to capture, since Magic mic is Pro only.
- **Cost note:** this stays inside Free allowances the server already enforces (voice 3 min, photos/documents 3, notes 20 a month; `lib/plan.ts:46`). So the worst-case cost per Free user can't rise above what those caps already allow. Typical use will rise from about zero. I'll show worst-case and typical cost per Free and Pro user before building this.
- **Effort:** L

### P2: Medium (clear improvement)

#### P2-1 · Magic mic returns to the page it was opened from
- **Element:** where Magic mic opens over and closes to
- **Now:** pressing the mic first switches to the Tasks tab (`TabBar.tsx:74-77`), and closing goes to Tasks (`app/live-voice.tsx:147-153`).
- **Move to:** don't switch tabs. Close with a plain "back". The mic screen already shows the changed tasks ("Just added / Updated / Done").
- **Why:** talking from Today and ending up on the full list breaks the Today-first flow.
- **Effort:** S

#### P2-2 · Sign out: to the bottom of Settings, and ask first
- **Element:** Sign out
- **Now:** a big red card right under the profile card, the first button in Settings (`app/(tabs)/settings.tsx:497`). When everything is saved it signs out with no question (`settings.tsx:466-472`).
- **Move to:** the last row of Settings, under Support and above the version, as red text. Ask "Sign out of Nexdo?" first.
- **Why:** it's rarely used and it's the first thing your thumb meets in Settings. Both iOS and Android apps keep it at the bottom.
- **Effort:** S

#### P2-3 · Task Details: X shouldn't silently drop edits
- **Element:** X (top right) vs Save Changes (bottom right)
- **Now:** X just goes back (`app/task/[id].tsx:509`). Anything open in the edit panel, the repeat picker, or a typed subtask or note is lost without a word.
- **Move to:** when something is being edited, X asks "Discard changes?" (Discard / Keep editing). With nothing open, it stays a plain close.
- **Why:** two exits with different results, and one of them loses work.
- **Effort:** S

#### P2-4 · Edit priority (and notes) in the same place as the other fields
- **Element:** Priority, Notes
- **Now:** priority can only be picked when creating the task (`app/add.tsx:295`). The pencil's edit panel has title, duration and deadline only (`components/TaskEditPanel.tsx:26`). Notes are read-only on Task Details (`task/[id].tsx:748`).
- **Move to:** the edit panel gets the same Priority cards and a Notes field as Add Task.
- **Why:** priority decides the order on Today, yet it can't be fixed later. Users will open Edit, look for it, and not find it.
- **Effort:** S

#### P2-5 · Add Task: move "Repeats" under "Optional"
- **Element:** Repeats section
- **Now:** always shown, between Deadline and Priority (`app/add.tsx:291`).
- **Move to:** inside "Optional", next to Plan steps and Notes.
- **Why:** few tasks repeat. The essentials (title, duration, deadline, priority) then fit on one screen with no scroll, which means less thinking.
- **Effort:** S

#### P2-6 · "Not today" on the Today card
- **Element:** postpone, from the card
- **Now:** swipe and Next only rotate the deck, so the same task is back on top next time. Moving it takes 3 taps: title → +1 day → X.
- **Move to:** a small text button under Mark complete: **Not today →**. It moves the deadline to tomorrow, with the Undo toast.
- **Why:** "what to do next" also means saying "not this one" fast. See Question 4.
- **Effort:** S

#### P2-7 · Checkbox on the same side everywhere
- **Element:** the complete checkbox in lists
- **Now:** left in Tasks and Magic mic (`components/TaskCard.tsx:256`), right in Schedule (`components/ScheduleItemRow.tsx:142`).
- **Move to:** left everywhere. Schedule's time box moves to the right.
- **Why:** muscle memory. A thumb aiming at "complete" opens Task Details instead.
- **Effort:** S

#### P2-8 · Reset my week: more doors, and a calmer button
- **Element:** Reset my week entry points
- **Now:** one door, the Slipped card on Today, with an **orange primary** "Reset" (`index.tsx:273`) that competes with Start session. Schedule shows late days with red dots (`schedule.tsx:258`) but offers no reset. Tasks shows "2 overdue" (`tasks.tsx:174`), but it isn't tappable. The daily planning notification already mentions slipped tasks and opens Today (`lib/reminders.ts:230-243`), which is good.
- **Move to:**
  - (a) Slipped card button → secondary style, so Start session stays the only orange action on Today.
  - (b) Schedule header: a "Reset my week" chip when the week shown has late tasks.
  - (c) Tasks header "2 overdue" → tappable, opens the Reset sheet.
  - (d) A daily planning notification with slipped tasks opens Today with the Reset sheet already open.
- **Why:** reset is offered where people actually notice late tasks, and Today keeps one orange action.
- **Effort:** S–M

#### P2-9 · Focus session: hide the tab bar, add "Minimize"
- **Element:** the way out of a running session
- **Now:** the session fills Today, but the tab bar stays on and active (`index.tsx:150`). The only exits are Complete or Cancel session (which drops the time). Switching tabs and coming back shows the session again, so you can't look at your other cards while the timer runs.
- **Move to:** hide the tab bar while a session is open. Add **⌄ Minimize** top left. It takes you back to the deck, where the card already shows "Resume session" with the clock (`components/StartSessionButton.tsx`).
- **Why:** a focus screen shouldn't show doors to Settings and Magic mic, and it needs a way out that doesn't destroy anything.
- **Effort:** M

#### P2-10 · Settings: reorder to the structure you decided
- **Element:** Settings sections
- **Now:** Account (+ Sign out) · Your plan · Notifications · AI · Language · Help & Support. No Appearance, no Data. Delete account is hidden at the bottom of the Account sheet. The theme setting is saved but never applied (`store/useSettingsStore.ts:9`).
- **Move to:**
  1. **Account**: profile row; plan row ("Free plan · Upgrade ›" or "Nexdo Pro · Manage ›") with this month's usage; Restore purchases
  2. **Inbox AI behavior**: AI features switch (and future AI options)
  3. **Notifications**: unchanged
  4. **Appearance**: Language (and Theme once dark mode works)
  5. **Data**: Delete account (Export when built)
  6. **Support**: FAQ, App tour, Send feedback, Privacy, Terms
  7. Sign out (P2-2), then the version
- **Why:** it matches your plan, the plan sits with the account, and Delete account becomes easy to find (Apple asks for that).
- **Effort:** M

### P3: Polish

#### P3-1 · Delete Task out of the Save tray
- **Element:** Delete Task
- **Now:** bottom left, next to Save Changes (`task/[id].tsx:828`). Its confirmation says "This can't be undone" (`constants/translations/en.ts:266`), but an Undo toast follows.
- **Move to:** the end of the scrolling content, as a red text row. Change the text to "You can undo this for a few seconds."
- **Why:** the main button's tray should hold only safe actions, and the confirmation text should be true.
- **Effort:** S

#### P3-2 · Subtask rows: fewer icons
- **Element:** ✎ and 🗑 on every subtask
- **Now:** both icons on every row (`task/[id].tsx:713`).
- **Move to:** tap the label to edit. The trash icon shows only while editing.
- **Why:** less clutter on a long page.
- **Effort:** S

#### P3-3 · Tasks: show "Showing X of Y" only when filtered
- **Element:** the "Showing X of Y tasks" line
- **Now:** always shown (`tasks.tsx:218`), right under counts that already say the same thing.
- **Move to:** only while a filter or search is active.
- **Why:** less text on the list.
- **Effort:** S

#### P3-4 · Add Task: one way to cancel
- **Element:** X (top) and Cancel (bottom)
- **Now:** both close the form.
- **Move to:** keep X. Give **Add Task** the full width of the bottom tray.
- **Why:** one cancel, and a bigger target for the main action.
- **Effort:** S

#### P3-5 · Pushed pages get a back arrow
- **Element:** X on Task Details and Schedule
- **Now:** they are pushed pages but close with X, like modals.
- **Move to:** ‹ top left on pushed pages. Keep X for real modals (Add, Magic mic, Paywall, Feedback).
- **Why:** iOS habit, and it tells people whether they are going "back" or "closing".
- **Effort:** S

#### P3-6 · Today card: drop the "Score: 72" pill
- **Element:** score pill on the Today card
- **Now:** shown on every card, next to "#1 Priority".
- **Move to:** Task Details and the Tasks list only. Keep "#1 Priority".
- **Why:** fewer numbers on the calmest screen. See Question 5.
- **Effort:** S

#### P3-7 · Tour: say where breakdown and tips live
- **Element:** the Today step of the first-run tour
- **Now:** says "Swipe for the others, or tap Start session to focus" (`en.ts:463`).
- **Move to:** add "…and get a step-by-step breakdown or tips inside it." If P1-2 is built, the mic step becomes the + step.
- **Why:** sessions are the only place these features live (your choice), so the tour is the only hint.
- **Effort:** S

#### P3-8 · "Pinned first" has no button
- **Element:** pinning a task to the top
- **Now:** the card can show "Pinned first", but no button sets it. Only an AI action can (`lib/taskOperations.ts:531`).
- **Move to:** either a "Do this first" switch in Task Details, or drop the feature. See Question 8.
- **Why:** a state that users can see but can't create is confusing.
- **Effort:** S

---

## 4. Daily capacity check and Reset my week: where and when

**Reset my week** (built): the placement is right. It's a calm card on Today, only when something slipped, and it never pops up by itself. Keep it that way, and add the doors in P2-8: Schedule, the Tasks overdue count, and the notification opening the sheet. Do **not** auto-open the sheet when the app opens. It would block the main flow on exactly the days people already feel behind.

**Daily capacity check** (not in the code): on 10-12 you said not to build it (P1-4 in `NEXDO_AUDIT.md`). If you want it now, here is the placement I'd use:
- **No new button and no new screen.** One line inside the existing Today progress card, shown only when today's tasks add up to clearly more than this user usually finishes in a day. For example: "About 6 h due today — more than you usually finish. Move some ›"
- "Move some" opens the Reset sheet's layout for **today's** tasks (same component, same undo).
- **When:** the first time the app is opened each morning, and as one sentence in the daily planning notification. Never as a pop-up.
- **Cost:** worked out on the phone from durations and past completions, so about $0 in AI.

---

## 5. Free vs Pro: where it shows today

| Where | What shows | Verdict |
|---|---|---|
| Tab bar, slot 3 | Padlocked mic → paywall, always | **Weak**: the best spot is spent on a lock for most users. P1-2 moves it into the Add sheet, still visible, at the moment of need |
| Session: Break down / Get advice | "2 left" when low; "Get more with Pro" when used up; buttons open the paywall | Good: right moment, doesn't block the session |
| Task Details + session Add context | "N left" for notes and photos; paywall opens once when the limit is hit | Good |
| Magic mic screen | "N min left" when low | Good |
| Settings → Your plan | Usage + Upgrade + Restore, or Manage | Good content; move it into Account (P2-10) |
| After sign-up | Paywall once, unless onboarding already showed it | OK |
| Paywall | X, "Continue with Free", Restore / Terms / Privacy | Good (store rules met) |

Nothing Pro-related blocks the main flow. Manual add, Today and reminders are unlimited on both plans.

---

## 6. Proposed map (after all suggestions)

```
(tabs) — 4 equal slots
├─ [1] Today
│     ├─ progress card (+ capacity line, only if you want it)
│     ├─ slipped card → Reset sheet (secondary button)
│     ├─ card: Start session · Mark complete · Not today
│     └─ Focus session (no tab bar, ⌄ Minimize top left)
├─ [2] Tasks              (header: search; "N overdue" → Reset sheet)
├─ [3] + Add → capture sheet
│        ├─ type a task → Add
│        ├─ Magic mic (Pro / padlock)      [long-press + = Magic mic, Pro]
│        ├─ Voice note → found tasks → Add
│        ├─ Photo or document → found tasks → Add
│        └─ More options → full Add Task form
└─ [4] Settings: Account (+plan) · Inbox AI · Notifications · Appearance · Data · Support · Sign out

push:  Task Details (‹ back; edit includes priority + notes; Delete at the end of the scroll)
push:  Schedule (‹ back; "Reset my week" chip when late tasks)
modal: Magic mic (returns to where it was opened) · Paywall · Feedback · full Add Task
```

| Feature | Now | After |
|---|---|---|
| Add a task by hand | 3 (top right, Tasks) | **2** (+ → Add), from any tab |
| Voice note → tasks | not possible | **2** + recording |
| Photo/document → tasks | not possible | **3** (+ → Photo → pick) |
| Magic mic (Pro) | 1 | 2 (1 with long-press) |
| Postpone the top task | 3 | **1** (Not today) |
| Leave a session without cancelling | not possible | **1** (Minimize) |
| Reset my week | 2, Today only | 2, from Today, Schedule, Tasks or the notification |
| Change priority | not possible | 3 (title → pencil → Save) |
| Sign out | 2, no question | 3 (scroll to bottom, confirm) |
| Complete / Start / Next | 1 / 1 / 1 | unchanged |

---

## 7. Sketches

### Today
```
┌────────────────────────────────────┐
│ ◆ MONDAY, OCTOBER 12  [📅 Schedule] │
│ Today                              │
│ ┌────────────────────────────────┐ │
│ │ 3 tasks left        2 of 5 done│ │
│ │ ███████████░░░░░░░░░░░░░░░░░░░ │ │
│ │ (capacity line, only if wanted)│ │
│ └────────────────────────────────┘ │
│ ┌────────────────────────────────┐ │
│ │ ↻ 2 tasks slipped   ( Reset )  │ │ ← secondary, not orange
│ └────────────────────────────────┘ │
│ ┌────────────────────────────────┐ │
│ │ 🔥 #1 Priority                 │ │
│ │ Finish the tax form            │ │
│ │ 📅 Today  |  ⏱ 45 mins          │ │
│ │ [ ▶  Start session           ] │ │ ← the one orange button
│ │ [ ✓  Mark complete           ] │ │
│ │            Not today →         │ │
│ └────────────────────────────────┘ │
│  [ ← Previous ]     [ Next → ]     │
│╭──────────────────────────────────╮│
││  ⚡ Today   📋 Tasks   (+)   ⚙    ││ ← + replaces the mic
│╰──────────────────────────────────╯│
└────────────────────────────────────┘
```

### Add (capture sheet, from +)
```
╭────────────────────────────────────╮
│              ───                   │
│ Add                             ✕  │
│ ┌────────────────────────────────┐ │
│ │ What needs doing?▏             │ │ ← keyboard opens
│ └────────────────────────────────┘ │
│ [Today] [45 min] [Medium]   [ Add ]│ ← chips change the defaults
│                                    │
│ [ 🎙  Magic mic           🔒 Pro ] │
│ [ ●  Voice note ] [ 📷 Photo / doc ]│
│                                    │
│ More options ›                     │ → full form, title carried over
╰────────────────────────────────────╯
```

### Add Task (full form, "More options")
```
Add Task                            ✕
TITLE      [ Finish the tax form    ]
DURATION   [15m] [30m] [45m] [1h] …   Custom ✎
DEADLINE   [Today] [Tomorrow] …       Pick a date
PRIORITY   [ High ] [ Medium ] [ Low ]
              ( Optional ⌄ )
              → Repeats · Plan steps · Notes
────────────────────────────────────
[            + Add Task            ]
```

### Focus session
```
⌄ Minimize
┌─ glass ────────────────────────┐
│ #1 Priority                    │
│ Finish the tax form            │
│ [📅 Today] [⏱ 45 mins]          │
│ ☐ Gather receipts  ☐ Fill form │
│           ( 23:41 )            │
│  [ ⏸ Pause ]   [ ✓ Complete ]  │
│        ✕ Cancel session        │
│ [ Break down ] [ Get advice ]  │
│ [ 📎 Add context ]              │
└────────────────────────────────┘
          (no tab bar)
```

### Settings
```
Settings
ACCOUNT
  [ 👤 Mo · mo@…                   › ]
  [ Free plan · 3 of 5 tips used     ]
  [ Upgrade to Nexdo Pro           › ]
  [ Restore purchases              › ]
INBOX AI BEHAVIOR
  AI features                   [ on ]
NOTIFICATIONS
  Deadline reminders · Daily planning · Overdue alerts
APPEARANCE
  Language  [English] [Français] …
DATA
  Delete account                   ›
SUPPORT
  FAQ / Help · App tour · Send feedback · Privacy · Terms
  Sign out                (red text, asks first)
  Nexdo v1.0.0
```

---

## 8. Questions for you

1. **Add-first or mic-first?** I recommend the + in slot 3 with Magic mic inside the sheet (P1-2). The alternative is to keep the mic for Pro users and show + only on Free, but then the bar changes with the plan. Also: should Tasks keep a small + in its header, or is the tab bar enough?
2. **Voice notes and photos for Free users (P1-3)?** They would use the existing caps (3 min voice, 3 photos/documents, 20 notes a month). I'll bring worst-case and typical cost numbers before building. OK to go ahead on that basis?
3. **Daily capacity check:** still "not wanted" (your 10-12 call)? If you want it, is the placement in §4 right?
4. **"Not today" on the Today card (P2-6):** yes or no? It's a third action on the card.
5. **Score on the Today card (P3-6):** keep "Score: 72", or keep it only in Task Details and Tasks?
6. **Your plan:** inside Account (my suggestion), or its own section? It isn't in your decided list.
7. **Appearance:** the theme setting is saved but does nothing yet. Should Appearance be just Language for launch, with no theme switch?
8. **"Pinned first" (P3-8):** add a "Do this first" switch, or remove pinning?
9. **Data section:** only Delete account at launch, or do you want Export too?
