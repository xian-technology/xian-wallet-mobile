import React, { useState } from "react";
import { Text, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Card } from "./Card";
import { Input } from "./Input";
import { Button } from "./Button";
import { useWallet } from "../lib/wallet-context";
import { colors } from "../theme/colors";
import type { AccountKeyRole, AccountOperation } from "@xian-tech/client";

async function chooseBackup(): Promise<string> {
  const result = await DocumentPicker.getDocumentAsync({
    type: "application/json",
    copyToCacheDirectory: true
  });
  if (result.canceled) throw new Error("No file selected.");
  const file = new File(result.assets[0]!.uri);
  if (file.size > 100000) throw new Error("Backup exceeds 100 KB.");
  return file.text();
}

/** File re-import is the proof of backup possession, not a confirmation checkbox. */
export function AccountSecurity() {
  const { state, controller, refresh } = useWallet();
  const [sender, setSender] = useState(state.publicKey ?? "");
  const [password, setPassword] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  type InputArgs = Parameters<NonNullable<typeof controller>["accountSecurity"]>[0];
  const run = async (
    action: InputArgs["action"],
    role?: AccountKeyRole,
    operation?: AccountOperation
  ) => {
    if (!controller || busy) return;
    setBusy(true);
    if (["begin", "verify", "submit"].includes(action)) setReady(false);
    try {
      const file =
        action === "verify" ||
        action === "restore" ||
        (action === "begin" && operation === "recover")
          ? await chooseBackup()
          : undefined;
      const result = (await controller.accountSecurity({
        action,
        role,
        operation,
        sender,
        password: action === "begin" ? oldPassword : password,
        file
      })) as
        | string
        | {
            ready?: boolean;
            sender?: string;
            status?: string;
            accepted?: boolean;
            message?: string;
          };
      if (typeof result === "string") {
        const backupFile = new File(Paths.cache, `xian-account-master-${Date.now()}.json`);
        try {
          backupFile.create({ overwrite: false });
          backupFile.write(result);
          if (!(await Sharing.isAvailableAsync()))
            throw new Error("File export is unavailable on this device.");
          await Sharing.shareAsync(backupFile.uri, {
            mimeType: "application/json",
            dialogTitle: "Save master backup"
          });
          setMessage("Save the file, then reopen and verify it below.");
        } finally {
          if (backupFile.exists) backupFile.delete();
        }
      } else {
        if (result.sender) setSender(result.sender);
        if (result.ready) setReady(true);
        setMessage(
          result.status
            ? `Account status: ${result.status}`
            : action === "submit" || action === "retry"
              ? result.accepted === false
                ? `Submission rejected: ${result.message ?? "Check status or archive the failed attempt."}`
                : "Submission attempted. Check the committed account before using the new keys. Keep the previous and replacement backups until commitment is confirmed."
              : "Backup step complete."
        );
        if (action === "restore" || action === "activate") await refresh();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const button = (
    title: string,
    action: InputArgs["action"],
    role?: AccountKeyRole,
    operation?: AccountOperation
  ) => (
    <Button
      key={title}
      title={title}
      variant="secondary"
      disabled={busy}
      onPress={() => {
        void run(action, role, operation);
      }}
    />
  );
  return (
    <Card
      title="Hybrid account security"
      subtitle="Keep your address and balances while replacing signing keys."
    >
      <View style={{ gap: 12 }}>
        <Text style={{ color: colors.fg }}>
          After enrollment, your old seed alone cannot restore this account. Save one master backup
          offline and reopen it before submitting. It restores both spending and recovery. Without
          optional encryption, anyone with the file controls the account. Enrollment must be enabled
          by the network.
        </Text>
        <Input
          label="Account address"
          value={sender}
          onChangeText={setSender}
          autoCapitalize="none"
        />
        <Input
          label="Current backup password (if encrypted)"
          value={oldPassword}
          onChangeText={setOldPassword}
          secureTextEntry
        />
        {button("Prepare enrollment", "begin", undefined, "enroll")}
        {button("Prepare key replacement", "begin", undefined, "rotate")}
        {button("Open master backup and prepare recovery", "begin", undefined, "recover")}
        <Input
          label="Optional backup password (12+ characters; empty means one secret)"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
        {button("Save master backup", "export")}
        {button("Reopen and verify master backup", "verify")}
        <Button
          title="Submit verified transition"
          disabled={busy || !ready}
          onPress={() => {
            void run("submit");
          }}
        />
        {button("Check committed account", "status")}
        {button("Retry saved transaction", "retry")}
        {button("Archive failed attempt (retain its keys)", "archive")}
        <Text style={{ color: colors.fg }}>
          Archiving does not cancel a broadcast. Its keys stay encrypted in the wallet in case it
          commits later.
        </Text>
        {button("Use confirmed account", "activate")}
        {button("Restore master backup", "restore")}
        <Text style={{ color: colors.fg }}>
          On a new device, create a local wallet, connect to the original chain and restore the
          master file here. Older active/recovery files remain importable for their respective roles.
          Recovery creates one replacement master backup; save and verify it before submitting.
        </Text>
        <Text accessibilityLiveRegion="polite" style={{ color: colors.fg }}>
          {message}
        </Text>
      </View>
    </Card>
  );
}
