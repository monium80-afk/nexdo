import { useAuth } from "@clerk/expo";
import { Redirect } from "expo-router";
import { useEffect } from "react";

import { openAddSheet } from "@/store/useAddSheetStore";

/**
 * A link to /add. Adding a task is a sheet over the tabs since 2026-11-08
 * (components/addSheet/AddTaskSheet.tsx) — the page behind it can only be
 * blurred there — so this opens it and goes to Today underneath.
 */
export default function Add() {
  const { isLoaded, isSignedIn } = useAuth();
  useEffect(() => {
    if (isLoaded && isSignedIn) openAddSheet();
  }, [isLoaded, isSignedIn]);

  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect href="/onboarding" />;
  return <Redirect href="/(tabs)" />;
}
