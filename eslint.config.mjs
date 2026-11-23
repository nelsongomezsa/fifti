import next from "eslint-config-next";

const config = [
  ...next,
  { ignores: [".next/**", "node_modules/**", "coverage/**"] },
  { rules: { "react/no-danger": "error" } },
];
export default config;
