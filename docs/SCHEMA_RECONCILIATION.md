# Schema reconciliation

The base schema in `docs/reference/001_shalfa_schema_rls.sql` plus every migration in `supabase/migrations/` is authoritative. The production error `column schools.source_row does not exist` means the deployed database has not applied `202611050001_schools_source_key.sql`: that migration adds `source_row` (and `source_key`, `source_columns`, and `missing_from_sheet_at`). It is not a typo in the `schools` query. Apply the migrations in the order listed below; do not edit the existing migrations. Historical `202611030001`–`202611030004` migrations belonged to an older schema and are not present or applicable.

All PostgREST table and RPC references in `src/` and `scripts/` resolve against the base schema and listed migrations. The current discrepancies were deployment state and column permissions, not missing SQL object names: the `source_row` migration must be applied, and `gatekeepers.employee_no` needs a column-level SELECT grant added by `202611060001_gatekeeper_employee_no_read.sql`. The app and `scripts/verify-schema.ts` share their query projections and required-column lists from `src/lib/schemaColumns.ts`. The verifier deliberately omits the protected `residence_no` columns; those are read only through `reveal_residence`.

The app does not directly query a SQL view. Its nested PostgREST relations are joins to `schools` and `employees`. The views checked by `scripts/verify-rls.ts` (`kpi_card_scores` and `kpi_month_totals`) are defined in 001.

| Object | Used by app (columns / RPC arguments) | In 001 | In migrations | Action |
|---|---|---:|---|---|
| `profiles` | `id`, `username`, `role`, `full_name` (display-name alias), `phone`, `employee_id`, `prefs` | Yes | No additions | Replaced `user_profiles` / `user_preferences`; profile creation remains trigger-managed. |
| `app_config` | `key`, `value`, `updated_by`, `updated_at` | No | `202611040001`, `202611140001` | Add minimal key/value configuration with member reads; the latest migration adds the `staffing_rules` key and default six-size rule table and restricts edits to that key to admins. |
| `app_settings` | `id`, `contract_signing_date`, `site_handover_date`, `award_letter_date` | Yes except `award_letter_date` | `202611060002` | Nullable award-letter date supports automatic due dates for `الترسية`; initialized to the reference workbook date (2026-07-01) and may be cleared if unknown. |
| `schools` | `id`, `ministry_no`, `ministry_key`, `name`, `extra`, `lat`, `lng`, `neighbourhood`, `synced_at`, `source_key`, `source_columns`, `source_row`, `missing_from_sheet_at`, `plan_scope`, `size_source`, `size_calc`, `class_count`, `building_type`, `has_elevator_contractor` | Base fields yes; source-tracking fields no | `202611050001`, `202611070001`, `202611140001` | Ministry numbers may repeat; unique `source_key` is normalized ministry number plus occurrence. `size_source` accepts six normalized indicators and is authoritative; `size_calc` remains a class-count reference. |
| `employees` | `id`, `full_name`, `employee_no`, `job_title`, `department`, `category`, `manager_id`, `phone`, `nationality`, `hire_date`, `status`; `residence_no` is intentionally probed as forbidden by `verify-rls.ts`, read via the audited reveal RPC, and used by the cleaner-import RPC | Yes | No additions | App reads only the explicitly granted columns. |
| `employee_ratings` | `employee_id`, `rating`, `updated_by` | Yes | No additions | Read/upsert is restricted to admin/project-manager; verified against role policy. |
| `cleaner_assignments` | `id`, `school_id`, `employee_id`, `labour_source` | Yes | No additions | Uses native `labour_source` enum values and native employee columns. |
| `staffing_exceptions` | `school_id`, `required_count`, `reason`, `created_by` | Yes | No additions | Replaced JSON-based `school_overrides.staffing_exception`; edits remain admin/project-manager only. |
| `school_size_corrections` | `school_id`, `corrected_size`, `updated_by`, `updated_at` | No | `202611040001`, `202611140001` | Add a dedicated correction table and widen its constraint to the six normalized indicators; do not overwrite sheet-sourced school size values. |
| `gatekeepers` | `id`, `school_id`, `employee_id`, `full_name`, `employee_no`, `phone`, `notes`; `residence_no` is never selected directly | Base fields except `employee_id` / `employee_no` | `202611040001` adds nullable employee FK; `202611050003` adds `employee_no`; `202611060001` grants SELECT on `employee_no` | The school record is authoritative and may be written without an employee link. `residence_no` is written explicitly only when supplied and revealed through the audited RPC. |
| `monthly_plans` | `id`, `plan_type`, `month`, `created_by` | Yes | No additions | Replaced `plan_month` with native `month`. |
| `monthly_plan_rows` | `id`, `plan_id`, `school_id`, `planned_date`, `engineer_id`, `supervisor_id`, `visited`, `visited_date`, `report_done`, `report_done_date`, `notes`, `contractor_name` | Base fields except `contractor_name` | `202611050003` | Mapped app visit/report aliases to native fields and set the corresponding booleans. `contractor_name` remains in the monthly-plan import. |
| `custom_plan_rows` | `id`, `plan_id`, `school_id`, `planned_date`, `execution_date`, `status`, `visited`, `visited_date`, `report_done`, `report_done_date`, `notes` | `visited` and `report_done` are in the base | `202611070002` | Adds visit/report dates, follower-safe update guards, and the audited bulk-update RPC; updates are restricted to existing rows in the selected plan. |
| `general_plans` | `id`, `plan_type`, `year` | Yes | No additions | Create/find the parent plan before adding rows; maps `sewage_waste` UI routing to `sewage_removal`. |
| `general_plan_rows` | `id`, `plan_id`, `school_id`, `planned_date`, `execution_date`, `status`, `report_done`, `report_done_date`, `notes`, `contractor_name` | Base fields except `responses_count` and `contractor_name` | `202611050003`, `202611150001` | Adds a separate report-completion state for general plans. `responses_count` remains a historical database column but is unused; `contractor_name` remains available. |
| `supervisor_aliases` | `alias_normalised`, `employee_id` | No | `202611050003` | Stores optional normalized engineer/supervisor aliases created by monthly-plan imports. |
| `reward_pools` | `id`, `engineer_id`, `month`, `amount`, `status`, `approved_by` | Yes | No additions | Replaced `reward_month` / `locked_at`; engineers are resolved through `profiles.employee_id`. |
| `reward_allocations` | `id`, `pool_id`, `employee_id`, `amount`, `note`, `updated_at` | Yes | No additions | Replaced nonexistent `reward_distributions`; retains schema allocation guards. |
| `kpi_card_weights` | `card`, `weight` | Yes | No additions | Read from the protected database table; no public KPI catalog bundle. |
| `kpi_months` | `id`, `month`, `work_order`, `project_no`, `region`, `contractor`, `status`, `approved_by` | Yes | No additions | Replaced `kpi_scorecards` with the applied monthly KPI parent table. |
| `kpi_entries` | `id`, `kpi_month_id`, `indicator_code`, `applicable`, `numerator`, `denominator`, `extra`, `score` | Yes | No additions | Stores the app's indicator input payload in `extra` and the calculated score in `score`. |
| `kpi_indicators` | `code`, `card`, `seq`, `name`, `importance`, `frequency`, `description`, `formula_text`, `target_text`, `source_ref`, `required_data`, `default_applicable` | Yes | No additions | Catalog is loaded under KPI RLS; seed via `npm run seed:kpi:database` in a trusted environment. |
| `kpi_discount_matrix` | `bucket` | Yes | No additions | Schema/RLS probe in `verify-rls.ts`. |
| `kpi_penalty_types` | `code` | Yes | No additions | Schema/RLS probe in `verify-rls.ts`. |
| `kpi_penalty_entries` | `id` | Yes | No additions | Schema/RLS probe in `verify-rls.ts`. |
| `kpi_card_scores` view | `kpi_month_id` | Yes | No additions | Schema/RLS probe in `verify-rls.ts`; `security_invoker` view. |
| `kpi_month_totals` view | `kpi_month_id` | Yes | No additions | Schema/RLS probe in `verify-rls.ts`; `security_invoker` view. |
| `checklist_items` | `id`, `domain`, `seq`, `axis`, `item`, `contract_ref`, `evidence`, `frequency`, `owner`, `status`, `notes` | Yes | `202611040001` tightens read policy | No current app query; `scripts/seed-checklist.ts` upserts the CM/OM catalogue while preserving existing progress. |
| `deliverables` | `id`, `seq`, `clause`, `title`, `due_basis`, `duration_days`, `duration_text`, `review_cycle`, `due_date`, `status`, `delivered_on`, `approved_on`, `notes` | Yes except `duration_text` | `202611040001` sets roles; `202611060002` adds schedule fields | Seed with `npm run seed:deliverables`. Metadata upserts omit status, dates, manual due-date overrides, and notes. Admin/project-manager may write; area engineers may read, verified by `verify-rls.ts`. |
| `attachments` | `id`, `entity`, `entity_id`, `storage_path`, `file_name`, `mime_type`, `size_bytes`, `uploaded_by`, `created_at` | Yes | No additions | Deliverable evidence is stored in private bucket `evidence` and linked with `entity = 'deliverable'`; the schema validates MIME types and the 10 MB limit. |
| `audit_log` | `id`, `actor`, `action`, `table_name`, `row_id`, `details`, `at` | Yes | No additions | Mapped audit screen to native fields; removed invalid client inserts and old audit aliases. |
| `reveal_residence(p_kind, p_ids)` | `p_kind = employees \| gatekeepers`, `p_ids`; returns `id`, `residence_no` | Yes | No additions | Replaced nonexistent `reveal_employee_residence` / `set_employee_residence`; RPC results are treated as rows. |
| `import_general_plan_rows(p_plan_id, p_rows)` | `p_plan_id`, `p_rows`; returns `source_line`, `school_id`, `operation` | No | `202611050003` | Upserts general plan rows without exposing a missing RPC. |
| `resolve_import_cleaner(p_school_id, p_full_name, p_employee_no, p_residence_no, p_labour_source)` | Listed arguments; returns `id`, `full_name`, `employee_no`, `operation` | No | `202611050003` | Matches or creates a cleaner and assigns them transactionally. |
| `admin_school_cleanup_list()`, `admin_school_cleanup_backup(p_school_ids)`, `admin_cleanup_school(p_action, p_school_id, p_target_id, p_confirmation)`, `admin_bulk_delete_unlinked_schools(p_school_ids)` | Admin-only list/count, backup, merge/delete, and unlinked bulk-delete RPCs | No | `202611090001` | Merge/delete operations are security-definer, audited, and never performed by direct client-side school deletion. Excel backup omits protected `gatekeepers.residence_no`. |
| `kpi_scorecards` / `public/data/kpi-scorecards.json` | Previously used `score_month`, `region`, `work_order`, `card_code`, `source_data`, approval fields; public bundle also exposed October inputs | No | Superseded migration removed | Removed duplicate table and public catalog; app now reads/writes protected `kpi_months`, `kpi_entries`, weights, and indicators. |
| `kpi_checklist_progress` | Previously used localized status and text IDs | No | Superseded migration removed | Not used; checklist feature is dormant and applied `checklist_items` data is untouched. |
| `user_profiles`, `user_preferences` | Previously used profile aliases and separate preference rows | No | Superseded migrations removed | App now uses `profiles.full_name`, `profiles.prefs`, and other native profile fields. |
| `school_overrides`, `gatekeeper_assignments`, `reward_distributions` | Previously used by app | No | Superseded migrations removed | Replaced with the applied `staffing_exceptions`, additive `school_size_corrections`, `gatekeepers`, and `reward_allocations`. |
| `export_employee_roster`, `audit_school_sync`, `set_employee_residence`, `reveal_employee_residence` | Previously called by app | No | Superseded migration removed | Removed calls to missing RPCs; current RPC references are listed above. |

## Security invariants

- The applied column grants still exclude `employees.residence_no` and `gatekeepers.residence_no`; the app only requests those values through `reveal_residence`.
- `employee_ratings` and KPI scoring tables are restricted to `admin` / `project_manager`; `checklist_items` and `deliverables` are readable by `area_engineer`, with writes restricted to `admin` / `project_manager`.
- KPI definitions and October source inputs are no longer served from public static assets.
- The existing `profiles` trigger keeps `username` immutable.
- Employee and gatekeeper queries use explicit column lists; no wildcard select is used on either table.
- The checklist JSON has been removed from `public/`; checklist rows are loaded only from authenticated Supabase queries.
- `gatekeepers.employee_no` is intentionally readable only after migration `202611060001`; `employee_id` remains a nullable link to `employees`, not the source of the gatekeeper's direct name, phone, employee number, residence number, or notes.

## Required migration order

Apply these after the base schema 001, in exactly this order:

1. `supabase/migrations/202611040001_reconcile.sql`
2. `supabase/migrations/202611050001_schools_source_key.sql`
3. `supabase/migrations/202611050002_general_plan_water_supply.sql`
4. `supabase/migrations/202611050003_import_support.sql`
5. `supabase/migrations/202611060001_gatekeeper_employee_no_read.sql`
6. `supabase/migrations/202611060002_deliverable_schedule_fields.sql`
7. `supabase/migrations/202611060003_area_engineer_profile_link.sql`
8. `supabase/migrations/202611060004_plan_names_custom_plans.sql`
9. `supabase/migrations/202611060005_custom_plan_group_and_audit.sql`
10. `supabase/migrations/202611070001_ministry_key.sql`
11. `supabase/migrations/202611070002_bulk_plan_updates.sql`
12. `supabase/migrations/202611090001_school_cleanup.sql`
13. `supabase/migrations/202611100001_gatekeeper_category.sql`
14. `supabase/migrations/202611100002_gatekeeper_employee_links.sql`
15. `supabase/migrations/202611110001_monthly_late_accounting.sql`
16. `supabase/migrations/202611140001_school_size_model.sql`

Then run a full school sync to populate accurate source row/order metadata. `npm run verify:schema` checks the app's required columns using `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `TEST_SCHEMA_EMAIL`, and `TEST_SCHEMA_PASSWORD` from the environment or local env files. Use an admin/project-manager test login so RLS-restricted catalog columns can be probed; no credentials belong in source control.
