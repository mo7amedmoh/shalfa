alter table public.schools
  drop constraint if exists schools_ministry_no_key;

create index if not exists schools_ministry_no_idx
  on public.schools (ministry_no);

alter table public.schools
  add column source_key text,
  add column source_columns jsonb not null default '[]'::jsonb,
  add column source_row integer,
  add column missing_from_sheet_at timestamptz;

update public.schools
set source_key = lower(regexp_replace(
      translate(btrim(ministry_no), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'),
      '\s+', ' ', 'g'
    )) || '#1',
    source_columns = coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('header', fields.key, 'value', fields.value)
          order by fields.key
        )
        from jsonb_each(extra) as fields(key, value)
      ),
      '[]'::jsonb
    );

alter table public.schools
  alter column source_key set not null;

create unique index schools_source_key_key
  on public.schools (source_key);
