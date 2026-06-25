import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts', 'services/**/*.test.ts'],
    testTimeout: 15000, // 增加全局超時以容納圖像生成操作
    // 需要 jsdom 環境的測試（Canvas API、File、Image）
    environmentMatchGlobs: [
      // 明確指定需要 jsdom 的檔案（相對於專案根目錄）
      ['**/imageClarity.test.ts', 'jsdom'],
      ['**/imageClarity.perf.test.ts', 'jsdom'],
      ['**/clarity-edge-cases.test.ts', 'jsdom'],
      ['**/useOCRBatch.test.ts', 'jsdom'],
      ['services/documentRegistry.test.ts', 'jsdom'],
    ],
    environment: 'node',
  },
});
