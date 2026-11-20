import { requireOptionalNativeModule } from "expo-modules-core";

// The app's own Android home screen widget (android/.../NexdoWidgetModule.kt).
// Missing on iOS — which uses expo-widgets (widgets/NextTaskWidget.tsx) — and
// on the web.
export const NexdoWidget = requireOptionalNativeModule<{ update(json: string): void }>("NexdoWidget");
