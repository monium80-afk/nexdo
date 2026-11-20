package expo.modules.softinput

import android.view.WindowManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Switches Android's own keyboard handling off for the app's window while a
 * screen places itself on the keyboard (the Add task sheet), and back on after.
 *
 * The app runs in "pan" mode (app.json softwareKeyboardLayoutMode): when the
 * keyboard comes up, Android slides the whole page up just enough to show the
 * line being typed. The sheet lifts itself onto the keyboard too, so with both
 * it ended up twice as high (2026-11-14). Other screens still rely on that
 * slide, so it's only paused while the sheet is open.
 */
class SoftInputModule : Module() {
  // The window's mode before it was paused, to put back exactly.
  private var savedMode: Int? = null

  override fun definition() = ModuleDefinition {
    Name("SoftInput")

    Function("setAdjustNothing") { on: Boolean ->
      val activity = appContext.currentActivity ?: return@Function
      activity.runOnUiThread {
        val window = activity.window
        val current = window.attributes.softInputMode
        if (on) {
          if (savedMode == null) savedMode = current
          val others = current and WindowManager.LayoutParams.SOFT_INPUT_MASK_ADJUST.inv()
          window.setSoftInputMode(others or WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING)
        } else {
          savedMode?.let { window.setSoftInputMode(it) }
          savedMode = null
        }
      }
    }
  }
}
