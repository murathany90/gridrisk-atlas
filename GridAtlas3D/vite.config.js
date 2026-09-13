import { defineConfig } from 'vite';

// Faz 1: basit statik build. Kaynak giriş noktası GridAtlas3D/index.html olarak kalır,
// böylece ana uygulamanın `GridAtlas3D/index.html?embed=1&country=..&lang=..` erişimi bozulmaz.
// Kaynak index.html importmap + ./vendor ile doğrudan statik sunucuda çalışır;
// `npm run build` çıktısı (dist/) CI'da üretilen ürün artefaktıdır ve
// Pages deploy'unda deploy/GridAtlas3D/ altına kopyalanır.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1200
  },
  server: {
    port: 5173
  }
});
