create or replace function public.normalise_ministry_no(p_value text)
returns text
language plpgsql
immutable
parallel safe
as $$
declare
  normalized text;
begin
  normalized := upper(regexp_replace(
    translate(coalesce(p_value, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'),
    '[[:space:]]', '', 'g'
  ));
  if normalized ~ '^M[0-9]' then
    normalized := substr(normalized, 2);
  end if;
  if normalized <> '' and normalized !~ '[^0]' then
    return '0';
  end if;
  if normalized ~ '^0+[0-9]' then
    return regexp_replace(normalized, '^0+', '');
  end if;
  return normalized;
end;
$$;

alter table public.schools
  add column if not exists ministry_key text
  generated always as (public.normalise_ministry_no(ministry_no)) stored;

create index if not exists schools_ministry_key_idx
  on public.schools (ministry_key);
