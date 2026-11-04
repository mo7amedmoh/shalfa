import { createClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { APP_SCHEMA_COLUMNS } from '../src/lib/schemaColumns';

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
  if (error) failures.push(`${table} (${columns.join(', ')}): ${error.message}`);
  else console.info(`OK ${table} (${columns.length} columns)`);
}

const { error: signOutError } = await client.auth.signOut();
if (signOutError) failures.push(`sign out: ${signOutError.message}`);

if (failures.length) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exitCode = 1;
} else {
  console.info(`Schema verification passed for ${Object.keys(APP_SCHEMA_COLUMNS).length} tables.`);
}
