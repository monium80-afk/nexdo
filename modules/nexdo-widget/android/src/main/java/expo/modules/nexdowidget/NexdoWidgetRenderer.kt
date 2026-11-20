package expo.modules.nexdowidget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Draws the widget from the data the app saved (lib/widgetData.ts): the task
 * on top of Today on Today's dark card. No ✓ — finishing happens in the app.
 * Taps open the app through its nexdo:// links: the task, /add, and /mic
 * (which opens the plans instead on Free).
 */
object NexdoWidgetRenderer {
  private const val PREFS = "nexdo_widget"
  private const val KEY = "data"

  // Today's card colours (constants/theme/colors.ts).
  private val PEACH = Color.parseColor("#FFB089")
  private val OVERDUE = Color.parseColor("#F0957E")

  fun save(context: Context, json: String) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, json).apply()
  }

  /** Redraws every Nexdo widget on the home screen. */
  fun refreshAll(context: Context) {
    val manager = AppWidgetManager.getInstance(context)
    val sizes = listOf(NextTaskSmallWidget::class.java to false, NextTaskMediumWidget::class.java to true)
    for ((provider, medium) in sizes) {
      for (id in manager.getAppWidgetIds(ComponentName(context, provider))) {
        manager.updateAppWidget(id, build(context, medium))
      }
    }
  }

  fun build(context: Context, medium: Boolean): RemoteViews {
    val views = RemoteViews(
      context.packageName,
      if (medium) R.layout.nexdo_widget_medium else R.layout.nexdo_widget_small,
    )
    val data = read(context)
    val labels = data?.optJSONObject("labels")
    fun label(key: String, fallback: Int) = labels?.optString(key)?.takeIf { it.isNotEmpty() } ?: context.getString(fallback)

    val signedIn = data?.optBoolean("signedIn") == true
    val task = if (signedIn) data?.optJSONObject("task") else null

    var heading = "Nexdo"
    var headingColor = PEACH
    val title: String
    val detail: String
    val tapUrl: String
    when {
      !signedIn -> {
        title = label("signIn", R.string.nexdo_widget_sign_in)
        detail = ""
        tapUrl = "nexdo://"
      }
      task == null -> {
        title = label("allClear", R.string.nexdo_widget_all_clear)
        detail = label("allClearBody", R.string.nexdo_widget_all_clear_body)
        tapUrl = "nexdo://add"
      }
      else -> {
        // The same label as lib/widgetData.ts widgetDueLabel.
        val next = label("next", R.string.nexdo_widget_next)
        val dueKey = task.optString("dueKey").takeIf { it.isNotEmpty() && it != "null" }
        val today = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
        heading = when {
          dueKey == null -> next
          dueKey < today -> {
            headingColor = OVERDUE
            "$next · ${label("overdue", R.string.nexdo_widget_overdue)}"
          }
          dueKey == today -> listOfNotNull(next, label("today", R.string.nexdo_widget_today), task.text("time")).joinToString(" · ")
          else -> listOfNotNull(next, task.text("dueText")).joinToString(" · ")
        }
        title = task.optString("title")
        detail = task.optString("length")
        tapUrl = "nexdo://task/" + Uri.encode(task.optString("id"))
      }
    }

    views.setTextViewText(R.id.nexdo_widget_label, heading.uppercase(Locale.getDefault()))
    views.setTextColor(R.id.nexdo_widget_label, headingColor)
    views.setTextViewText(R.id.nexdo_widget_title, title)
    views.setTextViewText(R.id.nexdo_widget_detail, detail)
    views.setViewVisibility(R.id.nexdo_widget_detail, if (detail.isEmpty()) View.GONE else View.VISIBLE)
    views.setOnClickPendingIntent(R.id.nexdo_widget_root, open(context, tapUrl, if (medium) 2 else 1))

    if (medium) {
      views.setViewVisibility(R.id.nexdo_widget_buttons, if (signedIn) View.VISIBLE else View.GONE)
      views.setTextViewText(R.id.nexdo_widget_add_text, label("add", R.string.nexdo_widget_add))
      views.setTextViewText(R.id.nexdo_widget_mic_text, label("mic", R.string.nexdo_widget_mic))
      val locked = data?.optBoolean("micLocked") == true
      views.setImageViewResource(
        R.id.nexdo_widget_mic_icon,
        if (locked) R.drawable.nexdo_widget_ic_lock else R.drawable.nexdo_widget_ic_mic,
      )
      views.setOnClickPendingIntent(R.id.nexdo_widget_add, open(context, "nexdo://add", 3))
      views.setOnClickPendingIntent(R.id.nexdo_widget_mic, open(context, "nexdo://mic", 4))
    }
    return views
  }

  private fun read(context: Context): JSONObject? {
    val json = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null) ?: return null
    return try {
      JSONObject(json)
    } catch (_: Exception) {
      null
    }
  }

  /** A JSON text field, or null when it's missing or null. */
  private fun JSONObject.text(key: String): String? =
    if (isNull(key)) null else optString(key).takeIf { it.isNotEmpty() }

  /** Opens the app at a nexdo:// link (Expo Router takes it from there). */
  private fun open(context: Context, url: String, requestCode: Int): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return PendingIntent.getActivity(
      context,
      requestCode,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }
}
