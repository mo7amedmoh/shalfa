# Schema reconciliation

The applied schema in `docs/reference/001_shalfa_schema_rls.sql` is authoritative. The app now uses its native tables and column names; the single additive migration is `supabase/migrations/202611040001_reconcile.sql`. Historical migrations `202611030001`–`202611030004` were based on a different schema and have been removed from the active migration directory.

The app does not directly query a SQL view. Nested PostgREST relations in plan reports and placements are joins to the `schools` and `employees` tables listed below.

| Object | Used by app (columns / RPC arguments) | In 001 | In migrations | Action |
|---|---|---:|---|---|
| `profiles` | `id`, `username`, `role`, `full_name` (display-name alias), `phone`, `employee_id`, `prefs` | Yes | No additions | Replaced `user_profiles` / `user_preferences`; profile creation remains trigger-managed. |
| `app_config` | `key`, `value`, `updated_by`, `updated_at` | No | `202611040001` | Add minimal key/value configuration with member reads and admin/project-manager writes. |
| `schools` | `id`, `ministry_no`, `name`, `extra`, `lat`, `lng`, `synced_at` | Yes | No additions | Mapped old app aliases to native columns; removed nonexistent `audit_school_sync` RPC. |
| `employees` | `id`, `full_name`, `employee_no`, `job_title`, `department`, `category`, `manager_id`, `phone`, `nationality`, `hire_date`, `status`; `residence_no` only through RPC | Yes | No additions | Mapped app fields to native columns. No direct residence-number selects or writes. |
| `employee_ratings` | `employee_id`, `rating`, `updated_by` | Yes | No additions | Kept reads to admin/project-manager UI; verified against role policy. |
| `cleaner_assignments` | `id`, `school_id`, `employee_id`, `labour_source` | Yes | No additions | Uses native `labour_source` enum values and native employee columns. |
| `staffing_exceptions` | `school_id`, `required_count`, `reason`, `created_by` | Yes | No additions | Replaced JSON-based `school_overrides.staffing_exception`; edits remain admin/project-manager only. |
| `school_size_corrections` | `school_id`, `corrected_size`, `updated_by`, `updated_at` | No | `202611040001` | Add a dedicated correction table; do not overwrite sheet-sourced school size values. |
| `gatekeepers` | `id`, `school_id`, `employee_id`, `full_name`, `phone`; `residence_no` only through RPC | `employee_id` absent | `202611040001` adds nullable employee FK | Replaced `gatekeeper_assignments`; explicit column lists preserve residence protection. |
| `monthly_plans` | `id`, `plan_type`, `month`, `created_by` | Yes | No additions | Replaced `plan_month` with native `month`. |
| `monthly_plan_rows` | `id`, `plan_id`, `school_id`, `planned_date`, `engineer_id`, `supervisor_id`, `visited`, `visited_date`, `report_done`, `report_done_date`, `notes` | Yes | No additions | Mapped app visit/report aliases to native fields and set the corresponding booleans. |
| `general_plans` | `id`, `plan_type`, `year` | Yes | No additions | Create/find the parent plan before adding rows; maps `sewage_waste` UI routing to `sewage_removal`. |
| `general_plan_rows` | `id`, `plan_id`, `school_id`, `planned_date`, `execution_date`, `status`, `notes` | Yes | No additions | Replaced old row-level `plan_type` / `completed_at` assumptions with parent relation and native status values. |
| `reward_pools` | `id`, `engineer_id`, `month`, `amount`, `status`, `approved_by` | Yes | No additions | Replaced `reward_month` / `locked_at`; engineers are resolved through `profiles.employee_id`. |
| `reward_allocations` | `id`, `pool_id`, `employee_id`, `amount`, `note`, `updated_at` | Yes | No additions | Replaced nonexistent `reward_distributions`; retains schema allocation guards. |
| `kpi_card_weights` | `card`, `weight` | Yes | No additions | Read from the protected database table; no public KPI catalog bundle. |
| `kpi_months` | `id`, `month`, `work_order`, `project_no`, `region`, `contractor`, `status`, `approved_by` | Yes | No additions | Replaced `kpi_scorecards` with the applied monthly KPI parent table. |
| `kpi_entries` | `id`, `kpi_month_id`, `indicator_code`, `applicable`, `numerator`, `denominator`, `extra`, `score` | Yes | No additions | Stores the app's indicator input payload in `extra` and the calculated score in `score`. |
| `kpi_indicators` | `code`, `card`, `seq`, `name`, `importance`, `frequency`, `description`, `formula_text`, `target_text`, `source_ref`, `required_data` | Yes | No additions | Catalog is loaded under KPI RLS; seed via `npm run seed:kpi:database` in a trusted environment. |
| `checklist_items` | `id`, `domain`, `seq`, `axis`, `item`, `contract_ref`, `evidence`, `frequency`, `owner`, `status`, `notes`, `updated_at`, `is_recommendation` | Yes | `202611040001` tightens read policy | Replaced public JSON and duplicate `kpi_checklist_progress`; catalog/progress are served from this table, admin/project-manager only. Seed via `npm run seed:checklist` in a trusted environment. |
| `deliverables` | No direct app query currently; covered by RLS verification | Yes | `202611040001` tightens read policy | Restricted reads to admin/project-manager as required for KPI data. |
| `audit_log` | `id`, `actor`, `action`, `table_name`, `row_id`, `details`, `at` | Yes | No additions | Mapped audit screen to native fields; removed invalid client inserts and old audit aliases. |
| `reveal_residence(p_kind, p_ids)` | `p_kind = employees \| gatekeepers`, `p_ids` | Yes | No additions | Replaced nonexistent `reveal_employee_residence` / `set_employee_residence`; RPC results are treated as rows. |
| `kpi_scorecards` / `public/data/kpi-scorecards.json` | Previously used `score_month`, `region`, `work_order`, `card_code`, `source_data`, approval fields; public bundle also exposed October inputs | No | Superseded migration removed | Removed duplicate table and public catalog; app now reads/writes protected `kpi_months`, `kpi_entries`, weights, and indicators. |
| `kpi_checklist_progress` | Previously used localized status and text IDs | No | Superseded migration removed | No duplicate progress table; status is stored on `checklist_items`. |
| `user_profiles`, `user_preferences` | Previously used profile aliases and separate preference rows | No | Superseded migrations removed | App now uses `profiles.full_name`, `profiles.prefs`, and other native profile fields. |
| `school_overrides`, `gatekeeper_assignments`, `reward_distributions` | Previously used by app | No | Superseded migrations removed | Replaced with the applied `staffing_exceptions`, additive `school_size_corrections`, `gatekeepers`, and `reward_allocations`. |
| `export_employee_roster`, `audit_school_sync`, `set_employee_residence`, `reveal_employee_residence` | Previously called by app | No | Superseded migration removed | Removed calls to missing RPCs; only the applied audited `reveal_residence` remains in app use. |

## Security invariants

- The applied column grants still exclude `employees.residence_no` and `gatekeepers.residence_no`; the app only requests those values through `reveal_residence`.
- `employee_ratings`, all KPI tables, checklist items, and deliverables are restricted to `admin` / `project_manager`.
- KPI definitions and October source inputs are no longer served from public static assets.
- The existing `profiles` trigger keeps `username` immutable.
- Employee and gatekeeper queries use explicit column lists; no wildcard select is used on either table.
- The checklist JSON has been removed from `public/`; checklist rows are loaded only from authenticated Supabase queries.
