const roles = ['admin', 'project_manager', 'area_engineer', 'report_follower', 'supervisor', 'viewer'] as const;

export type CreateUserInput = {
  username: string;
  displayName: string;
  role: typeof roles[number];
  password: string;
};

export type ValidationResult =
  | { success: true; data: CreateUserInput }
  | { success: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateCreateUserInput(input: unknown): ValidationResult {
  if (!isRecord(input)) return { success: false, error: 'بيانات المستخدم غير صالحة.' };
  const username = typeof input.username === 'string' ? input.username.trim().toLowerCase() : '';
  const displayName = typeof input.display_name === 'string' ? input.display_name.trim() : '';
  const role = typeof input.role === 'string' ? input.role : '';
  const password = typeof input.password === 'string' ? input.password : '';

  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) {
    return { success: false, error: 'اسم المستخدم يجب أن يتكون من 3 إلى 40 حرفاً إنجليزياً أو رقماً.' };
  }
  if (displayName.length < 2 || displayName.length > 120) {
    return { success: false, error: 'أدخل اسماً من خانتين إلى 120 خانة.' };
  }
  const validRole = roles.find((candidate) => candidate === role);
  if (!validRole) {
    return { success: false, error: 'الدور المحدد غير صالح.' };
  }
  if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return { success: false, error: 'كلمة المرور يجب أن تضم 12 خانة على الأقل وحروفاً كبيرة وصغيرة ورقماً ورمزاً.' };
  }

  return {
    success: true,
    data: { username, displayName, role: validRole, password },
  };
}
