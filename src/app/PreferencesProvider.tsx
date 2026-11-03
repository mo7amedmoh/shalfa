import type { ReactNode } from 'react';
import type { UserPreferences } from '../lib/preferences';
import { preferencesContext } from './preferencesContext';

export function PreferencesProvider({ value, children }: { value: UserPreferences; children: ReactNode }) {
  return <preferencesContext.Provider value={value}>{children}</preferencesContext.Provider>;
}
