import { useAuth } from "@clerk/expo";
import { Redirect, Stack } from "expo-router";

import { useStatusBarStyle } from "@/hooks/useStatusBarStyle";

export default function AuthLayout() {
  const { isLoaded, isSignedIn } = useAuth();
  // Sign-in and sign-up are cream all the way up.
  useStatusBarStyle("dark");

  if (!isLoaded) return null;
  if (isSignedIn) return <Redirect href="/" />;

  return <Stack screenOptions={{ headerShown: false, animation: "none" }} />;
}
