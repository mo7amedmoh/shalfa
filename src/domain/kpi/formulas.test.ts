import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { calculateMonthlyKpiTotal, formulaIndicatorIds, scoreByIndicatorId, type FormulaInputs } from './formulas';
import kpiCatalogJson from '../../../supabase/seed/kpi-catalog.json?raw';

const importedCatalog = z.object({
  cards: z.array(z.object({
    indicators: z.array(z.object({
      id: z.string(),
      octoberApplicable: z.boolean(),
      octoberInputs: z.object({
        numerator: z.number().nullable(),
        denominator: z.number().nullable(),
        observed: z.number().nullable(),
      }),
    })),
  })),
}).parse(JSON.parse(kpiCatalogJson));

describe('KPI formulas extracted from the October workbook', () => {
  it('registers every scorecard indicator', () => {
    expect(formulaIndicatorIds).toHaveLength(31);
    expect(formulaIndicatorIds).toContain('CM.1');
    expect(formulaIndicatorIds).toContain('SS.9');
  });

  it('reproduces the October score from the imported workbook values', () => {
    const indicators = Object.fromEntries(importedCatalog.cards.flatMap((card) =>
      card.indicators.map((indicator) => [indicator.id, {
        ...indicator.octoberInputs,
        applicable: indicator.octoberApplicable,
      }]),
    )) as Record<string, FormulaInputs>;

    expect(calculateMonthlyKpiTotal(indicators)).toBeCloseTo(0.9285852377710785, 10);
  });

  it('reproduces the individually sampled October values', () => {
    const indicators: Record<string, FormulaInputs> = {
      'CM.1': { numerator: 537, denominator: 537, applicable: true },
      'CM.2': { numerator: 21, denominator: 21, applicable: true },
      'CM.3': { numerator: 1, denominator: 1, applicable: true },
      'CM.4': { numerator: 6, denominator: 6, applicable: true },
      'CM.5': { observed: 0.85, applicable: false },
      'CM.6': { observed: 0, applicable: false },
      'CM.7': { numerator: 8, denominator: 8, applicable: true },
      'OM.1': { observed: 0, applicable: false },
      'OM.2': { numerator: 30, denominator: 30, applicable: true },
      'OM.3': { numerator: 1, denominator: 1, applicable: true },
      'OM.4': { numerator: 0, denominator: 0, applicable: false },
      'OM.5': { numerator: 600, denominator: 910, applicable: true },
      'HS.1': { numerator: 7500, denominator: 182, applicable: true },
      'HS.2': { numerator: 56, denominator: 1356, applicable: true },
      'HS.3': { numerator: 84, denominator: 546, applicable: true },
      'HS.4': { numerator: 159, denominator: 364, applicable: true },
      'HS.5': { numerator: 110, denominator: 546, applicable: true },
      'HS.6': { numerator: 214, denominator: 546, applicable: true },
      'HS.7': { numerator: 14, denominator: 364, applicable: true },
      'HS.8': { numerator: 394, denominator: 728, applicable: true },
      'HS.9': { numerator: 108, denominator: 546, applicable: true },
      'HS.10': { numerator: 36, denominator: 45, applicable: true },
      'SS.1': { numerator: 182, denominator: 182, applicable: true },
      'SS.2': { numerator: 1, denominator: 1, applicable: true },
      'SS.3': { numerator: 1, denominator: 1, applicable: false },
      'SS.4': { numerator: 1, denominator: 1, applicable: true },
      'SS.5': { numerator: 1, denominator: 1, applicable: true },
      'SS.6': { numerator: 182, denominator: 182, applicable: true },
      'SS.7': { numerator: 2, denominator: 2, applicable: true },
      'SS.8': { numerator: 0, denominator: 0, applicable: false },
      'SS.9': { numerator: 1, denominator: 1, applicable: true },
    };

    expect(calculateMonthlyKpiTotal(indicators)).toBeCloseTo(0.9285852377710785, 10);
  });

  it('matches workbook-specific thresholds, no-applicable behavior, and rejects unknown indicators', () => {
    expect(scoreByIndicatorId('CM.5', { observed: 0.81, applicable: true })).toBe(1);
    expect(scoreByIndicatorId('CM.6', { observed: 0.84, applicable: true })).toBe(0.84);
    expect(scoreByIndicatorId('OM.1', { observed: 3, applicable: true })).toBeCloseTo(0.85);
    expect(scoreByIndicatorId('SS.1', { numerator: 94, denominator: 100, applicable: true })).toBe(0.94);
    expect(scoreByIndicatorId('HS.3', { numerator: 1, denominator: 0, applicable: false })).toBe(1);
    expect(calculateMonthlyKpiTotal({
      'CM.1': { numerator: 1, denominator: 1, applicable: true },
    })).toBe(0.1);
    expect(calculateMonthlyKpiTotal({})).toBeNull();
    expect(() => scoreByIndicatorId('ZZ.1', { applicable: true })).toThrow(/No verified/);
  });
});
