# Skill: UI Interface Architecture

## Overview
This skill documents the frontend interface architecture, component hierarchy, and state management of the **Taiwan Invoice OCR Audit Pro**. Future agents should refer to this to maintain UI consistency and component reusability.

## 1. Core Component Map

### `App.tsx` (Main Entry)
- **Role**: State container, routing, and global layout.
- **Key State**:
    - `view`: Controls the main display (`PROJECT_LIST`, `WORKSPACE`, `ERROR_REVIEW`).
    - `project`: Holds the currently loaded project data.
    - `status`: Tracks global app status (`IDLE`, `PROCESSING`).
- **Layout**:
    - **Header**: Contains Global Actions (Upload, ERP Import, Export Report, Error Review).
    - **Main Area**: Renders the active view component.

### `components/InvoiceEditor.tsx`
- **Role**: The primary workspace for auditing invoices.
- **Features**:
    - Displays list of files on the left.
    - Embeds `InvoicePreview` and `InvoiceForm`.
    - Handles file navigation key bindings.

### `components/ErrorReviewPage.tsx`
- **Role**: Specialized view for fixing validation errors.
- **Features**:
    - **Sidebar**: Filters and lists ONLY invoices with specific error codes (e.g., Buyer ID Mismatch).
    - **Split View**: Reuses `InvoicePreview` and `InvoiceForm`.
    - **Focus Mode**: Optimized for rapid data correction.

### `components/InvoicePreview.tsx`
- **Role**: Reusable document viewer.
- **Capabilities**:
    - **PDF**: Uses `react-pdf` for high-fidelity rendering. Supports page navigation.
    - **Image**: Standard `img` tag for JPG/PNG.
    - **Zoom/Pan**: Built-in mouse wheel zoom and drag-to-pan logic.

### `components/InvoiceForm.tsx`
- **Role**: Reusable data entry form.
- **Capabilities**:
    - **Validation Visuals**: Color-coded borders based on `field_confidence` and validation logic.
        - Red: Critical Error / Low Confidence.
        - Orange: Warning.
        - Green: Verified / High Confidence.
    - **Logic Check**: Real-time validation of `Sales + Tax == Total`.

## 2. styling Strategy
- **Framework**: Tailwind CSS.
- **Theme**:
    - Primary: Indigo (`text-indigo-600`, `bg-indigo-50`).
    - Success: Emerald (`text-emerald-600`).
    - Error: Rose (`text-rose-600`).
    - Warning: Amber (`text-amber-500`).
- **Principles**:
    - Use `backdrop-blur` for overlays.
    - Use `shadow-xl` for depth in floating panels.
    - Font: `font-mono` for numbers and IDs to ensure readability.

## 3. Important Rules for Modification
1.  **Do NOT break the Split View**: The Side-by-Side (Preview + Form) layout is critical for audit efficiency.
2.  **Maintain Color Coding**: Red/Orange/Green semantic meanings must remain consistent across all views.
3.  **Component Reuse**: If modifying the form layout, update `InvoiceForm.tsx` so both Editor and Review Page benefit.
