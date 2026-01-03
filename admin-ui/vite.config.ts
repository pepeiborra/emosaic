import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react()],
    // Use /admin/ base path for production, / for development
    base: mode === 'production' ? '/admin/' : '/',
    server: {
      proxy: {
        '/api': {
          target: env.VITE_API_URL || 'https://your-api-id.execute-api.eu-west-3.amazonaws.com/prod',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
          secure: true,
        },
      },
    },
  }
})
