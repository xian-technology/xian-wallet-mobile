module.exports = {
  preset: "jest-expo",
  modulePaths: ["<rootDir>/node_modules"],
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  testPathIgnorePatterns: ["/node_modules/", "/android/", "/ios/"],
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native|react-native|expo(nent)?|@expo(nent)?/.*|expo-.*|@expo/.*|@unimodules/.*|unimodules|@react-navigation/.*|@scure/.*|@noble/.*))"
  ]
};
