// The app starts in the phone's language (store/useSettingsStore.ts
// deviceLanguage). The tests are written against the English copy, so they
// run in English whatever language the computer running them is set to.
import { useSettingsStore } from "@/store/useSettingsStore";

useSettingsStore.setState({ language: "en" });
