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
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined
          if (id.includes("@supabase") || id.includes("/jose/")) return "vendor-supabase"
          if (id.includes("@tanstack")) return "vendor-query"
          if (id.includes("react-router")) return "vendor-router"
          if (id.includes("/react/") || id.includes("/react-dom/") || id.includes("/scheduler/")) return "vendor-react"
          if (id.includes("@radix-ui") || id.includes("lucide-react") || id.includes("sonner")) return "vendor-ui"
          return "vendor"
        },
      },
    },
  },
})
