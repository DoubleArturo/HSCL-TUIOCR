# Debug 協作規則

## Evidence 原則

**無 evidence → 不提修法**

- 要求提供：DevTools screenshot / curl 輸出 / logs / error message
- 有 evidence → 直接定位問題，提出單一修法
- 3 次修法失敗 → 停止猜測，改為架構重新分析

## Debug 流程

```
1. 重現問題（steps to reproduce）
2. 收集 evidence（log / network / error）
3. 定位根因（不是症狀）
4. 單一修法
5. 驗證修法（不只修了那個點，整體也正常）
```

## 禁止行為

- ❌ 沒有 log 就說「可能是 X 問題」
- ❌ 連續 patch 多個地方同時改
- ❌ 改壞後直接 revert 不找根因
