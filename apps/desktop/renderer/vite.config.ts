import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const apiUrl = env.PUBLIC_API_URL

  return {
    base: './',
    envPrefix: ['VITE_', 'PUBLIC_'],
    plugins: [react(), tailwindcss()],
    server: {
      host: 'localhost',
      port: 5187,
      strictPort: true,
      proxy: {
        '/api': {
          target: apiUrl,
          changeOrigin: true,
        },
      },
    },
  }
})
