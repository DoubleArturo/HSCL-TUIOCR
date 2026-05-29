export const PROMPT_T500 = `
## TYPE: T500 (格式22) — two sub-types:

### Sub-type A: 二聯收銀 (二聯收銀機統一發票)
**Visual fingerprint:**
- "收銀機統一發票" printed on a NARROW thermal receipt strip (~7cm wide)
- NO "扣抵聯" text (that would make it T302)
- Issued by: parking lots (停車場), gas stations (加油站), supermarkets, convenience stores
- tax_code: "T500", voucher_type: "二聯收銀"

### Sub-type B: 交通票券
**Visual fingerprint:**
- A transit ticket from: 台灣高鐵, 台鐵, 客運, 捷運
- May show passenger name, seat number, train/bus number, departure/arrival station
- ticket_passenger_name OR ticket_seat_number present
- tax_code: "T500", voucher_type: "交通票券"

**Extraction for both sub-types:**
- invoice_number: extract the printed number (may be a long numeric barcode for transit tickets).
- seller_tax_id: null (not present on transit tickets; on narrow strip find in header if available).
- amounts: 合計 or 總計 value. For transit tickets, use the ticket price.
`;
