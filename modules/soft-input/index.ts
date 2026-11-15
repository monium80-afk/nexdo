import { requireOptionalNativeModule } from "expo-modules-core";

// The app's own Android module (android/.../SoftInputModule.kt). Missing on
// iOS and the web, where there's nothing to switch: then this does nothing.
const SoftInput = requireOptionalNativeModule<{ setAdjustNothing(on: boolean): void }>("SoftInput");

/**
 * Pauses (true) or restores (false) Android's own sliding of the page when
 * the keyboard comes up — for a screen that places itself on the keyboard.
 */
export function setKeyboardAdjustNothing(on: boolean) {
  SoftInput?.setAdjustNothing(on);
}
