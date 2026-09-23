import babel from "@rolldown/plugin-babel";
import stylex from "@stylexjs/unplugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

// Inoreader does not allow CORS. Production uses the Netlify edge function
// (netlify/edge-functions/cors-proxy.ts); dev and preview use the same path.
const INOREADER_ORIGINS = ["https://www.inoreader.com", "https://jp.inoreader.com"];
const corsProxy = Object.fromEntries(
    INOREADER_ORIGINS.map((origin) => [
        `/cors-proxy/${origin}`,
        {
            target: origin,
            changeOrigin: true,
            rewrite: (path: string) => path.slice(`/cors-proxy/${origin}`.length) || "/"
        }
    ])
);

// Unit tests run in Node without UI; skip the UI compilers there.
const unitTest = process.env.VITEST === "true";

export default defineConfig({
    plugins: unitTest
        ? []
        : [
              stylex({ useCSSLayers: true }),
              react(),
              // Fail the build when a component cannot be compiled by React Compiler.
              babel({ presets: [reactCompilerPreset({ panicThreshold: "all_errors" })] })
          ],
    server: { port: 8888, strictPort: true, proxy: corsProxy },
    preview: { port: 8888, strictPort: true, proxy: corsProxy },
    build: { target: "es2024" },
    lint: {
        plugins: ["eslint", "typescript", "unicorn", "oxc", "react", "jsx-a11y", "import"],
        // React Compiler diagnostics (purity, refs, set-state-in-effect, ...).
        jsPlugins: [
            { name: "react-compiler", specifier: "eslint-plugin-react-hooks" },
            // StyleX drops unsupported values silently; catch them at lint time.
            { name: "stylex", specifier: "@stylexjs/eslint-plugin" },
            { name: "immutable", specifier: "@irodr/oxlint-plugin-immutable" }
        ],
        categories: { correctness: "error", suspicious: "warn", perf: "warn" },
        options: { typeAware: true, typeCheck: true },
        ignorePatterns: ["dist/**", "dist-e2e/**", "playwright-report/**", "test-results/**", "resources/**"],
        rules: {
            "no-console": ["error", { allow: ["info", "warn", "error"] }],
            // Immutable style: no reassignment, no in-place merging.
            "immutable/no-let": "error",
            "immutable/no-class": "error",
            "no-var": "error",
            "no-param-reassign": "error",
            "no-restricted-properties": [
                "error",
                { object: "Object", property: "assign", message: "Create a new object with spread syntax instead." }
            ],
            "react/react-in-jsx-scope": "off",
            "react/rules-of-hooks": "error",
            "react/exhaustive-deps": "error",
            "react-compiler/purity": "error",
            "react-compiler/refs": "error",
            "react-compiler/immutability": "error",
            "react-compiler/set-state-in-render": "error",
            "react-compiler/set-state-in-effect": "error",
            "react-compiler/static-components": "error",
            "react-compiler/globals": "error",
            "react-compiler/use-memo": "error",
            "react-compiler/unsupported-syntax": "error",
            "react-compiler/preserve-manual-memoization": "error",
            "react-compiler/incompatible-library": "error",
            "react-compiler/error-boundaries": "error",
            "react-compiler/config": "error",
            "react-compiler/gating": "error",
            "stylex/valid-styles": "error",
            "stylex/valid-shorthands": "error",
            "stylex/no-unused": "error",
            "stylex/no-legacy-contextual-styles": "error",
            "stylex/no-nonstandard-styles": "error",
            "stylex/enforce-extension": "error",
            "import/no-cycle": "error",
            "typescript/no-floating-promises": "error",
            // Sequential awaits are deliberate: pagination, prefetch order and bounded concurrency.
            "no-await-in-loop": "off",
            // JSON responses are narrowed with explicit checks where their shape matters.
            "typescript/no-unsafe-type-assertion": "off",
            "import/no-unassigned-import": ["warn", { allow: ["**/*.css"] }],
            // Snapshots are immutable by design: copy-on-write is intended.
            "oxc/no-map-spread": "off",
            "typescript/no-misused-promises": "error",
            "unicorn/no-array-sort": "off",
            "unicorn/prefer-add-event-listener": "off"
        },
        overrides: [
            {
                // The Netlify edge function must stay silent: logs can leak proxied URLs.
                files: ["netlify/**"],
                rules: { "no-console": "error" }
            },
            {
                // Playwright fixtures receive a `use` callback that is not React's `use`.
                files: ["e2e/**", "**/*.test.ts"],
                rules: { "no-console": "off", "react/rules-of-hooks": "off" }
            }
        ]
    },
    fmt: {
        printWidth: 120,
        tabWidth: 4,
        trailingComma: "none",
        ignorePatterns: [
            "dist/**",
            "dist-e2e/**",
            "playwright-report/**",
            "test-results/**",
            "pnpm-lock.yaml",
            "resources/favicon/**"
        ],
        overrides: [{ files: ["*.md", "*.json", "*.yml", "*.yaml", "*.html"], options: { tabWidth: 2 } }]
    },
    staged: {
        "*.{js,mjs,ts,tsx}": "vp check --fix",
        "*.{json,md,yml,yaml,css,html}": "vp fmt"
    },
    test: {
        include: ["src/**/*.test.ts", "e2e/fake-api/**/*.test.ts", "lib/**/*.test.ts"],
        environment: "node"
    }
});
