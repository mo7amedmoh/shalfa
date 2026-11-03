export function averageApplicableScores(scores: readonly (number | null)[]): number | null {
  const applicable = scores.filter((score): score is number => score !== null);
  if (applicable.some((score) => !Number.isFinite(score) || score < 0 || score > 1)) {
    throw new RangeError('Applicable scores must be between zero and one.');
  }
  if (applicable.length === 0) return null;
  return applicable.reduce((sum, score) => sum + score, 0) / applicable.length;
}

export function ratingBand(scorePercent: number): 'excellent' | 'average' | 'weak' {
  if (!Number.isFinite(scorePercent) || scorePercent < 0 || scorePercent > 100) {
    throw new RangeError('Score must be between 0 and 100.');
  }
  return scorePercent >= 95 ? 'excellent' : scorePercent >= 85 ? 'average' : 'weak';
}
