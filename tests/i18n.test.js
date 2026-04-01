import { test } from "node:test";
import assert from "node:assert/strict";
import { setLanguage, getLanguage, t } from "../dist/i18n/index.js";
import { detectLanguage, mergeConfig } from "../dist/config.js";

test("t() returns English strings by default", () => {
  setLanguage("en");
  assert.equal(t("label.context"), "Context");
  assert.equal(t("label.usage"), "Usage");
  assert.equal(t("label.approxRam"), "Approx RAM");
  assert.equal(t("status.limitReached"), "Limit reached");
  assert.equal(t("status.allTodosComplete"), "All todos complete");
});

test("t() returns Chinese strings when language is zh", () => {
  setLanguage("zh");
  assert.equal(t("label.context"), "上下文");
  assert.equal(t("label.usage"), "用量");
  assert.equal(t("label.approxRam"), "内存");
  assert.equal(t("label.rules"), "规则");
  assert.equal(t("label.hooks"), "钩子");
  assert.equal(t("status.limitReached"), "已达上限");
  assert.equal(t("status.allTodosComplete"), "全部完成");
  assert.equal(t("format.in"), "输入");
  assert.equal(t("format.cache"), "缓存");
  assert.equal(t("format.out"), "输出");
  // Restore
  setLanguage("en");
});

test("setLanguage and getLanguage round-trip", () => {
  setLanguage("zh");
  assert.equal(getLanguage(), "zh");
  setLanguage("en");
  assert.equal(getLanguage(), "en");
});

test("detectLanguage respects LC_ALL over LANG (POSIX priority)", () => {
  const origLang = process.env.LANG;
  const origLcAll = process.env.LC_ALL;
  const origLcMsg = process.env.LC_MESSAGES;

  try {
    process.env.LANG = "en_US.UTF-8";
    process.env.LC_ALL = "zh_CN.UTF-8";
    delete process.env.LC_MESSAGES;
    assert.equal(detectLanguage(), "zh");

    process.env.LC_ALL = "en_US.UTF-8";
    process.env.LANG = "zh_CN.UTF-8";
    assert.equal(detectLanguage(), "en");

    delete process.env.LC_ALL;
    assert.equal(detectLanguage(), "zh");
  } finally {
    process.env.LANG = origLang;
    process.env.LC_ALL = origLcAll;
    process.env.LC_MESSAGES = origLcMsg;
  }
});

test("detectLanguage returns en for unknown locales", () => {
  const origLang = process.env.LANG;
  const origLcAll = process.env.LC_ALL;
  const origLcMsg = process.env.LC_MESSAGES;

  try {
    delete process.env.LC_ALL;
    delete process.env.LC_MESSAGES;
    process.env.LANG = "fr_FR.UTF-8";
    assert.equal(detectLanguage(), "en");

    process.env.LANG = "C";
    assert.equal(detectLanguage(), "en");

    delete process.env.LANG;
    assert.equal(detectLanguage(), "en");
  } finally {
    process.env.LANG = origLang;
    process.env.LC_ALL = origLcAll;
    process.env.LC_MESSAGES = origLcMsg;
  }
});

test("mergeConfig uses detectLanguage when no language specified", () => {
  const origLcAll = process.env.LC_ALL;
  const origLang = process.env.LANG;
  const origLcMsg = process.env.LC_MESSAGES;

  try {
    process.env.LC_ALL = "zh_CN.UTF-8";
    delete process.env.LC_MESSAGES;
    const config = mergeConfig({});
    assert.equal(config.language, "zh");
  } finally {
    process.env.LC_ALL = origLcAll;
    process.env.LANG = origLang;
    process.env.LC_MESSAGES = origLcMsg;
  }
});

test("mergeConfig preserves explicit language from config", () => {
  const config = mergeConfig({ language: "zh" });
  assert.equal(config.language, "zh");

  const config2 = mergeConfig({ language: "en" });
  assert.equal(config2.language, "en");
});

test("mergeConfig falls back to detection for invalid language", () => {
  const origLcAll = process.env.LC_ALL;
  const origLang = process.env.LANG;
  const origLcMsg = process.env.LC_MESSAGES;

  try {
    delete process.env.LC_ALL;
    delete process.env.LC_MESSAGES;
    process.env.LANG = "C";
    const config = mergeConfig({ language: "invalid" });
    assert.equal(config.language, "en");
  } finally {
    process.env.LC_ALL = origLcAll;
    process.env.LANG = origLang;
    process.env.LC_MESSAGES = origLcMsg;
  }
});
