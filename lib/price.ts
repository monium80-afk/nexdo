// Prices on the paywall and onboarding's plan steps. The store decides the
// amount and the currency — from the buyer's App Store / Google Play country,
// not the phone's language or where it is — and the app only writes them out.
// The store's own `priceString` was shown before (2026-10-08), but it leaves
// the currency to a symbol: "$6.99" reads the same in US, Canadian or
// Australian dollars, so a buyer couldn't tell what they'd be charged in.

/**
 * The store's numbers for one product — the fields of RevenueCat's product
 * the prices are written from. Not its `pricePerMonth`: the Test Store gave
 * that in millionths ("USD 6,660,000.00 a month" for $79.99 a year, seen
 * 2026-10-09), so a yearly plan's month is worked out here instead.
 */
export type PricedProduct = {
  price: number;
  currencyCode: string;
  /** The store's own wording, kept as the last resort. */
  priceString: string;
};

// Symbols shared by several currencies. Written on its own, one of these
// doesn't say which currency it is, so the price is written with the
// currency's code instead ("USD 6.99"). A symbol that already names its
// country ("CA$", "US$", "A$") or belongs to one currency ("€", "£") stays.
const AMBIGUOUS_SYMBOLS = new Set(["$", "kr", "¥", "￥"]);

/** What's left of a written price once its digits, separators, spaces and direction marks are gone: its currency sign. */
function currencySign(formatted: string): string {
  return formatted.replace(/[\d\s.,'’  ٫٬؜‎‏+\-−]/g, "");
}

/**
 * An amount in a currency, in the app language's way of writing numbers, with
 * a currency nobody can mistake: "€6.99", "CA$9.49", "USD 6.99" — never a bare "$".
 */
export function formatPrice(amount: number, currencyCode: string, locale: string): string {
  const code = currencyCode.trim().toUpperCase();
  try {
    const bySymbol = new Intl.NumberFormat(locale, { style: "currency", currency: code }).format(amount);
    if (!AMBIGUOUS_SYMBOLS.has(currencySign(bySymbol))) return bySymbol;
    const byCode = new Intl.NumberFormat(locale, { style: "currency", currency: code, currencyDisplay: "code" }).format(amount);
    // A JavaScript engine that ignores currencyDisplay still gets the code in.
    return byCode.includes(code) ? byCode : `${bySymbol} ${code}`;
  } catch {
    // An engine without Intl's currency support, or a code it doesn't know.
    return `${amount.toFixed(2)} ${code}`;
  }
}

/** The product's price as the store charges it, currency spelled out. */
export function productPrice(product: PricedProduct, locale: string): string {
  if (!product.currencyCode || !Number.isFinite(product.price)) return product.priceString;
  return formatPrice(product.price, product.currencyCode, locale);
}

/** A yearly product's price spread over twelve months — what it works out to, not what's charged. */
export function monthlyEquivalent(product: PricedProduct, locale: string): string {
  return formatPrice(product.price / 12, product.currencyCode, locale);
}
