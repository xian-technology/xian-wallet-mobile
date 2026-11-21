const { moduleNameMapper, transformIgnorePatterns } = require("./jest.config.cjs");

module.exports = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/src/lib/__tests__/live-rpc.test.ts"],
  moduleNameMapper,
  transformIgnorePatterns,
  transform: {
    "\\.[jt]sx?$": ["babel-jest", { presets: [require.resolve("expo/internal/babel-preset.js")] }]
  }
};
