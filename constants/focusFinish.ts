import { Easing } from "react-native-reanimated";

/**
 * "Task done in Focus" (nexdo-design-handoff Anim-FocusTaskDone.dc.html, the
 * ft* keyframes of its 7 s loop, 1 % = 70 ms). Every time is in ms from the
 * tap on Done, which the mockup makes at 5 %. Only the run up to Today is
 * built — the mockup's 93–100 % is its preview resetting.
 *
 * Used by FocusClockFace (ring, clock, gem, waves), NextTaskCard (the press,
 * glow, title strike, controls) and Today's FocusCardTransition (the fade back).
 */
export const FOCUS_FINISH = {
  /** Every segment's easing: cubic-bezier(.3,.7,.2,1). */
  ease: Easing.bezier(0.3, 0.7, 0.2, 1),

  // ftTap 5–7–10 %: the Done button pressed in and back.
  pressInMs: 140,
  pressOutMs: 210,

  // ftRing 10–26 %: the ring fills to 100 % and closes.
  ringAt: 350,
  ringMs: 1120,
  closesAt: 1470,

  // ftOut 13–22 %: the clock up 26 and out; ftIn 18–28 %: "Done" up from +26.
  clockOutAt: 560,
  clockOutMs: 630,
  doneInAt: 910,
  doneInMs: 700,
  textShift: 26,

  // ftWave 26–44 %, ftWave2 31–52 %.
  wave1Ms: 1260,
  wave2At: 1820,
  wave2Ms: 1470,

  // ftGlow 24–34–50 %: up to 1.25, settling at 1.12 (opacity .9).
  glowAt: 1330,
  glowUpMs: 700,
  glowSettleMs: 1120,

  // ftHop 26–29–35–41–45 %: squash, jump, land, rest.
  hopMs: [210, 420, 420, 280] as const,
  // ftEyeOld / ftEyeNew 28–30 %.
  eyesAt: 1610,
  eyesMs: 140,

  // ftStrike 34–46 %, ftTitle 36–46 %.
  strikeAt: 2030,
  strikeMs: 840,
  titleToneAt: 2170,
  titleToneMs: 700,

  // ftBtnOut 40–48 %: Pause, Done and the links under them, down 14 and out.
  controlsOutAt: 2450,
  controlsOutMs: 560,
  controlsShift: 14,

  // ftSheet 54–62 %: the Focus screen fades out in place, to 0.97.
  sheetOutAt: 3430,
  sheetOutMs: 560,
  // ftToday 56–66 %: Today fades in as it is.
  todayInAt: 3570,
  todayInMs: 700,

  /** Reduce Motion: no hop, waves or strike — a plain cross-fade to Today after 600 ms. */
  reducedAt: 600,
  reducedMs: 300,
} as const;
