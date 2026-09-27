import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      // A circular manual-chunk dependency builds "successfully" but can load a React-dependent
      // chunk before React itself, blanking the page in production. Fail the build instead.
      onwarn(warning, warn) {
        if (warning.message.startsWith("Circular chunk")) throw new Error(warning.message)
        warn(warning)
      },
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined
          if (id.includes("@supabase") || id.includes("/jose/")) return "vendor-supabase"
          if (id.includes("@tanstack")) return "vendor-query"
          if (id.includes("react-router")) return "vendor-router"
          if (id.includes("/react/") || id.includes("/react-dom/") || id.includes("/scheduler/")) return "vendor-react"
          if (id.includes("@radix-ui") || id.includes("lucide-react") || id.includes("sonner")) return "vendor-ui"
          // @sentry/react and its React helpers need their own chunk: in the catch-all "vendor"
          // chunk they create a vendor <-> vendor-react cycle that runs before React loads.
          if (id.includes("@sentry") || id.includes("hoist-non-react-statics")) return "vendor-sentry"
          return "vendor"
        },
      },
    },
  },
})
