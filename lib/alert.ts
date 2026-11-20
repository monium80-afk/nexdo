import { Alert, Platform, type AlertButton } from "react-native";

/**
 * Alert.alert, working on the web build too. react-native-web's Alert.alert
 * does nothing at all, so there a message never showed and a question never
 * asked — leaving whatever waited on the answer (clearing the chat history,
 * deleting a step, signing out with unsaved tasks) impossible to do. The
 * browser's own dialogs stand in: a message is alert(), and the app's
 * questions — Cancel and one action — are confirm().
 *
 * A browser can't offer a choice between two actions: on the web such a
 * question shows its message and does nothing, so a screen that needs one
 * there asks in its own way (app/task/[id].tsx, chooseScope).
 */
export function showAlert(title: string, message?: string, buttons?: AlertButton[]) {
  if (Platform.OS !== "web") {
    Alert.alert(title, message, buttons);
    return;
  }
  const text = message ? `${title}\n\n${message}` : title;
  const cancel = buttons?.find((button) => button.style === "cancel");
  const actions = buttons?.filter((button) => button !== cancel) ?? [];
  if (actions.length === 1 && cancel) {
    if (window.confirm(text)) actions[0].onPress?.();
    else cancel.onPress?.();
    return;
  }
  window.alert(text);
  if (actions.length === 1) actions[0].onPress?.();
  else cancel?.onPress?.();
}
