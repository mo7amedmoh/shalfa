import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';

const roles = ['ADMIN', 'PROJECT_MANAGER', 'AREA_ENGINEER', 'REPORT_FOLLOWER', 'SUPERVISOR', 'VIEWER'] as const;
type TestRole = (typeof roles)[number];
const envFile = loadEnv('test', process.cwd(), '');
const env = (key: string) => process.env[key] ?? envFile[key];
const supabaseUrl = env('VITE_SUPABASE_URL') ?? env('SUPABASE_URL');
const anonKey = env('VITE_SUPABASE_PUBLISHABLE_KEY') ?? env('VITE_SUPABASE_ANON_KEY') ?? env('SUPABASE_ANON_KEY');

if (!supabaseUrl || !anonKey) {
  throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (or SUPABASE_URL and SUPABASE_ANON_KEY).');
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

const forbiddenWildcard = /\.from\(\s*['"](?:employees|gatekeepers)['"]\s*\)[^;]{0,500}?\.select\(\s*['"]\*/s;
const wildcardMatches = sourceFiles(resolve('src')).filter((file) => forbiddenWildcard.test(readFileSync(file, 'utf8')));
if (wildcardMatches.length) {
  throw new Error(`Wildcard selects are forbidden on employees/gatekeepers: ${wildcardMatches.join(', ')}`);
}

const credentials = roles.map((role) => ({
  role,
  email: env(`TEST_${role}_EMAIL`),
  password: env(`TEST_${role}_PASSWORD`),
}));
const missing = credentials.filter(({ email, password }) => !email || !password);
const configured = credentials.filter(({ email, password }) => email && password) as Array<{
  role: TestRole;
  email: string;
  password: string;
}>;
if (!configured.length) {
  console.error(`No role credentials found. Set: ${roles.flatMap((role) => [`TEST_${role}_EMAIL`, `TEST_${role}_PASSWORD`]).join(', ')}`);
  process.exitCode = 1;
} else {
  const failures: string[] = [];
  for (const { role, email, password } of configured) {
    const client = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: signedIn, error: signInError } = await client.auth.signInWithPassword({ email, password });
    if (signInError || !signedIn.user) {
      failures.push(`${role}: sign-in failed (${signInError?.message ?? 'no user returned'})`);
      continue;
    }

    const privileged = role === 'ADMIN' || role === 'PROJECT_MANAGER';
    const { data: profile, error: profileError } = await client.from('profiles')
      .select('id,username')
      .eq('id', signedIn.user.id)
      .single();
    if (profileError || !profile) {
      failures.push(`${role}: cannot read own profile (${profileError?.message ?? 'no profile returned'})`);
    } else {
      const probe = `probe${crypto.randomUUID().replaceAll('-', '').slice(0, 8)}`;
      const { data: changed, error: usernameError } = await client.from('profiles')
        .update({ username: probe })
        .eq('id', profile.id)
        .select('id')
        .maybeSingle();
      if (!usernameError) {
        if (changed) {
          const { error: restoreError } = await client.from('profiles').update({ username: profile.username }).eq('id', profile.id);
          if (restoreError) failures.push(`${role}: username changed and could not be restored (${restoreError.message})`);
        }
        failures.push(`${role}: profiles.username was not immutable`);
      }
    }

    for (const table of ['employees', 'gatekeepers'] as const) {
      const { error } = await client.from(table).select('residence_no').limit(1);
      if (!error) failures.push(`${role}: residence_no is selectable on ${table}`);
    }

    const restrictedReads = [
      ['employee_ratings', 'employee_id'],
      ['kpi_months', 'id'],
      ['kpi_entries', 'id'],
      ['kpi_indicators', 'code'],
      ['kpi_card_weights', 'card'],
      ['kpi_discount_matrix', 'bucket'],
      ['kpi_penalty_types', 'code'],
      ['kpi_penalty_entries', 'id'],
      ['kpi_card_scores', 'kpi_month_id'],
      ['kpi_month_totals', 'kpi_month_id'],
      ['checklist_items', 'id'],
      ['deliverables', 'id'],
    ] as const;
    for (const [table, column] of restrictedReads) {
      const { data, error } = await client.from(table).select(column).limit(1);
      if (privileged && error) failures.push(`${role}: cannot read ${table} (${error.message})`);
      if (!privileged && (error || (data?.length ?? 0) > 0)) {
        failures.push(`${role}: non-privileged role can read ${table}`);
      }
    }
    await client.auth.signOut();
    console.info(`${role}: checked residence protection, KPI/ratings access, and username immutability.`);
  }
  if (missing.length) {
    console.error(`Not tested; set missing credentials: ${missing.flatMap(({ role }) => [`TEST_${role}_EMAIL`, `TEST_${role}_PASSWORD`]).join(', ')}`);
    failures.push('Role coverage is incomplete.');
  }
  if (failures.length) {
    for (const failure of failures) console.error(`FAIL ${failure}`);
    process.exitCode = 1;
  } else {
    console.info(`RLS checks passed for ${configured.length} role(s).`);
  }
}
