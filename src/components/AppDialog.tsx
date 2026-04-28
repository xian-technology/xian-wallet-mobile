import React from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { colors } from "../theme/colors";
import { Button } from "./Button";

interface DialogAction {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  loading?: boolean;
  disabled?: boolean;
}

interface AppDialogProps {
  visible: boolean;
  title: string;
  message?: string;
  children?: React.ReactNode;
  actions: DialogAction[];
  onRequestClose?: () => void;
  contentStyle?: ViewStyle;
}

export function AppDialog({
  visible,
  title,
  message,
  children,
  actions,
  onRequestClose,
  contentStyle,
}: AppDialogProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onRequestClose}
    >
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.dialog}>
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          {children ? (
            <ScrollView
              style={[styles.content, contentStyle]}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
          ) : null}
          <View
            style={[
              styles.actions,
              actions.length === 1 ? styles.actionsSingle : null,
              actions.length > 2 ? styles.actionsStack : null,
            ]}
          >
            {actions.map((action) => (
              <Button
                key={action.title}
                title={action.title}
                onPress={action.onPress}
                variant={action.variant}
                loading={action.loading}
                disabled={action.disabled}
                style={actions.length > 2 ? undefined : styles.actionButton}
              />
            ))}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message: string;
  confirmTitle?: string;
  cancelTitle?: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
  confirmVariant?: "primary" | "secondary" | "danger";
}

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmTitle = "Confirm",
  cancelTitle = "Cancel",
  onConfirm,
  onCancel,
  loading = false,
  confirmVariant = "danger",
}: ConfirmDialogProps) {
  return (
    <AppDialog
      visible={visible}
      title={title}
      message={message}
      onRequestClose={onCancel}
      actions={[
        { title: cancelTitle, onPress: onCancel, variant: "secondary", disabled: loading },
        { title: confirmTitle, onPress: onConfirm, variant: confirmVariant, loading },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.72)",
    justifyContent: "center",
    padding: 18,
  },
  dialog: {
    width: "100%",
    maxHeight: "88%",
    backgroundColor: colors.bg1,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 18,
    gap: 12,
  },
  title: {
    color: colors.fg,
    fontSize: 18,
    fontWeight: "700",
  },
  message: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  content: {
    maxHeight: 360,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 2,
  },
  actionsSingle: {
    justifyContent: "flex-end",
  },
  actionsStack: {
    flexDirection: "column",
  },
  actionButton: {
    flex: 1,
  },
});
