// Konfiguracja ESLint (flat config) — moduł AI Document Scanner Test
import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/**", "dist/**", "data-test/**", "standalone/AI_Skaner_Dokumentow.html"] },
  js.configs.recommended,
  {
    files: ["**/*.mjs", "**/*.js"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: { ...globals.node } },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
      "no-control-regex": "off",
      eqeqeq: ["error", "smart"],
      "no-var": "error",
      "prefer-const": ["error", { destructuring: "all" }]
    }
  },
  { files: ["public/**/*.js", "standalone/src/**/*.mjs"], languageOptions: { globals: { ...globals.browser } } },
  { files: ["**/*.cjs"], languageOptions: { sourceType: "commonjs", globals: { ...globals.node } } }
];
