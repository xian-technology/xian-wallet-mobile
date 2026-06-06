import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Image,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { colors } from "../theme/colors";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { ConfirmDialog } from "../components/AppDialog";
import { useWallet } from "../lib/wallet-context";
import { errorTap, successTap } from "../lib/haptics";
import { getBiometricStatus } from "../lib/biometrics";

const MAX_BIOMETRIC_UNLOCK_FAILURES = 5;

export function LockScreen() {
  const { refresh, controller } = useWallet();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [biometricLoading, setBiometricLoading] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricLabel, setBiometricLabel] = useState("Biometric");
  const [biometricChecked, setBiometricChecked] = useState(false);
  const [biometricFailureCount, setBiometricFailureCount] = useState(0);
  const [passwordFallback, setPasswordFallback] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const useBiometricOnly = biometricAvailable && !passwordFallback;

  useEffect(() => {
    let active = true;
    const loadBiometricState = async () => {
      if (!controller) {
        setBiometricChecked(true);
        return;
      }
      setBiometricChecked(false);
      try {
        const [status, enabled] = await Promise.all([
          getBiometricStatus(),
          controller.isBiometricUnlockEnabled(),
        ]);
        if (!active) return;
        setBiometricLabel(status.label);
        setBiometricAvailable(status.available && enabled);
        setBiometricFailureCount(0);
        setPasswordFallback(false);
      } catch {
        if (active) {
          setBiometricAvailable(false);
        }
      } finally {
        if (active) {
          setBiometricChecked(true);
        }
      }
    };
    void loadBiometricState();
    return () => {
      active = false;
    };
  }, [controller]);

  const handleUnlock = async () => {
    if (!controller || !password) return;
    setLoading(true);
    setError(null);
    try {
      await controller.unlock(password);
      successTap();
      await refresh();
    } catch {
      errorTap();
      setError("Invalid password.");
    } finally {
      setLoading(false);
    }
  };

  const handleBiometricUnlock = async () => {
    if (!controller) return;
    setBiometricLoading(true);
    setError(null);
    try {
      await controller.unlockWithBiometrics();
      successTap();
      await refresh();
    } catch {
      errorTap();
      const nextFailureCount = biometricFailureCount + 1;
      setBiometricFailureCount(nextFailureCount);
      if (nextFailureCount >= MAX_BIOMETRIC_UNLOCK_FAILURES) {
        setPasswordFallback(true);
        setError(`${biometricLabel} unlock failed 5 times. Enter your password to unlock.`);
      } else {
        const remaining = MAX_BIOMETRIC_UNLOCK_FAILURES - nextFailureCount;
        setError(
          `${biometricLabel} unlock failed. ${remaining} ${remaining === 1 ? "attempt" : "attempts"} remaining before password unlock.`
        );
      }
    } finally {
      setBiometricLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.inner}>
        <Image source={require("../../assets/xian-logo.png")} style={styles.logo} />
        <Text style={styles.heading}>Xian Wallet</Text>
        <Text style={styles.sub}>
          {!biometricChecked
            ? "Checking unlock options."
            : useBiometricOnly
            ? `Unlock with ${biometricLabel}.`
            : "Enter your password to unlock."}
        </Text>

        {!biometricChecked && (
          <ActivityIndicator color={colors.accent} />
        )}

        {biometricChecked && !useBiometricOnly && (
          <View style={styles.inputWrap}>
            <Input
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              onSubmitEditing={handleUnlock}
              returnKeyType="go"
            />
          </View>
        )}

        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {biometricChecked && !useBiometricOnly && (
          <View style={styles.inputWrap}>
            <Button title="Unlock" onPress={handleUnlock} loading={loading} />
          </View>
        )}

        {biometricChecked && useBiometricOnly && (
          <View style={styles.inputWrap}>
            <Button
              title={`Unlock with ${biometricLabel}`}
              variant="secondary"
              onPress={handleBiometricUnlock}
              loading={biometricLoading}
            />
          </View>
        )}

        <TouchableOpacity
          style={styles.forgotLink}
          onPress={() => setConfirmRemove(true)}
        >
          <Text style={styles.forgotText}>Forgot password? Remove wallet</Text>
        </TouchableOpacity>
        <ConfirmDialog
          visible={confirmRemove}
          title="Remove Wallet"
          message="This will permanently remove the wallet and all data. Are you sure?"
          confirmTitle="Remove"
          loading={removing}
          onCancel={() => setConfirmRemove(false)}
          onConfirm={async () => {
            if (!controller) return;
            setRemoving(true);
            try {
              await controller.removeWallet();
              setConfirmRemove(false);
              await refresh();
            } finally {
              setRemoving(false);
            }
          }}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg0,
    justifyContent: "center",
  },
  inner: {
    padding: 24,
    gap: 20,
    alignItems: "center",
  },
  logo: {
    width: 64,
    height: 64,
    resizeMode: "contain",
  },
  heading: {
    fontSize: 28,
    fontWeight: "800",
    color: colors.fg,
    textAlign: "center",
  },
  sub: {
    fontSize: 14,
    color: colors.muted,
    textAlign: "center",
  },
  inputWrap: {
    width: "100%",
  },
  errorBanner: {
    backgroundColor: colors.dangerSoft,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.danger,
    width: "100%",
  },
  errorText: {
    fontSize: 13,
    color: colors.danger,
  },
  forgotLink: {
    marginTop: 8,
    alignItems: "center" as const,
  },
  forgotText: {
    fontSize: 12,
    color: colors.muted,
  },
});
