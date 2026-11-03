import { createContext } from 'react';
import { defaultPreferences, type UserPreferences } from '../lib/preferences';

export const preferencesContext = createContext<UserPreferences>(defaultPreferences);
