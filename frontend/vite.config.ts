import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

const base = '/' + (process.env.VITE_BASE_PATH ?? '/port5000/').replace(/^\/+|\/+$/g, '')
const prefix = base === '/' ? '' : base

export default defineConfig({
  base: `${prefix}/`,
  server: {
    proxy: {
      [`${prefix}/stats`]: {
        target: 'http://localhost:8000',
        rewrite: (path) => path.slice(prefix.length),
      },
    },
  },
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],
})
