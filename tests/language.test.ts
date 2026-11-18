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

  // The five added 2026-11-02, as Android and iOS write them.
  it("finds the newer languages too", () => {
    assert.equal(languageFromLocale("zh_CN_#Hans"), "zh");
    assert.equal(languageFromLocale("zh-Hans-CN"), "zh");
    assert.equal(languageFromLocale("hi-IN"), "hi");
    assert.equal(languageFromLocale("pt-BR"), "pt");
    assert.equal(languageFromLocale("pt_PT"), "pt");
    assert.equal(languageFromLocale("bn-BD"), "bn");
    assert.equal(languageFromLocale("ru-RU"), "ru");
  });

  it("is passed over when Nexdo doesn't have it", () => {
    assert.equal(languageFromLocale("ja-JP"), null);
    assert.equal(languageFromLocale(""), null);
    assert.equal(languageFromLocale(undefined), null);
  });
});
