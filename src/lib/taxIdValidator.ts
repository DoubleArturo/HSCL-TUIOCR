/**
 * Taiwan Business Registration Number (統一編號) checksum validator.
 *
 * Rules per 財政部修正說明 (effective after 2023 amendment):
 *  - Multiply each digit by weights [1,2,1,2,1,2,4,1]
 *  - For 2-digit products, sum the two digits (e.g. 14 → 1+4=5)
 *  - Sum all 8 resulting values → Z
 *  - Valid if Z % 5 === 0
 *
 * Special case when digit[6] === '7':
 *  - The 7th position weight is 4, so its product can be treated as either
 *    floor(product/10) or ceil(product/10) for the tens digit.
 *    Concretely: compute Z once normally, once with that digit's contribution
 *    reduced by 1 (i.e. the carry bit is 0 instead of 1).
 *  - Valid if EITHER Z1 % 5 === 0 OR Z2 % 5 === 0
 */

const WEIGHTS = [1, 2, 1, 2, 1, 2, 4, 1] as const;

// Recursively sum digits until single digit (handles 7×4=28 → 2+8=10 → 1+0=1)
function digitSum(n: number): number {
  while (n >= 10) n = Math.floor(n / 10) + (n % 10);
  return n;
}

export function validateTaiwanTaxId(taxId: string): boolean {
  const clean = (taxId || '').replace(/\D/g, '');
  if (clean.length !== 8) return false;

  const digits = clean.split('').map(Number);

  let z = 0;
  for (let i = 0; i < 8; i++) {
    z += digitSum(digits[i] * WEIGHTS[i]);
  }

  if (z % 5 === 0) return true;

  // Special case: digit[6] === 7 → 7×4=28 → digitSum=1, but the official rule
  // allows treating the intermediate carry as 0, so z or (z-1) divisible by 5 is valid.
  if (digits[6] === 7 && (z - 1) % 5 === 0) return true;

  return false;
}
