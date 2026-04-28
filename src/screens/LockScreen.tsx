import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Image,
  TouchableOpacity,
} from "react-native";
import { colors } from "../theme/colors";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { ConfirmDialog } from "../components/AppDialog";
import { useWallet } from "../lib/wallet-context";
import { errorTap, successTap } from "../lib/haptics";

export function LockScreen() {
  const { refresh, controller } = useWallet();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

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

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.inner}>
        <Image source={require("../../assets/xian-logo.png")} style={styles.logo} />
        <Text style={styles.heading}>Xian Wallet</Text>
        <Text style={styles.sub}>Enter your password to unlock.</Text>

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

        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <View style={styles.inputWrap}>
          <Button title="Unlock" onPress={handleUnlock} loading={loading} />
        </View>

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
