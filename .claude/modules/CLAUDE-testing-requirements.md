# 測試要求

## 測試層級

| 層級 | 工具 | 覆蓋目標 |
|---|---|---|
| Unit | jest / pytest | 純邏輯函數 |
| Integration | supertest / httpx | API 端點 |
| E2E | Playwright | 關鍵使用者流程 |

## 規則

- 改邏輯函數 → 必須有對應 unit test
- 改 API 路由 → 必須有 integration test
- 改 UI 流程 → 手動驗證 golden path + edge cases
- 禁止帶失敗測試 push

## 測試命名

```
describe('功能名稱', () => {
  it('應該要做什麼', () => { ... })
  it('當X時應該要做什麼', () => { ... })
})
```
