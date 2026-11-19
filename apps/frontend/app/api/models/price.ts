const money = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 3 });

/** USD amount with up to three significant digits, e.g. 0.0075 -> "$0.0075". */
export const usd = (value: number) => `$${money.format(value)}`;
