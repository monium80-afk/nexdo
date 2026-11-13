import { useSignIn, useSignUp } from "@clerk/expo";
import { useSSO } from "@clerk/expo/experimental";
import Feather from "@expo/vector-icons/Feather";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState, type ComponentRef } from "react";
import { AppState, Text, TextInput, View, type TextInputProps } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";

import { AnimatedPressable } from "@/components/AnimatedPressable";
import { GoogleIcon } from "@/components/icons/GoogleIcon";
import { MAX_FONT_SCALE, ONB, PrimaryButton, rowDirection, TextButton, useIsRtl } from "@/components/onboarding/OnboardingKit";
import { useTranslation } from "@/hooks/useTranslation";
import { SSO_REDIRECT_URL } from "@/lib/clerk";
import { posthog } from "@/lib/posthog";

// The account step's buttons (13 Save your tasks, 14 Log in): Google, then
// Apple (on every platform, as before the redesign — an iOS app offering
// Google sign-in must offer Apple too), then email, which opens its form in their place. The
// email logic is the app's own since 2026-10-08 (sign-in is email first:
// a password if the account has one, else a code by email; sign-up is
// email + password, confirmed with a code).

export type AuthMode = "signUp" | "logIn";

/** Google or Apple through Clerk; null when the browser was just closed. */
export function useSocialAuth(mode: AuthMode) {
  const t = useTranslation();
  const router = useRouter();
  const { startSSOFlow } = useSSO();
  const [error, setError] = useState<string | null>(null);
  const start = async (provider: "google" | "apple") => {
    const event = mode === "signUp" ? "sign_up" : "sign_in";
    posthog.capture(`${event}_social_tapped`, { provider });
    setError(null);
    try {
      const { createdSessionId } = await startSSOFlow({ strategy: provider === "google" ? "oauth_google" : "oauth_apple", redirectUrl: SSO_REDIRECT_URL });
      if (createdSessionId) {
        posthog.capture(`${event}_completed`, { method: "social", provider });
        router.replace("/");
      }
    } catch (err) {
      console.error(`[onboarding/${event}] social`, JSON.stringify(err, null, 2));
      posthog.captureException(err instanceof Error ? err : new Error(String(err)), { context: `${event}_social`, provider });
      setError(t.auth.somethingWrong);
    }
  };
  return { start, error };
}

/** Google (light, outlined, its own logo), Apple (ink) and the quiet email link. 50 high, like every onboarding button. */
export function AuthButtons({ mode, onEmail }: { mode: AuthMode; onEmail: () => void }) {
  const t = useTranslation();
  const copy = mode === "signUp" ? t.onboardingFlow.save : t.onboardingFlow.logIn;
  const rtl = useIsRtl();
  const social = useSocialAuth(mode);
  return (
    <View style={{ gap: 10 }}>
      <AnimatedPressable
        onPress={() => void social.start("google")}
        scaleTo={0.97}
        accessibilityRole="button"
        accessibilityLabel={copy.google}
        style={[{ height: 50, borderRadius: 25, backgroundColor: ONB.card, borderWidth: 1.5, borderColor: ONB.line, alignItems: "center", justifyContent: "center", gap: 10 }, rowDirection(rtl)]}
      >
        <GoogleIcon size={18} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ fontSize: 16, fontFamily: "SpaceGrotesk-Bold", color: ONB.ink }}>{copy.google}</Text>
      </AnimatedPressable>
      <AnimatedPressable
        onPress={() => void social.start("apple")}
        scaleTo={0.97}
        accessibilityRole="button"
        accessibilityLabel={copy.apple}
        style={[{ height: 50, borderRadius: 25, backgroundColor: ONB.ink, alignItems: "center", justifyContent: "center", gap: 10 }, rowDirection(rtl)]}
      >
        <FontAwesome name="apple" size={17} color="#FFFFFF" />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ fontSize: 16, fontFamily: "SpaceGrotesk-Bold", color: "#FFFFFF" }}>{copy.apple}</Text>
      </AnimatedPressable>
      <AnimatedPressable onPress={onEmail} scaleTo={0.97} accessibilityRole="button" accessibilityLabel={copy.email} style={[{ height: 40, alignItems: "center", justifyContent: "center", gap: 8 }, rowDirection(rtl)]}>
        <Svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke={ONB.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <Rect x={3.5} y={5.5} width={17} height={13} rx={3} />
          <Path d="M4 7l8 6 8-6" />
        </Svg>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ fontSize: 15, fontFamily: "SpaceGrotesk-SemiBold", color: ONB.ink }}>{copy.email}</Text>
      </AnimatedPressable>
      {social.error ? <Text maxFontSizeMultiplier={MAX_FONT_SCALE} className="text-center font-grotesk-medium text-[13px] text-[#D4402A]">{social.error}</Text> : null}
    </View>
  );
}

function FormError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} className="text-center font-grotesk-medium text-[13px] text-[#D4402A]">
      {message}
    </Text>
  );
}

/** "EMAIL" → "Email": the app's labels are capitals, the field shows them as a placeholder. */
function asPlaceholder(label: string, locale: string): string {
  const lower = label.toLocaleLowerCase(locale);
  return lower.charAt(0).toLocaleUpperCase(locale) + lower.slice(1);
}

/** A field in the onboarding's style: a cream card with a soft line, orange while typing in it. */
function OnbField({
  label,
  value,
  onChangeText,
  secureEntry = false,
  keyboardType = "default",
  autoComplete,
  autoFocus,
  onSubmit,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  secureEntry?: boolean;
  keyboardType?: "email-address" | "default";
  autoComplete?: TextInputProps["autoComplete"];
  autoFocus?: boolean;
  onSubmit?: () => void;
}) {
  const t = useTranslation();
  const rtl = useIsRtl();
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(secureEntry);
  return (
    <View
      style={[
        { height: 52, borderRadius: 16, backgroundColor: ONB.card, borderWidth: 1.5, borderColor: focused ? ONB.orange : ONB.line, paddingHorizontal: 16, alignItems: "center", gap: 10 },
        rowDirection(rtl),
      ]}
    >
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={asPlaceholder(label, t.locale)}
        placeholderTextColor="#A89A8E"
        secureTextEntry={hidden}
        keyboardType={keyboardType}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="go"
        onSubmitEditing={onSubmit}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        accessibilityLabel={asPlaceholder(label, t.locale)}
        style={{ flex: 1, height: "100%", fontSize: 16, fontFamily: "SpaceGrotesk-Medium", color: ONB.ink, textAlign: rtl ? "right" : "left", paddingVertical: 0 }}
      />
      {secureEntry ? (
        <AnimatedPressable onPress={() => setHidden((prev) => !prev)} hitSlop={10} accessibilityRole="button" accessibilityLabel={hidden ? t.auth.showPassword : t.auth.hidePassword}>
          <Feather name={hidden ? "eye" : "eye-off"} size={18} color={ONB.muted} />
        </AnimatedPressable>
      ) : null}
    </View>
  );
}

const CODE_LENGTH = 6;

/**
 * The 6-digit code, right in the screen (it used to be a sheet over it, which
 * on Android sat apart from the keyboard with the page showing through). The
 * real field lies invisible over the boxes, so a tap always lands on it and
 * a long press pastes. Coming back from the mail app brings the keyboard up.
 */
function CodeStep({ email, onVerify, onCancel }: { email: string; onVerify: (code: string) => Promise<string | void>; onCancel: () => void }) {
  const t = useTranslation();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null);

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 250);
    // Leaving the app to read the code hides the keyboard while Android still
    // counts the field as focused: drop it and take it again on the way back.
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      const input = inputRef.current;
      if (input?.isFocused()) input.blur();
      setTimeout(() => inputRef.current?.focus(), 60);
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, []);

  const handleChange = async (text: string) => {
    const digits = text.replace(/[^0-9]/g, "").slice(0, CODE_LENGTH);
    setCode(digits);
    setError(null);
    if (digits.length < CODE_LENGTH) return;
    setVerifying(true);
    let message: string | void;
    try {
      message = await onVerify(digits);
    } catch {
      message = t.auth.somethingWrong;
    } finally {
      setVerifying(false);
    }
    if (message) {
      setError(message);
      setCode("");
    }
  };

  return (
    <View style={{ gap: 16 }}>
      <View style={{ alignItems: "center", gap: 4 }}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} className="text-center font-grotesk-bold text-[20px] text-[#221C17]">
          {t.auth.checkEmail}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} className="text-center font-grotesk-regular text-[14.5px] leading-[21px] text-[#7A6E64]">
          {t.auth.codeSentTo}
          {"\n"}
          <Text style={{ fontFamily: "SpaceGrotesk-SemiBold", color: ONB.ink }}>{email}</Text>
        </Text>
      </View>
      <View style={{ alignSelf: "center" }}>
        <View pointerEvents="none" style={{ flexDirection: "row", gap: 8 }}>
          {Array.from({ length: CODE_LENGTH }).map((_, index) => {
            const filled = index < code.length;
            const current = index === code.length && !verifying;
            return (
              <View
                key={index}
                style={{
                  width: 44,
                  height: 54,
                  borderRadius: 14,
                  backgroundColor: ONB.card,
                  borderWidth: 1.5,
                  borderColor: error ? "#D4402A" : filled || current ? ONB.orange : ONB.line,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text maxFontSizeMultiplier={1} style={{ fontSize: 22, fontFamily: "SpaceGrotesk-Bold", color: ONB.ink }}>
                  {code[index] ?? ""}
                </Text>
              </View>
            );
          })}
        </View>
        <TextInput
          ref={inputRef}
          value={code}
          onChangeText={(text) => void handleChange(text)}
          keyboardType="number-pad"
          maxLength={CODE_LENGTH}
          editable={!verifying}
          caretHidden
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          accessibilityLabel={t.auth.checkEmail}
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, color: "transparent", backgroundColor: "transparent", opacity: 0.02, fontSize: 1 }}
        />
      </View>
      <FormError message={error} />
      <TextButton label={t.common.cancel} onPress={onCancel} />
    </View>
  );
}

/** 13's email path: email and password, then the code sent to that address. */
export function EmailSignUpForm({ onCancel }: { onCancel: () => void }) {
  const t = useTranslation();
  const router = useRouter();
  const { signUp, errors, fetchStatus } = useSignUp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [codeOpen, setCodeOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!email.trim() || !password) return;
    setFormError(null);
    const { error } = await signUp.password({ emailAddress: email.trim(), password });
    if (error) {
      setFormError(error.longMessage ?? t.auth.somethingWrong);
      return;
    }
    const { error: codeError } = await signUp.verifications.sendEmailCode();
    if (codeError) {
      setFormError(codeError.longMessage ?? t.auth.sendCodeError);
      return;
    }
    setCodeOpen(true);
  };

  const handleVerify = async (code: string) => {
    const { error } = await signUp.verifications.verifyEmailCode({ code });
    if (error) return error.longMessage ?? t.auth.invalidCode;
    if (signUp.status === "complete") {
      const { error: finalizeError } = await signUp.finalize({
        navigate: () => {
          posthog.capture("sign_up_completed", { method: "email" });
          router.replace("/");
        },
      });
      if (finalizeError) return finalizeError.longMessage ?? t.auth.invalidCode;
    }
  };

  if (codeOpen) return <CodeStep email={email.trim()} onVerify={handleVerify} onCancel={() => setCodeOpen(false)} />;

  const fieldError = errors.fields.emailAddress?.message ?? errors.fields.password?.message;
  return (
    <View style={{ gap: 10 }}>
      <OnbField label={t.auth.email} value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" autoFocus />
      <OnbField label={t.auth.password} value={password} onChangeText={setPassword} secureEntry autoComplete="new-password" onSubmit={() => void handleSubmit()} />
      <View nativeID="clerk-captcha" />
      <FormError message={fieldError ?? formError} />
      <View style={{ marginTop: 4 }}>
        <PrimaryButton label={t.onboardingFlow.save.createAccount} onPress={() => void handleSubmit()} disabled={fetchStatus === "fetching"} />
      </View>
      <TextButton label={t.onboardingFlow.back} onPress={onCancel} />
    </View>
  );
}

/** 14's email path: the address first — then its password, or a code by email. */
export function EmailLogInForm({ onCancel }: { onCancel: () => void }) {
  const t = useTranslation();
  const router = useRouter();
  const { signIn, errors, fetchStatus } = useSignIn();
  const [step, setStep] = useState<"email" | "password">("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [codeOpen, setCodeOpen] = useState(false);
  // The sign-in's own code, or the one Clerk asks for after a password on a new phone.
  const [codeStep, setCodeStep] = useState<"signIn" | "newDevice">("signIn");
  const [formError, setFormError] = useState<string | null>(null);

  const finish = async (method: "email" | "password") => {
    const { error } = await signIn.finalize({
      navigate: () => {
        posthog.capture("sign_in_completed", { method });
        router.replace("/");
      },
    });
    return error ? (error.longMessage ?? t.auth.somethingWrong) : undefined;
  };

  const sendCode = async () => {
    const { error } = await signIn.emailCode.sendCode();
    if (error) {
      setFormError(error.longMessage ?? t.auth.sendCodeError);
      return;
    }
    setCodeStep("signIn");
    setCodeOpen(true);
  };

  const handleContinue = async () => {
    const { error } = await signIn.create({ identifier: email.trim() });
    if (error) {
      setFormError(error.longMessage ?? t.auth.somethingWrong);
      return;
    }
    if (signIn.supportedFirstFactors.some((factor) => factor.strategy === "password")) {
      setStep("password");
      return;
    }
    await sendCode();
  };

  const handlePassword = async () => {
    if (!password) return;
    const { error } = await signIn.password({ password });
    if (error) {
      setFormError(error.longMessage ?? t.auth.somethingWrong);
      return;
    }
    if (signIn.status === "complete") {
      const finishError = await finish("password");
      if (finishError) setFormError(finishError);
      return;
    }
    const emailCodeOffered = signIn.supportedSecondFactors.some((factor) => factor.strategy === "email_code");
    if ((signIn.status === "needs_client_trust" || signIn.status === "needs_second_factor") && emailCodeOffered) {
      const { error: sendError } = await signIn.mfa.sendEmailCode();
      if (sendError) {
        setFormError(sendError.longMessage ?? t.auth.sendCodeError);
        return;
      }
      setCodeStep("newDevice");
      setCodeOpen(true);
      return;
    }
    setFormError(t.auth.somethingWrong);
  };

  const handleSubmit = async () => {
    if (!email.trim()) return;
    setFormError(null);
    if (step === "password") await handlePassword();
    else await handleContinue();
  };

  const handleVerify = async (code: string) => {
    const { error } = codeStep === "newDevice" ? await signIn.mfa.verifyEmailCode({ code }) : await signIn.emailCode.verifyCode({ code });
    if (error) return error.longMessage ?? t.auth.invalidCode;
    if (signIn.status === "complete") return finish(codeStep === "newDevice" ? "password" : "email");
    return t.auth.somethingWrong;
  };

  if (codeOpen) return <CodeStep email={email.trim()} onVerify={handleVerify} onCancel={() => setCodeOpen(false)} />;

  const fieldError = errors.fields.identifier?.message ?? (step === "password" ? errors.fields.password?.message : undefined);
  return (
    <View style={{ gap: 10 }}>
      <OnbField
        label={t.auth.email}
        value={email}
        onChangeText={(text) => {
          setEmail(text);
          // Another address may or may not have a password: back to the first step.
          if (step === "password") {
            setStep("email");
            setPassword("");
            setFormError(null);
          }
        }}
        keyboardType="email-address"
        autoComplete="email"
        autoFocus
        onSubmit={() => void handleSubmit()}
      />
      {step === "password" ? (
        <OnbField label={t.auth.password} value={password} onChangeText={setPassword} secureEntry autoComplete="current-password" autoFocus onSubmit={() => void handleSubmit()} />
      ) : null}
      <FormError message={fieldError ?? formError} />
      <View style={{ marginTop: 4 }}>
        <PrimaryButton label={step === "password" ? t.auth.logIn : t.auth.continue} onPress={() => void handleSubmit()} disabled={fetchStatus === "fetching"} />
      </View>
      {step === "password" ? (
        <TextButton
          label={t.auth.useCode}
          onPress={() => {
            setFormError(null);
            void sendCode();
          }}
        />
      ) : (
        <TextButton label={t.onboardingFlow.back} onPress={onCancel} />
      )}
    </View>
  );
}
