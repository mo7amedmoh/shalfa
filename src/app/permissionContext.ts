import { createContext, useContext, useMemo } from 'react';
import type { PermissionKey } from '../domain/permissions';

export const PermissionContext = createContext<ReadonlySet<PermissionKey>>(new Set());

export function usePermission(key: PermissionKey): boolean {
  return useContext(PermissionContext).has(key);
}

export function usePermissions<const Keys extends readonly PermissionKey[]>(keys: Keys): ReadonlySet<Keys[number]> {
  const granted = useContext(PermissionContext);
  return useMemo(() => new Set(keys.filter((key) => granted.has(key))), [granted, keys]);
}
