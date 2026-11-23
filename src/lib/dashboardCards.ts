import { supabase } from './supabase';
import { APP_SCHEMA_SELECT } from './schemaColumns';
import {
  defaultDashboardCardSettings,
  normalizeDashboardCardSettings,
  type DashboardCardSettings,
} from '../domain/dashboardCards';

export async function loadDashboardCardSettings(): Promise<DashboardCardSettings> {
  if (!supabase) return defaultDashboardCardSettings;
  const { data, error } = await supabase.from('app_config')
    .select(APP_SCHEMA_SELECT.appConfigValue)
    .eq('key', 'dashboard_cards')
    .maybeSingle();
  if (error) throw error;
  return data ? normalizeDashboardCardSettings(data.value) : defaultDashboardCardSettings;
}

export async function saveDashboardCardSettings(settings: DashboardCardSettings): Promise<void> {
  if (!supabase) throw new Error('يلزم إعداد Supabase.');
  const { error } = await supabase.from('app_config').upsert({
    key: 'dashboard_cards',
    value: settings,
  });
  if (error) throw error;
}
