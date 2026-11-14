import { createClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { APP_SCHEMA_COLUMNS, APP_SCHEMA_SELECT } from '../src/lib/schemaColumns';

const envFile = loadEnv('test', process.cwd(), '');
const env = (key: string) => process.env[key] ?? envFile[key];
const supabaseUrl = env('VITE_SUPABASE_URL') ?? env('SUPABASE_URL');
const publishableKey = env('VITE_SUPABASE_PUBLISHABLE_KEY') ?? env('SUPABASE_PUBLISHABLE_KEY');
const email = env('TEST_SCHEMA_EMAIL');
const password = env('TEST_SCHEMA_PASSWORD');

if (!supabaseUrl || !publishableKey || !email || !password) {
  throw new Error('Set VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, TEST_SCHEMA_EMAIL, and TEST_SCHEMA_PASSWORD.');
}

const client = createClient(supabaseUrl, publishableKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { data: session, error: signInError } = await client.auth.signInWithPassword({ email, password });
if (signInError || !session.user) {
  throw new Error(`Schema verification login failed: ${signInError?.message ?? 'no user returned'}`);
}

const failures: string[] = [];
for (const [table, columns] of Object.entries(APP_SCHEMA_COLUMNS)) {
  const { error } = await client.from(table).select(columns.join(',')).limit(1);
  if (error) failures.push(`${table} (${columns.join(', ')}): [${error.code ?? 'unknown'}] ${error.message}`);
  else console.info(`OK ${table} (${columns.length} columns)`);
}

const appQueries: ReadonlyArray<{ label: string; table: string; select: string }> = [
  { label: 'dashboard monthly plans', table: 'monthly_plans', select: APP_SCHEMA_SELECT.monthlyPlanDashboard },
  { label: 'dashboard schools', table: 'schools', select: APP_SCHEMA_SELECT.schoolsDashboard },
  { label: 'dashboard school sync time', table: 'schools', select: APP_SCHEMA_SELECT.schoolsSyncTime },
  { label: 'dashboard cleaner assignments', table: 'cleaner_assignments', select: APP_SCHEMA_SELECT.cleanerAssignmentSchool },
  { label: 'dashboard school size corrections', table: 'school_size_corrections', select: APP_SCHEMA_SELECT.schoolSizeCorrection },
  { label: 'dashboard staffing exceptions', table: 'staffing_exceptions', select: APP_SCHEMA_SELECT.staffingException },
  { label: 'dashboard eligibility config', table: 'app_config', select: APP_SCHEMA_SELECT.appConfigValue },
  { label: 'dashboard gatekeepers', table: 'gatekeepers', select: APP_SCHEMA_SELECT.gatekeeperDashboard },
  { label: 'dashboard deliverables', table: 'deliverables', select: APP_SCHEMA_SELECT.deliverablesSummary },
  { label: 'dashboard app settings', table: 'app_settings', select: APP_SCHEMA_SELECT.appSettingsDeliverables },
  { label: 'dashboard KPI month', table: 'kpi_months', select: APP_SCHEMA_SELECT.kpiMonth },
  { label: 'dashboard KPI totals', table: 'kpi_month_totals', select: APP_SCHEMA_SELECT.kpiDashboardTotals },
  { label: 'dashboard activity', table: 'audit_log', select: APP_SCHEMA_SELECT.auditLog },
  { label: 'monthly report plan headers', table: 'monthly_plans', select: APP_SCHEMA_SELECT.monthlyReportPlanHeaders },
  { label: 'monthly report rows', table: 'monthly_plan_rows', select: APP_SCHEMA_SELECT.monthlyReportPlanRows },
  { label: 'monthly report employees', table: 'employees', select: APP_SCHEMA_SELECT.reportEmployees },
  { label: 'monthly report cleaner assignments', table: 'cleaner_assignments', select: APP_SCHEMA_SELECT.cleanerAssignmentSchool },
  { label: 'monthly report profile preferences', table: 'profiles', select: APP_SCHEMA_SELECT.profilePrefs },
  { label: 'monthly plan generator schools', table: 'schools', select: APP_SCHEMA_SELECT.schoolsPlanGenerator },
  { label: 'report generator school search', table: 'schools', select: APP_SCHEMA_SELECT.reportSchoolSearch },
  { label: 'monthly plan list', table: 'monthly_plans', select: APP_SCHEMA_SELECT.monthlyPlanList },
  { label: 'monthly plan rows', table: 'monthly_plan_rows', select: APP_SCHEMA_SELECT.monthlyPlanRows },
  { label: 'monthly plan row mutation result', table: 'monthly_plan_rows', select: APP_SCHEMA_SELECT.id },
  { label: 'general plan schools', table: 'schools', select: APP_SCHEMA_SELECT.schoolsBasic },
  { label: 'general plan IDs', table: 'general_plans', select: APP_SCHEMA_SELECT.generalPlanId },
  { label: 'general plan delete IDs', table: 'general_plans', select: APP_SCHEMA_SELECT.generalPlanId },
  { label: 'general plan rows', table: 'general_plan_rows', select: APP_SCHEMA_SELECT.generalPlanRows },
  { label: 'general plan row mutation result', table: 'general_plan_rows', select: APP_SCHEMA_SELECT.id },
  { label: 'supervisor plan employees', table: 'employees', select: APP_SCHEMA_SELECT.employeesForImport },
  { label: 'supervisor aliases', table: 'supervisor_aliases', select: APP_SCHEMA_SELECT.supervisorAliases },
  { label: 'custom plan type', table: 'custom_plan_types', select: 'id,name,cadence,scope,track_visit_report,group_key,created_at,is_active' },
  { label: 'active custom plan types', table: 'custom_plan_types', select: 'id,name,is_active' },
  { label: 'custom plan schools', table: 'schools', select: 'id,name,ministry_no,ministry_key,extra,plan_scope,neighbourhood,latitude:lat,longitude:lng' },
  { label: 'custom plan eligibility config', table: 'app_config', select: APP_SCHEMA_SELECT.appConfigValue },
  { label: 'custom plan periods', table: 'custom_plans', select: 'id,period' },
  { label: 'custom plan rows', table: 'custom_plan_rows', select: 'id,school_id,planned_date,execution_date,status,supervisor_name,engineer_name,visited,visited_date,report_done,report_done_date,notes,school:schools(name,ministry_no,ministry_key)' },
  { label: 'custom plan mutation result', table: 'custom_plans', select: APP_SCHEMA_SELECT.id },
  { label: 'custom plan bulk update preflight', table: 'custom_plan_rows', select: 'id,visited,visited_date,report_done,report_done_date' },
  { label: 'monthly plan bulk update preflight', table: 'monthly_plan_rows', select: 'id,visited,visited_date,report_done,report_done_date' },
  { label: 'custom plan bulk update verification', table: 'custom_plan_rows', select: 'id,visited_date,report_done_date' },
  { label: 'monthly plan bulk update verification', table: 'monthly_plan_rows', select: 'id,visited_date,report_done_date' },
  { label: 'custom plan row preflight', table: 'custom_plan_rows', select: 'id,plan_id,school_id,planned_date,supervisor_name,engineer_name,status' },
  { label: 'cleaner placement schools', table: 'schools', select: APP_SCHEMA_SELECT.schoolsWithSize },
  { label: 'cleaner placement employees', table: 'employees', select: APP_SCHEMA_SELECT.employeesBasic },
  { label: 'cleaner placement assignments', table: 'cleaner_assignments', select: APP_SCHEMA_SELECT.cleanerAssignments },
  { label: 'cleaner placement size corrections', table: 'school_size_corrections', select: APP_SCHEMA_SELECT.schoolSizeCorrection },
  { label: 'cleaner placement staffing exceptions', table: 'staffing_exceptions', select: APP_SCHEMA_SELECT.staffingException },
  { label: 'gatekeeper placement schools', table: 'schools', select: APP_SCHEMA_SELECT.schoolsGatekeeperPlacement },
  { label: 'gatekeeper placement employees', table: 'employees', select: APP_SCHEMA_SELECT.employeesForGatekeepers },
  { label: 'gatekeeper placement rows', table: 'gatekeepers', select: APP_SCHEMA_SELECT.gatekeeperPlacement },
];

for (const query of appQueries) {
  const { error } = await client.from(query.table).select(query.select).limit(1);
  if (error) failures.push(`${query.label} (${query.table}): [${error.code ?? 'unknown'}] ${error.message}`);
  else console.info(`OK query ${query.label}`);
}

const { error: signOutError } = await client.auth.signOut();
if (signOutError) failures.push(`sign out: [${signOutError.code ?? 'unknown'}] ${signOutError.message}`);

if (failures.length) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exitCode = 1;
} else {
  console.info(`Schema verification passed for ${Object.keys(APP_SCHEMA_COLUMNS).length} tables and ${appQueries.length} application queries.`);
}
