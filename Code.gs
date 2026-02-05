/**
 * Google Apps Script for Taiwan Invoice OCR Audit Pro
 * 
 * Instructions:
 * 1. Create a new Google Sheet.
 * 2. Extensions > Apps Script.
 * 3. Paste this code into Code.gs.
 * 4. Run the 'setup' function once to create sheets.
 * 5. Deploy > New Deployment > Web App > Execute as: Me > Who has access: Anyone.
 * 6. Copy the Web App URL.
 */

const SHEET_PROJECTS = "Projects";
const SHEET_INVOICES = "Invoices";

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  if (!ss.getSheetByName(SHEET_PROJECTS)) {
    const pSheet = ss.insertSheet(SHEET_PROJECTS);
    pSheet.appendRow(["id", "name", "created_at", "updated_at", "total_invoices", "total_erp_records", "last_synced"]);
  }
  
  if (!ss.getSheetByName(SHEET_INVOICES)) {
    const iSheet = ss.insertSheet(SHEET_INVOICES);
    iSheet.appendRow([
      "project_id", "invoice_number", "date", "buyer_id", "seller_id", 
      "sales_amt", "tax_amt", "total_amt", "status", "error_code", "ai_confidence", "cost_usd"
    ]);
  }
}

function doPost(e) {
  // CORS Lock
  const lock = LockService.getScriptLock();
  lock.tryLock(10000);

  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    if (action === "save_project") {
      const project = data.project;
      saveProject(ss, project);
      return response({ status: "success", message: "Project saved" });
    }

    return response({ status: "error", message: "Unknown action" });

  } catch (err) {
    return response({ status: "error", message: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

function saveProject(ss, project) {
  const pSheet = ss.getSheetByName(SHEET_PROJECTS);
  const iSheet = ss.getSheetByName(SHEET_INVOICES);

  // 1. Update Project Row (Upsert)
  const pData = pSheet.getDataRange().getValues();
  let pRowIndex = -1;
  
  for (let i = 1; i < pData.length; i++) {
    if (pData[i][0] == project.id) {
      pRowIndex = i + 1;
      break;
    }
  }

  const pRowData = [
    project.id, 
    project.name, 
    project.createdAt, 
    new Date().toISOString(),
    project.invoices.length,
    project.erpData.length,
    new Date().toISOString()
  ];

  if (pRowIndex > 0) {
    pSheet.getRange(pRowIndex, 1, 1, pRowData.length).setValues([pRowData]);
  } else {
    pSheet.appendRow(pRowData);
  }

  // 2. Sync Invoices (Delete old for this project and re-add)
  // This is a naive implementation; for scale, we should diff. 
  // Given <1000 rows, delete-insert is acceptable and robust.
  
  // Find rows to delete (reverse order to maintain indices)
  const iData = iSheet.getDataRange().getValues();
  for (let i = iData.length - 1; i >= 1; i--) {
     if (iData[i][0] == project.id) {
       iSheet.deleteRow(i + 1);
     }
  }

  // Add all invoices
  const newRows = [];
  project.invoices.forEach(inv => {
    // Only save successfully parsed data
    if (inv.status === 'SUCCESS' && inv.data.length > 0) {
      const d = inv.data[0];
      newRows.push([
        project.id,
        d.invoice_number || "UNKNOWN",
        d.invoice_date || "",
        d.buyer_tax_id || "",
        d.seller_tax_id || "",
        d.amount_sales || 0,
        d.amount_tax || 0,
        d.amount_total || 0,
        inv.status,
        d.error_code || "SUCCESS",
        d.verification?.ai_confidence || 0,
        d.usage_metadata?.cost_usd || 0
      ]);
    }
  });

  if (newRows.length > 0) {
    iSheet.getRange(iSheet.getLastRow() + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
  }
}

function response(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
