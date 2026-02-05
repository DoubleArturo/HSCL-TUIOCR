# Taiwan Invoice OCR Audit Pro (台灣進項發票 AI 稽核系統)

本專案是一個基於 Google Gemini 2.5 Pro/Flash 的智慧型發票辨識與稽核系統，專為台灣企業進項發票 (GUI) 設計。它採用 Local-First (本機優先) 架構，確保資料隱私，並提供高效的 AI 輔助校對流程。

## 1. 系統流程 (Workflow)

系統運作流程分為四個階段：

1.  **匯入 (Import)**：
    *   使用者上傳 PDF 掃描檔或圖片 (JPG/PNG)。
    *   匯入 ERP 系統匯出的 `Excel/CSV` 檔，用於與 OCR 結果進行交叉比對。
2.  **AI 辨識 (OCR Processing)**：
    *   系統自動調用 Google Gemini API 進行多模態視覺辨識。
    *   **混合模型策略 (Hybrid Strategy)**：預設使用快速低成本的 **Gemini 2.5 Flash**。若信心分數過低或邏輯驗證失敗，自動升級為 **Gemini 2.5 Pro** 重試。
3.  **人工稽核 (Audit & Review)**：
    *   使用者在「發票編輯器」或「異常檢核頁面」確認資料。
    *   AI 會自動標記潛在錯誤（如金額不平、統編錯誤）。
4.  **匯出 (Export)**：
    *   產生包含完整差異分析的 CSV 報表，供會計人員修正 ERP 或存檔。

## 2. 業務邏輯與驗證 (Business Logic)

系統內建嚴格的會計邏輯，確保資料的合規性：

*   **黃金恆等式 (The Golden Equation)**：
    *   `銷售額 (Sales Amount) + 稅額 (Tax Amount) = 總計 (Total Amount)`
    *   系統允許 ±1 元的誤差（處理四捨五入），超出此範圍將被標記為「金額邏輯錯誤」。
*   **買方統編驗證 (Buyer Tax ID)**：
    *   系統依照設定檢核買方統編（預設：`16547744`）。
    *   若 OCR 結果不符，將標記為紅色錯誤，提醒使用者修正。
*   **重複發票偵測 (Deduplication)**：
    *   以「發票號碼 (Invoice Number)」為唯一鍵值。
    *   若專案中出現兩張相同號碼的發票，系統會發出警告，防止重複入帳。

## 3. 介面設計 (Interface Design)

前端採用 React + Tailwind CSS 開發，強調高效率的操作體驗：

*   **發票編輯器 (Invoice Editor)**：
    *   **左側列表**：顯示所有上傳的檔案及其處理狀態（綠燈=通過、紅燈=錯誤）。
    *   **中間預覽**：支援 PDF 分頁瀏覽、縮放、拖曳查看原始憑證。
    *   **右側表單**：欄位即時驗證。AI 信心分數低於 90% 的欄位會以橘色/紅色邊框警示。
*   **異常檢核頁面 (Error Review Page)**：
    *   **專注模式**：僅列出「有問題」的發票（如統編錯誤、金額不符）。
    *   **類別篩選 (Category Filters)**：依錯誤類型篩選（全部、買方統編、金額勾稽、賣方統編、其他），並顯示各類別數量。
    *   **多標籤顯示 (Multi-tag)**：一張發票若有多種錯誤，會同時顯示多個錯誤標籤。
    *   **文件類型標籤**：在發票號碼旁顯示文件類型（統一發票/Invoice/進口報關/非發票），協助快速識別。
    *   **分割視窗**：左側原圖、右側欄位，方便快速修正錯誤。

## 4. 專案結構與技術

*   **Frontend**: React, Vite, TypeScript
*   **Styling**: Tailwind CSS
*   **Data Storage**:
    *   **Metadata**: LocalStorage (專案列表)
    *   **Files**: IndexedDB (圖片與 PDF 原始檔)
    *   *註：本系統為純前端應用，無後端資料庫，資料皆存在使用者瀏覽器中。*
*   **AI Service**: Google Gemini API (透過 `services/geminiService.ts` 呼叫)

## 5. Agent Skills (AI 開發指南)

本專案在 `.agent/skills/` 目錄下留有詳細的開發文件，供後續 AI Agent 參考：
*   `UI_Interface`: 前端元件架構規範。
*   `Business_Logic`: 詳細的會計規則與資料模型。
*   `OCR_Prompts`: OCR 提示詞工程與模型策略。
