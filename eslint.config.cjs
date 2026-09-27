const globals = require("globals");
const js = require("@eslint/js");

/**
 * ============================================
 * BASE RULES
 * Shared rules for standard Node/CommonJS environments
 * ============================================
 */
function baseRules(overrides = {}) {
  return {
    "no-unused-vars": [
      "error",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      },
    ],
    "no-empty": ["error", { allowEmptyCatch: true }],
    "no-var": "error",
    "prefer-const": "warn",
    "no-console": "off",
    ...overrides,
  };
}

/**
 * ============================================
 * EXTENSION RULES
 * Shared rules for build-inlined extension files
 * ============================================
 */
function extensionRules(overrides = {}) {
  return {
    "no-undef": "off",
    "no-unused-vars": "off",
    "no-redeclare": "off",
    "no-empty": ["error", { allowEmptyCatch: true }],
    "no-var": "error",
    "prefer-const": "warn",
    "no-control-regex": "off",
    "no-useless-escape": "off",
    "no-prototype-builtins": "off",
    "no-constant-binary-expression": "warn",
    ...overrides,
  };
}

module.exports = [
  /**
   * ============================================
   * GLOBAL IGNORES
   * ============================================
   */
  {
    ignores: [
      "**/node_modules/**",
      "**/libs/**",
      "dist/**",
      "release/**",
      "extensionBuilds/**",
      "**/*.zip",
      "**/*.exe",
      "**/*.deb",
      "**/*.rpm",
      "**/*.AppImage",
      "**/*.blockmap",
      "**/*.pak",
      "**/*.dat",
      "**/*.bin",
      "**/*.ico",
      "**/*.icns",
      "**/*.png",
      "**/*.svg",
      "**/*.bmp",
      "**/*.map",
    ],
  },

  /**
   * ============================================
   * ESLINT RECOMMENDED RULES
   * ============================================
   */
  js.configs.recommended,

  /**
   * ============================================
   * BUILD / TOOLING SCRIPTS - scripts/**
   * ============================================
   */
  {
    files: ["scripts/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: globals.node,
    },
    rules: baseRules(),
  },

  /**
   * ============================================
   * ELECTRON MAIN
   * ============================================
   */
  {
    files: ["app/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    rules: baseRules({ "no-unused-labels": "off" }),
  },

  /**
   * ============================================
   * SERVER — Node.js ESM backend
   * ============================================
   */
  {
    files: ["server/*.js", "server/routes/**/*.js", "server/rpc/**/*.js", "server/services/**/*.js"],
    ignores: ["server/utils.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: globals.node,
    },
    rules: baseRules({
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    }),
  },

  /**
   * ============================================
   * SERVER FRONTEND - public/**
   * ============================================
   */
  {
    files: ["server/public/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.browser,
    },
    rules: baseRules({
      "no-undef": "off",
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    }),
  },

  /**
   * ============================================
   * SERVER UTILS
   * ============================================
   */
  {
    files: ["server/utils.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: { ...globals.browser, ...globals.node },
    },
    rules: baseRules(),
  },

  /**
   * ============================================
   * EXTENSION — background.js
   * ============================================
   */
  {
    files: ["extension/background.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        ...globals.serviceworker,
      },
    },
    rules: extensionRules(),
  },

  /**
   * ============================================
   * EXTENSION OTHER & SHARED
   * ============================================
   */
  {
    files: ["extension/**/*.js", "shared/*.js"],
    ignores: ["extension/background.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: { ...globals.browser, ...globals.webextensions },
    },
    rules: extensionRules(),
  },
];
