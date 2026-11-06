// Service Units (SU), the unit of the ARCH allocation portal: 1 SU is one Slurm billing-hour.
// ARCH's published rate; billing isn't active yet, so dollars are a conversion, not a charge.
export const USD_PER_SU = 0.001;

export const fmtSu = (su: number) => Math.round(su).toLocaleString();

/** "$2.01", or whole dollars from $100 up. */
export const fmtUsd = (su: number) => {
  const usd = su * USD_PER_SU;
  const digits = usd >= 100 ? 0 : 2;
  return usd.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });
};
