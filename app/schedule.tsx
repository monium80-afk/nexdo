import { Redirect } from "expo-router";

/**
 * The Schedule is the Calendar tab since 2026-11-02 (app/(tabs)/calendar.tsx).
 * This address stays so an old link still lands somewhere: it just leads there.
 */
export default function ScheduleRedirect() {
  return <Redirect href="/calendar" />;
}
