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
  const { data: actor, error: actorError } = await admin.from('profiles')
    .select('role_id, role:roles(base_role)')
    .eq('id', userResult.user.id)
    .maybeSingle();
  if (actorError) {
    console.error('Unable to verify create-user requester role.', actorError);
    return response(500, { error: 'تعذر التحقق من صلاحيات المستخدم.' });
  }
  const { data: canCreate, error: permissionError } = await requester.rpc('has_permission', { p_key: 'users.create' });
  if (permissionError) return response(500, { error: 'تعذر التحقق من صلاحية إنشاء المستخدمين.' });
  if (canCreate !== true) return response(403, { error: 'لا تملك صلاحية إنشاء المستخدمين.' });

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return response(400, { error: 'بيانات الطلب غير صالحة.' });
  }
  const validated = validateCreateUserInput(input);
  if (!validated.success) return response(400, { error: validated.error });
  const { email, username, displayName, roleId, password } = validated.data;
  const { data: role, error: roleError } = await admin.from('roles')
    .select('id,base_role')
    .eq('id', roleId)
    .maybeSingle();
  if (roleError) return response(500, { error: 'تعذر التحقق من الدور.' });
  if (!role) return response(400, { error: 'الدور المحدد غير موجود.' });

  const actorIsAdmin = Array.isArray(actor?.role) ? actor.role[0]?.base_role === 'admin' : (actor as unknown as { role?: { base_role?: string } })?.role?.base_role === 'admin';
  if (role.base_role === 'admin' && !actorIsAdmin) {
    return response(403, { error: 'لا يجوز إسناد دور يتجاوز صلاحيات المنشئ.' });
  }

  if (role.base_role !== 'admin') {
    const { data: rolePermissions, error: rolePermissionsError } = await admin.from('role_permissions')
      .select('permission_key')
      .eq('role_id', roleId);
    if (rolePermissionsError) return response(500, { error: 'تعذر التحقق من صلاحيات الدور.' });
    for (const row of rolePermissions ?? []) {
      const { data: allowed, error: allowedError } = await requester.rpc('has_permission', { p_key: row.permission_key });
      if (allowedError) return response(500, { error: 'تعذر التحقق من صلاحيات المنشئ.' });
      if (allowed !== true) return response(403, { error: `الدور يتجاوز صلاحيات المنشئ: ${row.permission_key}` });
    }
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username, full_name: displayName },
  });
  if (createError || !created.user) {
    console.error('Unable to create Auth user.', createError);
    return response(400, { error: 'تعذر إنشاء الحساب؛ تحقق من عدم تكرار اسم المستخدم.' });
  }

  const { error: profileError } = await admin.from('profiles').update({
    role_id: roleId,
  }).eq('id', created.user.id);
  if (profileError) {
    console.error('Unable to assign role to automatically created profile.', profileError);
    const { error: rollbackError } = await admin.auth.admin.deleteUser(created.user.id);
    if (rollbackError) console.error('Unable to roll back unprofiled auth user.', rollbackError);
    return response(500, { error: rollbackError ? 'تعذر تحديث الملف الشخصي أو إلغاء حساب الدخول؛ يلزم فحص حساب Auth يدوياً.' : 'تعذر حفظ الملف الشخصي؛ أُلغيت محاولة إنشاء الحساب.' });
  }

  return response(201, { username: username.toLowerCase() });
});
