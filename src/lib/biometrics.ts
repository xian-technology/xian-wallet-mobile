import * as LocalAuthentication from "expo-local-authentication";

export interface BiometricStatus {
  available: boolean;
  enrolled: boolean;
  label: string;
  reason?: string;
}

function labelForTypes(types: LocalAuthentication.AuthenticationType[]): string {
  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
    return "Face ID";
  }
  if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
    return "Fingerprint";
  }
  return "Device biometrics";
}

export async function getBiometricStatus(): Promise<BiometricStatus> {
  const hardwareAvailable = await LocalAuthentication.hasHardwareAsync();
  if (!hardwareAvailable) {
    return {
      available: false,
      enrolled: false,
      label: "Biometric",
      reason: "Biometric authentication is not available on this device.",
    };
  }

  const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
  const label = labelForTypes(types);
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  if (!enrolled) {
    return {
      available: false,
      enrolled: false,
      label,
      reason: `${label} is not set up on this device.`,
    };
  }

  return {
    available: true,
    enrolled: true,
    label,
  };
}
