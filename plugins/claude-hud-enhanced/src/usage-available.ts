export const hasFigure = (percent: number | null | undefined): percent is number =>
  typeof percent === 'number' && Number.isFinite(percent);
