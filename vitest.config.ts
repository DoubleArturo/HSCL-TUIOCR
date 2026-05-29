import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts', 'services/**/*.test.ts'],
    // documentRegistry 用 localStorage（DOM API），需要 jsdom 環境
    // 其餘 services/ 和 src/ 測試在 node 環境下跑
    environmentMatchGlobs: [
      ['services/documentRegistry.test.ts', 'jsdom'],
    ],
    environment: 'node',
  },
});
