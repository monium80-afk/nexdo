import { addDaysToKey, keyToLocalDate, toLocalDateKey } from "@/lib/localDate";
import type { WidgetData } from "@/lib/widgetData";
import { nextTaskWidget } from "@/widgets/NextTaskWidget";

/** How many midnights ahead the widget redraws itself, in case the app isn't opened. */
const MIDNIGHTS = 3;

/**
 * The iPhone widget (widgets/NextTaskWidget.tsx). The same data is drawn now
 * and again at each of the next few midnights, so "Today" turns into
 * "Overdue" on its own — the widget works the label out from its date.
 */
export function updateHomeWidget(data: WidgetData): void {
  try {
    const now = new Date();
    const today = toLocalDateKey(now);
    const entries = [{ date: now, props: data }];
    for (let day = 1; day <= MIDNIGHTS; day++) {
      entries.push({ date: keyToLocalDate(addDaysToKey(today, day)), props: data });
    }
    nextTaskWidget.updateTimeline(entries);
  } catch {
    // A build without the widget extension: nothing to update.
  }
}
