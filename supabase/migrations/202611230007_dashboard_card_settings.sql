alter table public.app_config
  drop constraint if exists app_config_key_check,
  add constraint app_config_key_check
    check (key in ('school_sync', 'plan_eligibility', 'staffing_rules', 'dashboard_cards'));
