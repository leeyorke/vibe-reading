import react from "@vitejs/plugin-react"
import { configDefaults, defineConfig } from "vitest/config"

import { WxtVitest } from "wxt/testing"

export default defineConfig({
  // TODO: remove any
  plugins: [WxtVitest() as any, react()],
  test: {
    exclude: [...configDefaults.exclude, "**/.claude/**", "**/repos/**"],
    environment: "node",
    globals: true,
    setupFiles: "vitest.setup.ts",
    watch: false,
    // The whole suite runs 95 files in parallel on one machine, and a few
    // tests legitimately take 1.5–3s (audio decoding, dictionary lookups).
    // With the 5s default they flake into timeouts whenever the machine is
    // loaded, which is indistinguishable from a real failure.
    testTimeout: 20_000,
    coverage: {
      provider: "istanbul",
      reporter: ["text", "html", "lcov"],
      // include: ['src/**/*.{ts,tsx}'],
      // exclude: ['src/**/*.spec.ts']
    },
  },
})
