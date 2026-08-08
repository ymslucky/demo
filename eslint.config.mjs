import NextESLintConfig from "eslint-config-next";
import reactHooks from "eslint-plugin-react-hooks";

const config = [
  ...NextESLintConfig,
  {
    // Flat-config scoping: rules referencing a plugin must declare that
    // plugin in the same config object (ESLint 9 requirement).
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];

export default config;
