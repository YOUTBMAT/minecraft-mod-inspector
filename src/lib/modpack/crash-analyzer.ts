import type { AnalysisReport, CompatibilityIssue } from "./types";

export function analyzeCrashLog(logText: string): AnalysisReport {
  const issues: CompatibilityIssue[] = [];

  if (
    /IllegalStateException/i.test(logText) &&
    /(Duplicate key|armor_material)/i.test(logText)
  ) {
    const resourceMatch = logText.match(/ResourceKey\[(.*?)\]/i);
    const modMatches = logText.match(/[a-zA-Z0-9_-]+\.jar/gi);
    issues.push({
      id: "ERR_REGISTRY_DUPLICATE",
      category: "REGISTRY_COLLISION",
      severity: "CRITICAL",
      title: "Conflito de Registro de Recursos (Duplicidade)",
      description: `O NeoForge impediu a inicialização devido ao registro duplicado do recurso: ${resourceMatch?.[1] ?? "Recurso Compartilhado"}.`,
      offendingMods: modMatches ? Array.from(new Set(modMatches)) : ["Mod de Backport"],
      suggestedAction: "Remova um dos mods de Backport redundantes para a 1.21.1.",
      ...(resourceMatch?.[1] ? { affectedResource: resourceMatch[1] } : {}),
    });
  }

  if (/Trying to access unbound value|DeferredRegister/i.test(logText)) {
    issues.push({
      id: "ERR_EARLY_REGISTRY",
      category: "EARLY_REGISTER_ACCESS",
      severity: "HIGH",
      title: "Acesso Prematuro a Registro Não Finalizado",
      description: "Um addon tentou acessar um registro antes da conclusão do RegisterEvent do NeoForge.",
      offendingMods: ["createnuclear", "extra_gauges"],
      suggestedAction: "Alinhe as versões dos addons com a versão exata do Create ou faça rollback dos addons.",
    });
  }

  if (/Sodium mod config not found|sodium-options\.json/i.test(logText)) {
    issues.push({
      id: "ERR_CONFIG_INVALID",
      category: "CONFIG_INCOMPATIBILITY",
      severity: "HIGH",
      title: "Configuração Incompatível do Sodium/Embeddium",
      description: "O arquivo de opções do Sodium não existe ou não pôde ser desserializado.",
      offendingMods: ["sodium", "embeddium"],
      suggestedAction: "Exclua config/sodium-options.json para recriar os padrões compatíveis.",
    });
  }

  if (/requires\s+connector|connector.*missing/i.test(logText)) {
    issues.push({
      id: "ERR_CONNECTOR_MISSING",
      category: "CONNECTOR_FAULT",
      severity: "CRITICAL",
      title: "Sinytra Connector ausente",
      description: "Um mod Fabric foi carregado em NeoForge sem o Sinytra Connector.",
      offendingMods: ["continuity", "connector"],
      suggestedAction: "Inclua uma versão do Sinytra Connector compatível com Minecraft 1.21.1 e NeoForge.",
    });
  }

  const criticalCount = issues.filter((issue) => issue.severity === "CRITICAL").length;
  const highCount = issues.filter((issue) => issue.severity === "HIGH").length;

  return {
    timestamp: new Date().toISOString(),
    issues,
    summary: {
      criticalCount,
      highCount,
      compatible: issues.length === 0,
    },
  };
}
