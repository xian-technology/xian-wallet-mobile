module.exports = {
  preset: "jest-expo",
  // Babel also transforms the SDK packages in the sibling workspace.
  moduleNameMapper: { "^@babel/runtime/(.*)$": "<rootDir>/node_modules/@babel/runtime/$1" },
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  testPathIgnorePatterns: ["/node_modules/", "/android/", "/ios/"],
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native|react-native|expo(nent)?|@expo(nent)?/.*|expo-.*|@expo/.*|@unimodules/.*|unimodules|@react-navigation/.*|@scure/.*|@noble/.*))"
  ]
};
