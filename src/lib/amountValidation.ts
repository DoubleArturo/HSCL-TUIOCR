/** Returns true if sales + tax equals total within a tolerance of 1 (rounding). */
export function isAmountValid(sales: number, tax: number, total: number): boolean {
  return Math.abs((sales + tax) - total) <= 1;
}
