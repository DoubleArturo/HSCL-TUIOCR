-- OCR correction feedback loop
-- Records field-level diffs when users manually correct OCR results.
-- Used for error pattern analytics and prompt improvement insights.

create table if not exists ocr_corrections (
  id           uuid        default gen_random_uuid() primary key,
  created_at   timestamptz default now(),
  file_id      text        not null,
  voucher_id   text,
  tax_code     text,
  voucher_type text,
  field_name   text        not null,
  original_value  text,
  corrected_value text     not null,
  user_email   text
);

create index if not exists ocr_corrections_field_tax_idx
  on ocr_corrections (field_name, tax_code);

create index if not exists ocr_corrections_created_at_idx
  on ocr_corrections (created_at desc);
