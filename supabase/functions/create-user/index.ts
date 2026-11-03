import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { validateCreateUserInput } from '../../../src/domain/userCreation.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function response(status: number, body: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return response(405, { error: 'الطريقة غير مدعومة.' });

  const authorization = request.headers.get('Authorization');
  if (!authorization) return response(401, { error: 'يلزم تسجيل الدخول.' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error('Create-user function environment is incomplete.');
    return response(500, { error: 'إعداد وظيفة إنشاء المستخدمين غير مكتمل.' });
  }

  const requester = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: userResult, error: authError } = await requester.auth.getUser();
  if (authError || !userResult.user) return response(401, { error: 'جلسة المستخدم غير صالحة.' });

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: actor, error: actorError } = await admin.from('user_profiles')
    .select('role')
    .eq('id', userResult.user.id)
    .maybeSingle();
  if (actorError) {
    console.error('Unable to verify create-user requester role.', actorError);
    return response(500, { error: 'تعذر التحقق من صلاحيات المستخدم.' });
  }
  if (actor?.role !== 'admin') return response(403, { error: 'إنشاء المستخدمين متاح لمدير النظام فقط.' });

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return response(400, { error: 'بيانات الطلب غير صالحة.' });
  }
  const validated = validateCreateUserInput(input);
  if (!validated.success) return response(400, { error: validated.error });
  const { username, displayName, role, password } = validated.data;

  const email = `${username.toLowerCase()}@shalfa.local`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username: username.toLowerCase() },
  });
  if (createError || !created.user) {
    console.error('Unable to create Auth user.', createError);
    return response(400, { error: 'تعذر إنشاء الحساب؛ تحقق من عدم تكرار اسم المستخدم.' });
  }

  const { error: profileError } = await admin.from('user_profiles').insert({
    id: created.user.id,
    username: username.toLowerCase(),
    role,
    display_name: displayName,
  });
  if (profileError) {
    console.error('Unable to create user profile.', profileError);
    const { error: rollbackError } = await admin.auth.admin.deleteUser(created.user.id);
    if (rollbackError) console.error('Unable to roll back unprofiled auth user.', rollbackError);
    return response(500, { error: rollbackError ? 'تعذر إنشاء الملف الشخصي أو إلغاء حساب الدخول؛ يلزم فحص حساب Auth يدوياً.' : 'تعذر حفظ ملف المستخدم؛ أُلغيت محاولة إنشاء الحساب.' });
  }

  const { error: auditError } = await admin.from('audit_log').insert({
    actor_id: userResult.user.id,
    action: 'create_auth_user',
    entity: 'user_profiles',
    entity_id: created.user.id,
    details: { username: username.toLowerCase(), role },
  });
  if (auditError) {
    console.error('Unable to audit newly created account.', auditError);
    const { error: profileRollbackError } = await admin.from('user_profiles').delete().eq('id', created.user.id);
    const { error: authRollbackError } = await admin.auth.admin.deleteUser(created.user.id);
    if (profileRollbackError || authRollbackError) console.error('Unable to roll back account after audit failure.', { profileRollbackError, authRollbackError });
    return response(500, { error: 'تعذر تسجيل العملية؛ أُلغيت محاولة الإنشاء أو يلزم فحص سجل المستخدم.' });
  }

  return response(201, { username: username.toLowerCase() });
});
