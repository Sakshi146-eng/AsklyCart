import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/.well-known': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        bypass(req) {
          // Chrome DevTools probes this path — don't proxy it, just 404 locally
          if (req.url?.includes('com.chrome.devtools')) return req.url;
          return null; // let other /.well-known/* pass through to backend
        },
      },
    },
  },
})
