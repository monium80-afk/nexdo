/// <reference types="node" />
// The language a first launch starts in: the phone's, when Nexdo has it.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { languageFromLocale } from "@/store/useSettingsStore";

describe("the phone's language", () => {
  it("is used when Nexdo has it, however the phone writes its locale", () => {
    assert.equal(languageFromLocale("fr-CA"), "fr");
    assert.equal(languageFromLocale("fr_FR"), "fr");
    assert.equal(languageFromLocale("es-419"), "es");
    assert.equal(languageFromLocale("ar-MA"), "ar");
    assert.equal(languageFromLocale("de"), "de");
    assert.equal(languageFromLocale("EN-gb"), "en");
  });

  it("is passed over when Nexdo doesn't have it", () => {
    assert.equal(languageFromLocale("pt-BR"), null);
    assert.equal(languageFromLocale(""), null);
    assert.equal(languageFromLocale(undefined), null);
  });
});
