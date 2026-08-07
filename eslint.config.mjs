import NextESLintConfig from "eslint-config-next";

const config = [
  ...NextESLintConfig,
  {
    rules: {
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];

export default config;
