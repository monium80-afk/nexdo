import { HStack, Image, Link, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  background,
  clipShape,
  containerBackground,
  font,
  foregroundStyle,
  lineLimit,
  padding,
  textCase,
  widgetURL,
} from "@expo/ui/swift-ui/modifiers";
import { createWidget, type WidgetEnvironment } from "expo-widgets";

import type { WidgetData } from "@/lib/widgetData";

/**
 * The iPhone home screen widget (2026-11-19): the task on top of Today on
 * Today's dark card. Small = the task, tapping opens it. Medium = the same
 * with + (Add task) and the Magic mic underneath — a padlock on Free, where
 * it opens the plans. No ✓: finishing a task happens in the app.
 *
 * The app hands the data over (hooks/useWidgetSync.ts → lib/widget.ios.ts).
 * Android draws the same widget natively (modules/nexdo-widget).
 *
 * The "widget" function below is turned into a string by Expo's Babel
 * preset and run by the widget on its own: it can't use anything from
 * outside it — no imports (the components above are globals there),
 * constants or helpers. Hence the colours and the label logic inline.
 */
function NextTaskWidget(props: WidgetData, environment: WidgetEnvironment) {
  "widget";
  // Today's card: the same in light and dark mode (constants/theme/colors.ts).
  const CARD = "#221C17";
  const ON_CARD = "#FAF1E4";
  const FAINT = "#A89A8E";
  const PEACH = "#FFB089";
  const OVERDUE = "#F0957E";
  const ACCENT = "#F26A2E";
  const GLASS = "#3A302A";

  const medium = environment.widgetFamily === "systemMedium";
  const task = props.task;
  const labels = props.labels;

  // "Today" / "Overdue" from the widget's own date, so it's right after
  // midnight with the app closed (lib/widgetData.ts widgetDueLabel).
  // (new Date(…) whether the runtime hands over a Date, a number or a string.)
  const now = environment.date ? new Date(environment.date as unknown as string) : new Date();
  const two = (n: number) => (n < 10 ? "0" + n : "" + n);
  const today = now.getFullYear() + "-" + two(now.getMonth() + 1) + "-" + two(now.getDate());
  let label = labels.next;
  let overdue = false;
  if (task && task.dueKey) {
    if (task.dueKey < today) {
      label = labels.next + " · " + labels.overdue;
      overdue = true;
    } else if (task.dueKey === today) {
      label = labels.next + " · " + labels.today + (task.time ? " · " + task.time : "");
    } else {
      label = labels.next + " · " + task.dueText;
    }
  }

  const taskUrl = !props.signedIn ? "nexdo://" : task ? "nexdo://task/" + task.id : "nexdo://add";

  const info = (
    <VStack alignment="leading" spacing={6}>
      <Text modifiers={[font({ size: 11, weight: "bold", design: "monospaced" }), textCase("uppercase"), foregroundStyle(overdue ? OVERDUE : PEACH), lineLimit(1)]}>
        {props.signedIn && task ? label : "Nexdo"}
      </Text>
      <Text modifiers={[font({ size: medium ? 18 : 16, weight: "semibold" }), foregroundStyle(ON_CARD), lineLimit(medium ? 2 : 3)]}>
        {!props.signedIn ? labels.signIn : task ? task.title : labels.allClear}
      </Text>
      {props.signedIn ? (
        <Text modifiers={[font({ size: 13 }), foregroundStyle(FAINT), lineLimit(1)]}>
          {task ? task.length : labels.allClearBody}
        </Text>
      ) : null}
    </VStack>
  );

  if (!medium || !props.signedIn) {
    return (
      <VStack alignment="leading" modifiers={[containerBackground(CARD, "widget"), widgetURL(taskUrl)]}>
        {info}
        <Spacer />
      </VStack>
    );
  }

  return (
    <VStack alignment="leading" modifiers={[containerBackground(CARD, "widget")]}>
      <Link destination={taskUrl}>
        <HStack>
          {info}
          <Spacer />
        </HStack>
      </Link>
      <Spacer />
      <HStack spacing={8}>
        <Spacer />
        <Link destination="nexdo://add">
          <HStack spacing={4} modifiers={[padding({ horizontal: 14, vertical: 8 }), background(ACCENT), clipShape("capsule")]}>
            <Image systemName="plus" size={14} color="#FFFFFF" />
            <Text modifiers={[font({ size: 14, weight: "semibold" }), foregroundStyle("#FFFFFF")]}>{labels.add}</Text>
          </HStack>
        </Link>
        <Link destination="nexdo://mic">
          <HStack spacing={4} modifiers={[padding({ horizontal: 14, vertical: 8 }), background(GLASS), clipShape("capsule")]}>
            <Image systemName={props.micLocked ? "lock.fill" : "mic.fill"} size={14} color={ON_CARD} />
            <Text modifiers={[font({ size: 14, weight: "semibold" }), foregroundStyle(ON_CARD)]}>{labels.mic}</Text>
          </HStack>
        </Link>
      </HStack>
    </VStack>
  );
}

/** Must match the widget's `name` in app.json (the expo-widgets plugin). */
export const nextTaskWidget = createWidget<WidgetData>("NextTask", NextTaskWidget);
