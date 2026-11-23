import { useMemo, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { parsePermissionKeys, type PermissionKey } from '../domain/permissions';
import { PermissionContext, usePermission } from './permissionContext';

export function PermissionProvider({
  permissions,
  children,
}: {
  permissions: readonly string[];
  children: ReactNode;
}) {
  const granted = useMemo(() => new Set(parsePermissionKeys(permissions)), [permissions]);
  return <PermissionContext.Provider value={granted}>{children}</PermissionContext.Provider>;
}

export function Can({
  permission,
  children,
}: {
  permission: PermissionKey;
  children: ReactNode;
}) {
  return usePermission(permission) ? children : null;
}

export function RequirePermission({
  permission,
  children,
}: {
  permission: PermissionKey;
  children: ReactNode;
}) {
  const allowed = usePermission(permission);
  const location = useLocation();
  if (allowed) return children;
  return location.pathname === '/'
    ? <p role="alert" className="card p-5 text-sm text-rose-800">لا تملك صلاحية عرض هذه الصفحة.</p>
    : <Navigate to="/" replace />;
}
