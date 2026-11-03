# Agent.md — منصة إدارة مشروع إدارة المرافق المدرسية | شركة شلفا لإدارة المرافق

> This file is the permanent rulebook for any AI agent (GitHub Copilot, etc.) working in this repo.
> Read it fully before every task. If a request conflicts with this file, stop and ask.

---

## 1. Mission

Make it easy to run the school facilities-management project (Riyadh schools, contract TBC-FM-909) by managing the workforce and collecting the periodic data the contract requires: monthly plans, school database + map, workforce placement, technician rewards, and monthly KPI scorecards.

Reports/incidents (البلاغات) are handled by a separate platform and are **only linked** from this app. Do not rebuild it.

## 2. Non-negotiables

| # | Rule |
|---|------|
| 1 | **All UI text is Arabic**, `dir="rtl"`, `lang="ar"`. No English strings visible to users (code, comments, commit messages may be English). |
| 2 | **Font: Cairo** (fallback Tajawal), self-hosted via `@fontsource` — never a third-party CDN at runtime. |
| 3 | **Free only.** No paid service, no credit card. Do not suggest Render, Heroku, paid Firebase tiers, paid map APIs, etc. |
| 4 | **Avoid a custom backend.** Prefer BaaS with RLS. If something truly cannot be done client-side, use a free serverless function (Supabase Edge Function) and say why. |
| 5 | **No unused code, no unused dependencies, no dead files.** Every dependency must be justified in `docs/DECISIONS.md`. Run `npm audit` and fix highs. |
| 6 | **Do not change the app's core idea or menus' logic.** You may add helpful menus/pages that serve the idea. |
| 7 | **Feature ideas go to `docs/SUGGESTIONS.md` only.** Never implement a suggestion without the owner's explicit approval. |
| 8 | **Security first** (section 9). |
| 9 | Username is **immutable** after account creation. |
| 10 | The employee **rating (التقييم)** column is visible to the **Project Manager only** — enforced in the database, not just hidden in the UI. |

## 3. Identity & design system

- Accent: `#21366a`. Generate a full scale (50–950) from this hue and expose as Tailwind tokens `brand-50 … brand-950`. Use tints/shades for hover, borders, charts. Semantic colors (success/warn/danger) are separate.
- Logo: `https://shalfa.sa/images/ShalfaLogoNewBlueLight.png` — download once into `public/brand/` at build/setup time and serve locally.
- Look: refined, calm, enterprise. Rounded-xl cards, soft shadows, generous spacing, 8-pt grid, subtle motion (150–200 ms). Light theme first; dark theme optional only if it costs little.
- Icons: `lucide-react`. Charts: `recharts` (interactive tooltips, RTL-aware axes).
- Numerals: support Latin (0-9) and Arabic-Indic (٠-٩) via a user setting, default Latin. Dates: Gregorian display with optional Hijri toggle (only if cheap — otherwise log in SUGGESTIONS.md).
- Fully responsive (mobile first: engineers and supervisors use phones). Tables become cards on small screens.
- Accessibility: visible focus, contrast ≥ 4.5:1, keyboard navigation, proper `aria-*` in Arabic.
- Every list page has: search, filters, sort, pagination, empty state, loading skeleton, error state.
- Logical CSS properties only (`ms-*`, `me-*`, `ps-*`, `pe-*`, `text-start`) — never `ml-*`/`left-*` for layout, so alignment stays correct in RTL.

## 4. Tech stack (decided, deviate only with a written reason)

- **Frontend:** Vite + React 18 + TypeScript (strict) + Tailwind CSS + React Router + TanStack Query + Zod + React Hook Form.
- **Backend/DB:** Supabase free tier (Postgres + Auth + Row Level Security + Storage). No credit card needed.
  - Login by **username**: map to a synthetic email `username@shalfa.local` internally; the user never sees it. Optional real email can be linked later in "حسابي".
- **Maps:** Leaflet + OpenStreetMap tiles (free, no key).
- **School data source:** Google Sheet  
  `https://docs.google.com/spreadsheets/d/1RQo06DqRHv24M8bh1CmJbOl4c_GmoLPXKkHK_sVIoI8`  
  Read through the Google Visualization CSV endpoint (`/gviz/tq?tqx=out:csv&sheet=<name>`). Parse with `papaparse`. Upsert into Postgres (`schools`) keyed by the ministry number (الرقم الوزاري). Auto-sync on app start (throttled to once per N minutes) + manual "مزامنة الآن" button for admins. Store `last_synced_at` and show it.
- **PDF export:** must render Arabic correctly (shaping + RTL). Preferred: a dedicated print stylesheet + `window.print()` for the report page; if a library is needed use `pdfmake` with embedded Cairo. Verify Arabic output visually before calling it done.
- **Excel import/export:** `xlsx` (SheetJS) only where needed (KPI/checklist seed import, exports).
- **Deploy:** static hosting on a free host (Cloudflare Pages / Netlify / GitHub Pages). Document in `README.md`.
- **Tests:** Vitest for pure logic (KPI engine, staffing rules, penalty calc). Playwright smoke test for login + one flow per role (optional but encouraged).

## 5. Roles & permissions

| Role (الدور) | Scope |
|---|---|
| `admin` مدير النظام | everything incl. users, sync, settings |
| `project_manager` مدير المشروع | everything functional; sees ratings; sets reward pool; approves KPI month |
| `area_engineer` مهندس المنطقة | creates/owns monthly plans; sees only **his** technicians/supervisors; distributes rewards |
| `report_follower` متابع التقارير | marks visited schools & completed reports in plans |
| `supervisor` مشرف | read own scope; limited updates |
| `viewer` مشاهد | read only |

Enforce with **Postgres RLS policies** (not only UI guards). Ratings live in a separate table `employee_ratings` with a policy allowing only `project_manager`/`admin`. Never ship the rating in a query result for other roles.

## 6. Navigation (sidebar, in this order)

1. لوحة التحكم — dashboard + card/link to **منصة رِفاد** (external, opens new tab, `rel="noopener noreferrer"`).
2. الخطط الشهرية — sub-menu: خطة الصيانة · خطة النظافة · خطة الأمن والسلامة · خطة المصاعد · **التقرير العام**.
3. الخطط العامة — البستنة · التنسيق · نزح مخلفات الصرف الصحي · غسيل الخزانات · مكافحة الآفات ورش المبيدات · خطط الاستعداد السنوية.
4. المباني المدرسية — table + interactive map.
5. القوى العاملة.
6. أعمال إدارية — تسكين العمالة · تسكين البوابين · مكافأة الفنيين.
7. مؤشرات الأداء — بطاقات الأداء الشهرية · قائمة الفحص (CM/OM) · المخرجات التعاقدية (28).
8. حسابي.

Admin-only extras (allowed without approval): المستخدمون والصلاحيات · المزامنة والإعدادات · سجل التدقيق.

## 7. Module specifications

### 7.1 Monthly plans (الخطط الشهرية)
Four plan types: `maintenance`, `cleaning`, `security_safety`, `elevators`.

- A plan = one month + one type. A plan row = a school + planned date.
- Eligible schools: **independent buildings + primary shared** (المباني المستقلة + المشترك الأساسي). For **elevators**: only schools with an elevator contractor.
- Created by the area engineer; followed by him and the report follower. For each row they mark: **visited** (تمت الزيارة + actual date) and **report completed** (تم إنجاز التقرير + date).
- Bulk-generate a plan from eligible schools with a date-distribution helper (e.g. N schools/day, skip Fri/Sat); every date editable.
- Overdue = planned date passed and (not visited or report not done).

### 7.2 Monthly general report (التقرير العام) — 5th page
Covers the four plan types. Must show:
- Visit % and report-completion % (overall and per plan type), with interactive charts.
- **Supervisor performance** — for maintenance and cleaning only.
- **Cumulative table/chart of daily achievement** (planned vs actual, cumulative line).
- **Overdue tracker per supervisor** — ranking of who is most late and who is most compliant.
- Month/year selector, area/engineer filter.
- **Export to PDF** (Arabic, RTL, logo header, date, print-ready).

### 7.3 General plans (الخطط العامة)
Generic plan engine reusable for gardening, landscaping, sewage-waste removal, tank washing, pest control and annual readiness plans: schools × planned date × status × execution date × notes, plus a completion dashboard. Reuse components from 7.1.

### 7.4 School buildings (المباني المدرسية)
- Read-only mirror of the Google Sheet (see §4). Auto-sync + manual sync + `last_synced_at`.
- Table with search/filters (neighbourhood, size, type, region), column chooser, CSV export.
- **Interactive map** (Leaflet): one marker per school using the sheet's coordinates (validate lat/lng; list schools with missing/invalid coordinates). Marker clustering. Clicking a marker opens a panel with **all** school fields from the database. Same panel from the table row.
- Never edit source data locally except through documented override fields (e.g. corrected size) stored separately.

### 7.5 Workforce (القوى العاملة)
Table of employees: engineers, supervisors, administrators, technicians, drivers, cleaners.  
Required fields: اسم · رقم الإقامة · الرقم الوظيفي · الوظيفة · القسم · **التقييم (PM only)**.  
Also: nationality/ID type, phone, hire date, status, `manager_id` (the engineer/supervisor he reports to — drives §7.8 visibility).  
CRUD, Excel import, search, filters. Residence numbers are sensitive: mask in lists for non-privileged roles, audit-log reveals.

### 7.6 Cleaner placement (تسكين العمالة)
Table: school (independent + primary shared) · ministry number · neighbourhood · school size · class count · assigned cleaners (name · residence number · labour source/مصدر العمالة).

**Business rules (single source of truth in `src/domain/staffing.ts`, unit-tested):**
- Small: 1–12 classes → 1 cleaner
- Medium: 13–21 classes → 2 cleaners
- Large: 22+ classes (more than 21) → 3 cleaners
- If the database's size label disagrees with the class count, **the app corrects the size from the class count** and flags the row ("تم تصحيح الحجم").
- Occasional per-school exceptions are allowed (override required headcount with a reason, kept in an `exceptions` field); the contract standard itself is not editable from the UI.
- Summary panel: required vs assigned totals, **shortage (عجز)** and surplus per school and in total, by size and by neighbourhood; export to Excel.

### 7.7 Gatekeeper placement (تسكين البوابين)
Table: school (independent + primary shared) · ministry number · neighbourhood · gatekeeper name · phone · residence number. Highlight schools without a gatekeeper.

### 7.8 Technician rewards (مكافأة الفنيين)
- When an engineer logs in he sees **only his technicians** (and supervisors, if applicable) and the **total reward amount available** for distribution.
- PM/admin sets the monthly pool per engineer. Engineer distributes amounts; the UI blocks over-allocation (sum ≤ pool), shows remaining balance live, and requires a note for zero/min amounts if configured.
- Month lock after PM approval; full history and audit trail.

### 7.9 Performance indicators (مؤشرات الأداء)
See section 8 — this is the most business-critical module.

### 7.10 My account (حسابي)
View profile; change password; link email; edit personal & contact info. **Username is read-only.**

### 7.11 Settings (admin + per-user preferences)
Per-user: default numerals (Latin/Arabic-Indic), date format, rows per page. Admin: sync interval, plan eligibility rules, reward pool defaults.

## 8. KPI engine (from the official workbook "Service Provider IFM KPI update – OCT" and checklist workbook "Checklist CM/OM — TBC-FM-909")

Seed data must be imported from the two attached `.xlsx` files via a one-off script (`scripts/seed-kpi.ts`) so indicator text, references and targets are not retyped. Keep the originals in `docs/reference/`.

### 8.1 Scorecards (monthly, per work order / region)
Header fields: month, region (المنطقة الوسطى), contractor (شركة شلفا لإدارة المرافق), work order (`TBC005754 & TBC006484`), project number.

| Card | Code | Weight | Indicators |
|---|---|---|---|
| إدارة العقد | CM | 0.10 | CM.1–CM.7 |
| العمليات التشغيلية | OM | 0.15 | OM.1–OM.5 |
| الخدمات الثقيلة | HS | 0.30 | HS.1–HS.10 |
| الخدمات الخفيفة | SS | 0.45 | SS.1–SS.9 |

Per indicator store: applicable flag (ينطبق/لا ينطبق), importance, frequency (monthly / quarterly / annual), numerator, denominator, achieved %, score, source, required evidence, attachments.

- Card score = average of applicable indicator scores (the October workbook behaves this way; **verify against the workbook formulas before finalizing**), capped at 100%. Card contribution = card score × weight. Total = sum of contributions.
- Rating bands: **≥ 95% ممتاز**, **85–94.99% متوسط**, **≤ 84.99% ضعيف**.
- Observed formulas to reproduce (verify, then unit-test against October values — expected total ≈ 92.86%):
  - Ratio indicators: `score = min(1, numerator / denominator)`.
  - HS.3–HS.9 (reports vs preventive tasks per system): `ratio = reports / preventive_tasks; score = ratio ≤ 0.20 ? 1 : 1 − ratio`.
  - HS.2: `score = 1 − overdue_tasks / total_tasks`.
  - OM.1: `score = 1 − 0.05 × NCR_count` (floor 0).
  - Not-applicable indicators are excluded from the average.
- A **formula registry** (`src/domain/kpi/formulas.ts`) holds one pure, tested function per indicator ID so the logic is reviewable and editable in one place.

### 8.2 Discount matrix (مصفوفة الخصومات)
Contract started **1 July** with a 3-month grace period; KPI accountability starts in **October** (contract month 4). Compute contract month from the contract start date setting.

| Contract month | 95–100 | 90–94.99 | 85–89.99 | 80–84.99 | 75–79.99 | 70–74.99 | < 70 |
|---|---|---|---|---|---|---|---|
| 1 | 100% | 100% | 100% | 100% | 100% | 100% | 100% |
| 2 | 100% | 100% | 100% | 100% | 100% | 97.5% | 97.5% |
| 3 | 100% | 100% | 100% | 95% | 95% | 95% | 95% |
| 4–6 | 100% | 100% | 98% | 95% | 94% | 92% | 90% |
| 7 → end | 100% | 99% | 96% | 94% | 90% | 85% | 80% |

Show the payable % for the month and the monetary impact if the monthly invoice value is entered.

### 8.3 Direct penalties (الغرامات المباشرة)
12 penalty items (CM ×4, OM ×3, SS ×5) each linked to a KPI card, with count × unit amount (e.g. 200 SAR per case above 3 after month 8; 500; 1,000; 10,000 etc. — import exact amounts and conditions from the workbook sheet "اجمالي الغرامات المباشرة"). Provide an entry form per penalty, auto total, and inclusion in the monthly summary.

### 8.4 Checklist (قائمة الفحص CM/OM) and deliverables (المخرجات 28)
- Checklist: 81 CM items + 108 OM items grouped by axis (CM.1…CM.8, general obligations, OM.1…OM.7, SOP, CAFM, supply chain). Columns: item, reference, evidence/document, frequency, owner (مسؤول), status (`مكتمل / جارٍ / لم يبدأ / لا ينطبق`), last update, notes.
- Completion % = completed ÷ (total − not applicable). Weight per indicator = category weight ÷ number of its indicators (CM 10÷8, OM 15÷7).
- Items whose reference is "توصية" are recommendations, not contract text — show a distinct badge.
- Deliverables: 28 items from contract Table 1 with due date, status (`لم يُسلَّم / مُسلَّم بانتظار الاعتماد / معتمد`), delivery date, approval date, and **auto "متأخر"** when past due. Due dates derive from signing/site-handover date + duration.
- Link evidence: each KPI/checklist row can hold file attachments (Supabase Storage, private bucket, signed URLs).

### 8.5 Outputs
Monthly KPI summary page: four card gauges, total score, rating band, discount %, penalties, trend over months, top failing indicators. Export PDF (Arabic) and Excel mirroring the official workbook layout.

## 9. Security checklist (must pass before any release)

- RLS enabled on **every** table; default deny; policies written and tested per role.
- No secrets in the repo. Only the Supabase `anon` key in the client; `service_role` never in client or git. `.env.example` provided.
- Validate all input with Zod on the client **and** with DB constraints/checks.
- No `dangerouslySetInnerHTML`; escape any imported sheet text.
- CSP and security headers in the host config (`default-src 'self'`; allow only Supabase, OSM tiles, the logo origin if not self-hosted).
- Rate-limit-friendly auth (Supabase defaults), strong password rules, session timeout.
- File uploads: type/size allow-list, private bucket, signed URLs.
- Sensitive data (residence numbers, ratings) minimal exposure + audit log for reveal/export.
- `npm audit` clean of high/critical; pin versions; no abandoned packages.
- External links: `rel="noopener noreferrer"`.

## 10. Project structure

```
/
├─ Agent.md
├─ README.md
├─ docs/
│  ├─ DECISIONS.md        # every dependency & architectural choice, with reason
│  ├─ SUGGESTIONS.md      # feature ideas awaiting owner approval (NOT implemented)
│  ├─ DATA_MODEL.md
│  └─ reference/          # original xlsx files
├─ supabase/
│  ├─ migrations/         # SQL schema + RLS policies
│  └─ seed/
├─ scripts/               # seed-kpi.ts, sync helpers
├─ public/brand/
└─ src/
   ├─ app/                # router, providers, layout (RTL shell)
   ├─ components/ui/      # design-system primitives
   ├─ domain/             # pure business logic: staffing.ts, kpi/, plans.ts, penalties.ts (unit-tested)
   ├─ features/           # dashboard, plans, general-plans, schools, workforce, placement, gatekeepers, rewards, kpi, account, admin
   ├─ lib/                # supabase client, sheets sync, pdf, excel, format (numerals/dates)
   └─ styles/
```

## 11. Working agreement for the agent

1. **Plan first** for any task bigger than a small fix: write a short plan, list files to touch, then implement.
2. **Small, reviewable commits**; Conventional Commits.
3. After each module: run `npm run lint && npm run typecheck && npm test && npm run build`. Fix everything before moving on.
4. **Verify in a browser** (RTL alignment, Arabic PDF output, map popups, mobile width). Never claim "done" without running it.
5. Business rules live in `src/domain` as pure functions with unit tests — never inline in components.
6. Don't invent data. If a required value is missing (e.g. a column name in the sheet), ask or surface it as a configurable mapping.
7. When blocked or when the spec is ambiguous, write the question in `docs/QUESTIONS.md` and continue with other work.
8. End each task with a short report: what changed, how it was verified, open items, suggestions logged.

## 12. Definition of done (per module)

- Matches the spec in §7/§8, Arabic RTL, responsive, accessible.
- RLS policies exist and were tested with each role.
- Domain logic unit-tested; build, lint, typecheck green.
- No unused code or dependencies; docs updated.
- Verified manually in the browser, including empty/error/loading states.
