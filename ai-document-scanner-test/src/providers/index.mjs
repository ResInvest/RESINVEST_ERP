// @ts-check
/* Rejestr providerów: wybór na podstawie konfiguracji. „auto” = Claude, gdy jest klucz; inaczej mock. */
import { join } from "node:path";
import { MODULE_ROOT } from "../config.mjs";
import { createMockProvider } from "./mock.mjs";
import { createAnthropicProvider } from "./anthropic.mjs";

export const PROVIDER_NAMES = ["mock", "anthropic"];

/**
 * @param {import("../config.mjs").ScannerConfig} cfg
 * @param {Record<string, string|undefined>} env
 * @param {{ fixturesDir?: string, anthropicClient?: any }} [deps]  wstrzykiwanie zależności (testy)
 * @returns {{ active: import("./provider.mjs").Provider, all: Record<string, import("./provider.mjs").Provider> }}
 */
export function createProviders(cfg, env, deps = {}) {
  const mock = createMockProvider({ fixturesDir: deps.fixturesDir || join(MODULE_ROOT, "samples", "fixtures") });
  const anthropic = createAnthropicProvider({
    apiKey: env.ANTHROPIC_API_KEY || null,
    model: cfg.anthropic.model,
    effort: cfg.anthropic.effort,
    timeoutMs: cfg.anthropic.timeoutSec * 1000,
    useFallback: cfg.anthropic.useFallback,
    client: deps.anthropicClient
  });
  const all = { mock, anthropic };
  let active;
  if (cfg.provider === "mock") active = mock;
  else if (cfg.provider === "anthropic") active = anthropic;
  else active = anthropic.status().configured ? anthropic : mock;
  return { active, all };
}
