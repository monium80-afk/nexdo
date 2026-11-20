import type { WidgetData } from "@/lib/widgetData";
import { NexdoWidget } from "@/modules/nexdo-widget";

/**
 * The Android widget (modules/nexdo-widget): the data is saved on the phone
 * as JSON and every widget on the home screen is redrawn from it. It redraws
 * itself every hour too, so "Today" turns into "Overdue" after midnight.
 */
export function updateHomeWidget(data: WidgetData): void {
  NexdoWidget?.update(JSON.stringify(data));
}
