package expo.modules.nexdowidget

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The app's side of the home screen widget: lib/widget.android.ts hands over
 * the widget's data (lib/widgetData.ts, as JSON) whenever it changes, and
 * every Nexdo widget on the home screen is redrawn from it.
 */
class NexdoWidgetModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NexdoWidget")

    Function("update") { json: String ->
      val context = appContext.reactContext?.applicationContext ?: return@Function
      NexdoWidgetRenderer.save(context, json)
      NexdoWidgetRenderer.refreshAll(context)
    }
  }
}
