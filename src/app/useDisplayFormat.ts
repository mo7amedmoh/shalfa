import { useContext } from 'react';
import { formatDate, formatDateTime as formatDateTimeValue, formatNumerals } from '../lib/format';
import { preferencesContext } from './preferencesContext';

export function useDisplayFormat() {
  const preferences = useContext(preferencesContext);
  return {
    formatNumber: (value: string | number) => formatNumerals(value, preferences.numerals),
    formatDate: (value: string) => formatNumerals(formatDate(value, preferences.date_format), preferences.numerals),
    formatDateTime: (value: string) => formatDateTimeValue(value, preferences.date_format, preferences.numerals),
    rowsPerPage: preferences.rows_per_page,
  };
}
