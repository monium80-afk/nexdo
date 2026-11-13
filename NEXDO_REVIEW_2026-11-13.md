# Nexdo 2.0.0 — whole-app review (2026-11-13)

Before the 2.0.0 build (Android versionCode 11). Read-only review: nothing in this report has been changed yet.

**How it was checked:**
- **Code:** read the app and server code. Ran type check, lint, the 409 tests and `expo-doctor`.
- **Crash scan:** scanned the whole app for the crash that hit screens 06, 09 and 12: a plain helper function called from an animation. Two scans, one for helpers at the top of a file and one for helpers written inside an animation. No other case found.
- **Security:** reviewed every API route and the database rules.
- **Not tested on a real phone:** lag, keyboard behaviour and how the Android-only fixes look all need your phone.

---

## 1. Big, before you ship

### B1. Most of the redesign isn't saved in git
Git shows 100 changed files. Some have never been committed at all, so they exist only on this PC:
- `app/onboarding/` (all 14 screens)
- `components/onboarding/`
- `components/NexdoPaywall.tsx`
- the focus sounds
- the Caveat font
- `useOnboardingLiveVoice`

A disk problem or a mistaken command would lose weeks of work.
**Fix:** commit and push now, before anything else.

### B2. The server has to be deployed before release
Screen 07 (the live brain dump before sign-up) calls a server path that isn't online yet. Without `npm run deploy:server`, every new user's first real interaction fails. That's the core "wow" moment of the onboarding.
**Fix:** deploy, then test 07 signed out on the phone.

### B3. No safety net for crashes
No screen has an error boundary. Any rendering error shows a red box in development; in the store app, it can kill the app or leave a blank screen.
**Fix:** add one root `ErrorBoundary` (Expo Router supports it). It should show "Something went wrong" with a "Reload" button and report the error to PostHog (`captureException`). Small job, big protection.

### B4. Brain-dump tasks are silently lost on "Log in"
If someone does the onboarding brain dump and then logs in to an existing account (instead of creating one), the tasks they just said are thrown away. Drafts are only saved for new accounts (`hooks/useAuthSync.ts`). This happens to anyone who reinstalls the app.
**Fix:** after logging in with drafts waiting, ask "Add the 5 tasks from your brain dump?" (Add / Skip).

### B5. Store paperwork is out of date
- **`APP_REVIEW_NOTES.md`:**
  - It still says the + is in the middle of the tab bar, with the mic beside it. The mic is in the middle now, and + is on the Today page.
  - It doesn't mention the new onboarding: the live voice demo before sign-up, and the paywall opening on Pro.
  - A reviewer following the old notes will get lost.
- **Website privacy policy:** the version that covers the onboarding voice demo (§2.3) isn't uploaded. The stores link to the live one.
- **Play Console Data safety:** it must say audio is sent to Google (Gemini) before sign-in for the onboarding demo.

### B6. Apple sign-in on iPhone should be native
Apple sign-in currently opens a browser window (Clerk's web OAuth). On iOS, App Review expects the native "Sign in with Apple" sheet. Clerk's Expo SDK supports it, using `expo-apple-authentication`, a new package that needs your OK. Android can keep the browser flow.
**When:** before the first iOS submission of 2.0.

### B7. A new native build is required and needs a phone pass
Three things only show up after a new build:
- the Caveat handwriting on the founder note;
- the 2.0.0 version name;
- several Android-only fixes, still unconfirmed on a real phone: text hidden under shadows, and the crash fixes on 06, 09 and 12.

**Fix:** build, then walk the whole app once: onboarding 01→14, sign-up, sign-in, the Today stack, Magic mic, the paywall from Settings, notifications.

---

## 2. Small fixes

| # | Where | Problem | Fix |
|---|---|---|---|
| S1 | Whole app (`app.json`) | Android keyboard mode is `"pan"`: when the keyboard opens, the whole screen slides up. That's what pushed "Welcome back." under the status bar. | Switch to `"resize"` and check the add-task sheet, Account sheet and task details on the phone. |
| S2 | Date/time pickers (`TaskFormFields`, `RecurrencePicker`, the 8:30 picker on 10) | The app is light-only, but the pickers follow the phone's dark mode, so a dark spinner or dialog can open on a light sheet. The "theme" setting is stored but does nothing else. | Force the pickers to light. Remove the unused theme setting, or build a real dark mode later. |
| S3 | Durations | "2 h 15 mins" mixes the short and long forms. | Use "min" everywhere: "2 h 15 min". |
| S4 | Dead code | Never used: `CompletionBurst`, `FormSection`, `PlanUsage`, `ProfileCard`, `SoundWaves`, `TimerRing`, `lib/supabaseStorage.ts`, the `PlanPicker` component (only its types are used), and the old in-app paywall's strings. | Delete them. A smaller app is easier to maintain and teach. |
| S5 | Repo clutter | `graphify-out/` (53 cache files) is committed. A stray `Benmouna/` folder at the project root came from a command with an unquoted path. `design/` and the design hand-off folders are untracked. | Delete `Benmouna/` and add the rest to `.gitignore`. |
| S6 | Dependencies | 24 Expo packages are a patch behind (`expo` 58.0.20 → 58.0.25, `expo-router`, `expo-notifications`…). | `npx expo install --check` before the build. Patch updates are bug fixes only. |
| S7 | Tasks tab | Every task is drawn at once in a `ScrollView`, each with its own layout animation. Fine for dozens of tasks, laggy at a few hundred. | Switch to `FlatList` (built into React Native, no new package). |
| S8 | In-app paywall | "Continue with Free" reads oddly for someone already using Free inside the app. | Say "Not now" in the app; keep "Continue with Free" in onboarding. |
| S9 | Translations | The 9 non-English languages are my translations and nobody has reviewed them. Some are long enough to wrap: the German paywall, Arabic and Hindi screens. | Have a native speaker read French first (your Quebec users), then Spanish. |

---

## 3. Suggestions

1. **Quebec Law 25: analytics.**
   - Analytics (PostHog) receives the user's first and last name with every identified session. The account ID alone is enough for analytics. Stop sending names; it's less data to protect.
   - Law 25 can require consent for tracking that profiles a user. Finish the privacy impact assessment and consider a one-line analytics consent in onboarding.
2. **Old chat data.** Chat messages and attachments from before 8 October 2026 are still stored, though the app no longer uses them. Deleting them (you, in Supabase) reduces what you hold and matches the "we keep what we need" spirit of the policy.
3. **Measure the onboarding.** 14 screens is long. Send one PostHog event per screen and look at where people drop off after a week; cut or merge the weakest screens.
4. **Split the biggest files** when you next touch them. Each is a single file doing many jobs, which makes bugs harder to find:

   | File | Lines |
   |---|---|
   | `store/useTaskStore.ts` | 1,441 |
   | `components/NextTaskCard.tsx` | 1,364 |
   | `components/NextTaskCardStack.tsx` | 1,022 |
   | `components/addSheet/AddTaskSheet.tsx` | 961 |

5. **An "offline" hint.** Sync failures are retried silently. A small "Offline — changes saved on this phone" line would reassure users when sync is down.
6. **Load test on the phone.** Make an account with 200 tasks and scroll Tasks, Calendar and Today. That's the quickest way to find real lag.

---

## 4. What's in good shape

- **Security:**
  - Every API route checks sign-in, caps request size, and charges the monthly plan before calling the AI, refunding the charge if the AI call fails.
  - Signed-out calls are rate-limited and limited to a small trial per phone.
  - All 8 database tables have row-level security.
  - No secret key is reachable from the app.
- **Accounts:**
  - Sign-out stores any unsynced tasks safely and starts the next account clean.
  - Account deletion exists in the app and on the web.
- **AI consent:** asked before any audio or text goes to Google, including the onboarding demo.
- **Purchases:** buying before sign-up carries over to the account. Restore works from the paywall and Settings.
- **Animation crashes:** the app-wide scan found no other case of the crash that hit 06, 09 and 12.
- **Checks:** type check clean, lint clean, 409 of 409 tests pass.
