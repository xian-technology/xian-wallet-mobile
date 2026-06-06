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

jest.mock("expo-document-picker", () => ({
  getDocumentAsync: jest.fn(async () => ({ canceled: true, assets: [] }))
}));

jest.mock("expo-file-system", () => {
  const fileTextByUri = new Map<string, string>();

  class MockFile {
    uri: string;
    exists = false;

    constructor(...parts: string[]) {
      this.uri = parts.join("/");
      this.exists = fileTextByUri.has(this.uri);
    }

    create(): void {
      this.exists = true;
      if (!fileTextByUri.has(this.uri)) {
        fileTextByUri.set(this.uri, "");
      }
    }

    write(value: string): void {
      this.exists = true;
      fileTextByUri.set(this.uri, value);
    }

    async text(): Promise<string> {
      return fileTextByUri.get(this.uri) ?? "";
    }

    delete(): void {
      this.exists = false;
      fileTextByUri.delete(this.uri);
    }
  }

  return {
    File: MockFile,
    Paths: { cache: "/tmp/xian-wallet-mobile" },
    __setFileText: (uri: string, text: string) => {
      fileTextByUri.set(uri, text);
    },
    __clearFileText: () => {
      fileTextByUri.clear();
    }
  };
});

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
