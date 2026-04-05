import "@testing-library/jest-native/extend-expect";

import { jest } from "@jest/globals";
import { randomUUID, webcrypto } from "node:crypto";

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true
  });
}

if (typeof globalThis.crypto.randomUUID !== "function") {
  globalThis.crypto.randomUUID = randomUUID;
}

if (typeof globalThis.atob !== "function") {
  globalThis.atob = (value: string) => Buffer.from(value, "base64").toString("binary");
}

if (typeof globalThis.btoa !== "function") {
  globalThis.btoa = (value: string) => Buffer.from(value, "binary").toString("base64");
}

jest.mock("expo-clipboard", () => ({
  setStringAsync: jest.fn(async () => undefined)
}));

jest.mock("expo-haptics", () => ({
  ImpactFeedbackStyle: {
    Light: "light",
    Medium: "medium"
  },
  NotificationFeedbackType: {
    Success: "success",
    Error: "error"
  },
  impactAsync: jest.fn(async () => undefined),
  notificationAsync: jest.fn(async () => undefined),
  selectionAsync: jest.fn(async () => undefined)
}));

jest.mock("@expo/vector-icons", () => {
  const React = require("react");
  return {
    Feather: ({ children, ...props }: Record<string, unknown>) =>
      React.createElement("Feather", props, children)
  };
});

jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: {
    SHA256: "SHA256"
  },
  digest: jest.fn(async (_algorithm: string, data: Uint8Array) => {
    const { createHash } = require("node:crypto");
    const digest = createHash("sha256").update(Buffer.from(data)).digest();
    return digest.buffer.slice(digest.byteOffset, digest.byteOffset + digest.byteLength);
  })
}));
