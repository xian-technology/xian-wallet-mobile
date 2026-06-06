import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const mockHasHardwareAsync = jest.fn() as jest.Mock;
const mockSupportedAuthenticationTypesAsync = jest.fn() as jest.Mock;
const mockIsEnrolledAsync = jest.fn() as jest.Mock;

jest.mock("expo-local-authentication", () => ({
  AuthenticationType: {
    FINGERPRINT: 1,
    FACIAL_RECOGNITION: 2,
    IRIS: 3,
  },
  hasHardwareAsync: () => mockHasHardwareAsync(),
  supportedAuthenticationTypesAsync: () => mockSupportedAuthenticationTypesAsync(),
  isEnrolledAsync: () => mockIsEnrolledAsync(),
}));

import * as LocalAuthentication from "expo-local-authentication";
import { getBiometricStatus } from "../biometrics";

describe("getBiometricStatus", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHasHardwareAsync.mockImplementation(async () => true);
    mockIsEnrolledAsync.mockImplementation(async () => true);
  });

  it("uses the fingerprint label when fingerprint and face auth are both reported", async () => {
    mockSupportedAuthenticationTypesAsync.mockImplementation(async () => [
      LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION,
      LocalAuthentication.AuthenticationType.FINGERPRINT,
    ]);

    await expect(getBiometricStatus()).resolves.toMatchObject({
      available: true,
      enrolled: true,
      label: "Fingerprint",
    });
  });
});
