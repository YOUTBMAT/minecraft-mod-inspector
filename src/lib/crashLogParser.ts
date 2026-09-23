import type { CrashAnalysisResult } from "@/types";

const JAVA_CLASS_VERSIONS: Record<string, string> = {
  "52.0": "Java 8",
  "55.0": "Java 11",
  "61.0": "Java 17",
  "65.0": "Java 21",
};

export function parseCrashReport(logContent: string): CrashAnalysisResult {
  const javaMismatch = detectJavaVersionMismatch(logContent);
  if (javaMismatch) {
    return javaMismatch;
  }

  const outOfMemory = detectOutOfMemory(logContent);
  if (outOfMemory) {
    return outOfMemory;
  }

  const missingDependency = detectMissingDependency(logContent);
  if (missingDependency) {
    return missingDependency;
  }

  const duplicateModId = detectDuplicateModId(logContent);
  if (duplicateModId) {
    return duplicateModId;
  }

  const mixinConflict = detectMixinConflict(logContent);
  if (mixinConflict) {
    return mixinConflict;
  }

  const incompatibleMods = detectIncompatibleMods(logContent);
  if (incompatibleMods) {
    return incompatibleMods;
  }

  const corruptedModFile = detectCorruptedModFile(logContent);
  if (corruptedModFile) {
    return corruptedModFile;
  }

  return {
    type: "UNKNOWN",
    title: "Causa do crash não identificada",
    details: "O log não correspondeu aos padrões conhecidos de diagnóstico.",
    recommendation:
      'Procure pelas linhas que contêm "Caused by:" para encontrar a causa original do erro.',
  };
}

function detectOutOfMemory(logContent: string): CrashAnalysisResult | null {
  const match = logContent.match(
    /java\.lang\.OutOfMemoryError:?\s*([\w\s]+)?/i,
  );

  if (!match) {
    return null;
  }

  const reason = match[1]?.trim();

  return {
    type: "OUT_OF_MEMORY",
    title: "Memória insuficiente (Out of Memory)",
    details: reason
      ? `O Java ficou sem memória disponível (${reason}).`
      : "O Java ficou sem memória disponível durante a execução.",
    recommendation:
      "Aumente a memória alocada (-Xmx) nas configurações do launcher, ou remova mods pesados (texturas em alta resolução, shaders, mods de geração de mundo) que consomem muita RAM.",
  };
}

function detectDuplicateModId(
  logContent: string,
): CrashAnalysisResult | null {
  const match = logContent.match(
    /duplicate\s+mod\s*(?:id)?[:\s]+['"]?([\w.-]+)['"]?/i,
  ) ?? logContent.match(
    /mods?\s+share\s+(?:the\s+)?(?:same\s+)?id\s+['"]?([\w.-]+)['"]?/i,
  );

  if (!match) {
    return null;
  }

  return {
    type: "DUPLICATE_MOD_ID",
    title: "ID de mod duplicado",
    suspectedMod: match[1],
    details: `Mais de um arquivo de mod está registando o mesmo ID (${match[1]}). Isto normalmente acontece quando o mesmo mod foi instalado duas vezes (por exemplo em versões diferentes).`,
    recommendation: `Verifique a pasta de mods e remova a cópia duplicada ou desatualizada de ${match[1]}.`,
  };
}

function detectIncompatibleMods(
  logContent: string,
): CrashAnalysisResult | null {
  if (!/incompatib(?:le|ility|ilities)/i.test(logContent)) {
    return null;
  }

  const explicitMatch = logContent.match(
    /mod\s+['"]?([\w.-]+)['"]?\s+(?:is|are)\s+incompatible\s+with\s+['"]?([\w.-]+)['"]?/i,
  );

  if (explicitMatch) {
    return {
      type: "INCOMPATIBLE_MODS",
      title: "Mods incompatíveis detectados",
      suspectedMod: explicitMatch[1],
      details: `${explicitMatch[1]} foi identificado como incompatível com ${explicitMatch[2]}.`,
      recommendation: `Remova ou atualize um dos dois mods (${explicitMatch[1]} ou ${explicitMatch[2]}) para versões compatíveis entre si.`,
    };
  }

  const sectionMatch = logContent.match(/Incompatible mods found!?[\s\S]{0,400}/i);
  if (!sectionMatch) {
    return null;
  }

  return {
    type: "INCOMPATIBLE_MODS",
    title: "Mods incompatíveis detectados",
    details: getRelevantLine(sectionMatch[0]),
    recommendation:
      "Consulte a secção 'Incompatible mods found' no log completo para identificar quais mods precisam ser removidos ou atualizados.",
  };
}

function detectCorruptedModFile(
  logContent: string,
): CrashAnalysisResult | null {
  if (
    !/(ZipException|invalid CEN header|zip END header not found|Error reading zip file)/i.test(
      logContent,
    )
  ) {
    return null;
  }

  const jarMatch = logContent.match(/([\w.\-]+\.jar)/i);

  return {
    type: "CORRUPTED_MOD_FILE",
    title: "Arquivo de mod corrompido",
    ...(jarMatch ? { suspectedMod: jarMatch[1] } : {}),
    details: jarMatch
      ? `O arquivo ${jarMatch[1]} parece estar corrompido ou incompleto (erro ao ler o ZIP).`
      : "Um dos arquivos .jar de mod parece estar corrompido ou incompleto (erro ao ler o ZIP).",
    recommendation:
      "Baixe novamente o arquivo do mod a partir da fonte oficial (Modrinth/CurseForge) e substitua o arquivo corrompido na pasta de mods.",
  };
}

function detectJavaVersionMismatch(
  logContent: string,
): CrashAnalysisResult | null {
  if (!/UnsupportedClassVersionError/i.test(logContent)) {
    return null;
  }

  const versionMatch = logContent.match(
    /class file version\s+([\d.]+)[\s\S]*?(?:only recognizes class file versions up to|recognizes class file versions up to)\s+([\d.]+)/i,
  );

  if (!versionMatch) {
    return {
      type: "JAVA_VERSION_MISMATCH",
      title: "Versão do Java incompatível",
      details: "O Java em execução não consegue carregar uma classe compilada para uma versão mais recente.",
      recommendation:
        "Altere a versão do Java configurada no launcher para uma versão compatível com o modpack.",
    };
  }

  const requiredVersion = formatJavaVersion(versionMatch[1]);
  const currentVersion = formatJavaVersion(versionMatch[2]);

  return {
    type: "JAVA_VERSION_MISMATCH",
    title: "Versão do Java incompatível",
    details: `O modpack exige ${requiredVersion}, mas o launcher está usando ${currentVersion}.`,
    recommendation:
      `Configure o launcher para usar ${requiredVersion} ou uma versão posterior compatível com o modpack.`,
  };
}

function detectMissingDependency(
  logContent: string,
): CrashAnalysisResult | null {
  const fabricMatch = logContent.match(
    /Mod\s+'([^']+)'\s+requires\s+.+?\s+of\s+mod\s+'([^']+)',\s+which\s+is\s+missing!/i,
  );

  if (fabricMatch) {
    return createMissingDependencyResult(
      fabricMatch[1],
      fabricMatch[2],
      fabricMatch[0],
    );
  }

  const forgeMatch = logContent.match(
    /Mod\s+['"]?([\w.-]+)['"]?\s+requires\s+(?:version\s+)?(?:mod\s+)?([\w.-]+)\s+[\w.+-]+\s+or\s+above/i,
  );

  if (forgeMatch) {
    return createMissingDependencyResult(
      forgeMatch[1],
      forgeMatch[2],
      forgeMatch[0],
    );
  }

  return null;
}

function detectMixinConflict(logContent: string): CrashAnalysisResult | null {
  const mixinErrorMatch = logContent.match(
    /(?:MixinTransformationError|CriticalInjectionError)[\s\S]*/i,
  );

  if (!mixinErrorMatch) {
    return null;
  }

  const mixinFileMatch = logContent.match(
    /\[([\w.-]+)\.mixins\.json:/i,
  );
  const suspectedMod = mixinFileMatch?.[1];

  return {
    type: "MIXIN_CONFLICT",
    title: "Conflito de Mixin detectado",
    ...(suspectedMod ? { suspectedMod } : {}),
    details: getRelevantLine(mixinErrorMatch[0]),
    recommendation:
      "Verifique a compatibilidade do mod identificado com os demais mods e atualize, remova ou ajuste o mod conflitante.",
  };
}

function createMissingDependencyResult(
  requestingMod: string,
  missingMod: string,
  matchedMessage: string,
): CrashAnalysisResult {
  return {
    type: "MISSING_DEPENDENCY",
    title: "Dependência ausente",
    suspectedMod: missingMod,
    details: `${requestingMod} requer ${missingMod}. Mensagem detectada: ${matchedMessage}`,
    recommendation: `Instale ${missingMod} em uma versão compatível com ${requestingMod} e com o mod loader usado pelo modpack.`,
  };
}

function formatJavaVersion(classVersion: string): string {
  return JAVA_CLASS_VERSIONS[classVersion] ?? `Java (class file ${classVersion})`;
}

function getRelevantLine(text: string): string {
  return text.split(/\r?\n/, 1)[0].trim();
}
