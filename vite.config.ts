import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Port is configurable: `PORT=3000 npm run dev` or `npm run dev -- --port 3000`.
// Default 8765 (5179-ish ranges are often reserved by Hyper-V/WinNAT on Windows).
const port = Number(process.env.PORT) || 8765

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: { port, strictPort: false },
  preview: { port, strictPort: false },
})
