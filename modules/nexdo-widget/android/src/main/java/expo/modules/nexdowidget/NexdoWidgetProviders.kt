package expo.modules.nexdowidget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context

/**
 * The two sizes of the widget. Android asks each to redraw when it's placed
 * and every hour (res/xml/nexdo_widget_*_info.xml) — the hourly one is what
 * turns "Today" into "Overdue" after midnight with the app closed.
 */
open class NexdoWidgetProvider(private val medium: Boolean) : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
    for (id in appWidgetIds) {
      manager.updateAppWidget(id, NexdoWidgetRenderer.build(context, medium))
    }
  }
}

/** Small (2×2): the next task; tapping opens it. */
class NextTaskSmallWidget : NexdoWidgetProvider(medium = false)

/** Medium (4×2): the next task, with + (Add task) and the Magic mic. */
class NextTaskMediumWidget : NexdoWidgetProvider(medium = true)
