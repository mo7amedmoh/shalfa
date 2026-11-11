# تقرير الأداء

## طريقة القياس

تم القياس على Windows، Node.js 24، Vite production build، وChromium headless عبر Playwright. أحجام JavaScript محسوبة من `dist/assets` بعد gzip بمستوى 9. تحليل المكونات يُولد عبر:

```powershell
$env:ANALYZE='true'; npm run build
```

## A. حجم الحزمة

| القياس | قبل | بعد | التغير |
|---|---:|---:|---:|
| initial `index-*.js` | 1,140,255 B | 457,723 B | -59.9% |
| initial gzip | نحو 350 KB | 126,699 B | -63.8% |
| `MonthlyReportPage` | 435,318 B | 20,040 B | -95.4% |
| `SchoolsPage` | 207,256 B | 24,460 B | -88.2% |

تم فصل React، React Query، Leaflet، Recharts، وSheetJS إلى manual chunks، وأصبح SheetJS وLeaflet CSS يُحمّلان فقط من الصفحات/الإجراءات التي تستخدمهما. حد الحزمة الابتدائية هو 400 KiB gzip ويُفشل `npm run build` عند تجاوزه.

أكبر 15 مساهمًا في التحليل الحالي (rendered / gzip):

1. `xlsx/xlsx.mjs` — 1,001,439 / 252,980 B
2. `leaflet-src.js` — 474,007 / 112,372 B
3. `GoTrueClient.js` — 271,560 / 48,405 B
4. `react-dom.production.min.js` — 133,838 / 42,655 B
5. `storage-js/dist/index.mjs` — 114,654 / 21,206 B
6. `react-hook-form/dist/index.esm.mjs` — 113,012 / 20,722 B
7. `postgrest-js/dist/index.mjs` — 111,198 / 22,996 B
8. `chunk-6KYCQHYJ.mjs` — 85,964 / 20,884 B
9. `leaflet.markercluster-src.js` — 85,750 / 20,899 B
10. `generateCategoricalChart.js` — 80,608 / 16,141 B
11. `schemas.js` — 69,824 / 14,171 B
12. `ImportWizard.tsx` — 61,187 / 12,595 B
13. `phoenix.mjs` — 56,053 / 13,232 B
14. `decimal.js-light` — 49,577 / 13,184 B
15. `ChartUtils.js` — 40,770 / 10,142 B

## Startup and queries

Dashboard startup requests are role-gated and follow RLS:

- selected-month plan rows with school name, planned date, visit/report completion, and supervisor fields only, for roles allowed to read plans;
- staffing schools (only `id`, `extra`, and `size_source`), cleaner assignment and gatekeeper school IDs, size corrections, staffing exceptions, and eligibility configuration for `admin`, `project_manager`, and `area_engineer`;
- the latest non-null `schools.synced_at` value for `admin` and `project_manager`;
- the selected KPI month, deliverables and their due-date settings, previous-month KPI status, and a 250-row slim audit-log projection for `admin` and `project_manager` only.

URL query filters preserve month, service, and supervisor selection when sharing the dashboard. Report-follower navigation carries the selected month/service into the plan page so the bulk updater opens the corresponding plan.

The schools page intentionally keeps the full `schoolsMap` projection, including source columns, because the table and details view need it. It is not requested by the dashboard. The IndexedDB persister now restores the large schools cache only when the current path is `/schools`; dashboard/login startup skips that restore. Writes remain throttled to five seconds.

The dashboard does not import charting or spreadsheet libraries. Cleaner staffing is calculated from the same slim school projection and domain staffing rules used by placement; full school-table rows are never requested.

The audit activity list formats only recognized event types and whitelisted count/date fields; raw audit details are never rendered. Existing audit writes cover bulk plan updates, but sync/import/approval events are not currently emitted to `audit_log`, so the dashboard does not invent entries for them.

Authenticated dashboard/schools navigation timings could not be measured in this environment because no Supabase session and production credentials are available. The fixture route was measured, but it does not represent authenticated network latency or cache restore.

## B. Map fixture

`/__dev/map-fixture` renders 250 synthetic schools without authentication. It is guarded by `import.meta.env.DEV`; `grep` of the production `dist` found no `DevMapFixture` or `/__dev/map-fixture`.

The map marker layer is built from the slim school projection only. Zoom and pan no longer update React state, and label refresh is attached to `moveend`/`zoomend`; only up to 40 visible labels are opened at high zoom. Cluster loading is chunked, outside-visible markers are removed, and the map uses canvas rendering.

Measured after the change with 8 wheel zooms:

- marker/map readiness observed: 347 ms;
- 200 animation frames;
- 0 long tasks;
- 8 frames above 50 ms;
- maximum frame gap: 100.1 ms;
- average frame gap: 19.9 ms.

A before trace was not available because the repository did not contain an unauthenticated map fixture before this performance round. The prior code inspection confirmed a React zoom state update and marker labels attached only to `moveend`; the post-change trace is therefore the reproducible acceptance measurement, while an exact before/after long-task delta remains unverified.

## C. Tooling memory

Default commands now set `NODE_OPTIONS=--max-old-space-size=4096`; Vitest uses a bounded forks pool with one file at a time and at most two workers. ESLint ignores generated output, caches, screenshots, and public data.

Final verification:

- `npm run lint`: passes.
- `npm run typecheck`: passes.
- `npm test`: 30 files, 174 tests passed.
- `npm run build`: passes; initial JavaScript is 126,699 B gzip, below the 400 KiB budget.
