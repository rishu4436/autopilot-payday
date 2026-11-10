import js from "@eslint/js";
import ts from "typescript-eslint";
import hooks from "eslint-plugin-react-hooks";

export default ts.config(
  { ignores: [".next/**", "node_modules/**", "audit/**", "data/**", "next-env.d.ts", "test-results/**", "playwright-report/**", "vendor/**"] },
  js.configs.recommended,
  ...ts.configs.recommended,
  { files: ["**/*.ts", "**/*.tsx"], plugins: { "react-hooks": hooks }, rules: {
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    "react-hooks/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": "error",
  } },
  { files: ["*.js", "*.mjs"], languageOptions: { globals: { module: "readonly", process: "readonly" } } },
);
