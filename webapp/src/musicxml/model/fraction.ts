// Exact musical time: a duration or onset as a fraction of a whole note.

export interface Fraction {
  readonly n: number;
  readonly d: number;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x || 1;
}

export function fraction(n: number, d = 1): Fraction {
  if (d === 0) throw new RangeError("A fraction cannot have a zero denominator");
  const sign = d < 0 ? -1 : 1;
  const divisor = gcd(n, d);
  return { n: (sign * n) / divisor, d: (sign * d) / divisor };
}

export const ZERO = fraction(0);

export function add(a: Fraction, b: Fraction): Fraction {
  return fraction(a.n * b.d + b.n * a.d, a.d * b.d);
}

export function subtract(a: Fraction, b: Fraction): Fraction {
  return fraction(a.n * b.d - b.n * a.d, a.d * b.d);
}

export function multiply(a: Fraction, b: Fraction): Fraction {
  return fraction(a.n * b.n, a.d * b.d);
}

export function compare(a: Fraction, b: Fraction): number {
  return a.n * b.d - b.n * a.d;
}

export function maxFraction(a: Fraction, b: Fraction): Fraction {
  return compare(a, b) >= 0 ? a : b;
}

export function minFraction(a: Fraction, b: Fraction): Fraction {
  return compare(a, b) <= 0 ? a : b;
}

export function toNumber(value: Fraction): number {
  return value.n / value.d;
}

/** "0" for zero, else "3_8": usable in IDs. */
export function fractionKey(value: Fraction): string {
  return value.n === 0 ? "0" : `${value.n}_${value.d}`;
}
