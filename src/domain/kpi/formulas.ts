import { averageApplicableScores } from './scoring';

export interface FormulaInputs {
  numerator?: number;
  denominator?: number;
  observed?: number;
  applicable: boolean;
}

type IndicatorFormula = (values: FormulaInputs) => number;

function bounded(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) ? value : null;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(value, 1));
}

function ratioScore(values: FormulaInputs): number {
  const numerator = bounded(values.numerator);
  const denominator = bounded(values.denominator);
  if (!values.applicable || numerator === null || denominator === null || denominator === 0) return 0;
  return clamp(numerator / denominator);
}

function scoreCm1(values: FormulaInputs): number { return ratioScore(values); }
function scoreCm2(values: FormulaInputs): number { return ratioScore(values); }
function scoreCm3(values: FormulaInputs): number { return ratioScore(values); }
function scoreCm4(values: FormulaInputs): number { return ratioScore(values); }

function satisfactionScore(values: FormulaInputs, threshold: number): number {
  const observed = bounded(values.observed);
  if (!values.applicable || observed === null) return 0;
  return observed >= threshold ? 1 : clamp(observed);
}

function scoreCm5(values: FormulaInputs): number { return satisfactionScore(values, 0.81); }
function scoreCm6(values: FormulaInputs): number { return satisfactionScore(values, 0.85); }
function scoreCm7(values: FormulaInputs): number { return ratioScore(values); }

function scoreOm1(values: FormulaInputs): number {
  const nonconformities = bounded(values.observed);
  if (!values.applicable || nonconformities === null) return 0;
  return clamp(1 - nonconformities * 0.05);
}

function scoreOm2(values: FormulaInputs): number { return ratioScore(values); }
function scoreOm3(values: FormulaInputs): number { return ratioScore(values); }
function scoreOm4(values: FormulaInputs): number { return ratioScore(values); }
function scoreOm5(values: FormulaInputs): number { return ratioScore(values); }

function scoreHs1(values: FormulaInputs): number {
  if (bounded(values.numerator) === 0) return 0;
  return ratioScore(values);
}

function scoreHs2(values: FormulaInputs): number {
  const overdue = bounded(values.numerator);
  const total = bounded(values.denominator);
  if (overdue === null || total === null) return 0;
  if (overdue === 0) return 1;
  if (!values.applicable || total === 0) return 0;
  return clamp(1 - overdue / total);
}

function reportsScore(values: FormulaInputs): number {
  const reports = bounded(values.numerator);
  const total = bounded(values.denominator);
  if (reports === null || total === null) return 0;
  if (total === 0 || reports / total <= 0.2) return 1;
  if (!values.applicable) return 0;
  return clamp(1 - reports / total);
}

function scoreHs3(values: FormulaInputs): number { return reportsScore(values); }
function scoreHs4(values: FormulaInputs): number { return reportsScore(values); }
function scoreHs5(values: FormulaInputs): number { return reportsScore(values); }
function scoreHs6(values: FormulaInputs): number { return reportsScore(values); }
function scoreHs7(values: FormulaInputs): number { return reportsScore(values); }
function scoreHs8(values: FormulaInputs): number { return reportsScore(values); }
function scoreHs9(values: FormulaInputs): number { return reportsScore(values); }
function scoreHs10(values: FormulaInputs): number { return ratioScore(values); }

function scoreSs1(values: FormulaInputs): number {
  const numerator = bounded(values.numerator);
  const denominator = bounded(values.denominator);
  if (!values.applicable || numerator === null || denominator === null || denominator === 0) return 0;
  return numerator / denominator >= 0.95 ? 1 : clamp(numerator / denominator);
}

function scoreSs2(values: FormulaInputs): number { return ratioScore(values); }
function scoreSs3(values: FormulaInputs): number { return ratioScore(values); }
function scoreSs4(values: FormulaInputs): number { return ratioScore(values); }
function scoreSs5(values: FormulaInputs): number { return ratioScore(values); }
function scoreSs6(values: FormulaInputs): number { return ratioScore(values); }
function scoreSs7(values: FormulaInputs): number { return ratioScore(values); }
function scoreSs8(values: FormulaInputs): number { return ratioScore(values); }
function scoreSs9(values: FormulaInputs): number { return ratioScore(values); }

const formulaRegistry: Readonly<Record<string, IndicatorFormula>> = {
  'CM.1': scoreCm1,
  'CM.2': scoreCm2,
  'CM.3': scoreCm3,
  'CM.4': scoreCm4,
  'CM.5': scoreCm5,
  'CM.6': scoreCm6,
  'CM.7': scoreCm7,
  'OM.1': scoreOm1,
  'OM.2': scoreOm2,
  'OM.3': scoreOm3,
  'OM.4': scoreOm4,
  'OM.5': scoreOm5,
  'HS.1': scoreHs1,
  'HS.2': scoreHs2,
  'HS.3': scoreHs3,
  'HS.4': scoreHs4,
  'HS.5': scoreHs5,
  'HS.6': scoreHs6,
  'HS.7': scoreHs7,
  'HS.8': scoreHs8,
  'HS.9': scoreHs9,
  'HS.10': scoreHs10,
  'SS.1': scoreSs1,
  'SS.2': scoreSs2,
  'SS.3': scoreSs3,
  'SS.4': scoreSs4,
  'SS.5': scoreSs5,
  'SS.6': scoreSs6,
  'SS.7': scoreSs7,
  'SS.8': scoreSs8,
  'SS.9': scoreSs9,
};

const scorecardDefinitions = [
  { code: 'CM', weight: 0.1, ids: ['CM.1', 'CM.2', 'CM.3', 'CM.4', 'CM.5', 'CM.6', 'CM.7'] },
  { code: 'OM', weight: 0.15, ids: ['OM.1', 'OM.2', 'OM.3', 'OM.4', 'OM.5'] },
  { code: 'HS', weight: 0.3, ids: ['HS.1', 'HS.2', 'HS.3', 'HS.4', 'HS.5', 'HS.6', 'HS.7', 'HS.8', 'HS.9', 'HS.10'] },
  { code: 'SS', weight: 0.45, ids: ['SS.1', 'SS.2', 'SS.3', 'SS.4', 'SS.5', 'SS.6', 'SS.7', 'SS.8', 'SS.9'] },
] as const;

export const formulaIndicatorIds = Object.keys(formulaRegistry);

export function scoreByIndicatorId(indicatorId: string, values: FormulaInputs): number {
  const formula = formulaRegistry[indicatorId];
  if (!formula) throw new Error(`No verified KPI formula is registered for ${indicatorId}.`);
  return formula(values);
}

export function calculateMonthlyKpiTotal(indicators: Readonly<Record<string, FormulaInputs>>): number | null {
  let total = 0;
  let hasApplicableIndicators = false;
  for (const card of scorecardDefinitions) {
    const scores = card.ids.map((id) => {
      const input = indicators[id];
      return input?.applicable ? scoreByIndicatorId(id, input) : null;
    });
    const score = averageApplicableScores(scores);
    if (score !== null) {
      total += score * card.weight;
      hasApplicableIndicators = true;
    }
  }
  return hasApplicableIndicators ? total : null;
}
