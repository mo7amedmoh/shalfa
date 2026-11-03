import { useContext } from 'react';
import { formatDate, formatNumerals } from '../lib/format';
import { preferencesContext } from './preferencesContext';

export function useDisplayFormat() {
  const preferences = useContext(preferencesContext);
  return {
    formatNumber: (value: string | number) => formatNumerals(value, preferences.numerals),
    formatDate: (value: string) => formatNumerals(formatDate(value, preferences.date_format), preferences.numerals),
    formatDateTime: (value: string) => formatNumerals(new Date(value).toLocaleString('en-GB'), preferences.numerals),
    rowsPerPage: preferences.rows_per_page,
  };
}
