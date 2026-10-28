/// <reference types="node" />
// Paywall prices (lib/price.ts): the store's amount in the store's currency,
// with the currency always readable — never a bare "$".
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatPrice, monthlyEquivalent, productPrice } from "@/lib/price";

// Intl puts narrow / no-break spaces between amount and currency; compare on plain ones.
const plain = (text: string) => text.replace(/[  ]/g, " ");

describe("store prices with their currency", () => {
  it("a dollar of any country says which one", () => {
    assert.equal(plain(formatPrice(6.99, "USD", "en-US")), "USD 6.99");
    assert.equal(formatPrice(9.49, "CAD", "en-US"), "CA$9.49");
    assert.equal(formatPrice(10.99, "AUD", "en-US"), "A$10.99");
    assert.match(plain(formatPrice(6.99, "USD", "de-DE")), /^6,99 (USD|US\$)$/);
    assert.match(plain(formatPrice(9.49, "CAD", "fr-FR")), /^9,49 \$CA$/);
  });

  it("a currency with a sign of its own keeps it", () => {
    assert.equal(plain(formatPrice(6.99, "EUR", "fr-FR")), "6,99 €");
    assert.equal(formatPrice(5.99, "GBP", "en-US"), "£5.99");
  });

  it("a currency without a sign is written with its code", () => {
    assert.match(plain(formatPrice(70, "MAD", "fr-FR")), /^70,00 MAD$/);
    assert.match(plain(formatPrice(1200, "JPY", "en-US")), /^JPY 1,200$/);
  });

  it("the store's own wording is the last resort", () => {
    assert.equal(productPrice({ price: 6.99, currencyCode: "", priceString: "$6.99" }, "en-US"), "$6.99");
    assert.equal(productPrice({ price: Number.NaN, currencyCode: "USD", priceString: "$6.99" }, "en-US"), "$6.99");
  });

  it("a yearly plan's month is a twelfth of the year — never the store's own figure, which can come in millionths", () => {
    const testStoreYearly = { price: 79.99, currencyCode: "USD", priceString: "$79.99", pricePerMonth: 6_660_000 };
    assert.equal(plain(monthlyEquivalent(testStoreYearly, "en-US")), "USD 6.67");
    assert.equal(monthlyEquivalent({ price: 60, currencyCode: "CAD", priceString: "" }, "en-US"), "CA$5.00");
  });
});
