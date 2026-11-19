alter table public.schools
  drop constraint if exists schools_size_source_check,
  add constraint schools_size_source_check
    check (size_source is null or size_source in (
      'small', 'small_plus', 'medium', 'medium_plus', 'large', 'large_plus', 'large_plus_plus'
    ));

alter table public.school_size_corrections
  drop constraint if exists school_size_corrections_corrected_size_check,
  add constraint school_size_corrections_corrected_size_check
    check (corrected_size in (
      'small', 'small_plus', 'medium', 'medium_plus', 'large', 'large_plus', 'large_plus_plus'
    ));
