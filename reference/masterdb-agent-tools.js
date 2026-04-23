function aiToolsHelloWorld(ticket, params) {
  // recebe parametros em json, em alinhamento com a definição dos parametros da tool

  var response = ModuleUtils.makeOutput(11, ticket.getRequestContext());
  var results = { content: null, logs: [] };
  var parameters = JSON.parse(params.get(0)); // é aqui os parametros são transportados para a função

  results.logs.push(JSON.stringify(parameters));

  var prompt = parameters.prompt; // recolha do parametro prompt; a ser usado para todos os outros parametros

  results.content = "Hello World !! is the answer to this prompt:  " + prompt + "  ."; // resposta da função

  // estruturação dos logs e respectivo output

  results.logs.push(JSON.stringify(results));
  response = ModuleUtils.setResponse(response, TheSysModuleFunctionResult.RESULT_OK, "OK");

  response = ModuleUtils.setOutput(response, 11, JSON.stringify(results)); // define o output, que no caso, será observado em M2M e não em H2M

  ticket.getResult().setObject(response);
  ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_OK);
}

function aiToolsMasterDBFindEnergyInfra(ticket, params) {
  // Helper para logging seguro
  function safeStr(v, max) {
    try {
      var s = String(v || "");
      return s.length > max ? s.substring(0, max) + "...[truncated]" : s;
    } catch (e) {
      return "[unavailable]";
    }
  }

  // --- Inicialização ---
  var response = ModuleUtils.makeOutput(11, ticket.getRequestContext());

  // Preparação de resultados com logs em array
  var results = {
    content: null,
    logs: []
  };
  var MAX_LOGS = 200;

  function addLog(msg, level) {
    try {
      var entry = "[" + new Date().toISOString() + "][" + (level || "INFO") + "] " + safeStr(msg, 2000);
      results.logs.push(entry);
      if (results.logs.length > MAX_LOGS) results.logs.shift();
    } catch (e) {}
  }

  var parameters;
  try {
    parameters = JSON.parse(params.get(0));
  } catch (e) {
    var err = "Param parse error: " + e + " | raw=" + safeStr(params.get(0), 1000);
    ModuleUtils.logSevere(err);
    addLog(err, "ERROR");
    setResponse(ticket, response, "Erro ao processar parâmetros de entrada.", JSON.stringify(results), 1, TheSysModuleFunctionResult.RESULT_NOK, "400");
    return;
  }

  // --- Construção de Query ---
  var andFilterParts = [];

  // Helper: aceita strings ou arrays
  function pushFilter(key, val) {
    if (val === undefined || val === null || val === "") return;
    if (Array.isArray(val)) {
      if (val.length > 0) andFilterParts.push(key + "=" + val.join(","));
    } else {
      andFilterParts.push(key + "=" + val);
    }
  }

  // Variáveis de controlo (não entram como filtros)
  var CONTROL_KEYS = {
    limit: 1,
    sort_field: 1,
    sort_order: 1,
    return_fields: 1
  };

  // Inferir dinamicamente todos os atributos, exceto controlo e status (tratado abaixo)
  for (var k in parameters) {
    if (!parameters.hasOwnProperty(k)) continue;
    if (CONTROL_KEYS[k]) continue;
    if (k === "status") continue;
    pushFilter(k, parameters[k]);
  }

  // Regra do status: se não vier, assume Deployed; se vier "ALL", ignora filtro
  if (parameters.status) {
    pushFilter("status", parameters.status);
  } else {
    pushFilter("status", "~eq~Deployed");
  }

  // AND comum (key=value&key2=value2...)
  var andCommon = andFilterParts.join("&");

  // Construção do array 'filters' sem duplicações
  var filters = [];
  if (andCommon) {
    filters.push(andCommon);
  }

  // Parâmetros da query
  var limit = parameters.limit || 30;
  var sort_order = parameters.sort_order || -1;
  var sort_field = parameters.sort_field || "_created_date";
  var return_fields = parameters.return_fields || "";

  // Normalização do separador de return_fields (',' -> ';')
  if (typeof return_fields === "string" && return_fields.indexOf(",") !== -1) {
    return_fields = return_fields
      .split(",")
      .map(function (s) {
        return s.trim();
      })
      .join(";");
  }

  var query = {
    skip: 0,
    limit: limit,
    sort_order: sort_order,
    sort_field: sort_field,
    filters: filters,
    return_fields: return_fields,
    relations: false
  };

  // --- Execução ---
  var runTicket = ModuleUtils.runFunction("/masterdb/ci/search", JSON.stringify(query), ticket.getRequestContext());
  if (!ModuleUtils.waitForTicketsSuccess(runTicket)) {
    var rawResult;
    try {
      rawResult = runTicket.getResult() ? String(runTicket.getResult().getObject()) : "null";
    } catch (er) {
      rawResult = "unavailable: " + er;
    }
    var errLog = "/masterdb/ci/search failed | query=" + JSON.stringify(query) + " | result=" + safeStr(rawResult, 2000);
    ModuleUtils.logSevere(errLog);
    addLog(errLog, "ERROR");
    setResponse(ticket, response, "Falha ao pesquisar CIs (genérico).", JSON.stringify(results), 1, TheSysModuleFunctionResult.RESULT_NOK, "500");
    return;
  }

  // Parse do resultado
  var rawObjStr;
  try {
    rawObjStr = String(runTicket.getResult().getObject());
    var result = JSON.parse(rawObjStr);
    results.content = result;
    addLog("Executado /masterdb/ci/search com a query: " + JSON.stringify(query), "INFO");
    setResponse(ticket, response, "OK", JSON.stringify(results), 0, TheSysModuleFunctionResult.RESULT_OK, "200");
    return;
  } catch (e) {
    var parseErr = "[EnergyInfra] JSON parse error on /masterdb/ci/search result | raw=" + safeStr(rawObjStr, 2000) + " | err=" + e;
    ModuleUtils.logSevere(parseErr);
    addLog(parseErr, "ERROR");
    setResponse(ticket, response, "Erro ao processar resposta da MasterDB.", JSON.stringify(results), 1, TheSysModuleFunctionResult.RESULT_NOK, "500");
    return;
  }
}

function aiToolsMasterDBFind(ticket, params) {
  // Helper para logging seguro
  function safeStr(v, max) {
    try {
      var s = String(v || "");
      return s.length > max ? s.substring(0, max) + "...[truncated]" : s;
    } catch (e) {
      return "[unavailable]";
    }
  }

  // --- Inicialização ---
  var response = ModuleUtils.makeOutput(11, ticket.getRequestContext());

  // Resultados no formato unificado: { content, logs }
  var results = {
    content: null,
    logs: []
  };
  var MAX_LOGS = 200;

  function addLog(msg, level) {
    try {
      var entry = "[" + new Date().toISOString() + "][" + (level || "INFO") + "] " + safeStr(msg, 2000);
      results.logs.push(entry);
      if (results.logs.length > MAX_LOGS) results.logs.shift();
    } catch (e) {}
  }

  // Parse de parâmetros (robusto)
  var parameters;
  try {
    var rawIn = params && params.size && params.size() > 0 ? params.get(0) || "{}" : "{}";
    parameters = JSON.parse(rawIn);
    if (parameters.item && !parameters.items) {
      parameters.items = parameters.item;
      delete parameters.item;
    }
  } catch (e) {
    var err = "Param parse error: " + e + " | raw=" + safeStr(params && params.get ? params.get(0) : "", 1000);
    ModuleUtils.logSevere(err);
    addLog(err, "ERROR");
    setResponse(ticket, response, "Erro ao processar parâmetros de entrada.", JSON.stringify(results), 1, TheSysModuleFunctionResult.RESULT_NOK, "400");
    return;
  }

  addLog("Parameters: " + safeStr(JSON.stringify(parameters), 2000), "INFO");

  // --- Construção de Query ---
  var andFilterParts = [];
  var seenStatus = false;
  var seenKeys = {}; // Rastreia chaves já adicionadas para evitar duplicação

  // Variáveis de controlo (não entram como filtros)
  var CONTROL_KEYS = {
    limit: 1,
    sort_field: 1,
    sort_order: 1,
    return_fields: 1,
    items: 1
  };

  // Normaliza chave e verifica se é parâmetro de controlo
  function isControlKey(key) {
    if (!key) return true;
    var k = String(key)
      .toLowerCase()
      .replace(/^fields./, "");
    return CONTROL_KEYS[k] === 1;
  }

  // Helper: aceita strings ou arrays; remove prefixo "fields." das chaves
  // Evita duplicação de chaves já vistas
  function pushFilter(key, val) {
    if (val === undefined || val === null || val === "") return;

    var k = String(key || "").replace(/^fields./, "");
    if (!k) return;

    // 🚫 nunca permitir parâmetros de controlo nos filtros
    if (isControlKey(k)) return;

    // 🚫 Se a chave já foi adicionada (pelo items), ignorar
    var kLower = k.toLowerCase();
    if (seenKeys[kLower]) return;

    if (kLower === "status") seenStatus = true;

    seenKeys[kLower] = true;

    if (Array.isArray(val)) {
      if (val.length > 0) andFilterParts.push(k + "=" + val.join(","));
    } else {
      andFilterParts.push(k + "=" + val);
    }
  }

  // Suportar 'items' como AND string (ex.: "a=1&fields.b=2&status=eqDeployed") ou como array de AND strings
  function injectItems(val) {
    if (!val) return;

    if (Array.isArray(val)) {
      for (var i = 0; i < val.length; i++) injectItems(val[i]);
      return;
    }

    if (typeof val !== "string") return;

    var tokens = val.split("&");
    for (var t = 0; t < tokens.length; t++) {
      var tok = tokens[t];
      if (!tok) continue;

      var idx = tok.indexOf("=");
      if (idx <= 0) continue;

      var k = tok
        .substring(0, idx)
        .trim()
        .replace(/^fields\./, "");
      var v = tok.substring(idx + 1);

      if (!k) continue;

      // 🚫 nunca permitir parâmetros de controlo nos filtros
      if (isControlKey(k)) continue;

      var kLower = k.toLowerCase();
      if (kLower === "status") seenStatus = true;

      // Marcar chave como vista e adicionar filtro
      seenKeys[kLower] = true;
      andFilterParts.push(k + "=" + v);
    }
  }

  // 1) Injetar 'items' primeiro (se vier) - marca as chaves como vistas
  if (parameters.items) {
    injectItems(parameters.items);
  }

  // 2) Inferir dinamicamente todos os restantes atributos, exceto controlo e status
  // pushFilter já ignora chaves que foram adicionadas pelo items
  for (var k in parameters) {
    if (!parameters.hasOwnProperty(k)) continue;
    if (CONTROL_KEYS[k]) continue;
    if (k === "status") continue;
    pushFilter(k, parameters[k]);
  }

  // 3) Regra do status:
  //    - se vier "status=ALL", não aplicar filtro de status
  //    - se vier "status" (não ALL), aplicar tal como veio
  //    - se não vier e ainda não foi visto no items, aplicar "eqDeployed"
  if (parameters.status !== undefined && parameters.status !== null) {
    if (String(parameters.status).toUpperCase() !== "ALL") {
      pushFilter("status", parameters.status);
    }
  } else if (!seenStatus) {
    pushFilter("status", "~eq~Deployed");
  }

  // AND comum (key=value&key2=value2...)
  var andCommon = andFilterParts.join("&");

  // Construção do array 'filters'
  var filters = [];
  if (andCommon) filters.push(andCommon);

  // Parâmetros da query
  var limit = parameters.limit || 30;
  var sort_order = parameters.sort_order || -1;
  var sort_field = parameters.sort_field || "_created_date";
  var return_fields = parameters.return_fields || "";

  // Normalização do return_fields:
  // - converte ',' para ';'
  // - remove prefixo "fields." de cada campo
  if (typeof return_fields === "string" && return_fields.length > 0) {
    var parts = return_fields.indexOf(",") !== -1 ? return_fields.split(",") : return_fields.split(";");
    return_fields = parts
      .map(function (s) {
        return String(s || "")
          .trim()
          .replace(/^fields./, "");
      })
      .filter(function (s) {
        return s.length > 0;
      })
      .join(";");
  }

  var query = {
    skip: 0,
    limit: limit,
    sort_order: sort_order,
    sort_field: sort_field,
    filters: filters,
    return_fields: return_fields,
    relations: false
  };

  addLog("Built query: " + safeStr(JSON.stringify(query), 2000), "INFO");

  // ============================================
  // CASE FALLBACK - Qualquer atributo, qualquer operador
  // ============================================

  // Gera variações de case para um valor
  function getCaseVariations(val) {
    if (!val || typeof val !== "string") return [val];

    // Se for numérico, não variar
    if (!isNaN(val)) return [val];

    var variations = [];
    var seen = {};

    // 1. Original (como veio)
    if (!seen[val]) {
      variations.push(val);
      seen[val] = 1;
    }

    // 2. UPPERCASE
    var upper = val.toUpperCase();
    if (!seen[upper]) {
      variations.push(upper);
      seen[upper] = 1;
    }

    // 3. lowercase
    var lower = val.toLowerCase();
    if (!seen[lower]) {
      variations.push(lower);
      seen[lower] = 1;
    }

    // 4. Title Case
    var title = val.toLowerCase().replace(/\b\w/g, function (c) {
      return c.toUpperCase();
    });
    if (!seen[title]) {
      variations.push(title);
      seen[title] = 1;
    }

    return variations;
  }

  // ============================================
  // ATTRIBUTE ALTERNATIVES MAP
  // ============================================
  var ATTRIBUTE_ALTERNATIVES = {
    manufacturer: ["vendor", "type", "brand", "model", "fabricante"],
    vendor: ["manufacturer", "type", "brand", "model", "fabricante"],
    brand: ["manufacturer", "vendor", "type", "model"],
    model: ["type", "manufacturer", "vendor"],
    location: ["site", "datacenter", "room", "local"],
    datacenter: ["location", "site", "room"],
    site: ["location", "datacenter", "trigram"],
    owner: ["responsible", "team", "group", "responsavel"],
    responsible: ["owner", "team", "group"],
    team: ["owner", "responsible", "group"],
    type: ["model", "manufacturer", "vendor", "tipo"],
    name: ["ci_name", "hostname", "label"],
    hostname: ["ci_name", "name", "label"],
    ip: ["ip_address", "management_ip", "service_ip"],
    ip_address: ["ip", "management_ip", "service_ip"]
  };

  // Obtém atributos alternativos para um atributo
  function getAlternativeAttributes(attrName) {
    if (!attrName) return [];
    var key = attrName.toLowerCase();
    return ATTRIBUTE_ALTERNATIVES[key] || [];
  }

  // Todos os operadores com valor (exclui exists/nexists)
  var VALUE_OPERATORS = ["~eq~", "~neq~", "~like~", "~gt~", "~gte~", "~lt~", "~lte~"];

  // Extrai atributo/operador/valor de um token
  function parseFilterToken(tok) {
    if (!tok) return null;

    var idx = tok.indexOf("=");
    if (idx <= 0) return null;

    var key = tok
      .substring(0, idx)
      .trim()
      .replace(/^fields\./, "");
    var rest = tok.substring(idx + 1);

    // Encontrar qual operador está a ser usado
    for (var i = 0; i < VALUE_OPERATORS.length; i++) {
      var op = VALUE_OPERATORS[i];
      if (rest.indexOf(op) === 0) {
        var val = rest.substring(op.length);
        return { key: key, operator: op, value: val };
      }
    }

    // Sem operador reconhecido (valor direto)
    return { key: key, operator: "", value: rest };
  }

  // Extrai TODOS os atributos elegíveis para fallback
  function extractFallbackCandidates(filterStr) {
    var candidates = [];
    if (!filterStr) return candidates;

    var tokens = filterStr.split("&");
    for (var i = 0; i < tokens.length; i++) {
      var parsed = parseFilterToken(tokens[i]);
      if (!parsed) continue;

      // Ignorar atributos de controlo/enum
      var keyLower = parsed.key.toLowerCase();
      if (keyLower === "status" || keyLower === "ci_classification") continue;

      // Ignorar valores numéricos puros
      if (!isNaN(parsed.value)) continue;

      // Ignorar valores vazios
      if (!parsed.value || parsed.value.trim() === "") continue;

      candidates.push({
        key: parsed.key,
        operator: parsed.operator,
        value: parsed.value,
        idx: i
      });
    }
    return candidates;
  }

  // ============================================
  // EXECUÇÃO COM FALLBACK COMPLETO
  // Fase 1: Original
  // Fase 2: Case variations no atributo original
  // Fase 3: Atributos alternativos + case variations
  // ============================================
  function executeWithFullFallback(queryObj, tkt, logFn) {
    var originalFilters = queryObj.filters.slice();
    var attempts = [];

    // === FASE 1: Filtros originais ===
    attempts.push({ filters: originalFilters, description: "original", phase: 1 });

    // Identificar candidatos a fallback em todos os filtros
    var candidates = [];
    for (var f = 0; f < originalFilters.length; f++) {
      var cands = extractFallbackCandidates(originalFilters[f]);
      for (var c = 0; c < cands.length; c++) {
        cands[c].filterIdx = f;
        candidates.push(cands[c]);
      }
    }

    // === FASE 2: Case variations no atributo original ===
    if (candidates.length > 0) {
      for (var ci = 0; ci < candidates.length; ci++) {
        var cand = candidates[ci];
        var origFilter = originalFilters[cand.filterIdx];
        var tokens = origFilter.split("&");

        var variations = getCaseVariations(cand.value);

        // Adicionar tentativas para cada variação (skip original, já está)
        for (var v = 1; v < variations.length; v++) {
          var newToken = cand.key + "=" + cand.operator + variations[v];
          var newTokens = tokens.slice();
          newTokens[cand.idx] = newToken;
          var newFilter = newTokens.join("&");
          var newFilters = originalFilters.slice();
          newFilters[cand.filterIdx] = newFilter;

          // Descrição para logging
          var desc = cand.key + "=" + variations[v];

          // Evitar duplicados
          var isDup = false;
          for (var d = 0; d < attempts.length; d++) {
            if (attempts[d].description === desc) {
              isDup = true;
              break;
            }
          }
          if (!isDup) {
            attempts.push({ filters: newFilters, description: desc, phase: 2 });
          }
        }
      }
    }

    // === FASE 3: Atributos alternativos + case variations ===
    if (candidates.length > 0) {
      for (var ci2 = 0; ci2 < candidates.length; ci2++) {
        var cand2 = candidates[ci2];
        var alternatives = getAlternativeAttributes(cand2.key);

        if (alternatives.length === 0) continue;

        var origFilter2 = originalFilters[cand2.filterIdx];
        var tokens2 = origFilter2.split("&");
        var allValueVariations = getCaseVariations(cand2.value);

        // Para cada atributo alternativo
        for (var ai = 0; ai < alternatives.length; ai++) {
          var altAttr = alternatives[ai];

          // Para cada variação de case do valor
          for (var vi = 0; vi < allValueVariations.length; vi++) {
            var altToken = altAttr + "=" + cand2.operator + allValueVariations[vi];
            var altTokens = tokens2.slice();
            altTokens[cand2.idx] = altToken;
            var altFilter = altTokens.join("&");
            var altFilters = originalFilters.slice();
            altFilters[cand2.filterIdx] = altFilter;

            var altDesc = altAttr + "=" + allValueVariations[vi] + " (alt for " + cand2.key + ")";

            // Evitar duplicados
            var isAltDup = false;
            for (var ad = 0; ad < attempts.length; ad++) {
              if (attempts[ad].filters[0] === altFilters[0]) {
                isAltDup = true;
                break;
              }
            }
            if (!isAltDup) {
              attempts.push({ filters: altFilters, description: altDesc, phase: 3 });
            }
          }
        }
      }
    }

    logFn("Total attempts to try: " + attempts.length + " (Phase 1: original, Phase 2: case, Phase 3: alternative attrs)", "INFO");

    // Executar tentativas até encontrar resultados
    for (var a = 0; a < attempts.length; a++) {
      queryObj.filters = attempts[a].filters;

      logFn("Attempt " + (a + 1) + "/" + attempts.length + " [Phase " + attempts[a].phase + "] (" + attempts[a].description + ")", "INFO");

      var runTkt = ModuleUtils.runFunction("/masterdb/ci/search", tkt.getRequestContext(), JSON.stringify(queryObj));

      if (ModuleUtils.waitForTicketsSuccess(runTkt)) {
        try {
          var rawObj = String(runTkt.getResult().getObject());
          var parsedResult = JSON.parse(rawObj);
          var resultCount = parsedResult && parsedResult.data_output && parsedResult.data_output.result_count;

          if (resultCount > 0) {
            var resultFullCount = parsedResult && parsedResult.data_output && parsedResult.data_output.result_full_count;
            logFn("SUCCESS [Phase " + attempts[a].phase + "]: Found " + resultCount + " of " + (resultFullCount || resultCount) + " total with: " + attempts[a].description, "INFO");
            return {
              success: true,
              parsed: parsedResult,
              attemptUsed: attempts[a].description,
              phaseUsed: attempts[a].phase,
              totalAttempts: a + 1,
              resultFullCount: resultFullCount || resultCount
            };
          }

          logFn("No results with: " + attempts[a].description, "DEBUG");
        } catch (parseEx) {
          logFn("Parse error on attempt " + (a + 1) + ": " + parseEx, "WARN");
        }
      } else {
        logFn("Request failed on attempt " + (a + 1), "WARN");
      }
    }

    // Nenhuma tentativa teve sucesso
    logFn("All " + attempts.length + " attempts returned 0 results (Phases 1-3)", "WARN");
    return {
      success: false,
      parsed: null,
      attemptUsed: null,
      phaseUsed: null,
      totalAttempts: attempts.length
    };
  }

  // ============================================
  // SUGGESTIONS - Quando 0 resultados, sugere valores similares
  // ============================================

  // Busca valores similares usando distinct + like
  function getSuggestionsForAttribute(attrName, searchValue, ciClass, tkt, logFn) {
    if (!attrName || !searchValue) return [];

    // Extrair parte do valor para pesquisa fuzzy (primeiros 3-4 caracteres)
    var fuzzyPattern = String(searchValue).substring(0, Math.min(4, searchValue.length));

    var suggestionFilters = [];
    var filterParts = [];

    // Filtro por classification se disponível
    if (ciClass) {
      filterParts.push("ci_classification=~eq~" + ciClass);
    }

    // Filtro ~like~ no atributo
    filterParts.push(attrName + "=~like~" + fuzzyPattern);

    if (filterParts.length > 0) {
      suggestionFilters.push(filterParts.join("&"));
    }

    var suggestionQuery = {
      skip: 0,
      limit: 20,
      sort_order: 1,
      sort_field: attrName,
      filters: suggestionFilters,
      return_fields: attrName,
      relations: false,
      distinct: true
    };

    logFn("Fetching suggestions for " + attrName + " with pattern '" + fuzzyPattern + "'", "DEBUG");

    var sugTkt = ModuleUtils.runFunction("/masterdb/ci/search", tkt.getRequestContext(), JSON.stringify(suggestionQuery));

    if (ModuleUtils.waitForTicketsSuccess(sugTkt)) {
      try {
        var rawSug = String(sugTkt.getResult().getObject());
        var parsedSug = JSON.parse(rawSug);
        var sugResults = parsedSug && parsedSug.data_output && Array.isArray(parsedSug.data_output.result) ? parsedSug.data_output.result : [];

        // Extrair valores únicos não vazios
        var suggestions = [];
        for (var s = 0; s < sugResults.length && suggestions.length < 10; s++) {
          var val = sugResults[s][attrName];
          if (val && String(val).trim() !== "" && String(val).trim() !== "null") {
            suggestions.push(String(val));
          }
        }

        logFn("Found " + suggestions.length + " suggestions for " + attrName, "DEBUG");
        return suggestions;
      } catch (e) {
        logFn("Error parsing suggestions: " + e, "WARN");
        return [];
      }
    }
    return [];
  }

  // Recolhe sugestões para todos os atributos que podem estar errados
  function collectSuggestions(originalFilters, ciClass, tkt, logFn) {
    var allSuggestions = {};

    if (!originalFilters || originalFilters.length === 0) return allSuggestions;

    for (var f = 0; f < originalFilters.length; f++) {
      var tokens = originalFilters[f].split("&");

      for (var t = 0; t < tokens.length; t++) {
        var parsed = parseFilterToken(tokens[t]);
        if (!parsed) continue;

        var keyLower = parsed.key.toLowerCase();
        // Ignorar atributos de controlo/enum e valores numéricos
        if (keyLower === "status" || keyLower === "ci_classification") continue;
        if (!isNaN(parsed.value)) continue;
        if (!parsed.value || parsed.value.trim() === "") continue;

        // Buscar sugestões para este atributo
        var suggestions = getSuggestionsForAttribute(parsed.key, parsed.value, ciClass, tkt, logFn);
        if (suggestions.length > 0) {
          allSuggestions[parsed.key] = {
            searched_value: parsed.value,
            similar_values: suggestions
          };
        }
      }
    }

    return allSuggestions;
  }

  // --- Execução com Full Fallback (case + alternative attributes) ---
  var fallbackResult = executeWithFullFallback(query, ticket, addLog);

  if (fallbackResult.success) {
    results.content = fallbackResult.parsed.data_output;
    var returnedCount = results.content.result_count || 0;
    var fullCount = fallbackResult.resultFullCount || results.content.result_full_count || returnedCount;

    results.meta = {
      fallback_used: fallbackResult.phaseUsed > 1,
      phase_used: fallbackResult.phaseUsed,
      phase_description: fallbackResult.phaseUsed === 1 ? "original" : fallbackResult.phaseUsed === 2 ? "case_variation" : "alternative_attribute",
      variation_used: fallbackResult.attemptUsed,
      total_attempts: fallbackResult.totalAttempts,
      result_full_count: fullCount,
      has_more: fullCount > returnedCount
    };

    addLog("Executed /masterdb/ci/search OK. result_count=" + returnedCount + " of " + fullCount + " total" + (fullCount > returnedCount ? " (use higher limit to see all)" : ""), "INFO");
    setResponse(ticket, response, "OK", JSON.stringify(results), 0, TheSysModuleFunctionResult.RESULT_OK, "200");
    return;
  } else {
    // Retorna resultado vazio com sugestões
    addLog("No results found. Collecting suggestions...", "INFO");

    // Extrair ci_classification dos filtros para contexto
    var ciClassForSuggestions = null;
    for (var fi = 0; fi < query.filters.length; fi++) {
      var match = query.filters[fi].match(/ci_classification=~?(?:eq~)?([^&]+)/i);
      if (match) {
        ciClassForSuggestions = match[1];
        break;
      }
    }

    var suggestions = collectSuggestions(query.filters, ciClassForSuggestions, ticket, addLog);
    var hasSuggestions = Object.keys(suggestions).length > 0;

    results.content = { result_count: 0, items: [] };
    results.meta = {
      fallback_used: true,
      phase_used: 4,
      phase_description: "all_failed_suggestions_provided",
      variation_used: null,
      total_attempts: fallbackResult.totalAttempts
    };

    // Adicionar sugestões se existirem
    if (hasSuggestions) {
      results.suggestions = suggestions;
      addLog("Suggestions collected for " + Object.keys(suggestions).length + " attribute(s)", "INFO");
    } else {
      addLog("No similar values found for suggestions", "INFO");
    }

    setResponse(ticket, response, "OK", JSON.stringify(results), 0, TheSysModuleFunctionResult.RESULT_OK, "200");
    return;
  }
}

function aiToolsMasterDBGeoSearch(ticket, params) {
  // Helpers
  function safeStr(v, max) {
    try {
      var s = String(v === null ? "" : v);
      return max && s.length > max ? s.substring(0, max) + "...[truncated]" : s;
    } catch (e) {
      return "[unavailable]";
    }
  }
  function removeDiacritics(str) {
    if (str === null || str === undefined) return "";
    var s = String(str);
    var map = {};
    map["\u00C1"] = "A"; // Á
    map["\u00C0"] = "A"; // À
    map["\u00C3"] = "A"; // Ã
    map["\u00C2"] = "A"; // Â
    map["\u00C4"] = "A"; // Ä
    map["\u00E1"] = "a"; // á
    map["\u00E0"] = "a"; // à
    map["\u00E3"] = "a"; // ã
    map["\u00E2"] = "a"; // â
    map["\u00E4"] = "a"; // ä
    map["\u00C9"] = "E"; // É
    map["\u00C8"] = "E"; // È
    map["\u00CA"] = "E"; // Ê
    map["\u00CB"] = "E"; // Ë
    map["\u00E9"] = "e"; // é
    map["\u00E8"] = "e"; // è
    map["\u00EA"] = "e"; // ê
    map["\u00EB"] = "e"; // ë
    map["\u00CD"] = "I"; // Í
    map["\u00CC"] = "I"; // Ì
    map["\u00CE"] = "I"; // Î
    map["\u00CF"] = "I"; // Ï
    map["\u00ED"] = "i"; // í
    map["\u00EC"] = "i"; // ì
    map["\u00EE"] = "i"; // î
    map["\u00EF"] = "i"; // ï
    map["\u00D3"] = "O"; // Ó
    map["\u00D2"] = "O"; // Ò
    map["\u00D5"] = "O"; // Õ
    map["\u00D4"] = "O"; // Ô
    map["\u00D6"] = "O"; // Ö
    map["\u00F3"] = "o"; // ó
    map["\u00F2"] = "o"; // ò
    map["\u00F5"] = "o"; // õ
    map["\u00F4"] = "o"; // ô
    map["\u00F6"] = "o"; // ö
    map["\u00DA"] = "U"; // Ú
    map["\u00D9"] = "U"; // Ù
    map["\u00DB"] = "U"; // Û
    map["\u00DC"] = "U"; // Ü
    map["\u00FA"] = "u"; // ú
    map["\u00F9"] = "u"; // ù
    map["\u00FB"] = "u"; // û
    map["\u00FC"] = "u"; // ü
    map["\u00C7"] = "C"; // Ç
    map["\u00E7"] = "c"; // ç

    var result = "";
    for (var i = 0; i < s.length; i++) {
      var char = s.charAt(i);
      result += map[char] || char;
    }
    return result;
  }
  function upperNoAccents(str) {
    return removeDiacritics(String(str || ""))
      .trim()
      .toUpperCase();
  }
  function roundCoord(v, precision) {
    if (v === undefined || v === null || isNaN(Number(v))) return null;
    var p = Math.max(0, Math.min(10, Number(precision || 3)));
    var f = Math.pow(10, p);
    return Math.round(Number(v) * f) / f;
  }
  function derivePrecisionFromRadius(rm) {
    var r = Number(rm || 1000);
    if (r <= 200) return 4;
    if (r <= 1000) return 3;
    if (r <= 5000) return 2;
    return 1;
  }
  function push(andArr, k, v) {
    if (!k) return;
    if (v === undefined || v === null || v === "") return;
    if (Array.isArray(v)) {
      if (v.length > 0) andArr.push(k + "=" + v.join(","));
    } else andArr.push(k + "=" + v);
  }
  function normalizeReturnFields(rf) {
    if (!rf) return "";
    var s = String(rf).trim();
    return s.indexOf(",") !== -1
      ? s
          .split(",")
          .map(function (x) {
            return x.trim();
          })
          .join(";")
      : s;
  }
  function safeTryGet(t) {
    try {
      return String(t.getResult().getObject() || t.getOutput() || "");
    } catch (e) {
      return "";
    }
  }
  function runSearch(queryObj) {
    var t = ModuleUtils.runFunction("/masterdb/ci/search", ticket.getRequestContext(), JSON.stringify(queryObj));
    if (!ModuleUtils.waitForTicketsSuccess(t))
      return {
        ok: false,
        raw: safeTryGet(t)
      };
    try {
      var raw = String(t.getResult().getObject());
      var parsed = JSON.parse(raw);
      var arr = parsed && parsed.data_output && Array.isArray(parsed.data_output.result) ? parsed.data_output.result : [];
      var full = parsed && parsed.data_output && typeof parsed.data_output.result_full_count === "number" ? parsed.data_output.result_full_count : null;
      return {
        ok: true,
        parsed: parsed,
        arr: arr,
        full: full,
        raw: raw
      };
    } catch (e) {
      return {
        ok: false,
        raw: "parse_error:" + e
      };
    }
  }
  // Paginated search — fetches ALL pages up to maxItems (default 2000)
  function runSearchAll(queryTemplate, maxItems) {
    var pageSize = 100;
    var cap = Number(maxItems || 2000);
    var allArr = [];
    var skip = 0;
    var knownTotal = null;
    while (true) {
      var q = {
        skip: skip,
        limit: pageSize,
        sort_order: queryTemplate.sort_order,
        sort_field: queryTemplate.sort_field,
        filters: queryTemplate.filters,
        return_fields: queryTemplate.return_fields,
        relations: queryTemplate.relations
      };
      var res = runSearch(q);
      if (!res.ok) return { ok: false, arr: allArr, full: knownTotal, raw: res.raw };
      if (knownTotal === null && res.full !== null) knownTotal = res.full;
      if (res.arr.length > 0) allArr = allArr.concat(res.arr);
      skip += res.arr.length;
      if (res.arr.length < pageSize) break;
      if (knownTotal !== null && allArr.length >= knownTotal) break;
      if (allArr.length >= cap) break;
    }
    return { ok: true, arr: allArr, full: knownTotal !== null ? knownTotal : allArr.length };
  }
  function runFind(filterStr) {
    var t = ModuleUtils.runFunction("/masterdb/ci/find", ticket.getRequestContext(), filterStr);
    if (!ModuleUtils.waitForTicketsSuccess(t))
      return {
        ok: false,
        raw: safeTryGet(t)
      };
    try {
      var raw = String(t.getResult().getObject());
      var parsed = JSON.parse(raw);
      var arr = parsed && parsed.data_output && Array.isArray(parsed.data_output.result) ? parsed.data_output.result : [];
      return {
        ok: true,
        parsed: parsed,
        arr: arr,
        raw: raw
      };
    } catch (e) {
      return {
        ok: false,
        raw: "parse_error:" + e
      };
    }
  }

  // Envelope simples
  var response = "";
  var results = {
    content: null,
    logs: []
  };

  // Utilitário de finalização simples
  function finish(ok, code) {
    // Se ModuleUtils não devolver envelope válido, devolve diretamente results
    try {
      response = ModuleUtils.setResponse(response, ok ? TheSysModuleFunctionResult.RESULT_OK : TheSysModuleFunctionResult.RESULT_NOK, code || (ok ? "OK" : "NOK")) || response;
    } catch (e) {}
    try {
      response = ModuleUtils.setOutput(response, 11, JSON.stringify(results)) || response;
    } catch (e) {}
    ticket.getResult().setObject(response && String(response).charAt(0) === "{" ? response : JSON.stringify(results));
    ticket.getResult().setResult(ok ? TheSysModuleFunctionResult.RESULT_OK : TheSysModuleFunctionResult.RESULT_NOK);
  }

  // Parse params
  var p = {};
  try {
    p = JSON.parse(params && params.size && params.size() > 0 ? params.get(0) || "{}" : "{}");
  } catch (e) {
    results.logs.push(
      JSON.stringify({
        error: "MALFORMED_PARAMS",
        detail: safeStr(e, 400),
        raw: safeStr(params && params.get ? params.get(0) : "", 400)
      })
    );
    return finish(false, "MALFORMED_PARAMS");
  }
  // Log dos parâmetros brutos
  results.logs.push(
    JSON.stringify({
      parameters: p
    })
  );

  // Defaults e controlos
  var statusAll = String(p.status || "").toUpperCase() === "ALL";
  var statusVal = statusAll ? null : p.status ? String(p.status) : "~eq~Deployed";
  var limit = Number(p.limit || 30);
  var sort_order = p.sort_order === 1 || p.sort_order === -1 ? p.sort_order : -1;
  var sort_field = String(p.sort_field || "_created_date");
  var return_fields = normalizeReturnFields(p.return_fields || "");

  // Precisão/raio (base-1 para alargar por defeito)
  var basePrecision = derivePrecisionFromRadius(p.radius_meters);
  var coordPrecision = p.coordinate_precision !== undefined && p.coordinate_precision !== null ? Number(p.coordinate_precision) : Math.max(0, basePrecision - 1);

  // Domínio e inputs
  var targetClass = p.ci_classification ? String(p.ci_classification).trim() : "";
  var siteType = p.site_type ? String(p.site_type).trim() : "";
  var ciName = p.ci_name ? String(p.ci_name).trim() : "";

  var district = p.district ? String(p.district).trim() : "";
  var concelhoIn = p.concelho || p.municipality || p.county_name ? String(p.concelho || p.municipality || p.county_name).trim() : "";
  var street = p.street ? String(p.street).trim() : "";
  var number = p.number ? String(p.number).trim() : "";
  var postal_code = p.postal_code ? String(p.postal_code).trim() : "";
  var freguesia = p.freguesia ? String(p.freguesia).trim() : "";
  var country = p.country ? String(p.country).trim() : "";
  var addressFree = p.address ? String(p.address).trim() : "";

  var hasCoords = p.latitude !== undefined && p.latitude !== null && p.longitude !== undefined && p.longitude !== null;
  var latNum = hasCoords ? Number(p.latitude) : null;
  var lonNum = hasCoords ? Number(p.longitude) : null;
  if (hasCoords && (isNaN(latNum) || isNaN(lonNum))) {
    results.logs.push(
      JSON.stringify({
        error: "INVALID_COORDS",
        message: "Latitude/Longitude inválidas. Envie valores numéricos."
      })
    );
    return finish(false, "INVALID_COORDS");
  }
  var latR = hasCoords ? roundCoord(latNum, coordPrecision) : null;
  var lonR = hasCoords ? roundCoord(lonNum, coordPrecision) : null;

  var trigram = "";
  if (p.trigram) trigram = String(p.trigram).trim().substring(0, 3).toUpperCase();
  else if (p.site) trigram = String(p.site).trim().substring(0, 3).toUpperCase();

  function resolveCountyTrigramFromConcelho(conc) {
    var concOriginal = String(conc).trim().toUpperCase();
    var concNormalized = upperNoAccents(conc);

    var filter = "ci_classification=~eq~COUNTY&ci_description=~eq~" + encodeURIComponent(concOriginal) + "&_limit=1";
    var f = runFind(filter);

    if (!f.ok || !Array.isArray(f.arr) || f.arr.length === 0) {
      filter = "ci_classification=~eq~COUNTY&ci_description=~eq~" + encodeURIComponent(concNormalized) + "&_limit=1";
      f = runFind(filter);
      if (!f.ok)
        return {
          ok: false,
          reason: "find_county_failed",
          raw: f.raw
        };
      if (!Array.isArray(f.arr) || f.arr.length === 0)
        return {
          ok: false,
          reason: "county_not_found"
        };
    }

    var trig = String(f.arr[0].ci_name || "").trim();
    return trig
      ? {
          ok: true,
          trigram: trig
        }
      : {
          ok: false,
          reason: "county_trigram_missing"
        };
  }

  function resolveTrigramsFromDistrict(dist) {
    var distOriginal = String(dist).trim().toUpperCase();
    var distNormalized = upperNoAccents(dist);

    var filter = "ci_classification=~eq~COUNTY&state=~eq~" + encodeURIComponent(distOriginal) + "&status=~eq~Deployed";
    var f = runFind(filter);

    if (!f.ok || !Array.isArray(f.arr) || f.arr.length === 0) {
      filter = "ci_classification=~eq~COUNTY&state=~eq~" + encodeURIComponent(distNormalized) + "&status=~eq~Deployed";
      f = runFind(filter);
      if (!f.ok)
        return {
          ok: false,
          reason: "find_district_counties_failed",
          raw: f.raw
        };
      if (!Array.isArray(f.arr) || f.arr.length === 0)
        return {
          ok: false,
          reason: "district_counties_not_found"
        };
    }

    var trigrams = [];
    for (var i = 0; i < f.arr.length; i++) {
      var trig = String(f.arr[i].ci_name || "").trim();
      if (trig && trig.length >= 2) {
        trigrams.push(trig);
      }
    }
    return trigrams.length > 0
      ? {
          ok: true,
          trigrams: trigrams,
          count: trigrams.length
        }
      : {
          ok: false,
          reason: "no_valid_trigrams_in_district"
        };
  }

  function makeQueryFromFilters(andParts) {
    var filters = [];
    var andStr = andParts.join("&");
    if (andStr) filters.push(andStr);
    return {
      skip: 0,
      limit: limit,
      sort_order: sort_order,
      sort_field: sort_field,
      filters: filters,
      return_fields: return_fields,
      relations: false
    };
  }

  var executed = [];
  var strategy = "";

  // Title-case helper
  function toTitleCase(str) {
    return removeDiacritics(String(str || ""))
      .toLowerCase()
      .replace(/(?:^|\s)\S/g, function (c) {
        return c.toUpperCase();
      });
  }

  // Deduplicate CIs by ci_name
  function deduplicateByName(arr) {
    var seen = {};
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var key = String(arr[i].ci_name || "__idx__" + i);
      if (!seen[key]) {
        seen[key] = true;
        out.push(arr[i]);
      }
    }
    return out;
  }

  // Build non-text base parts for TECHNICAL_ROOM (status, classification, siteType, postal_code, number, coords)
  function buildBaseTRParts() {
    var base = [];
    if (!statusAll) push(base, "status", statusVal);
    push(base, "ci_classification", "TECHNICAL_ROOM");
    if (siteType) push(base, "access_info.site_type", siteType);
    if (number) push(base, "location_details.address.number", "~like~" + number);
    if (postal_code) push(base, "location_details.address.postal_code", "~like~" + postal_code);
    if (hasCoords && latR !== null && lonR !== null) {
      push(base, "location_details.coordinates.latitude", "~like~" + String(latR));
      push(base, "location_details.coordinates.longitude", "~like~" + String(lonR));
    }
    return base;
  }

  // 1) TECHNICAL_ROOM
  if (targetClass === "TECHNICAL_ROOM") {
    // Text address fields — case variants applied to these
    var textFields = [];
    if (district) textFields.push({ key: "location_details.address.district", val: district });
    if (concelhoIn) textFields.push({ key: "location_details.address.concelho", val: concelhoIn });
    if (street) textFields.push({ key: "location_details.address.street", val: street });
    else if (addressFree) textFields.push({ key: "location_details.address.street", val: addressFree });
    if (freguesia) textFields.push({ key: "location_details.address.freguesia", val: freguesia });
    if (country) textFields.push({ key: "location_details.address.country", val: country });

    // Fast-path: ci_name provided — direct lookup, no geographic resolution needed
    if (ciName) {
      var andCiName = buildBaseTRParts();
      push(andCiName, "ci_name", "~eq~" + ciName);
      var qCiName = makeQueryFromFilters(andCiName);
      executed.push({ stage: "TR_CI_NAME_DIRECT", query: qCiName });
      var resCiName = runSearchAll(qCiName);
      if (!resCiName.ok) {
        results.logs.push(JSON.stringify({ error: "BACKEND_ERROR", stage: "TR_CI_NAME_DIRECT", detail: resCiName.raw }));
        return finish(false, "BACKEND_ERROR");
      }
      var ciNameItems = deduplicateByName(resCiName.arr);

      // TECHNICAL_ROOM CIs typically don't carry `location` directly.
      // Resolve it via a secondary lookup: find any CI with site=~eq~{ciName}
      // and extract its `location` — that's the location identifier for this room.
      var resolvedLocation = ciNameItems.length > 0 && ciNameItems[0].location ? String(ciNameItems[0].location).trim() : null;
      if (!resolvedLocation) {
        var andLocLookup = [];
        push(andLocLookup, "status", "~eq~Deployed");
        push(andLocLookup, "site", "~eq~" + ciName);
        var qLocLookup = {
          skip: 0,
          limit: 1,
          sort_order: -1,
          sort_field: "_created_date",
          filters: [andLocLookup.join("&")],
          return_fields: "location;ci_name;ci_classification",
          relations: false
        };
        executed.push({ stage: "TR_LOCATION_VIA_SITE", query: qLocLookup });
        var resLocLookup = runSearch(qLocLookup);
        if (resLocLookup.ok && resLocLookup.arr && resLocLookup.arr.length > 0 && resLocLookup.arr[0].location) {
          resolvedLocation = String(resLocLookup.arr[0].location).trim();
          results.logs.push(JSON.stringify({ stage: "TR_LOCATION_VIA_SITE", resolved: resolvedLocation, via_ci: resLocLookup.arr[0].ci_name, via_classification: resLocLookup.arr[0].ci_classification }));
        } else {
          results.logs.push(JSON.stringify({ stage: "TR_LOCATION_VIA_SITE", resolved: null, note: "no deployed CI found with site=" + ciName }));
        }
      }

      results.content = {
        result: ciNameItems,
        result_count: ciNameItems.length,
        result_dedup_count: ciNameItems.length,
        result_full_count: resCiName.full || ciNameItems.length,
        location: resolvedLocation,
        stage_breakdown: [{ stage: "TR_CI_NAME_DIRECT", fetched: ciNameItems.length, full: resCiName.full || ciNameItems.length }]
      };
      results.logs.push(JSON.stringify({ strategy: "ci_name_direct", returned: ciNameItems.length, location: resolvedLocation, queries: executed }));
      return finish(true, "OK");
    }

    var hasAnyInput = textFields.length > 0 || siteType || postal_code || number || hasCoords;
    if (!hasAnyInput) {
      results.logs.push(JSON.stringify({ error: "MISSING_INPUT", message: "TECHNICAL_ROOM requer district/concelho/street/address ou coordenadas/site_type." }));
      return finish(false, "MISSING_INPUT");
    }

    // If no text fields (coords/siteType/postal_code/number only) → direct search only
    if (textFields.length === 0) {
      var andDirect = buildBaseTRParts();
      var qDirect = makeQueryFromFilters(andDirect);
      executed.push({ stage: "TR_DIRECT", query: qDirect, precision: coordPrecision });
      var resDirect = runSearch(qDirect);
      if (!resDirect.ok) {
        results.logs.push(JSON.stringify({ error: "BACKEND_ERROR", stage: "TR_DIRECT", detail: resDirect.raw }));
        return finish(false, "BACKEND_ERROR");
      }
      strategy = "direct";
      results.content = resDirect.parsed ? resDirect.parsed.data_output : null;
      results.logs.push(JSON.stringify({ strategy: strategy, queries: executed }));
      return finish(true, "OK");
    }

    var allTRItems = [];
    var stageSummary = {};

    // Strategy A: run ALL 4 case variants, always — collect all results
    var caseVariantsList = [
      {
        name: "original",
        fn: function (v) {
          return v;
        }
      },
      {
        name: "upper",
        fn: function (v) {
          return upperNoAccents(v);
        }
      },
      {
        name: "lower",
        fn: function (v) {
          return removeDiacritics(String(v || "")).toLowerCase();
        }
      },
      {
        name: "title",
        fn: function (v) {
          return toTitleCase(v);
        }
      }
    ];

    for (var vi = 0; vi < caseVariantsList.length; vi++) {
      var variant = caseVariantsList[vi];
      var andTRv = buildBaseTRParts();
      for (var fi = 0; fi < textFields.length; fi++) {
        push(andTRv, textFields[fi].key, "~like~" + variant.fn(textFields[fi].val));
      }
      var qTRv = makeQueryFromFilters(andTRv);
      var stageNameA = "TR_ADDRESS_" + variant.name.toUpperCase();
      executed.push({ stage: stageNameA, query: qTRv, variant: variant.name });
      var resTRv = runSearchAll(qTRv);
      if (!resTRv.ok) {
        results.logs.push(JSON.stringify({ warning: "SEARCH_FAILED", stage: stageNameA, detail: resTRv.raw }));
        stageSummary[stageNameA] = { ok: false };
        continue;
      }
      stageSummary[stageNameA] = { ok: true, fetched: resTRv.arr.length, full: resTRv.full };
      results.logs.push(JSON.stringify({ stage: stageNameA, fetched: resTRv.arr.length, full: resTRv.full }));
      if (resTRv.arr.length > 0) allTRItems = allTRItems.concat(resTRv.arr);
    }

    // Strategy B: trigram via concelho (always, if concelhoIn given) — filter by ci_name
    if (concelhoIn) {
      var rConc = resolveCountyTrigramFromConcelho(concelhoIn);
      if (rConc.ok) {
        var andTrigramC = buildBaseTRParts();
        push(andTrigramC, "ci_name", "~like~" + rConc.trigram);
        var qTrigramC = makeQueryFromFilters(andTrigramC);
        executed.push({ stage: "TR_TRIGRAM_CONCELHO", query: qTrigramC, trigram: rConc.trigram, concelho: concelhoIn });
        var resTrigramC = runSearchAll(qTrigramC);
        if (!resTrigramC.ok) {
          results.logs.push(JSON.stringify({ warning: "SEARCH_FAILED", stage: "TR_TRIGRAM_CONCELHO", detail: resTrigramC.raw }));
          stageSummary["TR_TRIGRAM_CONCELHO"] = { ok: false };
        } else {
          stageSummary["TR_TRIGRAM_CONCELHO"] = { ok: true, trigram: rConc.trigram, fetched: resTrigramC.arr.length, full: resTrigramC.full };
          results.logs.push(JSON.stringify({ stage: "TR_TRIGRAM_CONCELHO", trigram: rConc.trigram, fetched: resTrigramC.arr.length, full: resTrigramC.full }));
          if (resTrigramC.arr.length > 0) allTRItems = allTRItems.concat(resTrigramC.arr);
        }
      } else {
        results.logs.push(JSON.stringify({ warning: "TRIGRAM_CONCELHO_RESOLUTION_FAILED", reason: rConc.reason }));
        stageSummary["TR_TRIGRAM_CONCELHO"] = { ok: false, reason: rConc.reason };
      }
    }

    // Strategy C: trigrams via district (always, if district given) — filter by ci_name
    if (district) {
      var rDistTR = resolveTrigramsFromDistrict(district);
      if (rDistTR.ok) {
        stageSummary["TR_TRIGRAM_DISTRICT"] = { trigrams: rDistTR.trigrams, perTrigram: {} };
        for (var trIdx = 0; trIdx < rDistTR.trigrams.length; trIdx++) {
          var currentTrigTR = rDistTR.trigrams[trIdx];
          var andDistTR = buildBaseTRParts();
          push(andDistTR, "ci_name", "~like~" + currentTrigTR);
          var qDistTR = makeQueryFromFilters(andDistTR);
          executed.push({ stage: "TR_TRIGRAM_DISTRICT_" + trIdx, query: qDistTR, trigram: currentTrigTR });
          var resDistTR = runSearchAll(qDistTR);
          if (!resDistTR.ok) {
            results.logs.push(JSON.stringify({ warning: "TRIGRAM_QUERY_FAILED", trigram: currentTrigTR, detail: resDistTR.raw }));
            stageSummary["TR_TRIGRAM_DISTRICT"].perTrigram[currentTrigTR] = { ok: false };
            continue;
          }
          stageSummary["TR_TRIGRAM_DISTRICT"].perTrigram[currentTrigTR] = { ok: true, fetched: resDistTR.arr.length, full: resDistTR.full };
          results.logs.push(JSON.stringify({ stage: "TR_TRIGRAM_DISTRICT_" + trIdx, trigram: currentTrigTR, fetched: resDistTR.arr.length, full: resDistTR.full }));
          if (resDistTR.arr && resDistTR.arr.length > 0) allTRItems = allTRItems.concat(resDistTR.arr);
        }
      } else {
        results.logs.push(JSON.stringify({ warning: "TRIGRAM_DISTRICT_RESOLUTION_FAILED", reason: rDistTR.reason }));
        stageSummary["TR_TRIGRAM_DISTRICT"] = { ok: false, reason: rDistTR.reason };
      }
    }

    // Merge, deduplicate and cap at 100 for LLM readability
    var mergedTRItems = deduplicateByName(allTRItems);
    var finalTRItems = mergedTRItems.slice(0, 100);

    // Sum full counts across stages + build per-stage breakdown
    var totalTRFullCount = 0;
    var stageBreakdown = [];
    var summaryKeys = Object.keys(stageSummary);
    for (var ski = 0; ski < summaryKeys.length; ski++) {
      var sk = summaryKeys[ski];
      var ss = stageSummary[sk];
      if (ss.perTrigram) {
        // TR_TRIGRAM_DISTRICT: flatten each trigram entry
        var ptKeys = Object.keys(ss.perTrigram);
        for (var ptki = 0; ptki < ptKeys.length; ptki++) {
          var ptk = ptKeys[ptki];
          var ptv = ss.perTrigram[ptk];
          if (ptv.ok) {
            totalTRFullCount += ptv.full || 0;
            stageBreakdown.push({ stage: "TR_TRIGRAM_DISTRICT", trigram: ptk, fetched: ptv.fetched, full: ptv.full });
          }
        }
      } else if (ss.ok) {
        totalTRFullCount += ss.full || 0;
        var bEntry = { stage: sk, fetched: ss.fetched, full: ss.full };
        if (ss.trigram) bEntry.trigram = ss.trigram;
        stageBreakdown.push(bEntry);
      }
    }

    strategy = "merged_all";
    results.content = {
      result: finalTRItems,
      result_count: finalTRItems.length,
      result_dedup_count: mergedTRItems.length,
      result_full_count: totalTRFullCount,
      stage_breakdown: stageBreakdown
    };
    results.logs.push(JSON.stringify({ strategy: strategy, total_before_dedup: allTRItems.length, total_after_dedup: mergedTRItems.length, returned: finalTRItems.length, stage_summary: stageSummary, queries: executed }));
    return finish(true, "OK");
  }

  // 2) Outros CIs
  // 2.1) Coordenadas
  if (hasCoords && latR !== null && lonR !== null) {
    if (!targetClass) {
      results.logs.push(
        JSON.stringify({
          error: "MISSING_INPUT",
          message: "Indique ci_classification para pesquisa por coordenadas."
        })
      );
      return finish(false, "MISSING_INPUT");
    }
    var andC = [];
    if (!statusAll) push(andC, "status", statusVal);
    push(andC, "ci_classification", targetClass);
    push(andC, "location_details.coordinates.latitude", "~like~" + String(latR));
    push(andC, "location_details.coordinates.longitude", "~like~" + String(lonR));
    var qC = makeQueryFromFilters(andC);
    executed.push({
      stage: "BY_COORDINATES",
      query: qC,
      precision: coordPrecision
    });
    var resC = runSearch(qC);
    if (!resC.ok) {
      results.logs.push(
        JSON.stringify({
          error: "BACKEND_ERROR",
          stage: "BY_COORDINATES",
          detail: resC.raw
        })
      );
      return finish(false, "BACKEND_ERROR");
    }
    strategy = "coordinates";
    results.content = resC.parsed ? resC.parsed.data_output : null;
    results.logs.push(
      JSON.stringify({
        strategy: strategy,
        queries: executed
      })
    );
    return finish(true, "OK");
  }

  // 2.2) Concelho → trigrama
  if (concelhoIn) {
    if (!targetClass) {
      results.logs.push(
        JSON.stringify({
          error: "MISSING_INPUT",
          message: "Falta ci_classification para pesquisa por concelho."
        })
      );
      return finish(false, "MISSING_INPUT");
    }
    var r = resolveCountyTrigramFromConcelho(concelhoIn);
    if (!r.ok) {
      results.logs.push(
        JSON.stringify({
          error: "COUNTY_RESOLUTION_FAILED",
          input: concelhoIn,
          reason: r.reason,
          action: "Place name '" + concelhoIn + "' not found in COUNTY registry. Use the full municipality name OR run Method A from skill masterdb_geo: use Find - Attribute Values to discover location values matching '" + concelhoIn + "', then filter CIs by location attribute."
        })
      );
      results.content = null;
      ticket.getResult().setObject(JSON.stringify(results));
      ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_OK);
      return;
    }
    var andT = [];
    if (!statusAll) push(andT, "status", statusVal);
    push(andT, "ci_classification", targetClass);
    push(andT, "site", "~like~" + r.trigram);
    var qT1 = makeQueryFromFilters(andT);
    executed.push({
      stage: "BY_CONCELHO_TRIGRAM",
      trigram: r.trigram,
      concelho: upperNoAccents(concelhoIn),
      query: qT1
    });
    var resT1 = runSearch(qT1);
    if (!resT1.ok) {
      results.logs.push(
        JSON.stringify({
          error: "BACKEND_ERROR",
          stage: "BY_CONCELHO_TRIGRAM",
          detail: resT1.raw
        })
      );
      return finish(false, "BACKEND_ERROR");
    }
    strategy = "county_trigram";
    results.content = resT1.parsed ? resT1.parsed.data_output : null;
    results.logs.push(
      JSON.stringify({
        strategy: strategy,
        trigram: r.trigram,
        queries: executed
      })
    );
    return finish(true, "OK");
  }

  // 2.3) Trigrama direto
  if (trigram && trigram.length === 3) {
    if (!targetClass) {
      results.logs.push(
        JSON.stringify({
          error: "MISSING_INPUT",
          message: "Falta ci_classification para pesquisa por trigrama."
        })
      );
      return finish(false, "MISSING_INPUT");
    }
    var andT2 = [];
    if (!statusAll) push(andT2, "status", statusVal);
    push(andT2, "ci_classification", targetClass);
    push(andT2, "site", "~like~" + trigram);
    var qT2 = makeQueryFromFilters(andT2);
    executed.push({
      stage: "BY_TRIGRAM",
      trigram: trigram,
      query: qT2
    });
    var resT2 = runSearch(qT2);
    if (!resT2.ok) {
      results.logs.push(
        JSON.stringify({
          error: "BACKEND_ERROR",
          stage: "BY_TRIGRAM",
          detail: resT2.raw
        })
      );
      return finish(false, "BACKEND_ERROR");
    }
    strategy = "trigram";
    results.content = resT2.parsed ? resT2.parsed.data_output : null;
    results.logs.push(
      JSON.stringify({
        strategy: strategy,
        trigram: trigram,
        queries: executed
      })
    );
    return finish(true, "OK");
  }

  // 2.4) Distrito → trigramas múltiplos
  if (district) {
    if (!targetClass) {
      results.logs.push(
        JSON.stringify({
          error: "MISSING_INPUT",
          message: "Falta ci_classification para pesquisa por distrito."
        })
      );
      return finish(false, "MISSING_INPUT");
    }
    var rDist = resolveTrigramsFromDistrict(district);
    if (!rDist.ok) {
      results.logs.push(
        JSON.stringify({
          error: "DISTRICT_RESOLUTION_FAILED",
          reason: rDist.reason,
          raw: rDist.raw || ""
        })
      );
      return finish(false, "DISTRICT_RESOLUTION_FAILED");
    }

    // Agregamos resultados de todos os trigramas desse distrito
    var allItems = [];
    var totalFull = 0;
    for (var tIdx = 0; tIdx < rDist.trigrams.length; tIdx++) {
      var currentTrig = rDist.trigrams[tIdx];
      var andDist = [];
      if (!statusAll) push(andDist, "status", statusVal);
      push(andDist, "ci_classification", targetClass);
      push(andDist, "site", "~like~" + currentTrig);
      var qDist = makeQueryFromFilters(andDist);
      executed.push({
        stage: "BY_DISTRICT_TRIGRAM",
        trigram: currentTrig,
        district: upperNoAccents(district),
        query: qDist
      });
      var resDist = runSearch(qDist);
      if (!resDist.ok) {
        results.logs.push(
          JSON.stringify({
            warning: "TRIGRAM_QUERY_FAILED",
            trigram: currentTrig,
            detail: resDist.raw
          })
        );
        continue;
      }
      if (resDist.arr && resDist.arr.length > 0) {
        allItems = allItems.concat(resDist.arr);
      }
      if (resDist.full !== null) {
        totalFull += resDist.full;
      }
    }

    strategy = "district_trigrams";
    results.content = {
      result: allItems,
      result_count: allItems.length,
      result_full_count: totalFull
    };
    results.logs.push(
      JSON.stringify({
        strategy: strategy,
        district: upperNoAccents(district),
        trigrams: rDist.trigrams,
        trigram_count: rDist.count,
        queries: executed
      })
    );
    return finish(true, "OK");
  }

  // 2.5) ci_name → coords resolution
  // Flow: find CI → check own coords → fallback to site → fetch TECHNICAL_ROOM coords
  if (ciName) {
    // Step 1: fetch the CI — try exact match first, fallback to ~like~ picking best candidate
    var andCN = [];
    if (!statusAll) push(andCN, "status", statusVal);
    if (targetClass) push(andCN, "ci_classification", targetClass);
    push(andCN, "ci_name", "~eq~" + ciName);
    var qCN = {
      skip: 0,
      limit: 1,
      sort_order: sort_order,
      sort_field: sort_field,
      filters: [andCN.join("&")],
      return_fields: "",
      relations: false
    };
    executed.push({ stage: "CI_LOOKUP", ci_name: ciName, query: qCN });
    var resCN = runSearch(qCN);
    if (!resCN.ok) {
      results.logs.push(JSON.stringify({ error: "BACKEND_ERROR", stage: "CI_LOOKUP", detail: resCN.raw }));
      return finish(false, "BACKEND_ERROR");
    }

    // ~eq~ returned nothing → fallback to ~like~, pick best candidate (exact > starts-with > shortest)
    if (!resCN.arr || resCN.arr.length === 0) {
      var andCNLike = [];
      if (!statusAll) push(andCNLike, "status", statusVal);
      if (targetClass) push(andCNLike, "ci_classification", targetClass);
      push(andCNLike, "ci_name", "~like~" + ciName);
      var qCNLike = {
        skip: 0,
        limit: 20,
        sort_order: 1,
        sort_field: "ci_name",
        filters: [andCNLike.join("&")],
        return_fields: "ci_name;ci_classification;site;location;location_details;status",
        relations: false
      };
      executed.push({ stage: "CI_LOOKUP_LIKE", ci_name: ciName, query: qCNLike });
      var resCNLike = runSearch(qCNLike);
      if (!resCNLike.ok || !resCNLike.arr || resCNLike.arr.length === 0) {
        results.logs.push(JSON.stringify({ warning: "CI_NOT_FOUND", ci_name: ciName }));
        results.content = { result: [], result_count: 0, result_full_count: 0, resolution: "ci_not_found" };
        results.logs.push(JSON.stringify({ strategy: "ci_coords", resolution: "ci_not_found" }));
        return finish(true, "OK");
      }
      // Pick best candidate: exact match (case-insensitive) > starts-with > shortest name
      var ciNameUpper = ciName.toUpperCase();
      var best = resCNLike.arr[0];
      for (var bi = 0; bi < resCNLike.arr.length; bi++) {
        var cand = resCNLike.arr[bi];
        var candName = cand.ci_name ? String(cand.ci_name).toUpperCase() : "";
        var bestName = best.ci_name ? String(best.ci_name).toUpperCase() : "";
        if (candName === ciNameUpper) {
          best = cand;
          break;
        }
        if (candName.indexOf(ciNameUpper) === 0 && bestName.indexOf(ciNameUpper) !== 0) {
          best = cand;
          continue;
        }
        if (candName.indexOf(ciNameUpper) === 0 && bestName.indexOf(ciNameUpper) === 0 && candName.length < bestName.length) {
          best = cand;
        }
      }
      results.logs.push(JSON.stringify({ info: "CI_LOOKUP_FALLBACK_LIKE", input: ciName, matched: best.ci_name, candidates: resCNLike.arr.length }));
      resCN = { ok: true, arr: [best], full: resCNLike.full };
    }

    if (!resCN.arr || resCN.arr.length === 0) {
      results.logs.push(JSON.stringify({ warning: "CI_NOT_FOUND", ci_name: ciName }));
      results.content = { result: [], result_count: 0, result_full_count: 0, resolution: "ci_not_found" };
      results.logs.push(JSON.stringify({ strategy: "ci_coords", resolution: "ci_not_found" }));
      return finish(true, "OK");
    }

    var foundCI = resCN.arr[0];
    var ciCoords = foundCI.location_details && foundCI.location_details.coordinates ? foundCI.location_details.coordinates : null;
    var hasLat = ciCoords && ciCoords.latitude !== null && ciCoords.latitude !== undefined && String(ciCoords.latitude).trim() !== "";
    var hasLon = ciCoords && ciCoords.longitude !== null && ciCoords.longitude !== undefined && String(ciCoords.longitude).trim() !== "";

    // CI has own coordinates → return directly
    if (hasLat && hasLon) {
      strategy = "ci_own_coords";
      results.content = {
        result: [foundCI],
        result_count: 1,
        result_full_count: resCN.full,
        resolution: "ci_own_coords",
        location: foundCI.location || null,
        coordinates: { latitude: ciCoords.latitude, longitude: ciCoords.longitude }
      };
      results.logs.push(JSON.stringify({ strategy: strategy, ci_name: foundCI.ci_name, resolution: "ci_own_coords", location: foundCI.location || null, coordinates: ciCoords, queries: executed }));
      return finish(true, "OK");
    }

    // No own coords → resolve via site attribute → TECHNICAL_ROOM
    var ciSite = foundCI.site ? String(foundCI.site).trim() : "";
    if (!ciSite) {
      results.content = {
        result: [foundCI],
        result_count: 1,
        result_full_count: resCN.full,
        resolution: "no_coords_no_site",
        location: foundCI.location || null,
        coordinates: null
      };
      results.logs.push(JSON.stringify({ strategy: "ci_coords", ci_name: foundCI.ci_name, resolution: "no_coords_no_site", location: foundCI.location || null, queries: executed }));
      return finish(true, "OK");
    }

    // Step 2: fetch TECHNICAL_ROOM by site value
    var andTR = [];
    if (!statusAll) push(andTR, "status", statusVal);
    push(andTR, "ci_classification", "TECHNICAL_ROOM");
    push(andTR, "ci_name", "~eq~" + ciSite);
    var qTRSite = {
      skip: 0,
      limit: 1,
      sort_order: sort_order,
      sort_field: sort_field,
      filters: [andTR.join("&")],
      return_fields: "",
      relations: false
    };
    executed.push({ stage: "TR_LOOKUP_BY_SITE", site: ciSite, query: qTRSite });
    var resTRSite = runSearch(qTRSite);
    if (!resTRSite.ok) {
      results.logs.push(JSON.stringify({ error: "BACKEND_ERROR", stage: "TR_LOOKUP_BY_SITE", detail: resTRSite.raw }));
      return finish(false, "BACKEND_ERROR");
    }
    if (!resTRSite.arr || resTRSite.arr.length === 0) {
      results.content = {
        result: [foundCI],
        result_count: 1,
        result_full_count: resCN.full,
        resolution: "no_tr_found_for_site",
        location: foundCI.location || null,
        site: ciSite,
        coordinates: null
      };
      results.logs.push(JSON.stringify({ strategy: "ci_coords", ci_name: foundCI.ci_name, resolution: "no_tr_found_for_site", location: foundCI.location || null, site: ciSite, queries: executed }));
      return finish(true, "OK");
    }

    var foundTR = resTRSite.arr[0];
    var trCoords = foundTR.location_details && foundTR.location_details.coordinates ? foundTR.location_details.coordinates : null;
    strategy = "ci_coords_via_site_tr";
    results.content = {
      result: [foundCI],
      result_count: 1,
      result_full_count: resCN.full,
      resolution: "coords_from_technical_room",
      location: foundCI.location || foundTR.location || null,
      site: ciSite,
      technical_room: foundTR,
      coordinates: trCoords
    };
    results.logs.push(JSON.stringify({ strategy: strategy, ci_name: foundCI.ci_name, site: ciSite, tr_name: foundTR.ci_name, location: foundCI.location || foundTR.location || null, coordinates: trCoords, queries: executed }));
    return finish(true, "OK");
  }

  // Inputs insuficientes
  results.logs.push(
    JSON.stringify({
      error: "MISSING_INPUT",
      message: "Use um dos conjuntos: (a) TECHNICAL_ROOM com address/coords (e opcional site_type), (b) coords + ci_classification, (c) concelho + ci_classification, (d) trigram + ci_classification, (e) district + ci_classification, (f) ci_name (+ opcional ci_classification)."
    })
  );
  return finish(false, "MISSING_INPUT");
}

function aiToolsMasterDBFindEnergyAutonomy(ticket, params) {
  // Helpers
  function safeStr(v, max) {
    try {
      var s = String(v === null ? "" : v);
      return max && s.length > max ? s.substring(0, max) + "...[truncated]" : s;
    } catch (e) {
      return "[unavailable]";
    }
  }
  function addFilter(arr, k, v) {
    if (!k) return;
    if (v === undefined || v === null || v === "") return;
    if (Array.isArray(v)) {
      if (v.length > 0) arr.push(k + "=" + v.join(","));
    } else arr.push(k + "=" + v);
  }
  function normalizeReturnFields(rf) {
    if (!rf) return "";
    var s = String(rf).trim();
    return s.indexOf(",") !== -1
      ? s
          .split(",")
          .map(function (x) {
            return x.trim();
          })
          .join(";")
      : s;
  }
  function safeTryGet(t) {
    try {
      return String(t.getResult().getObject() || t.getOutput() || "");
    } catch (e) {
      return "";
    }
  }
  function runSearch(queryPayload) {
    var t = ModuleUtils.runFunction("/masterdb/ci/search", ticket.getRequestContext(), JSON.stringify(queryPayload));
    if (!ModuleUtils.waitForTicketsSuccess(t))
      return {
        ok: false,
        raw: safeTryGet(t)
      };
    try {
      var rawStr = String(t.getResult().getObject());
      var parsedObj = JSON.parse(rawStr);
      var resultsArr = parsedObj && parsedObj.data_output && Array.isArray(parsedObj.data_output.result) ? parsedObj.data_output.result : [];
      var fullCount = parsedObj && parsedObj.data_output && typeof parsedObj.data_output.result_full_count === "number" ? parsedObj.data_output.result_full_count : null;
      return {
        ok: true,
        parsed: parsedObj,
        arr: resultsArr,
        full: fullCount,
        raw: rawStr
      };
    } catch (e) {
      return {
        ok: false,
        raw: "parse_error:" + e
      };
    }
  }
  function toNum(v) {
    if (v === undefined || v === null || v === "") return null;
    var n = Number(v);
    return isNaN(n) ? null : n;
  }
  function toMs(ts) {
    var n = toNum(ts);
    if (n === null) return null;
    return n < 1e12 ? Math.round(n * 1000) : n;
    // segundos -> ms
  }
  function pickAutonomy(autonomyObj) {
    // aceita objecto ou array; se array, prefere type=battery, senão o primeiro válido
    var a = autonomyObj;
    if (Array.isArray(a)) {
      var chosen = null;
      for (var i = 0; i < a.length; i++) {
        var e1 = a[i];
        if (e1 && typeof e1 === "object" && String(e1.type || "").toLowerCase() === "battery") {
          chosen = e1;
          break;
        }
        if (!chosen && e1 && typeof e1 === "object") chosen = e1;
      }
      a = chosen;
    }
    if (!a || typeof a !== "object") return null;
    return {
      design: toNum(a.design),
      real: toNum(a.real),
      actual: toNum(a.actual),
      type: a.type !== undefined ? String(a.type) : null,
      time_unit: a.time_unit !== undefined ? String(a.time_unit) : null,
      updated_by: a.updated_by !== undefined ? String(a.updated_by) : null,
      updated_date: a.updated_date !== undefined ? String(a.updated_date) : null,
      real_last_observed_ms: toMs(a.real_last_observed),
      real_last_observed_iso: toMs(a.real_last_observed) !== null ? new Date(toMs(a.real_last_observed)).toISOString() : null
    };
  }

  // Envelope
  var responseEnvelope = "";
  var resultsEnvelope = {
    content: null,
    logs: []
  };

  function finish(okFlag, codeStr) {
    try {
      responseEnvelope = ModuleUtils.setResponse(responseEnvelope, okFlag ? TheSysModuleFunctionResult.RESULT_OK : TheSysModuleFunctionResult.RESULT_NOK, codeStr || (okFlag ? "OK" : "NOK")) || responseEnvelope;
    } catch (e) {}
    try {
      responseEnvelope = ModuleUtils.setOutput(responseEnvelope, 11, JSON.stringify(resultsEnvelope)) || responseEnvelope;
    } catch (e) {}
    ticket.getResult().setObject(responseEnvelope && String(responseEnvelope).charAt(0) === "{" ? responseEnvelope : JSON.stringify(resultsEnvelope));
    ticket.getResult().setResult(okFlag ? TheSysModuleFunctionResult.RESULT_OK : TheSysModuleFunctionResult.RESULT_NOK);
  }

  // Parse params
  var p = {};
  try {
    p = JSON.parse(params && params.size && params.size() > 0 ? params.get(0) || "{}" : "{}");
  } catch (e) {
    resultsEnvelope.logs.push(
      JSON.stringify({
        error: "MALFORMED_PARAMS",
        detail: safeStr(e, 400),
        raw: safeStr(params && params.get ? params.get(0) : "", 400)
      })
    );
    return finish(false, "MALFORMED_PARAMS");
  }
  resultsEnvelope.logs.push(
    JSON.stringify({
      parameters: p
    })
  );

  // Inputs obrigatórios (ci_classification é opcional)
  var ciNameInput = p.ci_name ? String(p.ci_name).trim() : "";
  var classInput =
    p.ci_classification || p.classification
      ? String(p.ci_classification || p.classification)
          .trim()
          .toUpperCase()
      : "";
  if (!ciNameInput) {
    resultsEnvelope.logs.push(
      JSON.stringify({
        error: "MISSING_INPUT",
        message: "É necessário fornecer 'ci_name'."
      })
    );
    return finish(false, "MISSING_INPUT");
  }

  // return_fields (primário): autonomia
  var returnFieldsPrimary = normalizeReturnFields(p.return_fields || "ci_name,ci_classification,energy.autonomy");

  // Query primária
  var filterParts = [];
  if (classInput) addFilter(filterParts, "ci_classification", "~eq~" + classInput);
  addFilter(filterParts, "ci_name", "~eq~" + ciNameInput);

  var filterList = [];
  var filterAndStr = filterParts.join("&");
  if (filterAndStr) filterList.push(filterAndStr);

  var queryPrimary = {
    skip: 0,
    limit: 1,
    sort_order: -1,
    sort_field: "_created_date",
    filters: filterList,
    return_fields: returnFieldsPrimary,
    relations: false
  };
  resultsEnvelope.logs.push(
    JSON.stringify({
      stage: "BUILD_QUERY_PRIMARY",
      query: queryPrimary
    })
  );

  // Execução primária
  var resPrimary = runSearch(queryPrimary);
  if (!resPrimary.ok) {
    resultsEnvelope.logs.push(
      JSON.stringify({
        error: "BACKEND_ERROR",
        stage: "PRIMARY",
        detail: resPrimary.raw
      })
    );
    return finish(false, "BACKEND_ERROR");
  }
  resultsEnvelope.logs.push(
    JSON.stringify({
      stage: "SEARCH_DONE_PRIMARY",
      result_count: resPrimary.arr.length
    })
  );

  if (resPrimary.arr.length === 0) {
    resultsEnvelope.logs.push(
      JSON.stringify({
        error: "NOT_FOUND",
        message: "Nenhum CI encontrado para os filtros fornecidos."
      })
    );
    return finish(true, "OK");
  }

  var baseItem = resPrimary.arr[0] || {};
  var autonomyPicked = pickAutonomy(baseItem.energy && baseItem.energy.autonomy);

  if (autonomyPicked) {
    resultsEnvelope.content = {
      ci_name: baseItem.ci_name || ciNameInput,
      ci_classification: baseItem.ci_classification || classInput,
      autonomy_design: autonomyPicked.design,
      autonomy_real: autonomyPicked.real,
      autonomy_actual: autonomyPicked.actual,
      type: autonomyPicked.type,
      time_unit: autonomyPicked.time_unit,
      updated_by: autonomyPicked.updated_by,
      updated_date: autonomyPicked.updated_date,
      autonomy_real_last_observed_ms: autonomyPicked.real_last_observed_ms,
      autonomy_real_last_observed_iso: autonomyPicked.real_last_observed_iso,
      autonomy_source: "CI",
      site_used: null
    };
    resultsEnvelope.logs.push(
      JSON.stringify({
        stage: "CONTENT_BUILT",
        source: "CI"
      })
    );
    return finish(true, "OK");
  }

  // Fallback Step 1: obter 'site' do próprio CI
  resultsEnvelope.logs.push(
    JSON.stringify({
      stage: "FALLBACK_STEP1",
      info: "No autonomy on CI. Reading 'site' attribute."
    })
  );
  var querySite = {
    skip: 0,
    limit: 1,
    sort_order: -1,
    sort_field: "_created_date",
    filters: filterList,
    return_fields: normalizeReturnFields("ci_name,ci_classification,site"),
    relations: false
  };
  var resSite = runSearch(querySite);
  if (!resSite.ok) {
    resultsEnvelope.logs.push(
      JSON.stringify({
        error: "BACKEND_ERROR",
        stage: "FALLBACK_STEP1",
        detail: resSite.raw
      })
    );
    resultsEnvelope.content = {
      ci_name: baseItem.ci_name || ciNameInput,
      ci_classification: baseItem.ci_classification || classInput,
      autonomy_design: null,
      autonomy_real: null,
      autonomy_actual: null,
      type: null,
      time_unit: null,
      updated_by: null,
      updated_date: null,
      autonomy_real_last_observed_ms: null,
      autonomy_real_last_observed_iso: null,
      autonomy_source: "NONE",
      site_used: null
    };
    return finish(true, "OK");
  }
  var siteItem = resSite.arr && resSite.arr[0] ? resSite.arr[0] : {};
  var siteVal = siteItem && siteItem.site ? String(siteItem.site).trim() : "";

  if (!siteVal) {
    resultsEnvelope.logs.push(
      JSON.stringify({
        stage: "FALLBACK_STEP1",
        info: "Attribute 'site' not found on CI."
      })
    );
    resultsEnvelope.content = {
      ci_name: baseItem.ci_name || ciNameInput,
      ci_classification: baseItem.ci_classification || classInput,
      autonomy_design: null,
      autonomy_real: null,
      autonomy_actual: null,
      type: null,
      time_unit: null,
      updated_by: null,
      updated_date: null,
      autonomy_real_last_observed_ms: null,
      autonomy_real_last_observed_iso: null,
      autonomy_source: "NONE",
      site_used: null
    };
    return finish(true, "OK");
  }

  // Fallback Step 2: procurar autonomia no TECHNICAL_ROOM com ci_name={{site}}
  resultsEnvelope.logs.push(
    JSON.stringify({
      stage: "FALLBACK_STEP2_TR",
      site: siteVal,
      info: "Query TECHNICAL_ROOM by ci_name=site for energy.autonomy."
    })
  );
  var filterTR = [];
  addFilter(filterTR, "ci_classification", "~eq~TECHNICAL_ROOM");
  addFilter(filterTR, "ci_name", "~eq~" + siteVal);
  var filterTRList = [];
  var filterTRAnd = filterTR.join("&");
  if (filterTRAnd) filterTRList.push(filterTRAnd);

  var queryTR = {
    skip: 0,
    limit: 1,
    sort_order: -1,
    sort_field: "_created_date",
    filters: filterTRList,
    return_fields: normalizeReturnFields("ci_name,ci_classification,energy.autonomy"),
    relations: false
  };
  var resTR = runSearch(queryTR);
  if (!resTR.ok) {
    resultsEnvelope.logs.push(
      JSON.stringify({
        error: "BACKEND_ERROR",
        stage: "FALLBACK_STEP2_TR",
        detail: resTR.raw
      })
    );
    resultsEnvelope.content = {
      ci_name: baseItem.ci_name || ciNameInput,
      ci_classification: baseItem.ci_classification || classInput,
      autonomy_design: null,
      autonomy_real: null,
      autonomy_actual: null,
      type: null,
      time_unit: null,
      updated_by: null,
      updated_date: null,
      autonomy_real_last_observed_ms: null,
      autonomy_real_last_observed_iso: null,
      autonomy_source: "NONE",
      site_used: siteVal
    };
    return finish(true, "OK");
  }

  if (resTR.arr.length === 0) {
    resultsEnvelope.logs.push(
      JSON.stringify({
        stage: "FALLBACK_STEP2_TR",
        info: "No TECHNICAL_ROOM found with ci_name=site."
      })
    );
    resultsEnvelope.content = {
      ci_name: baseItem.ci_name || ciNameInput,
      ci_classification: baseItem.ci_classification || classInput,
      autonomy_design: null,
      autonomy_real: null,
      autonomy_actual: null,
      type: null,
      time_unit: null,
      updated_by: null,
      updated_date: null,
      autonomy_real_last_observed_ms: null,
      autonomy_real_last_observed_iso: null,
      autonomy_source: "NONE",
      site_used: siteVal
    };
    return finish(true, "OK");
  }

  var trItem = resTR.arr[0] || {};
  var trAutonomy = pickAutonomy(trItem.energy && trItem.energy.autonomy);

  if (trAutonomy) {
    resultsEnvelope.content = {
      ci_name: trItem.ci_name || siteVal,
      ci_classification: trItem.ci_classification || "TECHNICAL_ROOM",
      autonomy_design: trAutonomy.design,
      autonomy_real: trAutonomy.real,
      autonomy_actual: trAutonomy.actual,
      type: trAutonomy.type,
      time_unit: trAutonomy.time_unit,
      updated_by: trAutonomy.updated_by,
      updated_date: trAutonomy.updated_date,
      autonomy_real_last_observed_ms: trAutonomy.real_last_observed_ms,
      autonomy_real_last_observed_iso: trAutonomy.real_last_observed_iso,
      autonomy_source: "TECHNICAL_ROOM",
      site_used: siteVal
    };
    resultsEnvelope.logs.push(
      JSON.stringify({
        stage: "CONTENT_BUILT",
        source: "TECHNICAL_ROOM"
      })
    );
    return finish(true, "OK");
  }

  // Sem sucesso no fallback
  resultsEnvelope.logs.push(
    JSON.stringify({
      stage: "FALLBACK_DONE",
      info: "No autonomy found in TECHNICAL_ROOM."
    })
  );
  resultsEnvelope.content = {
    ci_name: baseItem.ci_name || ciNameInput,
    ci_classification: baseItem.ci_classification || classInput,
    autonomy_design: null,
    autonomy_real: null,
    autonomy_actual: null,
    type: null,
    time_unit: null,
    updated_by: null,
    updated_date: null,
    autonomy_real_last_observed_ms: null,
    autonomy_real_last_observed_iso: null,
    autonomy_source: "NONE",
    site_used: siteVal
  };
  return finish(true, "OK");
}

function aiToolsMasterDBFindEnergySupplier(ticket, params) {
  // Helpers
  function safeStr(v, max) {
    try {
      var s = String(v === null ? "" : v);
      return max && s.length > max ? s.substring(0, max) + "...[truncated]" : s;
    } catch (e) {
      return "[unavailable]";
    }
  }
  function addFilter(arr, k, v) {
    if (!k) return;
    if (v === undefined || v === null || v === "") return;
    if (Array.isArray(v)) {
      if (v.length > 0) arr.push(k + "=" + v.join(","));
    } else arr.push(k + "=" + v);
  }
  function normalizeReturnFields(rf) {
    if (!rf) return "";
    var s = String(rf).trim();
    return s.indexOf(",") !== -1
      ? s
          .split(",")
          .map(function (x) {
            return x.trim();
          })
          .join(";")
      : s;
  }
  function safeTryGet(t) {
    try {
      return String(t.getResult().getObject() || t.getOutput() || "");
    } catch (e) {
      return "";
    }
  }
  function runSearch(queryPayload) {
    var t = ModuleUtils.runFunction("/masterdb/ci/search", ticket.getRequestContext(), JSON.stringify(queryPayload));
    if (!ModuleUtils.waitForTicketsSuccess(t))
      return {
        ok: false,
        raw: safeTryGet(t)
      };
    try {
      var rawStr = String(t.getResult().getObject());
      var parsedObj = JSON.parse(rawStr);
      var resultsArr = parsedObj && parsedObj.data_output && Array.isArray(parsedObj.data_output.result) ? parsedObj.data_output.result : [];
      var fullCount = parsedObj && parsedObj.data_output && typeof parsedObj.data_output.result_full_count === "number" ? parsedObj.data_output.result_full_count : null;
      return {
        ok: true,
        parsed: parsedObj,
        arr: resultsArr,
        full: fullCount,
        raw: rawStr
      };
    } catch (e) {
      return {
        ok: false,
        raw: "parse_error:" + e
      };
    }
  }
  function toStr(v) {
    if (v === undefined || v === null) return null;
    return String(v);
  }
  function pickSupplier(supplierObj) {
    var s = supplierObj;
    if (!s || typeof s !== "object") return null;
    return {
      nil_cil: toStr(s.nil_cil),
      tarifa: toStr(s.tarifa),
      morada_fornecimento: toStr(s.morada_fornecimento),
      fornecedor_sigi_contacto: toStr(s.fornecedor_sigi_contacto),
      pma: toStr(s.pma),
      cpe_number: toStr(s.cpe_number),
      potencia_contratada: toStr(s.potencia_contratada),
      tipologia: toStr(s.tipologia),
      contador: toStr(s.contador),
      datasource: toStr(s.datasource),
      tipo_tensao: toStr(s.tipo_tensao),
      updated_by: toStr(s.updated_by),
      cpe: toStr(s.cpe),
      fornecedor_sigi: toStr(s.fornecedor_sigi),
      fornecedor: toStr(s.fornecedor),
      fornecedor_contacto: toStr(s.fornecedor_contacto),
      updated_date: toStr(s.updated_date),
      data_ligacao: toStr(s.data_ligacao),
      cramer_code: toStr(s.cramer_code),
      cramer_building: toStr(s.cramer_building)
    };
  }
  function buildEmptySupplierContent(ciName, ciClass, source, siteUsed) {
    return {
      ci_name: ciName,
      ci_classification: ciClass,
      nil_cil: null,
      tarifa: null,
      morada_fornecimento: null,
      fornecedor_sigi_contacto: null,
      pma: null,
      cpe_number: null,
      potencia_contratada: null,
      tipologia: null,
      contador: null,
      datasource: null,
      tipo_tensao: null,
      updated_by: null,
      cpe: null,
      fornecedor_sigi: null,
      fornecedor: null,
      fornecedor_contacto: null,
      updated_date: null,
      data_ligacao: null,
      cramer_code: null,
      cramer_building: null,
      supplier_source: source,
      site_used: siteUsed
    };
  }

  // Envelope
  var responseEnvelope = "";
  var resultsEnvelope = {
    content: null,
    logs: []
  };

  function finish(okFlag, codeStr) {
    try {
      responseEnvelope = ModuleUtils.setResponse(responseEnvelope, okFlag ? TheSysModuleFunctionResult.RESULT_OK : TheSysModuleFunctionResult.RESULT_NOK, codeStr || (okFlag ? "OK" : "NOK")) || responseEnvelope;
    } catch (e) {}
    try {
      responseEnvelope = ModuleUtils.setOutput(responseEnvelope, 11, JSON.stringify(resultsEnvelope)) || responseEnvelope;
    } catch (e) {}
    ticket.getResult().setObject(responseEnvelope && String(responseEnvelope).charAt(0) === "{" ? responseEnvelope : JSON.stringify(resultsEnvelope));
    ticket.getResult().setResult(okFlag ? TheSysModuleFunctionResult.RESULT_OK : TheSysModuleFunctionResult.RESULT_NOK);
  }

  // Parse params
  var p = {};
  try {
    p = JSON.parse(params && params.size && params.size() > 0 ? params.get(0) || "{}" : "{}");
  } catch (e) {
    resultsEnvelope.logs.push(
      JSON.stringify({
        error: "MALFORMED_PARAMS",
        detail: safeStr(e, 400),
        raw: safeStr(params && params.get ? params.get(0) : "", 400)
      })
    );
    return finish(false, "MALFORMED_PARAMS");
  }
  resultsEnvelope.logs.push(
    JSON.stringify({
      parameters: p
    })
  );

  // Inputs obrigatórios (ci_classification é opcional)
  var ciNameInput = p.ci_name ? String(p.ci_name).trim() : "";
  var classInput =
    p.ci_classification || p.classification
      ? String(p.ci_classification || p.classification)
          .trim()
          .toUpperCase()
      : "";
  if (!ciNameInput) {
    resultsEnvelope.logs.push(
      JSON.stringify({
        error: "MISSING_INPUT",
        message: "É necessário fornecer 'ci_name'."
      })
    );
    return finish(false, "MISSING_INPUT");
  }

  // return_fields (primário): supplier
  var returnFieldsPrimary = normalizeReturnFields(p.return_fields || "ci_name,ci_classification,energy.supplier");

  // Query primária
  var filterParts = [];
  if (classInput) addFilter(filterParts, "ci_classification", "~eq~" + classInput);
  addFilter(filterParts, "ci_name", "~eq~" + ciNameInput);

  var filterList = [];
  var filterAndStr = filterParts.join("&");
  if (filterAndStr) filterList.push(filterAndStr);

  var queryPrimary = {
    skip: 0,
    limit: 1,
    sort_order: -1,
    sort_field: "_created_date",
    filters: filterList,
    return_fields: returnFieldsPrimary,
    relations: false
  };
  resultsEnvelope.logs.push(
    JSON.stringify({
      stage: "BUILD_QUERY_PRIMARY",
      query: queryPrimary
    })
  );

  // Execução primária
  var resPrimary = runSearch(queryPrimary);
  if (!resPrimary.ok) {
    resultsEnvelope.logs.push(
      JSON.stringify({
        error: "BACKEND_ERROR",
        stage: "PRIMARY",
        detail: resPrimary.raw
      })
    );
    return finish(false, "BACKEND_ERROR");
  }
  resultsEnvelope.logs.push(
    JSON.stringify({
      stage: "SEARCH_DONE_PRIMARY",
      result_count: resPrimary.arr.length
    })
  );

  if (resPrimary.arr.length === 0) {
    resultsEnvelope.logs.push(
      JSON.stringify({
        error: "NOT_FOUND",
        message: "Nenhum CI encontrado para os filtros fornecidos."
      })
    );
    return finish(true, "OK");
  }

  var baseItem = resPrimary.arr[0] || {};
  var supplierPicked = pickSupplier(baseItem.energy && baseItem.energy.supplier);

  if (supplierPicked) {
    resultsEnvelope.content = {
      ci_name: baseItem.ci_name || ciNameInput,
      ci_classification: baseItem.ci_classification || classInput,
      nil_cil: supplierPicked.nil_cil,
      tarifa: supplierPicked.tarifa,
      morada_fornecimento: supplierPicked.morada_fornecimento,
      fornecedor_sigi_contacto: supplierPicked.fornecedor_sigi_contacto,
      pma: supplierPicked.pma,
      cpe_number: supplierPicked.cpe_number,
      potencia_contratada: supplierPicked.potencia_contratada,
      tipologia: supplierPicked.tipologia,
      contador: supplierPicked.contador,
      datasource: supplierPicked.datasource,
      tipo_tensao: supplierPicked.tipo_tensao,
      updated_by: supplierPicked.updated_by,
      cpe: supplierPicked.cpe,
      fornecedor_sigi: supplierPicked.fornecedor_sigi,
      fornecedor: supplierPicked.fornecedor,
      fornecedor_contacto: supplierPicked.fornecedor_contacto,
      updated_date: supplierPicked.updated_date,
      data_ligacao: supplierPicked.data_ligacao,
      cramer_code: supplierPicked.cramer_code,
      cramer_building: supplierPicked.cramer_building,
      supplier_source: "CI",
      site_used: null
    };
    resultsEnvelope.logs.push(
      JSON.stringify({
        stage: "CONTENT_BUILT",
        source: "CI"
      })
    );
    return finish(true, "OK");
  }

  // Fallback Step 1: obter 'site' do próprio CI
  resultsEnvelope.logs.push(
    JSON.stringify({
      stage: "FALLBACK_STEP1",
      info: "No supplier on CI. Reading 'site' attribute."
    })
  );
  var querySite = {
    skip: 0,
    limit: 1,
    sort_order: -1,
    sort_field: "_created_date",
    filters: filterList,
    return_fields: normalizeReturnFields("ci_name,ci_classification,site"),
    relations: false
  };
  var resSite = runSearch(querySite);
  if (!resSite.ok) {
    resultsEnvelope.logs.push(
      JSON.stringify({
        error: "BACKEND_ERROR",
        stage: "FALLBACK_STEP1",
        detail: resSite.raw
      })
    );
    resultsEnvelope.content = buildEmptySupplierContent(baseItem.ci_name || ciNameInput, baseItem.ci_classification || classInput, "NONE", null);
    return finish(true, "OK");
  }
  var siteItem = resSite.arr && resSite.arr[0] ? resSite.arr[0] : {};
  var siteVal = siteItem && siteItem.site ? String(siteItem.site).trim() : "";

  if (!siteVal) {
    resultsEnvelope.logs.push(
      JSON.stringify({
        stage: "FALLBACK_STEP1",
        info: "Attribute 'site' not found on CI."
      })
    );
    resultsEnvelope.content = buildEmptySupplierContent(baseItem.ci_name || ciNameInput, baseItem.ci_classification || classInput, "NONE", null);
    return finish(true, "OK");
  }

  // Fallback Step 2: procurar supplier no TECHNICAL_ROOM com ci_name={{site}}
  resultsEnvelope.logs.push(
    JSON.stringify({
      stage: "FALLBACK_STEP2_TR",
      site: siteVal,
      info: "Query TECHNICAL_ROOM by ci_name=site for energy.supplier."
    })
  );
  var filterTR = [];
  addFilter(filterTR, "ci_classification", "~eq~TECHNICAL_ROOM");
  addFilter(filterTR, "ci_name", "~eq~" + siteVal);
  var filterTRList = [];
  var filterTRAnd = filterTR.join("&");
  if (filterTRAnd) filterTRList.push(filterTRAnd);

  var queryTR = {
    skip: 0,
    limit: 1,
    sort_order: -1,
    sort_field: "_created_date",
    filters: filterTRList,
    return_fields: normalizeReturnFields("ci_name,ci_classification,energy.supplier"),
    relations: false
  };
  var resTR = runSearch(queryTR);
  if (!resTR.ok) {
    resultsEnvelope.logs.push(
      JSON.stringify({
        error: "BACKEND_ERROR",
        stage: "FALLBACK_STEP2_TR",
        detail: resTR.raw
      })
    );
    resultsEnvelope.content = buildEmptySupplierContent(baseItem.ci_name || ciNameInput, baseItem.ci_classification || classInput, "NONE", siteVal);
    return finish(true, "OK");
  }

  if (resTR.arr.length === 0) {
    resultsEnvelope.logs.push(
      JSON.stringify({
        stage: "FALLBACK_STEP2_TR",
        info: "No TECHNICAL_ROOM found with ci_name=site."
      })
    );
    resultsEnvelope.content = buildEmptySupplierContent(baseItem.ci_name || ciNameInput, baseItem.ci_classification || classInput, "NONE", siteVal);
    return finish(true, "OK");
  }

  var trItem = resTR.arr[0] || {};
  var trSupplier = pickSupplier(trItem.energy && trItem.energy.supplier);

  if (trSupplier) {
    resultsEnvelope.content = {
      ci_name: trItem.ci_name || siteVal,
      ci_classification: trItem.ci_classification || "TECHNICAL_ROOM",
      nil_cil: trSupplier.nil_cil,
      tarifa: trSupplier.tarifa,
      morada_fornecimento: trSupplier.morada_fornecimento,
      fornecedor_sigi_contacto: trSupplier.fornecedor_sigi_contacto,
      pma: trSupplier.pma,
      cpe_number: trSupplier.cpe_number,
      potencia_contratada: trSupplier.potencia_contratada,
      tipologia: trSupplier.tipologia,
      contador: trSupplier.contador,
      datasource: trSupplier.datasource,
      tipo_tensao: trSupplier.tipo_tensao,
      updated_by: trSupplier.updated_by,
      cpe: trSupplier.cpe,
      fornecedor_sigi: trSupplier.fornecedor_sigi,
      fornecedor: trSupplier.fornecedor,
      fornecedor_contacto: trSupplier.fornecedor_contacto,
      updated_date: trSupplier.updated_date,
      data_ligacao: trSupplier.data_ligacao,
      cramer_code: trSupplier.cramer_code,
      cramer_building: trSupplier.cramer_building,
      supplier_source: "TECHNICAL_ROOM",
      site_used: siteVal
    };
    resultsEnvelope.logs.push(
      JSON.stringify({
        stage: "CONTENT_BUILT",
        source: "TECHNICAL_ROOM"
      })
    );
    return finish(true, "OK");
  }

  // Sem sucesso no fallback
  resultsEnvelope.logs.push(
    JSON.stringify({
      stage: "FALLBACK_DONE",
      info: "No supplier found in TECHNICAL_ROOM."
    })
  );
  resultsEnvelope.content = buildEmptySupplierContent(baseItem.ci_name || ciNameInput, baseItem.ci_classification || classInput, "NONE", siteVal);
  return finish(true, "OK");
}

function aiToolsMasterDBFindEnergyGenerator(ticket, params) {
  // Helpers
  function safeStr(v, max) {
    try {
      var s = String(v === null ? "" : v);
      return max && s.length > max ? s.substring(0, max) + "...[truncated]" : s;
    } catch (e) {
      return "[unavailable]";
    }
  }
  function addFilter(arr, k, v) {
    if (!k) return;
    if (v === undefined || v === null || v === "") return;
    if (Array.isArray(v)) {
      if (v.length > 0) arr.push(k + "=" + v.join(","));
    } else arr.push(k + "=" + v);
  }
  function normalizeReturnFields(rf) {
    if (!rf) return "";
    var s = String(rf).trim();
    return s.indexOf(",") !== -1
      ? s
          .split(",")
          .map(function (x) {
            return x.trim();
          })
          .join(";")
      : s;
  }
  function safeTryGet(t) {
    try {
      return String(t.getResult().getObject() || t.getOutput() || "");
    } catch (e) {
      return "";
    }
  }
  function runSearch(queryPayload) {
    var t = ModuleUtils.runFunction("/masterdb/ci/search", ticket.getRequestContext(), JSON.stringify(queryPayload));
    if (!ModuleUtils.waitForTicketsSuccess(t))
      return {
        ok: false,
        raw: safeTryGet(t)
      };
    try {
      var rawStr = String(t.getResult().getObject());
      var parsedObj = JSON.parse(rawStr);
      var resultsArr = parsedObj && parsedObj.data_output && Array.isArray(parsedObj.data_output.result) ? parsedObj.data_output.result : [];
      var fullCount = parsedObj && parsedObj.data_output && typeof parsedObj.data_output.result_full_count === "number" ? parsedObj.data_output.result_full_count : null;
      return {
        ok: true,
        parsed: parsedObj,
        arr: resultsArr,
        full: fullCount,
        raw: rawStr
      };
    } catch (e) {
      return {
        ok: false,
        raw: "parse_error:" + e
      };
    }
  }
  function toNum(v) {
    if (v === undefined || v === null || v === "") return null;
    var n = Number(v);
    return isNaN(n) ? null : n;
  }
  function toStr(v) {
    if (v === undefined || v === null) return null;
    return String(v);
  }
  function pickGenerator(generatorObj) {
    var g = generatorObj;
    if (!g || typeof g !== "object") return null;
    return {
      liters_capacity: toNum(g.liters_capacity),
      liters_available: toNum(g.liters_available),
      liters_hour_consumption: toNum(g.liters_hour_consumption),
      updated_by: toStr(g.updated_by),
      updated_date: toStr(g.updated_date)
    };
  }
  function buildEmptyGeneratorContent(ciName, ciClass, source, siteUsed) {
    return {
      ci_name: ciName,
      ci_classification: ciClass,
      liters_capacity: null,
      liters_available: null,
      liters_hour_consumption: null,
      updated_by: null,
      updated_date: null,
      generator_source: source,
      site_used: siteUsed
    };
  }

  // Envelope
  var responseEnvelope = "";
  var resultsEnvelope = {
    content: null,
    logs: []
  };

  function finish(okFlag, codeStr) {
    try {
      responseEnvelope = ModuleUtils.setResponse(responseEnvelope, okFlag ? TheSysModuleFunctionResult.RESULT_OK : TheSysModuleFunctionResult.RESULT_NOK, codeStr || (okFlag ? "OK" : "NOK")) || responseEnvelope;
    } catch (e) {}
    try {
      responseEnvelope = ModuleUtils.setOutput(responseEnvelope, 11, JSON.stringify(resultsEnvelope)) || responseEnvelope;
    } catch (e) {}
    ticket.getResult().setObject(responseEnvelope && String(responseEnvelope).charAt(0) === "{" ? responseEnvelope : JSON.stringify(resultsEnvelope));
    ticket.getResult().setResult(okFlag ? TheSysModuleFunctionResult.RESULT_OK : TheSysModuleFunctionResult.RESULT_NOK);
  }

  // Parse params
  var p = {};
  try {
    p = JSON.parse(params && params.size && params.size() > 0 ? params.get(0) || "{}" : "{}");
  } catch (e) {
    resultsEnvelope.logs.push(
      JSON.stringify({
        error: "MALFORMED_PARAMS",
        detail: safeStr(e, 400),
        raw: safeStr(params && params.get ? params.get(0) : "", 400)
      })
    );
    return finish(false, "MALFORMED_PARAMS");
  }
  resultsEnvelope.logs.push(
    JSON.stringify({
      parameters: p
    })
  );

  // Inputs obrigatórios (ci_classification é opcional)
  var ciNameInput = p.ci_name ? String(p.ci_name).trim() : "";
  var classInput =
    p.ci_classification || p.classification
      ? String(p.ci_classification || p.classification)
          .trim()
          .toUpperCase()
      : "";
  if (!ciNameInput) {
    resultsEnvelope.logs.push(
      JSON.stringify({
        error: "MISSING_INPUT",
        message: "É necessário fornecer 'ci_name'."
      })
    );
    return finish(false, "MISSING_INPUT");
  }

  // return_fields (primário): generator
  var returnFieldsPrimary = normalizeReturnFields(p.return_fields || "ci_name,ci_classification,energy.generator");

  // Query primária
  var filterParts = [];
  if (classInput) addFilter(filterParts, "ci_classification", "~eq~" + classInput);
  addFilter(filterParts, "ci_name", "~eq~" + ciNameInput);

  var filterList = [];
  var filterAndStr = filterParts.join("&");
  if (filterAndStr) filterList.push(filterAndStr);

  var queryPrimary = {
    skip: 0,
    limit: 1,
    sort_order: -1,
    sort_field: "_created_date",
    filters: filterList,
    return_fields: returnFieldsPrimary,
    relations: false
  };
  resultsEnvelope.logs.push(
    JSON.stringify({
      stage: "BUILD_QUERY_PRIMARY",
      query: queryPrimary
    })
  );

  // Execução primária
  var resPrimary = runSearch(queryPrimary);
  if (!resPrimary.ok) {
    resultsEnvelope.logs.push(
      JSON.stringify({
        error: "BACKEND_ERROR",
        stage: "PRIMARY",
        detail: resPrimary.raw
      })
    );
    return finish(false, "BACKEND_ERROR");
  }
  resultsEnvelope.logs.push(
    JSON.stringify({
      stage: "SEARCH_DONE_PRIMARY",
      result_count: resPrimary.arr.length
    })
  );

  if (resPrimary.arr.length === 0) {
    resultsEnvelope.logs.push(
      JSON.stringify({
        error: "NOT_FOUND",
        message: "Nenhum CI encontrado para os filtros fornecidos."
      })
    );
    return finish(true, "OK");
  }

  var baseItem = resPrimary.arr[0] || {};
  var generatorPicked = pickGenerator(baseItem.energy && baseItem.energy.generator);

  if (generatorPicked) {
    resultsEnvelope.content = {
      ci_name: baseItem.ci_name || ciNameInput,
      ci_classification: baseItem.ci_classification || classInput,
      liters_capacity: generatorPicked.liters_capacity,
      liters_available: generatorPicked.liters_available,
      liters_hour_consumption: generatorPicked.liters_hour_consumption,
      updated_by: generatorPicked.updated_by,
      updated_date: generatorPicked.updated_date,
      generator_source: "CI",
      site_used: null
    };
    resultsEnvelope.logs.push(
      JSON.stringify({
        stage: "CONTENT_BUILT",
        source: "CI"
      })
    );
    return finish(true, "OK");
  }

  // Fallback Step 1: obter 'site' do próprio CI
  resultsEnvelope.logs.push(
    JSON.stringify({
      stage: "FALLBACK_STEP1",
      info: "No generator on CI. Reading 'site' attribute."
    })
  );
  var querySite = {
    skip: 0,
    limit: 1,
    sort_order: -1,
    sort_field: "_created_date",
    filters: filterList,
    return_fields: normalizeReturnFields("ci_name,ci_classification,site"),
    relations: false
  };
  var resSite = runSearch(querySite);
  if (!resSite.ok) {
    resultsEnvelope.logs.push(
      JSON.stringify({
        error: "BACKEND_ERROR",
        stage: "FALLBACK_STEP1",
        detail: resSite.raw
      })
    );
    resultsEnvelope.content = buildEmptyGeneratorContent(baseItem.ci_name || ciNameInput, baseItem.ci_classification || classInput, "NONE", null);
    return finish(true, "OK");
  }
  var siteItem = resSite.arr && resSite.arr[0] ? resSite.arr[0] : {};
  var siteVal = siteItem && siteItem.site ? String(siteItem.site).trim() : "";

  if (!siteVal) {
    resultsEnvelope.logs.push(
      JSON.stringify({
        stage: "FALLBACK_STEP1",
        info: "Attribute 'site' not found on CI."
      })
    );
    resultsEnvelope.content = buildEmptyGeneratorContent(baseItem.ci_name || ciNameInput, baseItem.ci_classification || classInput, "NONE", null);
    return finish(true, "OK");
  }

  // Fallback Step 2: procurar generator no TECHNICAL_ROOM com ci_name={{site}}
  resultsEnvelope.logs.push(
    JSON.stringify({
      stage: "FALLBACK_STEP2_TR",
      site: siteVal,
      info: "Query TECHNICAL_ROOM by ci_name=site for energy.generator."
    })
  );
  var filterTR = [];
  addFilter(filterTR, "ci_classification", "~eq~TECHNICAL_ROOM");
  addFilter(filterTR, "ci_name", "~eq~" + siteVal);
  var filterTRList = [];
  var filterTRAnd = filterTR.join("&");
  if (filterTRAnd) filterTRList.push(filterTRAnd);

  var queryTR = {
    skip: 0,
    limit: 1,
    sort_order: -1,
    sort_field: "_created_date",
    filters: filterTRList,
    return_fields: normalizeReturnFields("ci_name,ci_classification,energy.generator"),
    relations: false
  };
  var resTR = runSearch(queryTR);
  if (!resTR.ok) {
    resultsEnvelope.logs.push(
      JSON.stringify({
        error: "BACKEND_ERROR",
        stage: "FALLBACK_STEP2_TR",
        detail: resTR.raw
      })
    );
    resultsEnvelope.content = buildEmptyGeneratorContent(baseItem.ci_name || ciNameInput, baseItem.ci_classification || classInput, "NONE", siteVal);
    return finish(true, "OK");
  }

  if (resTR.arr.length === 0) {
    resultsEnvelope.logs.push(
      JSON.stringify({
        stage: "FALLBACK_STEP2_TR",
        info: "No TECHNICAL_ROOM found with ci_name=site."
      })
    );
    resultsEnvelope.content = buildEmptyGeneratorContent(baseItem.ci_name || ciNameInput, baseItem.ci_classification || classInput, "NONE", siteVal);
    return finish(true, "OK");
  }

  var trItem = resTR.arr[0] || {};
  var trGenerator = pickGenerator(trItem.energy && trItem.energy.generator);

  if (trGenerator) {
    resultsEnvelope.content = {
      ci_name: trItem.ci_name || siteVal,
      ci_classification: trItem.ci_classification || "TECHNICAL_ROOM",
      liters_capacity: trGenerator.liters_capacity,
      liters_available: trGenerator.liters_available,
      liters_hour_consumption: trGenerator.liters_hour_consumption,
      updated_by: trGenerator.updated_by,
      updated_date: trGenerator.updated_date,
      generator_source: "TECHNICAL_ROOM",
      site_used: siteVal
    };
    resultsEnvelope.logs.push(
      JSON.stringify({
        stage: "CONTENT_BUILT",
        source: "TECHNICAL_ROOM"
      })
    );
    return finish(true, "OK");
  }

  // Sem sucesso no fallback
  resultsEnvelope.logs.push(
    JSON.stringify({
      stage: "FALLBACK_DONE",
      info: "No generator found in TECHNICAL_ROOM."
    })
  );
  resultsEnvelope.content = buildEmptyGeneratorContent(baseItem.ci_name || ciNameInput, baseItem.ci_classification || classInput, "NONE", siteVal);
  return finish(true, "OK");
}

function aiToolsMasterDBFindSupport(ticket, params) {
  // Helpers mínimos
  function safeStr(v, max) {
    try {
      var s = String(v === null ? "" : v);
      return max && s.length > max ? s.substring(0, max) + "...[truncated]" : s;
    } catch (e) {
      return "[unavailable]";
    }
  }
  function addFilter(arr, k, v) {
    if (!k) return;
    if (v === undefined || v === null || v === "") return;
    if (Array.isArray(v)) {
      if (v.length > 0) arr.push(k + "=" + v.join(","));
    } else {
      arr.push(k + "=" + v);
    }
  }
  function normalizeReturnFields(rf) {
    if (!rf) return "";
    var s = String(rf).trim();
    return s.indexOf(",") !== -1
      ? s
          .split(",")
          .map(function (x) {
            return x.trim();
          })
          .join(";")
      : s;
  }
  function safeTryGet(t) {
    try {
      return String(t.getResult().getObject() || t.getOutput() || "");
    } catch (e) {
      return "";
    }
  }
  function runSearch(queryPayload) {
    var t = ModuleUtils.runFunction("/masterdb/ci/search", ticket.getRequestContext(), JSON.stringify(queryPayload));
    if (!ModuleUtils.waitForTicketsSuccess(t))
      return {
        ok: false,
        raw: safeTryGet(t)
      };
    try {
      var rawStr = String(t.getResult().getObject());
      var parsedObj = JSON.parse(rawStr);
      var resultsArr = parsedObj && parsedObj.data_output && Array.isArray(parsedObj.data_output.result) ? parsedObj.data_output.result : [];
      var fullCount = parsedObj && parsedObj.data_output && typeof parsedObj.data_output.result_full_count === "number" ? parsedObj.data_output.result_full_count : null;
      return {
        ok: true,
        parsed: parsedObj,
        arr: resultsArr,
        full: fullCount,
        raw: rawStr
      };
    } catch (e) {
      return {
        ok: false,
        raw: "parse_error:" + e
      };
    }
  }
  function hasSupportData(supportObj) {
    if (!supportObj || typeof supportObj !== "object") return false;
    for (var k in supportObj) {
      if (!supportObj.hasOwnProperty(k)) continue;
      var v = supportObj[k];
      if (v && typeof v === "object") return true;
    }
    return false;
  }
  function buildContentFromSupport(baseItem, ciNameInput, classInput, supportObj) {
    var firstItem = baseItem || {};
    var support = supportObj || firstItem.support || null;

    var domainsPresent = [];
    var ownersSet = {};
    var ownersAll = [];

    if (support && typeof support === "object") {
      for (var domKey in support) {
        if (!support.hasOwnProperty(domKey)) continue;
        var domVal = support[domKey];
        if (!domVal || typeof domVal !== "object") continue;
        domainsPresent.push(domKey);
        var domOwners = Array.isArray(domVal.owner) ? domVal.owner.slice(0) : domVal.owner ? [String(domVal.owner)] : [];
        for (var oi = 0; oi < domOwners.length; oi++) {
          var ow = String(domOwners[oi]).trim();
          if (ow && !ownersSet[ow]) {
            ownersSet[ow] = true;
            ownersAll.push(ow);
          }
        }
      }
    }

    var contentOut = {
      ci_name: firstItem.ci_name || ciNameInput,
      ci_classification: firstItem.ci_classification || classInput,
      support_owners: ownersAll,
      support_domains: domainsPresent
    };

    if (support && typeof support === "object") {
      for (var dk in support) {
        if (!support.hasOwnProperty(dk)) continue;
        var dval = support[dk];
        if (!dval || typeof dval !== "object") continue;
        var keyBase = "support_" + dk;
        var ownersArr = Array.isArray(dval.owner) ? dval.owner.slice(0) : dval.owner ? [String(dval.owner)] : [];
        contentOut[keyBase + "_owner"] = ownersArr;
        contentOut[keyBase + "_updated_by"] = dval.updated_by !== undefined ? String(dval.updated_by) : null;
        contentOut[keyBase + "_updated_date"] = dval.updated_date !== undefined ? String(dval.updated_date) : null;
      }
    }

    return contentOut;
  }

  // Envelope simples (content + logs)
  var responseEnvelope = "";
  var resultsEnvelope = {
    content: null,
    logs: []
  };

  function finish(okFlag, codeStr) {
    try {
      responseEnvelope = ModuleUtils.setResponse(responseEnvelope, okFlag ? TheSysModuleFunctionResult.RESULT_OK : TheSysModuleFunctionResult.RESULT_NOK, codeStr || (okFlag ? "OK" : "NOK")) || responseEnvelope;
    } catch (e) {}
    try {
      responseEnvelope = ModuleUtils.setOutput(responseEnvelope, 11, JSON.stringify(resultsEnvelope)) || responseEnvelope;
    } catch (e) {}
    ticket.getResult().setObject(responseEnvelope && String(responseEnvelope).charAt(0) === "{" ? responseEnvelope : JSON.stringify(resultsEnvelope));
    ticket.getResult().setResult(okFlag ? TheSysModuleFunctionResult.RESULT_OK : TheSysModuleFunctionResult.RESULT_NOK);
  }

  // Parse params
  var p = {};
  try {
    p = JSON.parse(params && params.size && params.size() > 0 ? params.get(0) || "{}" : "{}");
  } catch (e) {
    resultsEnvelope.logs.push(
      JSON.stringify({
        error: "MALFORMED_PARAMS",
        detail: safeStr(e, 400),
        raw: safeStr(params && params.get ? params.get(0) : "", 400)
      })
    );
    return finish(false, "MALFORMED_PARAMS");
  }
  resultsEnvelope.logs.push(
    JSON.stringify({
      parameters: p
    })
  );

  // Inputs obrigatórios (ci_classification é opcional)
  var ciNameInput = p.ci_name ? String(p.ci_name).trim() : "";
  var classInput =
    p.ci_classification || p.classification
      ? String(p.ci_classification || p.classification)
          .trim()
          .toUpperCase()
      : "";
  if (!ciNameInput) {
    resultsEnvelope.logs.push(
      JSON.stringify({
        error: "MISSING_INPUT",
        message: "É necessário fornecer 'ci_name'."
      })
    );
    return finish(false, "MISSING_INPUT");
  }

  // 1) Tentativa primária: suporte no próprio CI
  var returnFieldsPrimary = normalizeReturnFields(p.return_fields || "ci_name,ci_classification,support");
  var filterParts = [];
  if (classInput) addFilter(filterParts, "ci_classification", "~eq~" + classInput);
  addFilter(filterParts, "ci_name", "~eq~" + ciNameInput);
  var filterList = [];
  var filterAndStr = filterParts.join("&");
  if (filterAndStr) filterList.push(filterAndStr);

  var queryPrimary = {
    skip: 0,
    limit: 1,
    sort_order: -1,
    sort_field: "_created_date",
    filters: filterList,
    return_fields: returnFieldsPrimary,
    relations: false
  };
  resultsEnvelope.logs.push(
    JSON.stringify({
      stage: "BUILD_QUERY_PRIMARY",
      query: queryPrimary
    })
  );

  var resPrimary = runSearch(queryPrimary);
  if (!resPrimary.ok) {
    resultsEnvelope.logs.push(
      JSON.stringify({
        error: "BACKEND_ERROR",
        stage: "PRIMARY",
        detail: resPrimary.raw
      })
    );
    return finish(false, "BACKEND_ERROR");
  }
  resultsEnvelope.logs.push(
    JSON.stringify({
      stage: "SEARCH_DONE_PRIMARY",
      result_count: resPrimary.arr.length
    })
  );

  if (resPrimary.arr.length === 0) {
    resultsEnvelope.logs.push(
      JSON.stringify({
        error: "NOT_FOUND",
        message: "Nenhum CI encontrado para os filtros fornecidos."
      })
    );
    return finish(true, "OK");
  }

  var baseItem = resPrimary.arr[0] || {};
  var supportObj = baseItem.support || null;
  if (hasSupportData(supportObj)) {
    var contentCI = buildContentFromSupport(baseItem, ciNameInput, classInput, supportObj);
    contentCI.support_source = "CI";
    contentCI.site_used = null;
    resultsEnvelope.content = contentCI;
    resultsEnvelope.logs.push(
      JSON.stringify({
        stage: "CONTENT_BUILT",
        source: "CI"
      })
    );
    return finish(true, "OK");
  }

  // 2) Fallback Step 1: obter o atributo 'site' do CI
  resultsEnvelope.logs.push(
    JSON.stringify({
      stage: "FALLBACK_STEP1",
      info: "No direct support. Reading 'site' from CI."
    })
  );
  var querySite = {
    skip: 0,
    limit: 1,
    sort_order: -1,
    sort_field: "_created_date",
    filters: filterList,
    return_fields: normalizeReturnFields("ci_name,ci_classification,site"),
    relations: false
  };
  var resSite = runSearch(querySite);
  if (!resSite.ok) {
    resultsEnvelope.logs.push(
      JSON.stringify({
        error: "BACKEND_ERROR",
        stage: "FALLBACK_STEP1",
        detail: resSite.raw
      })
    );
    var contentErr1 = buildContentFromSupport(baseItem, ciNameInput, classInput, {});
    contentErr1.support_source = "NONE";
    contentErr1.site_used = null;
    resultsEnvelope.content = contentErr1;
    return finish(true, "OK");
  }
  var siteItem = resSite.arr && resSite.arr[0] ? resSite.arr[0] : {};
  var siteVal = siteItem && siteItem.site ? String(siteItem.site).trim() : "";

  if (!siteVal) {
    resultsEnvelope.logs.push(
      JSON.stringify({
        stage: "FALLBACK_STEP1",
        info: "Attribute 'site' not found on CI."
      })
    );
    var contentNoSite = buildContentFromSupport(baseItem, ciNameInput, classInput, {});
    contentNoSite.support_source = "NONE";
    contentNoSite.site_used = null;
    resultsEnvelope.content = contentNoSite;
    return finish(true, "OK");
  }

  // 3) Fallback Step 2: procurar suporte em TECHNICAL_ROOM com ci_name={{site}}
  resultsEnvelope.logs.push(
    JSON.stringify({
      stage: "FALLBACK_STEP2_TR",
      site: siteVal,
      info: "Query TECHNICAL_ROOM by ci_name=site."
    })
  );
  var filterTR = [];
  addFilter(filterTR, "ci_classification", "~eq~TECHNICAL_ROOM");
  addFilter(filterTR, "ci_name", "~eq~" + siteVal);
  var filterTRList = [];
  var filterTRAnd = filterTR.join("&");
  if (filterTRAnd) filterTRList.push(filterTRAnd);

  var queryTRSupport = {
    skip: 0,
    limit: 1,
    sort_order: -1,
    sort_field: "_created_date",
    filters: filterTRList,
    return_fields: normalizeReturnFields("ci_name,ci_classification,support"),
    relations: false
  };
  var resTR = runSearch(queryTRSupport);
  if (!resTR.ok) {
    resultsEnvelope.logs.push(
      JSON.stringify({
        error: "BACKEND_ERROR",
        stage: "FALLBACK_STEP2_TR",
        detail: resTR.raw
      })
    );
    var contentErrTR = buildContentFromSupport(baseItem, ciNameInput, classInput, {});
    contentErrTR.support_source = "NONE";
    contentErrTR.site_used = siteVal;
    resultsEnvelope.content = contentErrTR;
    return finish(true, "OK");
  }

  if (resTR.arr.length === 0) {
    resultsEnvelope.logs.push(
      JSON.stringify({
        stage: "FALLBACK_STEP2_TR",
        info: "No TECHNICAL_ROOM found with ci_name=site."
      })
    );
    var contentNoTR = buildContentFromSupport(baseItem, ciNameInput, classInput, {});
    contentNoTR.support_source = "NONE";
    contentNoTR.site_used = siteVal;
    resultsEnvelope.content = contentNoTR;
    return finish(true, "OK");
  }

  var trItem = resTR.arr[0] || {};
  var trSupport = trItem.support || null;
  if (hasSupportData(trSupport)) {
    var contentTR = buildContentFromSupport(trItem, siteVal, "TECHNICAL_ROOM", trSupport);
    contentTR.support_source = "TECHNICAL_ROOM";
    contentTR.site_used = siteVal;
    // valor usado para mapear para a sala técnica
    resultsEnvelope.content = contentTR;
    resultsEnvelope.logs.push(
      JSON.stringify({
        stage: "CONTENT_BUILT",
        source: "TECHNICAL_ROOM"
      })
    );
    return finish(true, "OK");
  }

  // Sem sucesso no fallback
  resultsEnvelope.logs.push(
    JSON.stringify({
      stage: "FALLBACK_DONE",
      info: "No support found in TECHNICAL_ROOM."
    })
  );
  var contentNone = buildContentFromSupport(baseItem, ciNameInput, classInput, {});
  contentNone.support_source = "NONE";
  contentNone.site_used = siteVal;
  resultsEnvelope.content = contentNone;
  return finish(true, "OK");
}

function aiToolsMasterDBTemplateAttributesGet(ticket, params) {
  // Helpers mínimos
  function safeStr(v, max) {
    try {
      var s = String(v === null ? "" : v);
      return max && s.length > max ? s.substring(0, max) + "...[truncated]" : s;
    } catch (e) {
      return "[unavailable]";
    }
  }
  function addFilter(arr, k, v) {
    if (!k) return;
    if (v === undefined || v === null || v === "") return;
    if (Array.isArray(v)) {
      if (v.length > 0) arr.push(k + "=" + v.join(","));
    } else arr.push(k + "=" + v);
  }
  function normalizeReturnFields(rf) {
    if (!rf) return "";
    var s = String(rf).trim();
    return s.indexOf(",") !== -1
      ? s
          .split(",")
          .map(function (x) {
            return x.trim();
          })
          .join(";")
      : s;
  }
  function safeTryGet(t) {
    try {
      return String(t.getResult().getObject() || t.getOutput() || "");
    } catch (e) {
      return "";
    }
  }
  function runSearch(queryPayload) {
    var t = ModuleUtils.runFunction("/masterdb/ci/search", ticket.getRequestContext(), JSON.stringify(queryPayload));
    if (!ModuleUtils.waitForTicketsSuccess(t))
      return {
        ok: false,
        raw: safeTryGet(t)
      };
    try {
      var rawStr = String(t.getResult().getObject());
      var parsedObj = JSON.parse(rawStr);
      var resultsArr = parsedObj && parsedObj.data_output && Array.isArray(parsedObj.data_output.result) ? parsedObj.data_output.result : [];
      var fullCount = parsedObj && parsedObj.data_output && typeof parsedObj.data_output.result_full_count === "number" ? parsedObj.data_output.result_full_count : null;
      return {
        ok: true,
        parsed: parsedObj,
        arr: resultsArr,
        full: fullCount,
        raw: rawStr
      };
    } catch (e) {
      return {
        ok: false,
        raw: "parse_error:" + e
      };
    }
  }

  // Envelope simples (content + logs)
  var responseEnvelope = "";
  var resultsEnvelope = {
    content: null,
    logs: []
  };

  function finish(okFlag, codeStr) {
    try {
      responseEnvelope = ModuleUtils.setResponse(responseEnvelope, okFlag ? TheSysModuleFunctionResult.RESULT_OK : TheSysModuleFunctionResult.RESULT_NOK, codeStr || (okFlag ? "OK" : "NOK")) || responseEnvelope;
    } catch (e) {}
    try {
      responseEnvelope = ModuleUtils.setOutput(responseEnvelope, 11, JSON.stringify(resultsEnvelope)) || responseEnvelope;
    } catch (e) {}
    ticket.getResult().setObject(responseEnvelope && String(responseEnvelope).charAt(0) === "{" ? responseEnvelope : JSON.stringify(resultsEnvelope));
    ticket.getResult().setResult(okFlag ? TheSysModuleFunctionResult.RESULT_OK : TheSysModuleFunctionResult.RESULT_NOK);
  }

  // Parse params (corrigido)
  var p = {};
  try {
    p = JSON.parse(params && params.size && params.size() > 0 ? params.get(0) || "{}" : "{}");
  } catch (e) {
    resultsEnvelope.logs.push(
      JSON.stringify({
        error: "MALFORMED_PARAMS",
        detail: safeStr(e, 400),
        raw: safeStr(params && params.get ? params.get(0) : "", 400)
      })
    );
    return finish(false, "MALFORMED_PARAMS");
  }
  resultsEnvelope.logs.push(
    JSON.stringify({
      parameters: p
    })
  );

  // Parâmetros de filtragem de entrada
  // classification -> mapeado a ci_name do TEMPLATE
  var templateNameFilter = p.ci_classification || p.classification || p.template_name ? String(p.ci_classification || p.classification || p.template_name).trim() : "";
  var attributeKeyFilter = p.attribute ? String(p.attribute).trim() : "";
  var statusFilterAll = String(p.status || "").toUpperCase() === "ALL";
  var statusFilterVal = statusFilterAll ? null : p.status ? String(p.status) : "~eq~Live";

  // Paginação
  var limitVal = Number(p.limit || 1000);
  var skipVal = Number(p.skip || 0);

  // return_fields – garantir que traz attributes e refdata
  var returnFields = normalizeReturnFields(p.return_fields || "ci_name,attributes,status");

  // Construção dos filtros de pesquisa
  var filterParts = [];
  addFilter(filterParts, "ci_classification", "~eq~TEMPLATE");
  if (!statusFilterAll) addFilter(filterParts, "status", statusFilterVal);
  if (templateNameFilter) addFilter(filterParts, "ci_name", "~eq~" + templateNameFilter);

  var filterList = [];
  var filterAndStr = filterParts.join("&");
  if (filterAndStr) filterList.push(filterAndStr);

  var queryPayload = {
    skip: skipVal,
    limit: limitVal,
    sort_order: 1,
    sort_field: "ci_name",
    filters: filterList,
    return_fields: returnFields,
    relations: false
  };
  resultsEnvelope.logs.push(
    JSON.stringify({
      stage: "BUILD_QUERY",
      query: queryPayload
    })
  );

  // Execução do search
  var searchRes = runSearch(queryPayload);
  if (!searchRes.ok) {
    resultsEnvelope.logs.push(
      JSON.stringify({
        error: "BACKEND_ERROR",
        detail: searchRes.raw
      })
    );
    return finish(false, "BACKEND_ERROR");
  }
  resultsEnvelope.logs.push(
    JSON.stringify({
      stage: "SEARCH_DONE",
      result_count: searchRes.arr.length,
      result_full_count: searchRes.full
    })
  );

  // Processamento dos atributos (com filtro por attribute, se fornecido)
  var itemsOut = [];
  for (var i = 0; i < searchRes.arr.length; i++) {
    var ci = searchRes.arr[i] || {};
    var tplName = ci.ci_name || "";
    var attrs = ci.attributes;

    if (!Array.isArray(attrs)) continue;

    for (var j = 0; j < attrs.length; j++) {
      var a = attrs[j] || {};
      var key = a.key || "";
      if (attributeKeyFilter && key !== attributeKeyFilter) continue;

      itemsOut.push({
        template_name: tplName,
        attribute: key,
        description: a.description || "",
        rules: Array.isArray(a.rules) ? a.rules : a.rules ? [String(a.rules)] : [],
        refdata: Array.isArray(a.refdata) ? a.refdata : a.refdata !== undefined && a.refdata !== null ? a.refdata : null
      });
    }
  }

  // Montagem do content final
  resultsEnvelope.content = {
    count: itemsOut.length,
    items: itemsOut
  };
  resultsEnvelope.logs.push(
    JSON.stringify({
      stage: "CONTENT_BUILT",
      matched_items: itemsOut.length
    })
  );

  return finish(true, "OK");
}

function aiToolsMasterDBClassificationsGet(ticket, params) {
  // Helpers
  function safeStr(v, max) {
    try {
      var s = String(v || "");
      return s.length > max ? s.substring(0, max) + "...[truncated]" : s;
    } catch (e) {
      return "[unavailable]";
    }
  }
  function addLogObj(obj, arr) {
    try {
      arr.push(JSON.stringify(obj));
    } catch (e) {}
  }

  // Output simples: { content, logs }
  var results = {
    content: null,
    logs: []
  };

  // Params opcionais (apenas para log)
  var p = {};
  try {
    var rawIn = params && params.size && params.size() > 0 ? params.get(0) || "{}" : "{}";
    p = JSON.parse(rawIn);
  } catch (e) {
    addLogObj(
      {
        error: "MALFORMED_PARAMS",
        detail: safeStr(e, 600),
        raw: safeStr(params && params.get ? params.get(0) : "", 600)
      },
      results.logs
    );
    ticket.getResult().setObject(JSON.stringify(results));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }

  // Logs conforme pedido
  addLogObj(
    {
      parameters: p
    },
    results.logs
  );
  addLogObj(
    {
      stage: "CALL",
      funcao: "/masterdb/ci/classifications"
    },
    results.logs
  );

  // Chamada ao backend (sem payload)
  var t = ModuleUtils.runFunction("/masterdb/ci/classifications", ticket.getRequestContext());
  if (!ModuleUtils.waitForTicketsSuccess(t)) {
    var rawFail;
    try {
      rawFail = t.getResult() ? String(t.getResult().getObject()) : "null";
    } catch (er) {
      rawFail = "unavailable: " + er;
    }
    addLogObj(
      {
        error: "BACKEND_ERROR",
        stage: "CALL",
        raw: safeStr(rawFail, 2000)
      },
      results.logs
    );
    ticket.getResult().setObject(JSON.stringify(results));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }

  // Parse e construção do output simples
  var rawObjStr;
  try {
    rawObjStr = String(t.getResult().getObject());
    var parsed = JSON.parse(rawObjStr);
    var data = parsed && parsed.data_output ? parsed.data_output : null;

    addLogObj(
      {
        stage: "FETCH_DONE",
        result_count: data && typeof data.result_count === "number" ? data.result_count : data && Array.isArray(data.result) ? data.result.length : null,
        result_full_count: data && typeof data.result_full_count === "number" ? data.result_full_count : null,
        execution_duration: parsed && parsed.execution_duration !== undefined ? parsed.execution_duration : null
      },
      results.logs
    );

    results.content = data;

    addLogObj(
      {
        stage: "CONTENT_BUILT",
        matched_items: data && Array.isArray(data.result) ? data.result.length : 0
      },
      results.logs
    );

    ticket.getResult().setObject(JSON.stringify(results));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_OK);
    return;
  } catch (e) {
    addLogObj(
      {
        error: "PARSE_ERROR",
        stage: "PARSE",
        raw: safeStr(rawObjStr, 2000),
        detail: String(e)
      },
      results.logs
    );
    ticket.getResult().setObject(JSON.stringify(results));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }
}

function aiToolsMasterDBDependencySearch(ticket, params) {
  // Helpers
  function safeStr(v, max) {
    try {
      var s = String(v === null || v === undefined ? "" : v);
      return max && s.length > max ? s.substring(0, max) + "...[truncated]" : s;
    } catch (e) {
      return "[unavailable]";
    }
  }
  function addLogObj(obj, arr) {
    try {
      arr.push(JSON.stringify(obj));
    } catch (e) {}
  }
  function toStr(v, dflt) {
    return v === undefined || v === null ? dflt || "" : String(v);
  }
  function normUpper(v) {
    return toStr(v, "").trim().toUpperCase();
  }
  function firstIpFrom(dest) {
    try {
      var addrs = dest && dest.network && Array.isArray(dest.network.addresses) ? dest.network.addresses : null;
      return addrs && addrs.length > 0 && addrs[0].ip ? String(addrs[0].ip) : null;
    } catch (e) {
      return null;
    }
  }
  function buildClassifications(p) {
    var raw = p.classifications || p.classification || p.ci_classifications || p.ci_classification || "";
    if (Array.isArray(raw))
      return raw
        .map(function (x) {
          return normUpper(x);
        })
        .filter(function (x) {
          return x.length > 0;
        })
        .join("|");
    var s = String(raw || "").trim();
    if (s.indexOf("|") > -1)
      return s
        .split("|")
        .map(function (x) {
          return normUpper(x);
        })
        .filter(function (x) {
          return x.length > 0;
        })
        .join("|");
    return normUpper(s);
  }

  function runCISearch(queryPayload) {
    var tci = ModuleUtils.runFunction("/masterdb/ci/search", ticket.getRequestContext(), JSON.stringify(queryPayload));
    if (!ModuleUtils.waitForTicketsSuccess(tci)) {
      var rawFailCI;
      try {
        rawFailCI = tci.getResult() ? String(tci.getResult().getObject()) : "null";
      } catch (er) {
        rawFailCI = "unavailable: " + er;
      }
      return { ok: false, arr: [], raw: safeStr(rawFailCI, 2000) };
    }
    var rawCIStr;
    try {
      rawCIStr = String(tci.getResult().getObject());
      var parsedCI = JSON.parse(rawCIStr);
      var arrCI = parsedCI && parsedCI.data_output && Array.isArray(parsedCI.data_output.result) ? parsedCI.data_output.result : [];
      return { ok: true, arr: arrCI, full: parsedCI.data_output ? parsedCI.data_output.result_full_count || 0 : 0 };
    } catch (eCIp) {
      return { ok: false, arr: [], raw: safeStr(eCIp, 400) };
    }
  }

  // Envelope simples: { content, logs }
  var results = {
    content: null,
    logs: []
  };

  // Parse params
  var p = {};
  try {
    var rawIn = params && params.size && params.size() > 0 ? params.get(0) || "" : "";
    p = JSON.parse(rawIn);
  } catch (e) {
    addLogObj(
      {
        error: "MALFORMED_PARAMS",
        detail: safeStr(e, 600),
        raw: safeStr(params && params.get ? params.get(0) : "", 600)
      },
      results.logs
    );
    ticket.getResult().setObject(JSON.stringify(results));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }

  // NormalizaÃ§Ã£o dos inputs com defaults pedidos
  var depth = toStr(p.depth, "10").trim();
  var relationName = toStr(p.relation_name || p.relation || "DEFAULT").trim();
  var ci = toStr(p.ci || p.ci_name, "")
    .trim()
    .toUpperCase();
  var classesStr = buildClassifications(p);
  var directionIn = toStr(p.direction, "").trim().toUpperCase();
  var direction = directionIn || "L2R";
  // default
  var status = toStr(p.status || "Deployed").trim();
  var stopMode = toStr(p.stop_mode || "depth").trim();
  var summary = toStr(p.summary, "yes").trim().toLowerCase();
  // default "yes"
  var sourceClass = normUpper(toStr(p.source_classification || p.origin_classification || p.ci_source_classification || "", ""));

  addLogObj(
    {
      parameters: {
        depth: depth,
        relation_name: relationName,
        ci: ci,
        classifications: classesStr,
        source_classification: sourceClass || "(not provided)",
        direction: directionIn || "(default:L2R)",
        status: status,
        stop_mode: stopMode,
        summary: summary
      }
    },
    results.logs
  );

  if (!ci) {
    addLogObj(
      {
        error: "MISSING_INPUT",
        message: "Parameter 'ci' (ci_name) is required."
      },
      results.logs
    );
    results.content = null;
    ticket.getResult().setObject(JSON.stringify(results));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_OK);
    return;
  }

  if (!classesStr) {
    addLogObj(
      {
        error: "MISSING_INPUT",
        field: "ci_classifications",
        action: "Call Find with ci_name=" + ci + " to get its ci_classification, then use skill masterdb_topology_dependencies to map it to the correct ci_classifications value, and retry."
      },
      results.logs
    );
    results.content = null;
    ticket.getResult().setObject(JSON.stringify(results));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_OK);
    return;
  }

  // Preparar chamada (endpoint recebe argumentos POSICIONAIS)
  var fn = "/masterdb/dependency/searchv2";

  // Lista de relation_names a pesquisar sempre
  var relationNamesToSearch = ["DEFAULT"];

  function callSearch(dir, relName) {
    var args = [depth, relName, ci, classesStr, dir, status, stopMode];
    if (summary) args.push(summary);
    addLogObj(
      {
        stage: "CALL",
        funcao: fn,
        relation_name: relName,
        args: args
      },
      results.logs
    );

    var t;
    try {
      if (args.length === 7) t = ModuleUtils.runFunction(fn, ticket.getRequestContext(), args[0], args[1], args[2], args[3], args[4], args[5], args[6]);
      else t = ModuleUtils.runFunction(fn, ticket.getRequestContext(), args[0], args[1], args[2], args[3], args[4], args[5], args[6], args[7]);
    } catch (eCall) {
      addLogObj(
        {
          error: "BACKEND_CALL_EXCEPTION",
          relation_name: relName,
          detail: safeStr(eCall, 800)
        },
        results.logs
      );
      return {
        ok: false,
        err: "CALL_EXCEPTION"
      };
    }

    if (!ModuleUtils.waitForTicketsSuccess(t)) {
      var rawFail;
      try {
        rawFail = t.getResult() ? String(t.getResult().getObject()) : "null";
      } catch (er) {
        rawFail = "unavailable: " + er;
      }
      addLogObj(
        {
          error: "BACKEND_ERROR",
          stage: "CALL",
          relation_name: relName,
          raw: safeStr(rawFail, 2000)
        },
        results.logs
      );
      return {
        ok: false,
        err: "BACKEND_ERROR"
      };
    }

    var rawObjStr;
    try {
      rawObjStr = String(t.getResult().getObject());
      var parsed = JSON.parse(rawObjStr);
      var data = parsed && parsed.data_output && parsed.data_output.result ? parsed.data_output.result : null;
      var dests = data && Array.isArray(data.destinations) ? data.destinations : [];
      addLogObj(
        {
          stage: "FETCH_DONE",
          relation_name: relName,
          result_count: dests.length,
          execution_duration: parsed && parsed.execution_duration !== undefined ? parsed.execution_duration : null,
          direction_used: dir
        },
        results.logs
      );
      return {
        ok: true,
        parsed: parsed,
        data: data,
        dests: dests,
        dir: dir,
        relName: relName
      };
    } catch (eParse) {
      addLogObj(
        {
          error: "PARSE_ERROR",
          stage: "PARSE",
          relation_name: relName,
          detail: String(eParse)
        },
        results.logs
      );
      return {
        ok: false,
        err: "PARSE_ERROR"
      };
    }
  }

  // ExecuÃ§Ã£o para todas as relation_names (DEFAULT, VOLUME, MAPPING)
  // SEMPRE pesquisar ambas as direÃ§Ãµes: L2R e R2L
  var allDests = [];
  var seenCiKeys = {};
  var originData = null;
  var directionsUsed = [];
  var relationsUsed = [];
  var directions = ["L2R", "R2L"];

  for (var rIdx = 0; rIdx < relationNamesToSearch.length; rIdx++) {
    var currentRelName = relationNamesToSearch[rIdx];

    // Pesquisar ambas as direÃ§Ãµes para cada relation_name
    for (var dIdx = 0; dIdx < directions.length; dIdx++) {
      var currentDir = directions[dIdx];

      var res = callSearch(currentDir, currentRelName);
      if (!res.ok) {
        // Continuar para a prÃ³xima direÃ§Ã£o/relation mesmo que esta falhe
        continue;
      }

      // Guardar origin do primeiro resultado vÃ¡lido
      if (!originData && res.data && res.data.origin) {
        originData = res.data.origin;
      }

      // Agregar destinos (evitar duplicados pelo ci_name + classification + direction)
      if (res.dests && res.dests.length > 0) {
        if (relationsUsed.indexOf(currentRelName) === -1) {
          relationsUsed.push(currentRelName);
        }
        if (directionsUsed.indexOf(currentDir) === -1) {
          directionsUsed.push(currentDir);
        }

        for (var destIdx = 0; destIdx < res.dests.length; destIdx++) {
          var dest = res.dests[destIdx];
          var ciKey = (dest.ci_name || "") + "|" + (dest.ci_classification || "");
          if (!seenCiKeys[ciKey]) {
            seenCiKeys[ciKey] = true;
            // Adicionar info de qual relation e direÃ§Ã£o trouxe este destino
            dest._relation_source = currentRelName;
            dest._direction = currentDir;
            allDests.push(dest);
          }
        }
      }
    }
  }

  // --- FALLBACK: TECHNICAL_ROOM â†’ pesquisa por site ---
  // Quando o CI de origem Ã© uma TECHNICAL_ROOM e nÃ£o hÃ¡ resultados de dependÃªncias,
  // pesquisar na MasterDB por site={{ci_name}} + ci_classification={{target}}
  var siteFallbackUsed = false;
  if (allDests.length === 0 && classesStr) {
    var originClassFB = originData && originData.ci_classification ? normUpper(String(originData.ci_classification)) : "";
    var isTR = originClassFB === "TECHNICAL_ROOM" || sourceClass === "TECHNICAL_ROOM";

    if (isTR) {
      addLogObj(
        {
          stage: "SITE_FALLBACK",
          info: "TECHNICAL_ROOM com 0 resultados de dependÃªncias. Pesquisar por site=" + ci,
          target_classifications: classesStr
        },
        results.logs
      );

      var targetClasses = classesStr.split("|");
      var siteFBReturnFields = "ci_name;ci_classification;status;site;manufacturer;model;platform;operating_system;operating_system_family;environment;layer1;layer2;group_type;type;location;owner;support_team;network";
      var siteFBLimit = Number(p.limit || 100);
      var siteFBStatus = status && normUpper(status) !== "ALL" ? status : null;

      for (var tcIdx = 0; tcIdx < targetClasses.length; tcIdx++) {
        var targetClass = targetClasses[tcIdx].trim();
        if (!targetClass) continue;

        var siteFilterStr = "ci_classification=~eq~" + targetClass + "&site=~eq~" + ci;
        if (siteFBStatus) siteFilterStr += "&status=~eq~" + siteFBStatus;

        var siteQuery = {
          skip: 0,
          limit: siteFBLimit,
          sort_order: -1,
          sort_field: "_created_date",
          filters: [siteFilterStr],
          return_fields: siteFBReturnFields,
          relations: false
        };

        addLogObj(
          {
            stage: "SITE_FALLBACK_CALL",
            target_classification: targetClass,
            filter: siteFilterStr
          },
          results.logs
        );

        var siteRes = runCISearch(siteQuery);
        if (!siteRes.ok) {
          addLogObj(
            {
              stage: "SITE_FALLBACK_ERROR",
              target_classification: targetClass,
              detail: siteRes.raw
            },
            results.logs
          );
          continue;
        }

        addLogObj(
          {
            stage: "SITE_FALLBACK_DONE",
            target_classification: targetClass,
            result_count: siteRes.arr.length
          },
          results.logs
        );

        for (var sfIdx = 0; sfIdx < siteRes.arr.length; sfIdx++) {
          var sfDest = siteRes.arr[sfIdx] || {};
          var sfKey = (sfDest.ci_name || "") + "|" + (sfDest.ci_classification || "");
          if (!seenCiKeys[sfKey]) {
            seenCiKeys[sfKey] = true;
            sfDest._relation_source = "SITE_FALLBACK";
            sfDest._direction = null;
            allDests.push(sfDest);
            siteFallbackUsed = true;
          }
        }
      }
    }
  }
  // --- FIM FALLBACK ---

  // Construir content flat com foco em destinations
  var origin = originData;
  var dests = allDests;

  var contentOut = {
    origin_ci_name: origin && origin.ci_name ? String(origin.ci_name) : ci || null,
    origin_ci_classification: origin && origin.ci_classification ? String(origin.ci_classification) : null,
    classifications_used: classesStr || null,
    relation_names_searched: relationNamesToSearch,
    relation_names_with_results: relationsUsed,
    directions_searched: directions,
    directions_with_results: directionsUsed,
    site_fallback_used: siteFallbackUsed,
    destinations_count: dests.length,
    destinations: []
  };

  for (var i = 0; i < dests.length; i++) {
    var d = dests[i] || {};
    contentOut.destinations.push({
      ci_name: d.ci_name || null,
      ci_classification: d.ci_classification || null,
      relation_source: d._relation_source || null,
      direction: d._direction || null,
      ip: firstIpFrom(d),
      manufacturer: d.manufacturer || d.vendor || null,
      model: d.model || null,
      platform: d.platform || null,
      operating_system: d.operating_system || null,
      operating_system_family: d.operating_system_family || null,
      environment: d.environment || null,
      layer1: d.layer1 || null,
      layer2: d.layer2 || null,
      group_type: d.group_type || null,
      type: d.type || null,
      site: d.site || null,
      location: d.location || null,
      status: d.status || null,
      owner: d.owner || null,
      support_team: d.support_team || null
    });
  }

  results.content = contentOut;
  addLogObj(
    {
      stage: "CONTENT_BUILT",
      matched_items: dests.length
    },
    results.logs
  );

  ticket.getResult().setObject(JSON.stringify(results));
  ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_OK);
  return;
}

function aiToolsMasterDBImpact(ticket, params) {
  // Helpers
  function safeStr(v, max) {
    try {
      var s = String(v === null || v === undefined ? "" : v);
      return max && s.length > max ? s.substring(0, max) + "...[truncated]" : s;
    } catch (e) {
      return "[unavailable]";
    }
  }
  function addLogObj(obj, arr) {
    try {
      arr.push(JSON.stringify(obj));
    } catch (e) {}
  }
  function toStr(v, dflt) {
    return v === undefined || v === null ? dflt || "" : String(v);
  }
  function normBoolStr(v, dflt) {
    var s = String(v === undefined || v === null ? dflt : v)
      .trim()
      .toLowerCase();
    if (s === "true" || s === "1" || s === "yes") return "true";
    if (s === "false" || s === "0" || s === "no") return "false";
    return String(dflt ? "true" : "false");
  }
  function normBy(v, dflt) {
    var s = String(v === undefined || v === null ? dflt || "name" : v).trim();
    var sl = s.toLowerCase();
    if (sl === "id") return "Id";
    if (sl === "name") return "name";
    return "name";
  }
  function joinPipe(val, opts) {
    var upper = opts && opts.upper === true;
    var trim = opts && opts.trim === false ? false : true;
    var dedup = opts && opts.dedup === false ? false : true;
    function normOne(x) {
      var s = String(x === undefined || x === null ? "" : x);
      if (trim) s = s.trim();
      if (upper) s = s.toUpperCase();
      return s;
    }
    if (val === undefined || val === null) return "";
    if (Array.isArray(val)) {
      var arr = [],
        seen = {};
      for (var i = 0; i < val.length; i++) {
        var it = normOne(val[i]);
        if (!it) continue;
        if (dedup) {
          if (seen[it]) continue;
          seen[it] = true;
        }
        arr.push(it);
      }
      return arr.join("|");
    }
    var raw = String(val);
    var parts = raw
      .split(/[|,]+/g)
      .map(function (x) {
        return normOne(x);
      })
      .filter(function (x) {
        return x.length > 0;
      });
    if (dedup) {
      var arr2 = [],
        seen2 = {};
      for (var j = 0; j < parts.length; j++) {
        var p = parts[j];
        if (seen2[p]) continue;
        seen2[p] = true;
        arr2.push(p);
      }
      return arr2.join("|");
    }
    return parts.join("|");
  }

  // Envelope
  var results = {
    content: null,
    logs: []
  };

  // Parse params
  var p = {};
  try {
    var rawIn = params && params.size && params.size() > 0 ? params.get(0) || "" : "";
    p = JSON.parse(rawIn || "");
  } catch (e) {
    addLogObj(
      {
        error: "MALFORMED_PARAMS",
        detail: safeStr(e, 600),
        raw: safeStr(params && params.get ? params.get(0) : "", 600)
      },
      results.logs
    );
    ticket.getResult().setObject(JSON.stringify(results));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }

  // Defaults pedidos
  var relationName = toStr(p.relationName || p.relation_name || p.relation || "DEFAULT", "DEFAULT").trim() || "DEFAULT";

  // cis: obrigatório (array|string). Mantém-se obrigatório.
  var cisPipe = "";
  if (p.cis !== undefined && p.cis !== null) {
    cisPipe = joinPipe(p.cis, {
      upper: true,
      trim: true,
      dedup: true
    });
  } else if (p.ci || p.ci_name) {
    cisPipe = joinPipe([p.ci || p.ci_name], {
      upper: true,
      trim: true,
      dedup: true
    });
  }

  // classifications: default "SERVICE"
  var classesRaw = p.classifications || p.classification || p.ci_classifications || p.ci_classification || "SERVICE";
  var classificationsPipe = joinPipe(classesRaw, {
    upper: true,
    trim: true,
    dedup: true
  });

  // show_paths: default false
  var showPathsStr = normBoolStr(p.show_paths, false);

  // origins: default "" (vazio)
  var originsPipe = "";
  if (p.origins !== undefined && p.origins !== null) {
    originsPipe = joinPipe(p.origins, {
      upper: false,
      trim: true,
      dedup: true
    });
  } else if (p.origin) {
    originsPipe = joinPipe([p.origin], {
      upper: false,
      trim: true,
      dedup: true
    });
  }
  // senão, fica ""

  // status: default "Deployed"
  var status = toStr(p.status || "Deployed", "Deployed").trim() || "Deployed";

  // by: default "name"
  var byStr = normBy(p.by || "name", "name");

  // cache: default true
  var cacheStr = normBoolStr(p.cache, true);

  // Logs dos parâmetros normalizados
  addLogObj(
    {
      parameters: {
        relation_name: relationName,
        cis: cisPipe,
        classifications: classificationsPipe,
        show_paths: showPathsStr,
        origins: originsPipe,
        status: status,
        by: byStr,
        cache: cacheStr
      }
    },
    results.logs
  );

  // Validação mínima
  if (!cisPipe) {
    addLogObj(
      {
        error: "MISSING_INPUT",
        message: "É necessário fornecer 'cis' (lista ou único CI)."
      },
      results.logs
    );
    ticket.getResult().setObject(JSON.stringify(results));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }

  // Execução
  var fn = "/masterdb/impact/calculatev2";
  addLogObj(
    {
      stage: "CALL",
      funcao: fn,
      args: [relationName, cisPipe, classificationsPipe, showPathsStr, originsPipe, status, byStr, cacheStr]
    },
    results.logs
  );

  var t;
  try {
    t = ModuleUtils.runFunction(fn, ticket.getRequestContext(), relationName, cisPipe, classificationsPipe, showPathsStr, originsPipe, status, byStr, cacheStr);
  } catch (eCall) {
    addLogObj(
      {
        error: "BACKEND_CALL_EXCEPTION",
        detail: safeStr(eCall, 800)
      },
      results.logs
    );
    ticket.getResult().setObject(JSON.stringify(results));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }

  if (!ModuleUtils.waitForTicketsSuccess(t)) {
    var rawFail;
    try {
      rawFail = t.getResult() ? String(t.getResult().getObject()) : "null";
    } catch (er) {
      rawFail = "unavailable: " + er;
    }
    addLogObj(
      {
        error: "BACKEND_ERROR",
        stage: "CALL",
        raw: safeStr(rawFail, 2000)
      },
      results.logs
    );
    ticket.getResult().setObject(JSON.stringify(results));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }

  // Parse e output
  var rawObjStr;
  try {
    rawObjStr = String(t.getResult().getObject());
    var parsed = JSON.parse(rawObjStr);
    var data = parsed && parsed.data_output ? parsed.data_output : null;
    var impactsCount = data && Array.isArray(data.impacts) ? data.impacts.length : 0;

    addLogObj(
      {
        stage: "FETCH_DONE",
        impacts_count: impactsCount,
        execution_duration: parsed && parsed.execution_duration !== undefined ? parsed.execution_duration : null,
        status_code: parsed && parsed.status_code ? String(parsed.status_code) : null
      },
      results.logs
    );

    results.content = data;
    addLogObj(
      {
        stage: "CONTENT_BUILT",
        matched_items: impactsCount
      },
      results.logs
    );

    ticket.getResult().setObject(JSON.stringify(results));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_OK);
    return;
  } catch (eParse) {
    addLogObj(
      {
        error: "PARSE_ERROR",
        stage: "PARSE",
        raw: safeStr(rawObjStr, 2000),
        detail: String(eParse)
      },
      results.logs
    );
    ticket.getResult().setObject(JSON.stringify(results));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }
}

function aiToolsMasterDBExportEmailCSV(ticket, params) {
  // Helpers
  function safeStr(v, max) {
    try {
      var s = String(v === null || v === undefined ? "" : v);
      return max && s.length > max ? s.substring(0, max) + "...[truncated]" : s;
    } catch (e) {
      return "[unavailable]";
    }
  }
  function addLogObj(obj, arr) {
    try {
      arr.push(JSON.stringify(obj));
    } catch (e) {}
  }
  function toStringArray(val) {
    if (val === undefined || val === null) return [];
    if (Array.isArray(val))
      return val
        .map(function (x) {
          return String(x || "").trim();
        })
        .filter(function (x) {
          return x.length > 0;
        });
    var s = String(val).trim();
    return s ? [s] : [];
  }
  function unique(arr) {
    var seen = {},
      out = [];
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i];
      if (!seen[v]) {
        seen[v] = true;
        out.push(v);
      }
    }
    return out;
  }
  function getValueFromPath(obj, path) {
    var parts = String(path || "").split(".");
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur === null || typeof cur !== "object" || !cur.hasOwnProperty(parts[i])) return null;
      cur = cur[parts[i]];
    }
    return cur;
  }
  function isValidEmail(s) {
    try {
      var str = String(s || "").trim();
      var re = new RegExp("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$");
      return re.test(str);
    } catch (e) {
      return false;
    }
  }

  // Envelope unificado
  var results = {
    content: null,
    logs: []
  };

  // Parse input
  var p = {};
  try {
    var rawIn = params && params.size && params.size() > 0 ? params.get(0) || "" : "";
    p = JSON.parse(rawIn || "{}");
  } catch (e) {
    addLogObj(
      {
        error: "MALFORMED_PARAMS",
        detail: safeStr(e, 600),
        raw: safeStr(params && params.get ? params.get(0) : "", 600)
      },
      results.logs
    );
    ticket.getResult().setObject(JSON.stringify(results));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }

  // OBRIGATÓRIOS
  var filterConditions = toStringArray(p.filterConditions || p.filters);
  var returnFields = unique(toStringArray(p.returnFields || p.fields));
  var emailRecipient = String(p.emailRecipient || p.email || "").trim();

  if (filterConditions.length === 0) {
    addLogObj(
      {
        error: "MISSING_INPUT",
        message: "'filterConditions' é obrigatório (array de strings não vazio)."
      },
      results.logs
    );
    ticket.getResult().setObject(JSON.stringify(results));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }
  if (returnFields.length === 0) {
    addLogObj(
      {
        error: "MISSING_INPUT",
        message: "'returnFields' é obrigatório (array de strings não vazio)."
      },
      results.logs
    );
    ticket.getResult().setObject(JSON.stringify(results));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }
  if (!emailRecipient || !isValidEmail(emailRecipient)) {
    addLogObj(
      {
        error: "MISSING_INPUT",
        message: "'emailRecipient' é obrigatório e deve ser um email válido."
      },
      results.logs
    );
    ticket.getResult().setObject(JSON.stringify(results));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }

  // Opcionais (não obrigatórios)
  var emailCc = String(p.emailCc || "").trim();
  var emailBcc = String(p.emailBcc || "").trim();
  var emailSubjectPref = String(p.emailSubjectPrefix || "MasterDB Export").trim();
  var exportName = String(p.exportName || "masterdb_export").trim();

  // Preparação
  var startTime = new Date();
  var dayPart = startTime.toISOString().slice(0, 10);
  // YYYY-MM-DD

  // Sanitização de headers e campos a pedir ao backend
  var sanitizedFields = returnFields.filter(function (f) {
    return f !== "day_part";
  });
  var csvHeaders = sanitizedFields.map(function (f) {
    return f.replace(/./g, "_");
  });
  csvHeaders.push("day_part");

  var fieldsToRequest = [];
  for (var i = 0; i < sanitizedFields.length; i++) {
    var f = sanitizedFields[i];
    if (f === "ip") {
      fieldsToRequest.push("network.addresses");
      continue;
    }
    if (f === "latitude" || f === "longitude") {
      fieldsToRequest.push("location_details.coordinates");
      continue;
    }
    if (f === "created_date") {
      fieldsToRequest.push("_created_date");
      continue;
    }
    if (f === "updated_date") {
      fieldsToRequest.push("_updated_date");
      continue;
    }
    fieldsToRequest.push(f);
  }
  fieldsToRequest = unique(fieldsToRequest);
  var return_fields_str = fieldsToRequest.join(";");

  addLogObj(
    {
      parameters: {
        filterConditions_count: filterConditions.length,
        returnFields: returnFields,
        normalized_return_fields: return_fields_str,
        emailRecipient: emailRecipient,
        exportName: exportName
      }
    },
    results.logs
  );

  // Extração paginada
  var pageSize = Number(p.page_size || 10000);
  var sort_field = String(p.sort_field || "_id");
  var sort_order = p.sort_order === 1 || p.sort_order === -1 ? p.sort_order : 1;

  var totalProcessed = 0;
  var pageNumber = 0;
  var finalRows = [];
  var more = true;

  function buildQuery(skip) {
    return {
      skip: skip,
      limit: pageSize,
      sort_order: sort_order,
      sort_field: sort_field,
      filters: filterConditions,
      return_fields: return_fields_str,
      relations: false
    };
  }

  while (more) {
    var skip = pageNumber * pageSize;
    var query = buildQuery(skip);
    addLogObj(
      {
        stage: "SEARCH_CALL",
        page: pageNumber + 1,
        skip: skip,
        limit: pageSize
      },
      results.logs
    );
    var t = ModuleUtils.runFunction("/masterdb/ci/search", ticket.getRequestContext(), JSON.stringify(query));
    if (!ModuleUtils.waitForTicketsSuccess(t)) {
      var rawFail;
      try {
        rawFail = t.getResult() ? String(t.getResult().getObject()) : "null";
      } catch (er) {
        rawFail = "unavailable: " + er;
      }
      addLogObj(
        {
          error: "BACKEND_ERROR",
          stage: "SEARCH_CALL",
          raw: safeStr(rawFail, 1000)
        },
        results.logs
      );
      ticket.getResult().setObject(JSON.stringify(results));
      ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
      return;
    }
    var rawObjStr = "";
    var arr = [];
    try {
      rawObjStr = String(t.getResult().getObject() || "");
      var parsed = JSON.parse(rawObjStr);
      arr = parsed && parsed.data_output && Array.isArray(parsed.data_output.result) ? parsed.data_output.result : [];
    } catch (eParse) {
      addLogObj(
        {
          error: "PARSE_ERROR",
          stage: "SEARCH_PARSE",
          raw: safeStr(rawObjStr, 1000),
          detail: String(eParse)
        },
        results.logs
      );
      ticket.getResult().setObject(JSON.stringify(results));
      ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
      return;
    }

    addLogObj(
      {
        stage: "SEARCH_PAGE_DONE",
        page: pageNumber + 1,
        count: arr.length
      },
      results.logs
    );
    if (arr.length === 0) {
      more = false;
      break;
    }
    totalProcessed += arr.length;

    for (var r = 0; r < arr.length; r++) {
      var doc = arr[r];
      var out = {};
      for (var k = 0; k < sanitizedFields.length; k++) {
        var original = sanitizedFields[k];
        var csvKey = original.replace(/\./g, "_");
        var value = null;
        if (original === "ip") {
          try {
            var addrs = doc.network && Array.isArray(doc.network.addresses) ? doc.network.addresses : [];
            var ips = [];
            for (var a = 0; a < addrs.length; a++) {
              var ip = addrs[a] && addrs[a].ip ? String(addrs[a].ip) : "";
              if (ip) ips.push(ip);
            }
            value = ips.length > 0 ? ips.join(",") : "";
          } catch (e) {
            value = "";
          }
        } else if (original === "latitude") {
          value = doc.location_details && doc.location_details.coordinates && doc.location_details.coordinates.latitude !== undefined ? String(doc.location_details.coordinates.latitude) : "";
        } else if (original === "longitude") {
          value = doc.location_details && doc.location_details.coordinates && doc.location_details.coordinates.longitude !== undefined ? String(doc.location_details.coordinates.longitude) : "";
        } else if (original === "created_date") {
          value = doc._created_date ? new Date(doc._created_date).toISOString() : "";
        } else if (original === "updated_date") {
          value = doc._updated_date ? new Date(doc._updated_date).toISOString() : "";
        } else {
          var v = getValueFromPath(doc, original);
          if (v instanceof Date) value = v.toISOString();
          else if (v && typeof v === "object") value = JSON.stringify(v);
          else value = v === null || v === undefined ? "" : String(v);
        }
        out[csvKey] = value;
      }
      out["day_part"] = dayPart;
      finalRows.push(out);
    }

    if (arr.length < pageSize) {
      more = false;
      break;
    }
    pageNumber++;
  }

  // CSV local
  var csvPath = null;
  var rowsCount = finalRows.length;
  addLogObj(
    {
      stage: "TRANSFORM_DONE",
      rows: rowsCount
    },
    results.logs
  );

  if (rowsCount > 0) {
    var csvArray = [];
    csvArray.push(csvHeaders);
    for (var i2 = 0; i2 < finalRows.length; i2++) {
      var line = [];
      for (var h = 0; h < csvHeaders.length; h++) {
        var key = csvHeaders[h];
        var val = finalRows[i2][key];
        line.push(val === undefined || val === null ? "" : String(val));
      }
      csvArray.push(line);
    }

    var storagePathStr = TheSysController.getConfigBasePath() + File.separator + "localStorage" + File.separator + "masterdb_email_exports";
    try {
      var dir = new File(storagePathStr);
      if (!dir.exists()) dir.mkdirs();
    } catch (e) {}
    csvPath = storagePathStr + File.separator + "export_" + exportName + "_" + dayPart + ".csv";

    addLogObj(
      {
        stage: "CSV_WRITE_CALL",
        file: csvPath,
        rows_incl_header: csvArray.length
      },
      results.logs
    );
    var tCsv = ModuleUtils.runFunction("/fileutils/storetocsvwithencoding", ticket.getRequestContext(), "FIELDSEPARATOR=;", JSON.stringify(csvArray), csvPath, "yes", "Windows-1252");
    if (!ModuleUtils.waitForTicketsSuccess(tCsv)) {
      var rawCsv;
      try {
        rawCsv = tCsv.getResult() ? String(tCsv.getResult().getObject()) : "null";
      } catch (er) {
        rawCsv = "unavailable: " + er;
      }
      addLogObj(
        {
          error: "CSV_WRITE_ERROR",
          raw: safeStr(rawCsv, 800)
        },
        results.logs
      );
      ticket.getResult().setObject(JSON.stringify(results));
      ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
      return;
    }
    addLogObj(
      {
        stage: "CSV_WRITE_DONE",
        path: csvPath
      },
      results.logs
    );
  }

  // Envio de email (HTML + anexo se existir CSV)
  var subject = emailSubjectPref + " | " + exportName + " | " + dayPart;
  var htmlBody = "<p>Olá,</p><p>Segue em anexo o export da MasterDB.</p>" + "<ul>" + "<li>Export: " + exportName + "</li>" + "<li>Day part: " + dayPart + "</li>" + "<li>Items: " + rowsCount + "</li>" + "</ul>" + "<p>Filtros:</p><pre style='font-size:12px'>" + safeStr(JSON.stringify(filterConditions), 1000) + "</pre>" + "<p>Campos:</p><pre style='font-size:12px'>" + safeStr(JSON.stringify(returnFields), 1000) + "</pre>" + "<p>Atenciosamente,<br>O Mestre da MasterDB</p>";
  addLogObj(
    {
      stage: "MAIL_CALL",
      to: emailRecipient,
      cc: emailCc,
      bcc: emailBcc,
      subject: subject,
      attachment: csvPath || "(none)"
    },
    results.logs
  );
  var mailTicket = ModuleUtils.runFunction("/netutils/mail/sendhtmlmailwithattachments2", ticket.getRequestContext(), "", emailRecipient, emailCc, emailBcc, subject, htmlBody, csvPath || "");

  var mailOk = ModuleUtils.waitForTicketsSuccess(mailTicket);
  if (!mailOk) {
    var rawMail;
    try {
      rawMail = mailTicket.getResult() ? String(mailTicket.getResult().getObject()) : "null";
    } catch (er) {
      rawMail = "unavailable: " + er;
    }
    addLogObj(
      {
        error: "MAIL_SEND_ERROR",
        raw: safeStr(rawMail, 800)
      },
      results.logs
    );
    ticket.getResult().setObject(JSON.stringify(results));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }
  addLogObj(
    {
      stage: "MAIL_SENT",
      ok: true
    },
    results.logs
  );

  // Limpeza do CSV temporário
  if (csvPath) {
    var cleanupCmd = "rm " + csvPath;
    addLogObj(
      {
        stage: "CLEANUP_CALL",
        cmd: cleanupCmd
      },
      results.logs
    );
    var cleanT = ModuleUtils.runFunction("/cmd/executelocal", ticket.getRequestContext(), cleanupCmd);
    if (ModuleUtils.waitForTicketsSuccess(cleanT))
      addLogObj(
        {
          stage: "CLEANUP_DONE"
        },
        results.logs
      );
    else
      addLogObj(
        {
          stage: "CLEANUP_SKIPPED_OR_FAILED"
        },
        results.logs
      );
  }

  // Output final
  results.content = {
    export_name: exportName,
    day_part: dayPart,
    items_sent: rowsCount,
    email_to: emailRecipient,
    email_cc: emailCc || null,
    email_bcc: emailBcc || null
  };
  addLogObj(
    {
      stage: "CONTENT_BUILT",
      items: rowsCount
    },
    results.logs
  );

  ticket.getResult().setObject(JSON.stringify(results));
  ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_OK);
  return;
}

function aiToolsMasterDBNetworkIPGet(ticket, params) {
  // Helpers
  function safeStr(v, max) {
    try {
      var s = String(v === null || v === undefined ? "" : v);
      return max && s.length > max ? s.substring(0, max) + "...[truncated]" : s;
    } catch (e) {
      return "[unavailable]";
    }
  }
  function addLogObj(obj, arr) {
    try {
      arr.push(JSON.stringify(obj));
    } catch (e) {}
  }
  function normalizeReturnFields(rf) {
    if (!rf) return "";
    var s = String(rf).trim();
    return s.indexOf(",") !== -1
      ? s
          .split(",")
          .map(function (x) {
            return x.trim();
          })
          .join(";")
      : s;
  }
  function tryGet(t) {
    try {
      return String(t.getResult().getObject() || t.getOutput() || "");
    } catch (e) {
      return "";
    }
  }
  function runSearch(queryPayload) {
    var t = ModuleUtils.runFunction("/masterdb/ci/search", ticket.getRequestContext(), JSON.stringify(queryPayload));
    if (!ModuleUtils.waitForTicketsSuccess(t))
      return {
        ok: false,
        raw: tryGet(t)
      };
    try {
      var rawStr = String(t.getResult().getObject());
      var parsedObj = JSON.parse(rawStr);
      var arr = parsedObj && parsedObj.data_output && Array.isArray(parsedObj.data_output.result) ? parsedObj.data_output.result : [];
      return {
        ok: true,
        parsed: parsedObj,
        arr: arr,
        raw: rawStr
      };
    } catch (e) {
      return {
        ok: false,
        raw: "parse_error:" + e
      };
    }
  }
  function hasSSH(addr) {
    try {
      var props = Array.isArray(addr.properties) ? addr.properties : [];
      for (var i = 0; i < props.length; i++) {
        var p = String(props[i] || "")
          .trim()
          .toUpperCase();
        if (p === "SSH") return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }
  function isDefaultYes(v) {
    if (v === true) return true;
    var s = String(v || "")
      .trim()
      .toUpperCase();
    return s === "Y" || s === "YES" || s === "TRUE" || s === "1";
  }
  function pickAddr(a) {
    return {
      ip: a && a.ip !== undefined ? String(a.ip) : null,
      ifname: a && a.ifname !== undefined ? String(a.ifname) : a && a.name !== undefined ? String(a.name) : null,
      name: a && a.name !== undefined ? String(a.name) : null,
      subnet: a && a.subnet !== undefined ? String(a.subnet) : null,
      subnet_description: a && a.subnet_description !== undefined ? String(a.subnet_description) : null,
      cidr: a && a.cidr !== undefined ? a.cidr : null,
      type: a && a.type !== undefined ? String(a.type) : null,
      mac: a && a.mac !== undefined ? String(a.mac) : null,
      gateway: a && a.gateway !== undefined ? String(a.gateway) : null,
      mask: a && a.mask !== undefined ? String(a.mask) : null,
      default_flag: a && a["default"] !== undefined ? String(a["default"]) : null,
      properties: Array.isArray(a && a.properties) ? a.properties.slice(0) : null
    };
  }
  function pickRoute(r) {
    return {
      ifname: r && r.ifname !== undefined ? String(r.ifname) : null,
      destination: r && r.destination !== undefined ? String(r.destination) : null,
      gateway: r && r.gateway !== undefined ? String(r.gateway) : null,
      mask: r && r.mask !== undefined ? String(r.mask) : null
    };
  }
  function pickPhysical(p) {
    return {
      ifname: p && p.ifname !== undefined ? String(p.ifname) : null,
      state: p && p.state !== undefined ? String(p.state) : null,
      mac: p && p.mac !== undefined ? String(p.mac) : null
    };
  }
  function finish(okFlag, codeStr, resultsEnvelope, responseEnvelopeRef) {
    try {
      responseEnvelopeRef.value = ModuleUtils.setResponse(responseEnvelopeRef.value, okFlag ? TheSysModuleFunctionResult.RESULT_OK : TheSysModuleFunctionResult.RESULT_NOK, codeStr || (okFlag ? "OK" : "NOK")) || responseEnvelopeRef.value;
    } catch (e) {}
    try {
      responseEnvelopeRef.value = ModuleUtils.setOutput(responseEnvelopeRef.value, 11, JSON.stringify(resultsEnvelope)) || responseEnvelopeRef.value;
    } catch (e) {}
    ticket.getResult().setObject(responseEnvelopeRef.value && String(responseEnvelopeRef.value).charAt(0) === "{" ? responseEnvelopeRef.value : JSON.stringify(resultsEnvelope));
    ticket.getResult().setResult(okFlag ? TheSysModuleFunctionResult.RESULT_OK : TheSysModuleFunctionResult.RESULT_NOK);
  }

  // Envelope
  var responseEnvelope = {
    value: ""
  };
  var resultsEnvelope = {
    content: null,
    logs: []
  };

  // Parse params
  var p = {};
  try {
    p = JSON.parse(params && params.size && params.size() > 0 ? params.get(0) || "" : "");
  } catch (e) {
    resultsEnvelope.logs.push(
      JSON.stringify({
        error: "MALFORMED_PARAMS",
        detail: safeStr(e, 400),
        raw: safeStr(params && params.get ? params.get(0) : "", 400)
      })
    );
    return finish(false, "MALFORMED_PARAMS", resultsEnvelope, responseEnvelope);
  }
  resultsEnvelope.logs.push(
    JSON.stringify({
      parameters: p
    })
  );

  // Inputs obrigatórios (ci_classification é opcional)
  var ciName = p.ci_name ? String(p.ci_name).trim() : "";
  var ciClass =
    p.ci_classification || p.classification
      ? String(p.ci_classification || p.classification)
          .trim()
          .toUpperCase()
      : "";
  if (!ciName) {
    resultsEnvelope.logs.push(
      JSON.stringify({
        error: "MISSING_INPUT",
        message: "É necessário fornecer 'ci_name'."
      })
    );
    return finish(false, "MISSING_INPUT", resultsEnvelope, responseEnvelope);
  }

  // Question opcional
  var qraw = p.question || p.query || p.info_type || "";
  var q = String(qraw || "")
    .trim()
    .toLowerCase();

  // return_fields
  var returnFields = normalizeReturnFields(p.return_fields || "ci_name,ci_classification,network");

  // Query
  var filterPartsNet = [];
  if (ciClass) filterPartsNet.push("ci_classification=~eq~" + ciClass);
  filterPartsNet.push("ci_name=~eq~" + ciName);
  var filtersList = filterPartsNet.join("&");
  var queryPayload = {
    skip: 0,
    limit: 1,
    sort_order: -1,
    sort_field: "_created_date",
    filters: [filtersList],
    return_fields: returnFields,
    relations: false
  };
  resultsEnvelope.logs.push(
    JSON.stringify({
      stage: "BUILD_QUERY",
      query: queryPayload
    })
  );

  // Execução
  var searchRes = runSearch(queryPayload);
  if (!searchRes.ok) {
    resultsEnvelope.logs.push(
      JSON.stringify({
        error: "BACKEND_ERROR",
        detail: searchRes.raw
      })
    );
    return finish(false, "BACKEND_ERROR", resultsEnvelope, responseEnvelope);
  }
  resultsEnvelope.logs.push(
    JSON.stringify({
      stage: "SEARCH_DONE",
      result_count: searchRes.arr.length
    })
  );

  if (searchRes.arr.length === 0) {
    resultsEnvelope.logs.push(
      JSON.stringify({
        error: "NOT_FOUND",
        message: "Nenhum CI encontrado para os filtros fornecidos."
      })
    );
    resultsEnvelope.content = {
      ci_name: ciName,
      ci_classification: ciClass,
      management_ip: null,
      service_ip: null,
      management_ips: [],
      service_ips: [],
      addresses: [],
      routing: [],
      physical: []
    };
    return finish(true, "OK", resultsEnvelope, responseEnvelope);
  }

  // Extrair network
  var item = searchRes.arr[0] || {};
  var net = item.network && typeof item.network === "object" ? item.network : {};
  var addresses = Array.isArray(net.addresses) ? net.addresses : [];
  var routing = Array.isArray(net.routing) ? net.routing : [];
  var physical = Array.isArray(net.physical) ? net.physical : [];

  // Seleções
  var mgmtArr = [];
  var svcArr = [];
  for (var i = 0; i < addresses.length; i++) {
    var a = addresses[i] || {};
    if (hasSSH(a)) mgmtArr.push(pickAddr(a));
    if (isDefaultYes(a["default"])) svcArr.push(pickAddr(a));
  }
  var mgmtIp = mgmtArr.length > 0 ? mgmtArr[0].ip || null : null;
  var svcIp = svcArr.length > 0 ? svcArr[0].ip || null : null;

  // Reduções para saída
  var addrsOut = [];
  for (var j = 0; j < addresses.length; j++) {
    addrsOut.push(pickAddr(addresses[j] || {}));
  }
  var routesOut = [];
  for (var r = 0; r < routing.length; r++) {
    routesOut.push(pickRoute(routing[r] || {}));
  }
  var physOut = [];
  for (var pidx = 0; pidx < physical.length; pidx++) {
    physOut.push(pickPhysical(physical[pidx] || {}));
  }

  // Content conforme question
  var contentOut;
  if (q === "management_ip") {
    contentOut = {
      ci_name: item.ci_name || ciName,
      ci_classification: item.ci_classification || ciClass,
      management_ip: mgmtIp,
      management_ips: mgmtArr
    };
  } else if (q === "service_ip") {
    contentOut = {
      ci_name: item.ci_name || ciName,
      ci_classification: item.ci_classification || ciClass,
      service_ip: svcIp,
      service_ips: svcArr
    };
  } else {
    contentOut = {
      ci_name: item.ci_name || ciName,
      ci_classification: item.ci_classification || ciClass,
      management_ip: mgmtIp,
      service_ip: svcIp,
      management_ips: mgmtArr,
      service_ips: svcArr,
      addresses: addrsOut,
      routing: routesOut,
      physical: physOut
    };
  }

  resultsEnvelope.content = contentOut;
  resultsEnvelope.logs.push(
    JSON.stringify({
      stage: "CONTENT_BUILT",
      keys: Object.keys(contentOut)
    })
  );
  return finish(true, "OK", resultsEnvelope, responseEnvelope);
}

function aiToolsMasterDBFindAttributeValues(ticket, params) {
  // Helpers
  function safeStr(v, max) {
    try {
      var s = String(v || "");
      return s.length > max ? s.substring(0, max) + "...[truncated]" : s;
    } catch (e) {
      return "[unavailable]";
    }
  }

  // Remove acentos de uma string (ES5 compatible)
  function removeDiacritics(str) {
    if (!str) return "";
    var s = String(str);
    var map = {};
    map["\u00C1"] = "A"; // Á
    map["\u00C0"] = "A"; // À
    map["\u00C3"] = "A"; // Ã
    map["\u00C2"] = "A"; // Â
    map["\u00C4"] = "A"; // Ä
    map["\u00E1"] = "a"; // á
    map["\u00E0"] = "a"; // à
    map["\u00E3"] = "a"; // ã
    map["\u00E2"] = "a"; // â
    map["\u00E4"] = "a"; // ä
    map["\u00C9"] = "E"; // É
    map["\u00C8"] = "E"; // È
    map["\u00CA"] = "E"; // Ê
    map["\u00CB"] = "E"; // Ë
    map["\u00E9"] = "e"; // é
    map["\u00E8"] = "e"; // è
    map["\u00EA"] = "e"; // ê
    map["\u00EB"] = "e"; // ë
    map["\u00CD"] = "I"; // Í
    map["\u00CC"] = "I"; // Ì
    map["\u00CE"] = "I"; // Î
    map["\u00CF"] = "I"; // Ï
    map["\u00ED"] = "i"; // í
    map["\u00EC"] = "i"; // ì
    map["\u00EE"] = "i"; // î
    map["\u00EF"] = "i"; // ï
    map["\u00D3"] = "O"; // Ó
    map["\u00D2"] = "O"; // Ò
    map["\u00D5"] = "O"; // Õ
    map["\u00D4"] = "O"; // Ô
    map["\u00D6"] = "O"; // Ö
    map["\u00F3"] = "o"; // ó
    map["\u00F2"] = "o"; // ò
    map["\u00F5"] = "o"; // õ
    map["\u00F4"] = "o"; // ô
    map["\u00F6"] = "o"; // ö
    map["\u00DA"] = "U"; // Ú
    map["\u00D9"] = "U"; // Ù
    map["\u00DB"] = "U"; // Û
    map["\u00DC"] = "U"; // Ü
    map["\u00FA"] = "u"; // ú
    map["\u00F9"] = "u"; // ù
    map["\u00FB"] = "u"; // û
    map["\u00FC"] = "u"; // ü
    map["\u00C7"] = "C"; // Ç
    map["\u00E7"] = "c"; // ç
    map["\u00D1"] = "N"; // Ñ
    map["\u00F1"] = "n"; // ñ

    var result = "";
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      result += map[ch] || ch;
    }
    return result;
  }

  // Normaliza pattern: remove espacos, acentos, apostrofos, hifens -> UPPERCASE (ES5 compatible)
  function normalizePattern(str) {
    if (!str) return "";
    var s = removeDiacritics(String(str));
    // Remove espacos, apostrofos, hifens, underscores
    var result = "";
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      // Skip: space, tab, newline, apostrophe variants, hyphen, underscore, backtick
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "'" || ch === "\u2019" || ch === "\u2018" || ch === "`" || ch === "-" || ch === "_") {
        continue;
      }
      result += ch;
    }
    return result.toUpperCase();
  }

  // Gera variações progressivas do pattern para fallback
  function getPatternVariations(original) {
    var variations = [];
    var seen = {};

    // 1. Original (como veio)
    if (original && !seen[original]) {
      variations.push({ pattern: original, desc: "original" });
      seen[original] = 1;
    }

    // 2. Normalizado (sem espaços/acentos, UPPERCASE)
    var normalized = normalizePattern(original);
    if (normalized && !seen[normalized]) {
      variations.push({ pattern: normalized, desc: "normalized" });
      seen[normalized] = 1;
    }

    // 3. Prefixo progressivo (6, 5, 4, 3 caracteres)
    var prefixLengths = [6, 5, 4, 3];
    for (var i = 0; i < prefixLengths.length; i++) {
      var len = prefixLengths[i];
      if (normalized.length > len) {
        var prefix = normalized.substring(0, len);
        if (!seen[prefix]) {
          variations.push({ pattern: prefix, desc: "prefix_" + len });
          seen[prefix] = 1;
        }
      }
    }

    return variations;
  }

  // --- Inicialização ---
  var response = ModuleUtils.makeOutput(11, ticket.getRequestContext());
  var results = {
    content: null,
    logs: []
  };
  var MAX_LOGS = 100;

  function addLog(msg, level) {
    try {
      var entry = "[" + new Date().toISOString() + "][" + (level || "INFO") + "] " + safeStr(msg, 2000);
      results.logs.push(entry);
      if (results.logs.length > MAX_LOGS) results.logs.shift();
    } catch (e) {}
  }

  // Parse de parâmetros
  var parameters;
  try {
    var rawIn = params && params.size && params.size() > 0 ? params.get(0) || "{}" : "{}";
    parameters = JSON.parse(rawIn);
  } catch (e) {
    var err = "Param parse error: " + e + " | raw=" + safeStr(params && params.get ? params.get(0) : "", 1000);
    ModuleUtils.logSevere(err);
    addLog(err, "ERROR");
    setResponse(ticket, response, "Erro ao processar parâmetros de entrada.", JSON.stringify(results), 1, TheSysModuleFunctionResult.RESULT_NOK, "400");
    return;
  }

  addLog("Parameters: " + safeStr(JSON.stringify(parameters), 2000), "INFO");

  // --- Validação de parâmetros obrigatórios ---
  var ciClassification = parameters.ci_classification ? String(parameters.ci_classification).trim() : "";
  var attributeName = parameters.attribute_name ? String(parameters.attribute_name).trim() : "";
  var originalPattern = parameters.pattern ? String(parameters.pattern).trim() : "";
  var limit = parameters.limit || 100;

  if (!ciClassification) {
    addLog("Missing required parameter: ci_classification", "ERROR");
    results.content = { error: "MISSING_PARAMETER", message: "ci_classification is required" };
    setResponse(ticket, response, "ci_classification is required", JSON.stringify(results), 1, TheSysModuleFunctionResult.RESULT_NOK, "400");
    return;
  }

  if (!attributeName) {
    addLog("Missing required parameter: attribute_name", "ERROR");
    results.content = { error: "MISSING_PARAMETER", message: "attribute_name is required" };
    setResponse(ticket, response, "attribute_name is required", JSON.stringify(results), 1, TheSysModuleFunctionResult.RESULT_NOK, "400");
    return;
  }

  // --- Função de execução de query ---
  function executeQuery(patternToUse) {
    var filterParts = [];
    filterParts.push("ci_classification=~eq~" + ciClassification);
    filterParts.push("status=~eq~Deployed");

    if (patternToUse) {
      filterParts.push(attributeName + "=~like~" + patternToUse);
    } else {
      filterParts.push(attributeName + "=~exists~");
    }

    var filters = [filterParts.join("&")];

    var query = {
      skip: 0,
      limit: limit,
      sort_order: 1,
      sort_field: attributeName,
      filters: filters,
      return_fields: attributeName,
      relations: false,
      distinct: true
    };

    var runTkt = ModuleUtils.runFunction("/masterdb/ci/search", ticket.getRequestContext(), JSON.stringify(query));

    if (!ModuleUtils.waitForTicketsSuccess(runTkt)) {
      return { success: false, values: [], query: query };
    }

    try {
      var rawObj = String(runTkt.getResult().getObject());
      var result = JSON.parse(rawObj);
      var dataOutput = result && result.data_output ? result.data_output : {};
      var resultItems = Array.isArray(dataOutput.result) ? dataOutput.result : [];

      var uniqueValues = [];
      for (var i = 0; i < resultItems.length; i++) {
        var val = resultItems[i][attributeName];
        if (val !== null && val !== undefined && String(val).trim() !== "") {
          uniqueValues.push(String(val));
        }
      }

      return {
        success: true,
        values: uniqueValues,
        fullCount: dataOutput.result_full_count || uniqueValues.length,
        query: query
      };
    } catch (e) {
      return { success: false, values: [], query: query };
    }
  }

  // --- Execução com fallback progressivo ---
  var patternUsed = null;
  var patternDescription = null;
  var uniqueValues = [];
  var fullCount = 0;

  if (!originalPattern) {
    // Sem pattern - lista todos
    addLog("No pattern provided, listing all values", "INFO");
    var allResult = executeQuery(null);
    if (allResult.success) {
      uniqueValues = allResult.values;
      fullCount = allResult.fullCount;
    }
    addLog("Built query: " + safeStr(JSON.stringify(allResult.query), 2000), "INFO");
  } else {
    // Com pattern - tentar variações progressivas
    var variations = getPatternVariations(originalPattern);
    addLog(
      "Pattern variations to try: " +
        variations.length +
        " (" +
        variations
          .map(function (v) {
            return v.pattern;
          })
          .join(", ") +
        ")",
      "INFO"
    );

    for (var v = 0; v < variations.length; v++) {
      var variation = variations[v];
      addLog("Trying pattern [" + variation.desc + "]: " + variation.pattern, "DEBUG");

      var queryResult = executeQuery(variation.pattern);
      addLog("Built query: " + safeStr(JSON.stringify(queryResult.query), 2000), "INFO");

      if (queryResult.success && queryResult.values.length > 0) {
        uniqueValues = queryResult.values;
        fullCount = queryResult.fullCount;
        patternUsed = variation.pattern;
        patternDescription = variation.desc;
        addLog("SUCCESS with [" + variation.desc + "]: Found " + uniqueValues.length + " values using pattern '" + variation.pattern + "'", "INFO");
        break;
      } else {
        addLog("No results with [" + variation.desc + "]: " + variation.pattern, "DEBUG");
      }
    }

    // Se nenhuma variação funcionou, listar todos os valores como sugestão
    if (uniqueValues.length === 0) {
      addLog("All pattern variations failed. Listing all values as suggestions...", "INFO");
      var fallbackResult = executeQuery(null);
      if (fallbackResult.success) {
        uniqueValues = fallbackResult.values;
        fullCount = fallbackResult.fullCount;
        patternDescription = "all_values_fallback";
      }
    }
  }

  // --- Construção da resposta ---
  results.content = {
    ci_classification: ciClassification,
    attribute_name: attributeName,
    original_pattern: originalPattern || null,
    pattern_used: patternUsed,
    pattern_description: patternDescription,
    values: uniqueValues,
    value_count: uniqueValues.length,
    total_in_db: fullCount
  };

  // Adicionar meta se houve transformação
  if (originalPattern && patternUsed && patternUsed !== originalPattern) {
    results.meta = {
      pattern_normalized: true,
      original_input: originalPattern,
      effective_pattern: patternUsed,
      normalization_type: patternDescription
    };
  }

  addLog("Found " + uniqueValues.length + " unique values for " + attributeName + (patternUsed ? " with pattern '" + patternUsed + "'" : ""), "INFO");
  setResponse(ticket, response, "OK", JSON.stringify(results), 0, TheSysModuleFunctionResult.RESULT_OK, "200");
  return;
}

function aiToolsMasterDBCockpitFindData(ticket, params) {
  // Helper para logging seguro
  function safeStr(v, max) {
    try {
      var s = String(v || "");
      return s.length > max ? s.substring(0, max) + "...[truncated]" : s;
    } catch (e) {
      return "[unavailable]";
    }
  }

  // --- Inicialização ---
  var response = ModuleUtils.makeOutput(11, ticket.getRequestContext());
  var results = {
    content: null,
    logs: []
  };
  var MAX_LOGS = 100;

  function addLog(msg, level) {
    try {
      var entry = "[" + new Date().toISOString() + "][" + (level || "INFO") + "] " + safeStr(msg, 2000);
      results.logs.push(entry);
      if (results.logs.length > MAX_LOGS) results.logs.shift();
    } catch (e) {}
  }

  // Parse de parâmetros
  var parameters;
  try {
    var rawIn = params && params.size && params.size() > 0 ? params.get(0) || "{}" : "{}";
    parameters = JSON.parse(rawIn);
  } catch (e) {
    var err = "Param parse error: " + e + " | raw=" + safeStr(params && params.get ? params.get(0) : "", 1000);
    ModuleUtils.logSevere(err);
    addLog(err, "ERROR");
    setResponse(ticket, response, "Erro ao processar parâmetros de entrada.", JSON.stringify(results), 1, TheSysModuleFunctionResult.RESULT_NOK, "400");
    return;
  }

  addLog("Parameters: " + safeStr(JSON.stringify(parameters), 2000), "INFO");

  // --- Validação do parâmetro obrigatório ---
  var objectName = parameters.object ? String(parameters.object).trim() : "masterdb.ftth.topologyAnalysis";

  if (!objectName) {
    addLog("Missing required parameter: object", "ERROR");
    results.content = {
      error: "MISSING_PARAMETER",
      message: "object is required. Examples: masterdb.functionalcockpit.backupCompliance2, masterdb.ftth.topologyAnalysis"
    };
    setResponse(ticket, response, "object is required", JSON.stringify(results), 1, TheSysModuleFunctionResult.RESULT_NOK, "400");
    return;
  }

  // Parâmetros opcionais com defaults
  var space = parameters.space ? String(parameters.space).trim() : "dummy";
  var row = parameters.row ? String(parameters.row).trim() : "";
  var column = parameters.column ? String(parameters.column).trim() : "";
  var period = parameters.period ? String(parameters.period).trim() : "86400"; // default 1800 no servidor
  var backoff = parameters.backoff ? String(parameters.backoff).trim() : "86400"; // default 1800 no servidor

  addLog("Calling /mon/dataserver/finddata with: space=" + space + ", object=" + objectName + ", row=" + row + ", column=" + column + ", period=" + period + ", backoff=" + backoff, "INFO");

  // --- Chamar /mon/dataserver/finddata ---
  var runTicketFindData = ModuleUtils.runFunction("/mon/dataserver/finddata", ticket.getRequestContext(), space, objectName, row, column, period, backoff);

  if (!ModuleUtils.waitForTicketsSuccess(runTicketFindData)) {
    addLog("Failed to get data from /mon/dataserver/finddata", "ERROR");
    results.content = {
      error: "FINDDATA_FAILED",
      object_requested: objectName,
      space: space,
      row: row,
      column: column,
      period: period,
      backoff: backoff,
      message: "Could not retrieve data from dataserver. Verify the object name is correct."
    };
    setResponse(ticket, response, "Failed to get data for: " + objectName, JSON.stringify(results), 1, TheSysModuleFunctionResult.RESULT_NOK, "404");
    return;
  }

  // Parse da resposta
  var cockpitData;
  try {
    var rawResult = runTicketFindData.getResult().getObject();
    if (rawResult) {
      cockpitData = JSON.parse(rawResult.toString());
    } else {
      cockpitData = [];
    }
    addLog("Data retrieved successfully. Records: " + (Array.isArray(cockpitData) ? cockpitData.length : "N/A"), "INFO");
  } catch (e) {
    addLog("Failed to parse finddata response: " + e, "ERROR");
    setResponse(ticket, response, "Failed to parse finddata response.", JSON.stringify(results), 1, TheSysModuleFunctionResult.RESULT_NOK, "500");
    return;
  }

  // --- Construção da resposta ---
  results.content = {
    object: objectName,
    space: space,
    filters: {
      row: row || "(all)",
      column: column || "(all)",
      period: period || "1800 (default)",
      backoff: backoff || "1800 (default)"
    },
    record_count: Array.isArray(cockpitData) ? cockpitData.length : 1,
    data: cockpitData
  };

  // Prompt de ajuda para o LLM - detecta tipo de cockpit
  var promptText = "";

  // Detectar cockpit de topologia (contém relações A→B)
  var isTopologyCockpit = objectName.toLowerCase().indexOf("topology") >= 0;
  if (!isTopologyCockpit && Array.isArray(cockpitData)) {
    for (var i = 0; i < cockpitData.length && i < 5; i++) {
      if (cockpitData[i] && cockpitData[i].Row && String(cockpitData[i].Row).indexOf("→") >= 0) {
        isTopologyCockpit = true;
        break;
      }
    }
  }

  if (isTopologyCockpit) {
    promptText = "TOPOLOGY DATA from '" + objectName + "'.\n" + "Row 'A→B' = A connects to B. Column 'L2R' = relation count (use 'last' value).\n" + "Row '_Summary' = execution stats. Only show relations with value > 0.\n" + "Generate a Mermaid flowchart diagram showing the topology.";
  } else {
    promptText = "This is cockpit data from object '" + objectName + "'. Data is organized by row/column/value. Analyze the metrics and provide insights. Show relevant values and timestamps.";
  }

  results.content.prompt = promptText;
  results.content.cockpit_type = isTopologyCockpit ? "topology" : "generic";

  addLog("Response built successfully for object: " + objectName + " (type: " + (isTopologyCockpit ? "topology" : "generic") + ")", "INFO");
  setResponse(ticket, response, "OK", JSON.stringify(results), 0, TheSysModuleFunctionResult.RESULT_OK, "200");
}

function aiToolsMasterDBUpdate(ticket, params) {
  // ===========================================================================
  // --- SECURITY CONSTANTS ---
  // ===========================================================================
  var BLACKLIST_ATTRIBUTES = ["_id", "_created_date", "_created_by", "_updated_date", "_updated_by", "_updated_jobId", "ci_name", "ci_classification"];
  var MAX_RETRIES = 3;
  var RETRY_DELAY_MS = 500;

  // ===========================================================================
  // --- HELPERS ---
  // ===========================================================================
  function safeStr(v, max) {
    try {
      var s = String(v === null || v === undefined ? "" : v);
      return max && s.length > max ? s.substring(0, max) + "...[truncated]" : s;
    } catch (e) {
      return "[unavailable]";
    }
  }

  function addLogObj(obj, arr) {
    try {
      arr.push(JSON.stringify(obj));
    } catch (e) {}
  }

  function toStr(v, dflt) {
    return v === undefined || v === null ? dflt || "" : String(v);
  }

  function isObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }

  function deepClone(obj) {
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch (e) {
      return null;
    }
  }

  function arrContains(arr, val) {
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] === val) return true;
    }
    return false;
  }

  function getNestedKeys(obj, prefix) {
    var keys = [];
    prefix = prefix || "";
    for (var k in obj) {
      if (!obj.hasOwnProperty(k)) continue;
      var fullKey = prefix ? prefix + "." + k : k;
      keys.push(fullKey);
      if (isObject(obj[k])) {
        keys = keys.concat(getNestedKeys(obj[k], fullKey));
      }
    }
    return keys;
  }

  function isAttributeBlacklisted(attrKey) {
    var parts = attrKey.split(".");
    return arrContains(BLACKLIST_ATTRIBUTES, parts[0]);
  }

  function sleepMs(ms) {
    try {
      var slp = ModuleUtils.runFunction("/thesys/sleep", ticket.getRequestContext(), ms);
      if (slp) ModuleUtils.waitForTicketsSuccess(slp);
    } catch (e) {}
  }

  function extractRootKey(k) {
    return k.split(".")[0];
  }

  // ===========================================================================
  // --- ENVELOPE DE RESPOSTA ---
  // ===========================================================================
  var results = {
    content: null,
    logs: []
  };

  // ===========================================================================
  // --- PARSE DE PARÂMETROS ---
  // ===========================================================================
  var p = {};
  try {
    var rawIn = params && params.size && params.size() > 0 ? params.get(0) || "" : "";
    p = JSON.parse(rawIn || "{}");
  } catch (eParseParams) {
    addLogObj(
      {
        error: "MALFORMED_PARAMS",
        detail: safeStr(eParseParams, 600),
        raw: safeStr(params && params.get ? params.get(0) : "", 600)
      },
      results.logs
    );
    ticket.getResult().setObject(JSON.stringify(results));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }

  // ===========================================================================
  // --- VALIDATE REQUIRED PARAMETERS ---
  // ===========================================================================

  // 1. Validate CI - flat parameters: _id OR (ci_name + ci_classification)
  var ciId = toStr(p._id || p.id, "").trim();
  var ciName = toStr(p.ci_name || p.name, "").trim();
  var ciClassification = toStr(p.ci_classification || p.classification, "")
    .trim()
    .toUpperCase();

  if (!ciId && !(ciName && ciClassification)) {
    addLogObj({ error: "MISSING_PARAM", message: "Provide '_id' OR ('ci_name' + 'ci_classification')." }, results.logs);
    ticket.getResult().setObject(JSON.stringify(results));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }

  // 2. Validate Updates
  var updatesInput = p.updates || p.update || p.data || null;
  if (!updatesInput || !isObject(updatesInput)) {
    addLogObj({ error: "MISSING_PARAM", message: "Parameter 'updates' is required. Must be an object with attributes to update." }, results.logs);
    ticket.getResult().setObject(JSON.stringify(results));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }

  // 3. Dry Run (default: TRUE)
  var isDryRun = p.dry_run !== false;

  // 4. Reason (required if not dry run)
  var reason = toStr(p.reason, "").trim();
  if (!isDryRun && !reason) {
    addLogObj({ error: "MISSING_REASON", message: "Parameter 'reason' is required for LIVE mode.", hint: "Provide a justification for the change." }, results.logs);
    ticket.getResult().setObject(JSON.stringify(results));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }

  // ===========================================================================
  // --- VALIDATE ATTRIBUTES (BLACKLIST) ---
  // ===========================================================================
  var updateKeys = getNestedKeys(updatesInput);
  var blockedAttributes = [];
  for (var ki = 0; ki < updateKeys.length; ki++) {
    if (isAttributeBlacklisted(updateKeys[ki])) {
      blockedAttributes.push(updateKeys[ki]);
    }
  }
  if (blockedAttributes.length > 0) {
    addLogObj({ error: "BLOCKED_ATTRIBUTES", message: "Attempted to modify protected attributes.", blocked: blockedAttributes, hint: "These are critical: " + BLACKLIST_ATTRIBUTES.join(", ") }, results.logs);
    ticket.getResult().setObject(JSON.stringify(results));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }

  addLogObj({ stage: "PARAMS_VALIDATED", mode: isDryRun ? "DRY_RUN" : "LIVE", updates_keys: updateKeys, reason: reason || "(dry run)" }, results.logs);

  // ===========================================================================
  // --- RESOLVE CI (fetch _id and current values) ---
  // ===========================================================================
  var resolved = { _id: null, ci_name: null, ci_classification: null, current_values: null, resolve_status: "pending" };
  var returnFieldsStr = "_id;ci_name;ci_classification;" + updateKeys.map(extractRootKey).join(";");

  if (ciId) {
    var searchByIdQuery = { skip: 0, limit: 1, filters: ["_id=" + ciId], return_fields: returnFieldsStr, relations: false };
    var searchTicketById = ModuleUtils.runFunction("/masterdb/ci/search", ticket.getRequestContext(), JSON.stringify(searchByIdQuery));
    if (ModuleUtils.waitForTicketsSuccess(searchTicketById)) {
      try {
        var searchResultById = JSON.parse(searchTicketById.getResult().getObject());
        if (searchResultById.data_output && searchResultById.data_output.result && searchResultById.data_output.result.length > 0) {
          var ciDataById = searchResultById.data_output.result[0];
          resolved._id = ciDataById._id;
          resolved.ci_name = ciDataById.ci_name;
          resolved.ci_classification = ciDataById.ci_classification;
          resolved.current_values = ciDataById;
          resolved.resolve_status = "success";
        } else {
          resolved.resolve_status = "not_found";
        }
      } catch (eParseById) {
        resolved.resolve_status = "parse_error";
      }
    } else {
      resolved.resolve_status = "api_error";
    }
  } else {
    var filterStrByName = "ci_name=" + ciName + "&ci_classification=" + ciClassification;
    var searchByNameQuery = { skip: 0, limit: 1, filters: [filterStrByName], return_fields: returnFieldsStr, relations: false };
    var searchTicketByName = ModuleUtils.runFunction("/masterdb/ci/search", ticket.getRequestContext(), JSON.stringify(searchByNameQuery));
    if (ModuleUtils.waitForTicketsSuccess(searchTicketByName)) {
      try {
        var searchResultByName = JSON.parse(searchTicketByName.getResult().getObject());
        if (searchResultByName.data_output && searchResultByName.data_output.result && searchResultByName.data_output.result.length > 0) {
          var ciDataByName = searchResultByName.data_output.result[0];
          resolved._id = ciDataByName._id;
          resolved.ci_name = ciDataByName.ci_name;
          resolved.ci_classification = ciDataByName.ci_classification;
          resolved.current_values = ciDataByName;
          resolved.resolve_status = "success";
        } else {
          resolved.resolve_status = "not_found";
        }
      } catch (eParseByName) {
        resolved.resolve_status = "parse_error";
      }
    } else {
      resolved.resolve_status = "api_error";
    }
  }

  if (resolved.resolve_status !== "success") {
    addLogObj({ error: "CI_NOT_FOUND", message: "Could not find CI.", _id: ciId || null, ci_name: ciName || null, ci_classification: ciClassification || null, status: resolved.resolve_status }, results.logs);
    ticket.getResult().setObject(JSON.stringify(results));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }

  addLogObj({ stage: "CI_RESOLVED", ci_name: resolved.ci_name, ci_classification: resolved.ci_classification, _id: resolved._id }, results.logs);

  // ===========================================================================
  // --- EXECUTE UPDATE ---
  // ===========================================================================
  var updateResult = {
    ci_name: resolved.ci_name,
    ci_classification: resolved.ci_classification,
    _id: resolved._id,
    snapshot_before: resolved.current_values,
    updates_applied: updatesInput,
    status: "pending",
    api_response: null,
    error: null
  };

  if (isDryRun) {
    updateResult.status = "simulated";
    updateResult.api_response = "DRY_RUN - No changes made.";
    addLogObj({ stage: "DRY_RUN_UPDATE", ci_name: resolved.ci_name, would_update: updatesInput, current_values: resolved.current_values }, results.logs);
  } else {
    addLogObj({ stage: "LIVE_UPDATE_START", ci_name: resolved.ci_name, _id: resolved._id, payload: updatesInput, reason: reason }, results.logs);
    var updateSuccess = false;
    var lastError = null;

    for (var attempt = 1; attempt <= MAX_RETRIES && !updateSuccess; attempt++) {
      try {
        var updateTicket = ModuleUtils.runFunction("/masterdb/ci/update", ticket.getRequestContext(), resolved._id, JSON.stringify(updatesInput));
        if (ModuleUtils.waitForTicketsSuccess(updateTicket)) {
          var updateResponse = updateTicket.getResult().getObject();
          updateResult.status = "success";
          updateResult.api_response = updateResponse;
          updateSuccess = true;
          addLogObj({ stage: "LIVE_UPDATE_SUCCESS", ci_name: resolved.ci_name, attempt: attempt }, results.logs);
        } else {
          lastError = updateTicket.getResult().getObject();
          addLogObj({ stage: "LIVE_UPDATE_RETRY", ci_name: resolved.ci_name, attempt: attempt, error: safeStr(lastError, 500) }, results.logs);
          if (attempt < MAX_RETRIES) {
            sleepMs(RETRY_DELAY_MS * attempt);
          }
        }
      } catch (eRetry) {
        lastError = String(eRetry);
        addLogObj({ stage: "LIVE_UPDATE_EXCEPTION", ci_name: resolved.ci_name, attempt: attempt, error: safeStr(eRetry, 500) }, results.logs);
      }
    }

    if (!updateSuccess) {
      updateResult.status = "failed";
      updateResult.error = safeStr(lastError, 1000);
    }
  }

  // ===========================================================================
  // --- BUILD FINAL RESPONSE ---
  // ===========================================================================
  var isSuccess = updateResult.status === "success" || updateResult.status === "simulated";

  results.content = {
    execution_mode: isDryRun ? "DRY_RUN" : "LIVE",
    reason: reason || "(dry run)",
    status: updateResult.status,
    result: updateResult,
    guardrails: {
      blacklisted_attributes: BLACKLIST_ATTRIBUTES,
      dry_run_default: true
    }
  };

  if (isDryRun) {
    results.content.next_steps = {
      message: "This was a SIMULATION. To apply changes:",
      instructions: ["1. Review snapshot_before and updates_applied", "2. Set 'dry_run': false", "3. Add 'reason': 'your justification'"]
    };
  }

  addLogObj({ stage: "EXECUTION_COMPLETE", mode: isDryRun ? "DRY_RUN" : "LIVE", status: updateResult.status }, results.logs);

  ticket.getResult().setObject(JSON.stringify(results));
  ticket.getResult().setResult(isSuccess ? TheSysModuleFunctionResult.RESULT_OK : TheSysModuleFunctionResult.RESULT_NOK);
}

function aiToolsSystemUptime(ticket, params) {
  var results = {
    content: null,
    logs: []
  };

  function addLog(msg) {
    try {
      results.logs.push("[" + new Date().toISOString() + "] " + msg);
    } catch (e) {}
  }

  addLog("Fetching system uptime...");

  try {
    var uptimeTicket = ModuleUtils.runFunction("/thesys/uptime", ticket.getRequestContext());

    if (!ModuleUtils.waitForTicketsSuccess(uptimeTicket)) {
      addLog("ERROR: Failed to get uptime");
      results.content = {
        success: false,
        error: "Failed to retrieve system uptime"
      };
      ticket.getResult().setObject(JSON.stringify(results));
      ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
      return;
    }

    // Extrair resultado (getOutput() é o método correto para /thesys/uptime)
    var rawUptime = "";
    try {
      rawUptime = String(uptimeTicket.getOutput() || "");
    } catch (e) {
      rawUptime = "";
    }

    addLog("Raw uptime: " + rawUptime);

    // Parse uptime (format: "21h17m" or similar)
    var uptimeStr = rawUptime.trim();
    var hours = 0;
    var minutes = 0;
    var days = 0;

    // Try to parse days
    var dayMatch = uptimeStr.match(/(\d+)d/);
    if (dayMatch) {
      days = parseInt(dayMatch[1], 10);
    }

    // Try to parse hours
    var hourMatch = uptimeStr.match(/(\d+)h/);
    if (hourMatch) {
      hours = parseInt(hourMatch[1], 10);
    }

    // Try to parse minutes
    var minMatch = uptimeStr.match(/(\d+)m/);
    if (minMatch) {
      minutes = parseInt(minMatch[1], 10);
    }

    // Calculate total minutes
    var totalMinutes = days * 24 * 60 + hours * 60 + minutes;

    // Build human-readable string
    var humanReadable = "";
    if (days > 0) {
      humanReadable += days + " dia" + (days > 1 ? "s" : "") + " ";
    }
    if (hours > 0) {
      humanReadable += hours + " hora" + (hours > 1 ? "s" : "") + " ";
    }
    if (minutes > 0 || humanReadable === "") {
      humanReadable += minutes + " minuto" + (minutes !== 1 ? "s" : "");
    }
    humanReadable = humanReadable.trim();

    results.content = {
      success: true,
      uptime_raw: uptimeStr,
      uptime_human: humanReadable,
      days: days,
      hours: hours,
      minutes: minutes,
      total_minutes: totalMinutes,
      timestamp: new Date().toISOString()
    };

    addLog("Uptime retrieved: " + humanReadable);

    ticket.getResult().setObject(JSON.stringify(results));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_OK);
  } catch (e) {
    addLog("ERROR: Exception - " + e);
    results.content = {
      success: false,
      error: "Exception: " + String(e)
    };
    ticket.getResult().setObject(JSON.stringify(results));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
  }
}

function aiToolsMasterDBFindTransformations(ticket, params) {
  // Helper para logging seguro
  function safeStr(v, max) {
    try {
      var s = String(v || "");
      return s.length > max ? s.substring(0, max) + "...[truncated]" : s;
    } catch (e) {
      return "[unavailable]";
    }
  }

  // --- Inicialização ---
  var response = ModuleUtils.makeOutput(11, ticket.getRequestContext());

  // Preparação de resultados com logs em array
  var results = {
    content: null,
    logs: []
  };
  var MAX_LOGS = 200;

  function addLog(msg, level) {
    try {
      var entry = "[" + new Date().toISOString() + "][" + (level || "INFO") + "] " + safeStr(msg, 2000);
      results.logs.push(entry);
      if (results.logs.length > MAX_LOGS) results.logs.shift();
    } catch (e) {}
  }

  // Parse de parâmetros - aceita "", "{}" ou JSON válido
  var parameters = {};
  try {
    var rawParam = params && params.size && params.size() > 0 ? params.get(0) : "";
    // Se vazio ou apenas whitespace, usa objeto vazio (retorna tudo)
    if (!rawParam || String(rawParam).trim() === "" || String(rawParam).trim() === "{}") {
      parameters = {};
    } else {
      parameters = JSON.parse(rawParam);
    }
  } catch (e) {
    var err = "Param parse error: " + e + " | raw=" + safeStr(params && params.get ? params.get(0) : "", 1000);
    addLog(err, "ERROR");
    setResponse(ticket, response, "Erro ao processar parâmetros de entrada.", JSON.stringify(results), 1, TheSysModuleFunctionResult.RESULT_NOK, "400");
    return;
  }

  addLog("Parameters: " + safeStr(JSON.stringify(parameters), 2000), "INFO");

  // Parâmetros de pesquisa e filtro - tratar strings vazias como null
  var searchFilter = parameters.filter_field && String(parameters.filter_field).trim() !== "" ? parameters.filter_field : null;
  var searchValue = parameters.filter_value && String(parameters.filter_value).trim() !== "" ? parameters.filter_value : null;
  var searchOutput = parameters.output_field && String(parameters.output_field).trim() !== "" ? parameters.output_field : null;
  var searchOutputValue = parameters.output_value && String(parameters.output_value).trim() !== "" ? parameters.output_value : null;
  var limit = parameters.limit || 100;
  var showStats = parameters.show_stats !== false;

  // --- Obter lista de transformations ---
  addLog("A obter lista de transformations do MasterDB...", "INFO");

  var listTicket = ModuleUtils.runFunction("/masterdb/admin/transform/list", ticket.getRequestContext());

  if (!ModuleUtils.waitForTicketsSuccess(listTicket)) {
    var errLog = "/masterdb/admin/transform/list failed";
    addLog(errLog, "ERROR");
    setResponse(ticket, response, "Falha ao obter lista de transformations.", JSON.stringify(results), 1, TheSysModuleFunctionResult.RESULT_NOK, "500");
    return;
  }

  // Parse do resultado
  var rawObjStr;
  var transformations = [];
  try {
    rawObjStr = String(listTicket.getResult().getObject());
    transformations = JSON.parse(rawObjStr);
    if (!Array.isArray(transformations)) {
      transformations = [];
    }
  } catch (e) {
    var parseErr = "[Transformations] JSON parse error | raw=" + safeStr(rawObjStr, 2000) + " | err=" + e;
    addLog(parseErr, "ERROR");
    setResponse(ticket, response, "Erro ao processar resposta da MasterDB.", JSON.stringify(results), 1, TheSysModuleFunctionResult.RESULT_NOK, "500");
    return;
  }

  addLog("Total de transformations obtidas: " + transformations.length, "INFO");

  // --- Aplicar filtros (se especificados) ---
  var filteredTransformations = [];

  for (var i = 0; i < transformations.length; i++) {
    var t = transformations[i];
    var filters = {};
    var to = {};

    try {
      filters = JSON.parse(t.filters || "{}");
    } catch (e) {
      filters = {};
    }

    try {
      to = JSON.parse(t.to || "{}");
    } catch (e) {
      to = {};
    }

    var match = true;

    // Filtrar por campo de filtro
    if (searchFilter && searchValue) {
      var filterVal = filters[searchFilter];
      if (!filterVal) {
        match = false;
      } else {
        var filterValLower = String(filterVal).toLowerCase();
        var searchValLower = String(searchValue).toLowerCase();
        if (filterValLower.indexOf(searchValLower) === -1) {
          match = false;
        }
      }
    }

    // Filtrar por campo de output
    if (match && searchOutput && searchOutputValue) {
      var outputVal = to[searchOutput];
      if (!outputVal) {
        match = false;
      } else {
        var outputValLower = String(outputVal).toLowerCase();
        var searchOutLower = String(searchOutputValue).toLowerCase();
        if (outputValLower.indexOf(searchOutLower) === -1) {
          match = false;
        }
      }
    }

    // Filtrar apenas por campo de output (sem valor específico)
    if (match && searchOutput && !searchOutputValue) {
      if (!to.hasOwnProperty(searchOutput)) {
        match = false;
      }
    }

    if (match) {
      filteredTransformations.push({
        _id: t._id,
        filters: filters,
        to: to
      });
    }
  }

  addLog("Transformations após filtros: " + filteredTransformations.length, "INFO");

  // --- Gerar estatísticas (se solicitado) ---
  var stats = null;
  if (showStats) {
    stats = {
      total_transformations: transformations.length,
      filtered_count: filteredTransformations.length,
      fields_modified: {},
      fields_filtered: {}
    };

    for (var j = 0; j < transformations.length; j++) {
      var tj = transformations[j];
      var filtersJ = {};
      var toJ = {};

      try {
        filtersJ = JSON.parse(tj.filters || "{}");
      } catch (e) {}

      try {
        toJ = JSON.parse(tj.to || "{}");
      } catch (e) {}

      // Estatísticas de campos modificados (to)
      for (var toKey in toJ) {
        if (toJ.hasOwnProperty(toKey)) {
          stats.fields_modified[toKey] = (stats.fields_modified[toKey] || 0) + 1;
        }
      }

      // Estatísticas de campos usados em filtros
      for (var filterKey in filtersJ) {
        if (filtersJ.hasOwnProperty(filterKey)) {
          stats.fields_filtered[filterKey] = (stats.fields_filtered[filterKey] || 0) + 1;
        }
      }
    }

    // Ordenar campos por frequência (top 10)
    var sortedModified = Object.keys(stats.fields_modified).sort(function (a, b) {
      return stats.fields_modified[b] - stats.fields_modified[a];
    });
    var top10Modified = {};
    for (var m = 0; m < Math.min(10, sortedModified.length); m++) {
      top10Modified[sortedModified[m]] = stats.fields_modified[sortedModified[m]];
    }
    stats.top10_fields_modified = top10Modified;

    var sortedFiltered = Object.keys(stats.fields_filtered).sort(function (a, b) {
      return stats.fields_filtered[b] - stats.fields_filtered[a];
    });
    var top10Filtered = {};
    for (var f = 0; f < Math.min(10, sortedFiltered.length); f++) {
      top10Filtered[sortedFiltered[f]] = stats.fields_filtered[sortedFiltered[f]];
    }
    stats.top10_fields_filtered = top10Filtered;
  }

  // --- Limitar resultados ---
  var limitedResults = filteredTransformations.slice(0, limit);
  var hasMore = filteredTransformations.length > limit;

  // --- Construir resposta ---
  var content = {
    transformations: limitedResults,
    meta: {
      total_in_db: transformations.length,
      filtered_count: filteredTransformations.length,
      returned_count: limitedResults.length,
      has_more: hasMore,
      filters_applied: {
        filter_field: searchFilter || "(nenhum)",
        filter_value: searchValue || "(nenhum)",
        output_field: searchOutput || "(nenhum)",
        output_value: searchOutputValue || "(nenhum)"
      }
    }
  };

  if (showStats) {
    content.statistics = stats;
  }

  results.content = content;

  addLog("Resposta construída com " + limitedResults.length + " transformations", "INFO");

  setResponse(ticket, response, "OK", JSON.stringify(results), 0, TheSysModuleFunctionResult.RESULT_OK, "200");
}

function aiToolsMasterDBTransformAdd(ticket, params) {
  // ===========================================================================
  // --- CONSTANTS ---
  // ===========================================================================
  var MAX_RETRIES = 3;
  var RETRY_DELAY_MS = 500;
  var SIMILARITY_THRESHOLD = 0.7;

  // ===========================================================================
  // --- HELPERS (aligned with aiToolsMasterDBUpdate) ---
  // ===========================================================================
  function safeStr(v, max) {
    try {
      var s = String(v === null || v === undefined ? "" : v);
      return max && s.length > max ? s.substring(0, max) + "...[truncated]" : s;
    } catch (e) {
      return "[unavailable]";
    }
  }

  function addLogObj(obj, arr) {
    try {
      arr.push(JSON.stringify(obj));
    } catch (e) {}
  }

  function toStr(v, dflt) {
    return v === undefined || v === null ? dflt || "" : String(v);
  }

  function isObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }

  function safeJsonParse(str) {
    try {
      return JSON.parse(str);
    } catch (e) {
      return null;
    }
  }

  /**
   * Parses a query string format (key=value or key1=value1&key2=value2) into an object.
   * Returns null if the string doesn't match the expected format.
   */
  function parseQueryString(str) {
    if (!str || typeof str !== "string") return null;
    var trimmed = str.trim();
    // Must contain at least one "=" to be a query string
    if (trimmed.indexOf("=") === -1) return null;
    // If it starts with "{" it's likely JSON, not query string
    if (trimmed.charAt(0) === "{") return null;

    var result = {};
    var pairs = trimmed.split("&");
    for (var i = 0; i < pairs.length; i++) {
      var pair = pairs[i].trim();
      if (!pair) continue;
      var eqIndex = pair.indexOf("=");
      if (eqIndex === -1) continue;
      var key = pair.substring(0, eqIndex).trim();
      var value = pair.substring(eqIndex + 1).trim();
      if (key) {
        result[key] = value;
      }
    }
    return Object.keys(result).length > 0 ? result : null;
  }

  function getResultAsString(theTicket) {
    var rawObj = null;
    try {
      rawObj = theTicket.getResult().getObject();
    } catch (e1) {
      rawObj = null;
    }
    if (rawObj !== null && rawObj !== undefined && rawObj !== "") {
      try {
        if (typeof rawObj === "string") return rawObj;
        var s1 = String(rawObj);
        return s1 === "[object Object]" ? "" : s1;
      } catch (eStr) {}
    }
    return "";
  }

  function sleepMs(ms) {
    try {
      var slp = ModuleUtils.runFunction("/thesys/sleep", ticket.getRequestContext(), ms);
      if (slp) ModuleUtils.waitForTicketsSuccess(slp);
    } catch (e) {}
  }

  // ===========================================================================
  // --- RESPONSE ENVELOPE ---
  // ===========================================================================
  var results = {
    content: null,
    logs: []
  };

  // ===========================================================================
  // --- PARSE PARAMETERS ---
  // ===========================================================================
  var p = {};
  try {
    var rawIn = params && params.size && params.size() > 0 ? params.get(0) || "" : "";
    p = JSON.parse(rawIn || "{}");
  } catch (eParseParams) {
    addLogObj(
      {
        error: "MALFORMED_PARAMS",
        detail: safeStr(eParseParams, 600),
        raw: safeStr(params && params.get ? params.get(0) : "", 600)
      },
      results.logs
    );
    ticket.getResult().setObject(JSON.stringify(results));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }

  // ===========================================================================
  // --- VALIDATE REQUIRED PARAMETERS (with aliases) ---
  // ===========================================================================

  // 1. Filters - accepts: filters, filter, from (aliases)
  // Formats: object, JSON string, or query string (key=value&key2=value2)
  var filtersRaw = p.filters || p.filter || p.from || null;
  var filtersInput = null;

  if (filtersRaw) {
    if (isObject(filtersRaw)) {
      filtersInput = filtersRaw;
    } else if (typeof filtersRaw === "string") {
      // Try 1: Parse as JSON string
      var parsedFilters = safeJsonParse(filtersRaw);
      if (parsedFilters && isObject(parsedFilters)) {
        filtersInput = parsedFilters;
        addLogObj({ info: "FILTERS_PARSED", format: "JSON", message: "Parameter 'filters' was a JSON string and was parsed successfully." }, results.logs);
      } else {
        // Try 2: Parse as query string (key=value&key2=value2)
        var qsFilters = parseQueryString(filtersRaw);
        if (qsFilters) {
          filtersInput = qsFilters;
          addLogObj({ info: "FILTERS_PARSED", format: "QUERY_STRING", message: "Parameter 'filters' was a query string and was parsed successfully.", parsed: qsFilters }, results.logs);
        } else {
          addLogObj({ error: "INVALID_FILTERS_FORMAT", message: "Parameter 'filters' is a string but not valid JSON or query string format.", received: safeStr(filtersRaw, 200), hint: "Use object, JSON string, or query string (key=value)" }, results.logs);
        }
      }
    }
  }

  if (!filtersInput || !isObject(filtersInput) || Object.keys(filtersInput).length === 0) {
    addLogObj({ error: "MISSING_PARAM", message: "Parameter 'filters' is required. Must be a non-empty object, JSON string, or query string (key=value).", received_type: typeof filtersRaw, examples: ['{"operating_system": "Ubuntu 20.04"}', "operating_system=Ubuntu 20.04"] }, results.logs);
    ticket.getResult().setObject(JSON.stringify(results));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }

  // 2. To - accepts: to, output, result (aliases)
  // Formats: object, JSON string, or query string (key=value&key2=value2)
  var toRaw = p.to || p.output || p.result || null;
  var toInput = null;

  if (toRaw) {
    if (isObject(toRaw)) {
      toInput = toRaw;
    } else if (typeof toRaw === "string") {
      // Try 1: Parse as JSON string
      var parsedTo = safeJsonParse(toRaw);
      if (parsedTo && isObject(parsedTo)) {
        toInput = parsedTo;
        addLogObj({ info: "TO_PARSED", format: "JSON", message: "Parameter 'to' was a JSON string and was parsed successfully." }, results.logs);
      } else {
        // Try 2: Parse as query string (key=value&key2=value2)
        var qsTo = parseQueryString(toRaw);
        if (qsTo) {
          toInput = qsTo;
          addLogObj({ info: "TO_PARSED", format: "QUERY_STRING", message: "Parameter 'to' was a query string and was parsed successfully.", parsed: qsTo }, results.logs);
        } else {
          addLogObj({ error: "INVALID_TO_FORMAT", message: "Parameter 'to' is a string but not valid JSON or query string format.", received: safeStr(toRaw, 200), hint: "Use object, JSON string, or query string (key=value)" }, results.logs);
        }
      }
    }
  }

  if (!toInput || !isObject(toInput) || Object.keys(toInput).length === 0) {
    addLogObj({ error: "MISSING_PARAM", message: "Parameter 'to' is required. Must be a non-empty object, JSON string, or query string (key=value).", received_type: typeof toRaw, examples: ['{"operating_system_family": "linux"}', "operating_system_family=linux"] }, results.logs);
    ticket.getResult().setObject(JSON.stringify(results));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }

  // 3. Boolean options with defaults
  var isDryRun = p.dry_run !== false; // default: TRUE (safe mode)
  var isForce = p.force === true; // default: FALSE
  var doCheckSimilar = p.check_similar !== false; // default: TRUE

  addLogObj({ stage: "PARAMS_VALIDATED", mode: isDryRun ? "DRY_RUN" : "LIVE", filters_keys: Object.keys(filtersInput), to_keys: Object.keys(toInput), force: isForce, check_similar: doCheckSimilar }, results.logs);

  // ===========================================================================
  // --- HELPER FUNCTIONS FOR TRANSFORMATION LOGIC ---
  // ===========================================================================

  /**
   * Normaliza um objeto de filtros para comparação (lowercase, trim, ordenado)
   */
  function normalizeFilters(filtersObj) {
    if (!filtersObj || typeof filtersObj !== "object") return {};
    var normalized = {};
    var keys = Object.keys(filtersObj).sort();
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i].toLowerCase().trim();
      var value = filtersObj[keys[i]];
      normalized[key] = value !== null && value !== undefined ? String(value).toLowerCase().trim() : "";
    }
    return normalized;
  }

  /**
   * Compara dois objetos de filtros e retorna se são iguais
   */
  function filtersAreEqual(filters1, filters2) {
    var norm1 = normalizeFilters(filters1);
    var norm2 = normalizeFilters(filters2);
    var keys1 = Object.keys(norm1);
    var keys2 = Object.keys(norm2);
    if (keys1.length !== keys2.length) return false;
    for (var i = 0; i < keys1.length; i++) {
      if (norm1[keys1[i]] !== norm2[keys1[i]]) return false;
    }
    return true;
  }

  /**
   * Calcula similaridade entre dois conjuntos de filtros (0-1)
   */
  function calculateSimilarity(filters1, filters2) {
    var norm1 = normalizeFilters(filters1);
    var norm2 = normalizeFilters(filters2);
    var keys1 = Object.keys(norm1);
    var keys2 = Object.keys(norm2);

    if (keys1.length === 0 && keys2.length === 0) return 1.0;
    if (keys1.length === 0 || keys2.length === 0) return 0.0;

    var allKeys = {};
    for (var i = 0; i < keys1.length; i++) allKeys[keys1[i]] = true;
    for (var j = 0; j < keys2.length; j++) allKeys[keys2[j]] = true;
    var totalKeys = Object.keys(allKeys).length;

    var commonKeys = 0;
    var matchingValues = 0;
    for (var k = 0; k < keys1.length; k++) {
      if (norm2.hasOwnProperty(keys1[k])) {
        commonKeys++;
        if (norm1[keys1[k]] === norm2[keys1[k]]) {
          matchingValues++;
        }
      }
    }

    var keyScore = commonKeys / totalKeys;
    var valueScore = matchingValues / totalKeys;
    return (keyScore + valueScore) / 2;
  }

  // ===========================================================================
  // --- FETCH EXISTING TRANSFORMATIONS ---
  // ===========================================================================
  addLogObj({ stage: "FETCHING_TRANSFORMATIONS" }, results.logs);

  var listTicket = null;
  var listSuccess = false;
  var existingTransformations = [];

  for (var attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    listTicket = ModuleUtils.runFunction("/masterdb/admin/transform/list", ticket.getRequestContext());
    if (ModuleUtils.waitForTicketsSuccess(listTicket)) {
      listSuccess = true;
      break;
    }
    addLogObj({ warn: "LIST_RETRY", attempt: attempt, max: MAX_RETRIES }, results.logs);
    sleepMs(RETRY_DELAY_MS);
  }

  if (!listSuccess) {
    addLogObj({ error: "LIST_FAILED", message: "Failed to fetch existing transformations after " + MAX_RETRIES + " attempts" }, results.logs);
    ticket.getResult().setObject(JSON.stringify(results));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }

  var listRaw = getResultAsString(listTicket);
  existingTransformations = safeJsonParse(listRaw);

  if (!Array.isArray(existingTransformations)) {
    existingTransformations = [];
  }

  addLogObj({ stage: "TRANSFORMATIONS_FETCHED", count: existingTransformations.length }, results.logs);

  // ===========================================================================
  // --- CHECK DUPLICATES AND SIMILAR ---
  // ===========================================================================

  var exactMatch = null;
  var similarMatches = [];

  for (var i = 0; i < existingTransformations.length; i++) {
    var existing = existingTransformations[i];
    var existingFilters = safeJsonParse(existing.filters) || {};
    var existingTo = safeJsonParse(existing.to) || {};

    // Check exact duplicate
    if (filtersAreEqual(filtersInput, existingFilters)) {
      exactMatch = {
        _id: existing._id,
        filters: existingFilters,
        to: existingTo,
        toMatches: filtersAreEqual(toInput, existingTo)
      };
      addLogObj({ warn: "EXACT_MATCH_FOUND", id: existing._id }, results.logs);
      break;
    }

    // Check similar
    if (doCheckSimilar) {
      var similarity = calculateSimilarity(filtersInput, existingFilters);
      if (similarity >= SIMILARITY_THRESHOLD) {
        similarMatches.push({
          _id: existing._id,
          filters: existingFilters,
          to: existingTo,
          similarity: Math.round(similarity * 100)
        });
      }
    }
  }

  // ===========================================================================
  // --- BUILD RESPONSE CONTENT ---
  // ===========================================================================
  var content = {
    success: false,
    action: null,
    message: null,
    input: {
      filters: filtersInput,
      to: toInput
    },
    options: {
      force: isForce,
      dry_run: isDryRun,
      check_similar: doCheckSimilar
    },
    validation: {
      existing_count: existingTransformations.length,
      exact_match: exactMatch,
      similar_matches: similarMatches.slice(0, 5)
    }
  };

  // ===========================================================================
  // --- DECISION LOGIC ---
  // ===========================================================================

  // If exact duplicate exists (same filters AND same output) - always skip
  if (exactMatch && exactMatch.toMatches) {
    content.action = "SKIPPED_EXACT_DUPLICATE";
    content.message = "Transformation already exists with identical filters and output. ID: " + exactMatch._id;
    addLogObj({ stage: "DUPLICATE_DETECTED", action: content.action, id: exactMatch._id }, results.logs);
    results.content = content;
    ticket.getResult().setObject(JSON.stringify(results));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_OK);
    return;
  }

  // If same filters but different output - allow with force=true
  if (exactMatch && !exactMatch.toMatches && !isForce) {
    content.action = "CONFLICT_SAME_FILTER_DIFFERENT_OUTPUT";
    content.message = "Transformation exists with same filters but different output. ID: " + exactMatch._id + ". Use force=true to create anyway.";
    content.conflict = {
      existing_id: exactMatch._id,
      existing_to: exactMatch.to,
      requested_to: toInput
    };
    addLogObj({ stage: "CONFLICT_DETECTED", action: content.action, id: exactMatch._id, hint: "Use force=true to bypass" }, results.logs);
    results.content = content;
    ticket.getResult().setObject(JSON.stringify(results));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_OK);
    return;
  }

  // Log if forcing creation despite conflict
  if (exactMatch && !exactMatch.toMatches && isForce) {
    addLogObj({ warn: "FORCE_BYPASS_CONFLICT", message: "Creating transformation despite existing rule with same filters", existing_id: exactMatch._id }, results.logs);
  }

  // If similar exist and not force
  if (similarMatches.length > 0 && !isForce) {
    content.action = "WARNING_SIMILAR_EXISTS";
    content.message = "Found " + similarMatches.length + " similar transformations. Use force=true to add anyway.";
    addLogObj({ stage: "SIMILAR_FOUND", count: similarMatches.length, action: content.action }, results.logs);
    results.content = content;
    ticket.getResult().setObject(JSON.stringify(results));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_OK);
    return;
  }

  // Dry run - validate only
  if (isDryRun) {
    content.success = true;
    content.action = "DRY_RUN_OK";
    content.message = "Validation OK. Transformation can be added. Set dry_run=false to create.";
    addLogObj({ stage: "DRY_RUN_COMPLETE", action: content.action }, results.logs);
    results.content = content;
    ticket.getResult().setObject(JSON.stringify(results));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_OK);
    return;
  }

  // ===========================================================================
  // --- ADD TRANSFORMATION ---
  // ===========================================================================
  addLogObj({ stage: "ADDING_TRANSFORMATION" }, results.logs);

  var filtersStr = JSON.stringify(filtersInput);
  var toStrValue = JSON.stringify(toInput);

  var addTicket = null;
  var addSuccess = false;

  for (var addAttempt = 1; addAttempt <= MAX_RETRIES; addAttempt++) {
    addTicket = ModuleUtils.runFunction("/masterdb/admin/transform/add", ticket.getRequestContext(), filtersStr, toStrValue);
    if (ModuleUtils.waitForTicketsSuccess(addTicket)) {
      addSuccess = true;
      break;
    }
    addLogObj({ warn: "ADD_RETRY", attempt: addAttempt, max: MAX_RETRIES }, results.logs);
    sleepMs(RETRY_DELAY_MS);
  }

  if (!addSuccess) {
    content.action = "ERROR_ADD_FAILED";
    content.message = "Failed to add transformation after " + MAX_RETRIES + " attempts";
    content.error = getResultAsString(addTicket);
    addLogObj({ error: "ADD_FAILED", message: content.message }, results.logs);
    results.content = content;
    ticket.getResult().setObject(JSON.stringify(results));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }

  // Success
  content.success = true;
  content.action = "ADDED";
  content.message = "Transformation added successfully!";
  content.response = getResultAsString(addTicket);

  addLogObj({ stage: "SUCCESS", action: content.action }, results.logs);

  results.content = content;
  ticket.getResult().setObject(JSON.stringify(results));
  ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_OK);
}

/**
 * ============================================================================
 * AI Tool: MasterDB Compliance Search
 * ============================================================================
 *
 * NOME:             aiToolsMasterDBComplianceSearch
 * PATH:             /ai/tools/masterdb/compliance/search
 * TIPO:             analysis / read
 * PROPÓSITO:        Analisa o atributo `compliances` dos CIs na MasterDB,
 *                   respondendo a questões de compliance: que classificações
 *                   têm compliances preenchidos, contagens por estado, detalhe
 *                   por check específico, filtros por OS, etc.
 *
 * PARÂMETROS OPCIONAIS (todos têm defaults):
 *   - ci_classification  (string)  — filtrar por classificação (ex: SERVER).
 *                                    Aliases: classification
 *                                    Default: sem filtro (todas as classificações)
 *   - compliance_check   (string)  — focar num check específico (ex: "tenable",
 *                                    "SecurityPatch", "antivirus", "crowdstrike").
 *                                    Aliases: check, check_name
 *                                    Default: todos os checks
 *   - compliance_state   (string|number) — filtrar por estado do compliance.
 *                                    Valores numéricos: 0-4
 *                                    Valores string: "undefined","implemented",
 *                                    "not_implemented","ignored","implementation",
 *                                    "compliant" (=1), "not_compliant" (=2),
 *                                    "pending" / "in_progress" (=4)
 *                                    Aliases: state, filter_state
 *                                    Default: sem filtro de estado
 *   - os                 (string)  — filtrar por sistema operativo (like).
 *                                    Aliases: os_type, operating_system
 *                                    Default: sem filtro de OS
 *   - mode               (string)  — "summary" (default) | "list" | "count"
 *                                    summary: agregação por classification+check+state
 *                                    list: devolve os CIs com detalhe de compliances
 *                                    count: devolve apenas totais
 *   - limit              (number)  — máximo de CIs a processar/devolver.
 *                                    Default: 5000 para summary/count, 100 para list
 *   - status             (string)  — estado do CI. Default: Deployed. "ALL" = sem filtro
 *
 * OUTPUT (results.content):
 * {
 *   mode: string,
 *   filters_applied: { ci_classification, compliance_check, compliance_state, os },
 *   total_cis_with_compliances: number,
 *   classifications_with_compliances: [
 *     { ci_classification, count, compliance_checks: string[] }
 *   ],
 *   compliance_summary: [
 *     { compliance_check, ci_classification, total, implemented, not_implemented,
 *       ignored, undefined, implementation, not_compliant_pct }
 *   ],
 *   items: []    // só em mode=list: [{ ci_name, ci_classification, os, compliances_digest }]
 *   count: number  // só em mode=count
 * }
 *
 * ESTADOS DE COMPLIANCE:
 *   0 = UNDEFINED
 *   1 = IMPLEMENTED   (compliant)
 *   2 = NOT_IMPLEMENTED (not compliant)
 *   3 = IGNORED
 *   4 = IMPLEMENTATION  (in progress / pending)
 *
 * ERROS:
 *   MALFORMED_PARAMS  - JSON inválido em params.get(0)
 *   BACKEND_ERROR     - falha em /masterdb/ci/search
 *
 * NOT_FOUND: RESULT_OK com totais a zero — nunca RESULT_NOK
 *
 * @param {TheSysTicket} ticket
 * @param {JavaCollection} params — índice 0 = JSON string
 */
function aiToolsMasterDBComplianceSearch(ticket, params) {
  // =========================================================================
  // HELPERS
  // =========================================================================
  var MAX_LOGS = 200;

  function safeStr(v, max) {
    try {
      var s = String(v === null || v === undefined ? "" : v);
      return max && s.length > max ? s.substring(0, max) + "...[truncated]" : s;
    } catch (e) {
      return "[unavailable]";
    }
  }

  function addLog(msg, level) {
    try {
      results.logs.push("[" + new Date().toISOString() + "][" + (level || "INFO") + "] " + safeStr(msg, 2000));
      if (results.logs.length > MAX_LOGS) {
        results.logs.shift();
      }
    } catch (e) {}
  }

  function addLogObj(obj) {
    try {
      results.logs.push(JSON.stringify(obj));
    } catch (e) {}
    if (results.logs.length > MAX_LOGS) {
      results.logs.shift();
    }
  }

  function tryGet(t) {
    try {
      return String(t.getResult().getObject() || t.getOutput() || "");
    } catch (e) {
      return "";
    }
  }

  // Normaliza return_fields: ',' -> ';'
  function normalizeReturnFields(rf) {
    if (!rf) {
      return "";
    }
    var s = String(rf).trim();
    if (s.indexOf(",") !== -1) {
      var parts = s.split(",");
      var out = [];
      for (var i = 0; i < parts.length; i++) {
        out.push(parts[i].trim());
      }
      return out.join(";");
    }
    return s;
  }

  // Converte string de estado para número
  // 0=UNDEFINED, 1=IMPLEMENTED, 2=NOT_IMPLEMENTED, 3=IGNORED, 4=IMPLEMENTATION
  function resolveStateFilter(raw) {
    if (raw === null || raw === undefined || raw === "") {
      return null;
    }
    var n = parseInt(raw, 10);
    if (!isNaN(n)) {
      return n;
    }
    var s = String(raw).toLowerCase().replace(/[-_ ]/g, "");
    if (s === "implemented" || s === "compliant") {
      return 1;
    }
    if (s === "notimplemented" || s === "notcompliant" || s === "noncompliant") {
      return 2;
    }
    if (s === "ignored") {
      return 3;
    }
    if (s === "implementation" || s === "pending" || s === "inprogress") {
      return 4;
    }
    if (s === "undefined") {
      return 0;
    }
    return null; // desconhecido — sem filtro
  }

  // Nome do estado para o LLM
  function stateName(n) {
    if (n === 0) {
      return "UNDEFINED";
    }
    if (n === 1) {
      return "IMPLEMENTED";
    }
    if (n === 2) {
      return "NOT_IMPLEMENTED";
    }
    if (n === 3) {
      return "IGNORED";
    }
    if (n === 4) {
      return "IMPLEMENTATION";
    }
    return "UNKNOWN(" + n + ")";
  }

  // Verifica se um objeto compliances tem pelo menos uma entrada preenchida
  function hasCompliances(ci) {
    if (!ci || !ci.compliances) {
      return false;
    }
    var c = ci.compliances;
    for (var k in c) {
      if (c.hasOwnProperty(k)) {
        return true;
      }
    }
    return false;
  }

  // Extrai os nomes dos checks presentes no objecto compliances
  function getCheckNames(compliancesObj) {
    var names = [];
    if (!compliancesObj) {
      return names;
    }
    for (var k in compliancesObj) {
      if (compliancesObj.hasOwnProperty(k)) {
        names.push(k);
      }
    }
    return names;
  }

  // =========================================================================
  // INIT ENVELOPE
  // =========================================================================
  var response = ModuleUtils.makeOutput(11, ticket.getRequestContext());
  var results = { content: null, logs: [] };

  // =========================================================================
  // PARSE PARAMS
  // =========================================================================
  var p = {};
  try {
    var rawIn = params && params.size && params.size() > 0 ? params.get(0) || "" : "";
    p = JSON.parse(rawIn || "{}");
  } catch (e) {
    addLogObj({ error: "MALFORMED_PARAMS", detail: safeStr(e, 400) });
    ticket.getResult().setObject(JSON.stringify(results));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }
  addLog("Parameters: " + safeStr(JSON.stringify(p), 2000), "INFO");

  // =========================================================================
  // RESOLVER PARÂMETROS COM ALIASES
  // =========================================================================
  var ciClass = String(p.ci_classification || p.classification || "")
    .trim()
    .toUpperCase();
  var checkFilter = String(p.compliance_check || p.check || p.check_name || "")
    .trim()
    .toLowerCase();
  var rawState = p.compliance_state !== undefined ? p.compliance_state : p.state !== undefined ? p.state : p.filter_state !== undefined ? p.filter_state : null;
  var stateFilter = resolveStateFilter(rawState);
  var mode = String(p.mode || "summary")
    .trim()
    .toLowerCase();
  var statusRaw = String(p.status || "Deployed").trim();
  var statusAll = statusRaw.toUpperCase() === "ALL";

  // Limite: conservador para list, máximo 100k para summary/count
  var MAX_HARD_LIMIT = 100000;
  var defaultLimit = mode === "list" ? 100 : MAX_HARD_LIMIT;
  var pageSize = 10000; // paginação interna: 10k por página

  // =========================================================================
  // CONSTRUÇÃO DE FILTROS BACKEND — dinâmica (padrão CONTROL_KEYS)
  // Qualquer parâmetro fora das chaves de controlo é injetado como filtro.
  // Exemplo: operating_system_family=~like~Windows → filter directo no backend.
  // O valor pode incluir o operador (=~like~val) ou será enviado como está.
  // =========================================================================
  var CONTROL_KEYS = {
    ci_classification: 1,
    classification: 1,
    compliance_check: 1,
    check: 1,
    check_name: 1,
    compliance_state: 1,
    state: 1,
    filter_state: 1,
    mode: 1,
    limit: 1,
    status: 1,
    sort_field: 1,
    sort_order: 1,
    return_fields: 1
  };

  var filterParts = [];

  // 1. ci_classification (semântico — sempre ~eq~)
  if (ciClass) {
    filterParts.push("ci_classification=~eq~" + ciClass);
  }

  // 2. Injeção dinâmica de todos os parâmetros que não são chaves de controlo
  //    O LLM passa o atributo com o operador já incluído no valor, ex:
  //      operating_system_family=~like~Windows
  //    ou sem operador (passado directamente, e.g. operating_system_family=Windows)
  var extraFilters = [];
  for (var fk in p) {
    if (!p.hasOwnProperty(fk)) {
      continue;
    }
    if (CONTROL_KEYS[fk]) {
      continue;
    }
    var fv = p[fk];
    if (fv === null || fv === undefined || fv === "") {
      continue;
    }
    filterParts.push(fk + "=" + String(fv));
    extraFilters.push(fk);
  }

  // 3. compliances=~exists~ — filtra no backend, traz só CIs com o atributo preenchido
  filterParts.push("compliances=~exists~");

  // 4. Status
  if (!statusAll) {
    filterParts.push("status=~eq~" + statusRaw);
  }

  addLog("Resolved → class=" + (ciClass || "ALL") + " check=" + (checkFilter || "ALL") + " state=" + (stateFilter !== null ? stateName(stateFilter) : "ALL") + " extra_filters=[" + extraFilters.join(",") + "] mode=" + mode, "INFO");

  var filterStr = filterParts.join("&");
  // Inclui operating_system_family por defeito para enriquecer o output list
  var returnFields = normalizeReturnFields("ci_name;ci_classification;operating_system_family;compliances");

  var baseQuery = {
    skip: 0,
    limit: pageSize,
    sort_order: -1,
    sort_field: "_created_date",
    filters: filterStr ? [filterStr] : [],
    return_fields: returnFields,
    relations: false
  };

  addLogObj({ stage: "BUILD_QUERY", query: baseQuery });

  // =========================================================================
  // PAGINAÇÃO PARALELA
  // Estratégia:
  //   1. Preflight (limit=1) para obter result_full_count do backend
  //   2. Calcular número total de páginas necessárias
  //   3. Disparar TODAS as páginas em paralelo (fire-and-forget)
  //   4. Aguardar e recolher cada resultado por ordem
  // Ganho: tempo ≈ página mais lenta (em vez de soma de todas as páginas)
  // =========================================================================
  var requestedLimit = p.limit ? Number(p.limit) : defaultLimit;
  var hardLimit = mode === "list" ? requestedLimit : requestedLimit > MAX_HARD_LIMIT ? MAX_HARD_LIMIT : requestedLimit;

  // --- STEP 1: Preflight para saber o total de registos ---
  var preflightQuery = {
    skip: 0,
    limit: 1,
    sort_order: -1,
    sort_field: "_created_date",
    filters: baseQuery.filters,
    return_fields: "ci_name",
    relations: false
  };
  var tPreflight = ModuleUtils.runFunction("/masterdb/ci/search", ticket.getRequestContext(), JSON.stringify(preflightQuery));
  if (!ModuleUtils.waitForTicketsSuccess(tPreflight)) {
    addLogObj({ error: "BACKEND_ERROR", stage: "PREFLIGHT", detail: safeStr(tryGet(tPreflight), 400) });
    ticket.getResult().setObject(JSON.stringify(results));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }
  var serverTotalCount = 0;
  try {
    var preflightRaw = String(tPreflight.getResult().getObject() || "{}");
    var preflightParsed = JSON.parse(preflightRaw);
    serverTotalCount = preflightParsed && preflightParsed.data_output ? Number(preflightParsed.data_output.result_full_count) || 0 : 0;
  } catch (eP) {
    addLogObj({ warn: "PREFLIGHT_PARSE_ERROR", detail: safeStr(eP, 200) });
  }

  var totalToFetch = serverTotalCount > hardLimit ? hardLimit : serverTotalCount;
  var totalPages = totalToFetch > 0 ? Math.ceil(totalToFetch / pageSize) : 0;
  addLog("Preflight: serverTotal=" + serverTotalCount + " toFetch=" + totalToFetch + " pages=" + totalPages, "INFO");

  // --- STEP 2: Disparar todas as páginas em paralelo ---
  var pageTickets = [];
  for (var pg = 0; pg < totalPages; pg++) {
    var pgQuery = {
      skip: pg * pageSize,
      limit: pageSize,
      sort_order: baseQuery.sort_order,
      sort_field: baseQuery.sort_field,
      filters: baseQuery.filters,
      return_fields: baseQuery.return_fields,
      relations: false
    };
    pageTickets.push(ModuleUtils.runFunction("/masterdb/ci/search", ticket.getRequestContext(), JSON.stringify(pgQuery)));
  }
  addLog("Fired " + pageTickets.length + " parallel page requests", "INFO");

  // --- STEP 3: Aguardar e recolher resultados ---
  var allItems = [];
  for (var pi = 0; pi < pageTickets.length; pi++) {
    var tPage = pageTickets[pi];
    if (!ModuleUtils.waitForTicketsSuccess(tPage)) {
      addLogObj({ error: "BACKEND_ERROR", page: pi, detail: safeStr(tryGet(tPage), 400) });
      ticket.getResult().setObject(JSON.stringify(results));
      ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
      return;
    }
    var pageArr = [];
    try {
      var rawStr = String(tPage.getResult().getObject() || "{}");
      var parsed = JSON.parse(rawStr);
      pageArr = parsed && parsed.data_output && Array.isArray(parsed.data_output.result) ? parsed.data_output.result : [];
    } catch (eArr) {
      addLogObj({ error: "PARSE_ERROR", page: pi, detail: safeStr(eArr, 400) });
      ticket.getResult().setObject(JSON.stringify(results));
      ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
      return;
    }
    for (var i = 0; i < pageArr.length; i++) {
      allItems.push(pageArr[i]);
    }
    addLog("Page " + pi + " collected: " + pageArr.length + " records. Total: " + allItems.length, "DEBUG");
  }

  addLog("Total CIs fetched: " + allItems.length, "INFO");

  // =========================================================================
  // PROCESSAMENTO — ANÁLISE IN-MEMORY
  // =========================================================================

  // Estruturas de agregação
  // classMap[ci_class] = { count: N, checks: { checkName: true } }
  var classMap = {};

  // summaryMap[ci_class + "||" + checkName][state] = count
  var summaryMap = {};

  // CIs para mode=list
  var listItems = [];

  var totalWithCompliances = 0;

  for (var j = 0; j < allItems.length; j++) {
    var ci = allItems[j];

    // Só processar CIs que tenham compliances
    if (!hasCompliances(ci)) {
      continue;
    }

    var ciCompliances = ci.compliances;
    var checkNames = getCheckNames(ciCompliances);

    // Filtro por check específico
    if (checkFilter) {
      var hasCheck = false;
      for (var c = 0; c < checkNames.length; c++) {
        if (checkNames[c].toLowerCase() === checkFilter) {
          hasCheck = true;
          break;
        }
      }
      if (!hasCheck) {
        continue;
      }
    }

    // Filtro por estado (verifica se pelo menos um check relevante tem esse estado)
    // Quando stateFilter=2 (not_compliant), inclui também state=0 (UNDEFINED):
    // UNDEFINED significa que o check não correu (ex: SSH inacessível) — funcionalmente não conforme.
    if (stateFilter !== null) {
      var hasTargetState = false;
      for (var c2 = 0; c2 < checkNames.length; c2++) {
        var ckName = checkNames[c2];
        if (checkFilter && ckName.toLowerCase() !== checkFilter) {
          continue;
        }
        var ckObj = ciCompliances[ckName];
        var ckState = ckObj && ckObj.state !== undefined ? parseInt(ckObj.state, 10) : 0;
        if (ckState === stateFilter || (stateFilter === 2 && ckState === 0)) {
          hasTargetState = true;
          break;
        }
      }
      if (!hasTargetState) {
        continue;
      }
    }

    // CI passou todos os filtros
    totalWithCompliances++;

    var ciName = String(ci.ci_name || "");
    var ciCls = String(ci.ci_classification || "").toUpperCase();

    // Agregação por classification
    if (!classMap[ciCls]) {
      classMap[ciCls] = { count: 0, checks: {} };
    }
    classMap[ciCls].count++;

    // Agregação por classification + check
    // Quando stateFilter está activo, só se agrega o check se o seu estado
    // corresponde ao filtro — evita poluir o summary com checks irrelevantes.
    for (var c3 = 0; c3 < checkNames.length; c3++) {
      var ckn = checkNames[c3];
      if (checkFilter && ckn.toLowerCase() !== checkFilter) {
        continue;
      }

      var ckEntry = ciCompliances[ckn];
      var ckState2 = ckEntry && ckEntry.state !== undefined ? parseInt(ckEntry.state, 10) : 0;

      // Se há filtro de estado, só conta este check se ele próprio está no estado pedido.
      // Excepção: not_compliant (2) inclui também UNDEFINED (0) — check não correu.
      if (stateFilter !== null && ckState2 !== stateFilter && !(stateFilter === 2 && ckState2 === 0)) {
        continue;
      }

      classMap[ciCls].checks[ckn] = true;

      var sumKey = ciCls + "||" + ckn;
      if (!summaryMap[sumKey]) {
        summaryMap[sumKey] = { ci_classification: ciCls, compliance_check: ckn, total: 0, ci_names: [] };
        summaryMap[sumKey][0] = 0;
        summaryMap[sumKey][1] = 0;
        summaryMap[sumKey][2] = 0;
        summaryMap[sumKey][3] = 0;
        summaryMap[sumKey][4] = 0;
      }
      summaryMap[sumKey].total++;
      // ci_names para NOT_IMPLEMENTED (state=2) e UNDEFINED (state=0):
      // UNDEFINED é funcionalmente não conforme — o check não correu (ex: SSH inacessível)
      // mas é reportado separadamente em undefined_state para distinguir do NOK explícito.
      if (ckState2 === 2 || ckState2 === 0) {
        summaryMap[sumKey].ci_names.push(ciName);
      }
      if (summaryMap[sumKey][ckState2] !== undefined) {
        summaryMap[sumKey][ckState2]++;
      }
    }

    // mode=list: guardar detalhe reduzido do CI
    if (mode === "list" && listItems.length < hardLimit) {
      var digest = {};
      for (var c4 = 0; c4 < checkNames.length; c4++) {
        var ckd = checkNames[c4];
        if (checkFilter && ckd.toLowerCase() !== checkFilter) {
          continue;
        }
        var ckdObj = ciCompliances[ckd];
        var ckdState = ckdObj && ckdObj.state !== undefined ? parseInt(ckdObj.state, 10) : 0;
        digest[ckd] = {
          state: ckdState,
          state_name: stateName(ckdState),
          state_details: ckdObj ? safeStr(ckdObj.state_details, 300) : null,
          update_time: ckdObj ? ckdObj.update_time || null : null
        };
      }
      listItems.push({
        ci_name: ciName,
        ci_classification: ciCls,
        operating_system_family: String(ci.operating_system_family || ci.os || "") || null,
        compliances_digest: digest
      });
    }
  }

  // =========================================================================
  // MONTAR CONTENT
  // =========================================================================

  // classificações com compliances → array ordenado por count DESC
  var classWithCompliances = [];
  for (var cls in classMap) {
    if (!classMap.hasOwnProperty(cls)) {
      continue;
    }
    var entry = classMap[cls];
    var checksArr = [];
    for (var ck in entry.checks) {
      if (entry.checks.hasOwnProperty(ck)) {
        checksArr.push(ck);
      }
    }
    classWithCompliances.push({ ci_classification: cls, count: entry.count, compliance_checks: checksArr });
  }
  classWithCompliances.sort(function (a, b) {
    return b.count - a.count;
  });

  // summary por classification+check
  var complianceSummary = [];
  for (var sk in summaryMap) {
    if (!summaryMap.hasOwnProperty(sk)) {
      continue;
    }
    var sm = summaryMap[sk];
    var notImpl = sm[2] || 0;
    var total = sm.total || 0;
    complianceSummary.push({
      compliance_check: sm.compliance_check,
      ci_classification: sm.ci_classification,
      total: total,
      implemented: sm[1] || 0,
      not_implemented: notImpl,
      ignored: sm[3] || 0,
      undefined_state: sm[0] || 0,
      implementation: sm[4] || 0,
      not_compliant_pct: total > 0 ? Math.round((notImpl / total) * 10000) / 100 : 0,
      ci_names: sm.ci_names || []
    });
  }
  // Ordenar por not_implemented DESC
  complianceSummary.sort(function (a, b) {
    return b.not_implemented - a.not_implemented;
  });

  // =========================================================================
  // MONTAR RESPONSE FINAL
  // =========================================================================
  var contentOut = {
    mode: mode,
    filters_applied: {
      ci_classification: ciClass || null,
      compliance_check: checkFilter || null,
      compliance_state: stateFilter !== null ? stateName(stateFilter) : null,
      extra_filters: extraFilters.length > 0 ? extraFilters : null,
      status: statusAll ? "ALL" : statusRaw
    },
    total_cis_with_compliances: totalWithCompliances,
    classifications_with_compliances: classWithCompliances,
    compliance_summary: complianceSummary
  };

  if (mode === "list") {
    contentOut.items = listItems;
  }

  if (mode === "count") {
    contentOut.count = totalWithCompliances;
    contentOut.classifications_with_compliances = classWithCompliances;
    contentOut.compliance_summary = complianceSummary;
  }

  addLogObj({ stage: "CONTENT_BUILT", total: totalWithCompliances, classifications: classWithCompliances.length, summary_rows: complianceSummary.length });

  results.content = contentOut;
  response = ModuleUtils.setResponse(response, TheSysModuleFunctionResult.RESULT_OK, "OK");
  response = ModuleUtils.setOutput(response, 11, JSON.stringify(results));
  ticket.getResult().setObject(response);
  ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_OK);
}

function masterDBEugeniaTest(ticket, configParams) {
  var startTime = new Date();
  var EMAIL_RECIPIENT = "hugo.d.goncalves@nos.pt";
  var AGENT_CONTEXT = "at|masterdb";
  var STORAGE_BASE;
  try {
    STORAGE_BASE = TheSysController.getConfigBasePath() + File.separator + "localStorage" + File.separator + "masterdb_email_exports";
  } catch (initErr) {
    STORAGE_BASE = "/tmp/masterdb_email_exports";
  }

  // =========================================================================
  // Hoist all vars (LESSON-007 — no var declarations inside blocks)
  // =========================================================================
  var options, testCases, isDryRun, sleepBetweenMs, maxRetries, retryDelayMs;
  var errorCount, testResults;
  var promptsTicket, promptsRaw, promptsParsed, allPrompts, filteredPrompts;
  var pi, prompt, matchedCase, varsMap, mustNotContainArr, resolvedPrompt;
  var testStart, testDurationMs, status, failReasons, responseSummary;
  var eugeniaTicket, eugeniaRaw, eugeniaResult, replyContent, failures, encodedPrompt;
  var dir, csvPath, csvArray, csvRow, csvTicket;
  var htmlBody, emailSubject, mailTicket, mailOk, rawMailErr;
  var passCount, failCount, skipCount, errorTestCount, ri;
  var resultObj, endTime, deltaTime, finalStatus;
  var defaultVarsForPrompt, mergedVars, dv, DEFAULT_VARS_MAP;
  var DEFAULT_MUST_NOT, mergedMustNot, mi, mnc;

  ticket.addOutput("=== [EUGENIA TEST SUITE] Start ===");
  ticket.addOutput("Start time: " + startTime.toISOString());

  // =========================================================================
  // STEP 1: PARSE CONFIG
  // =========================================================================
  ticket.addOutput("\n[STEP 1] Parsing configuration...");
  options = {};
  try {
    if (configParams && configParams[0] && configParams[0].trim() !== "") {
      options = JSON.parse(configParams[0]);
    } else {
      ticket.addOutput("  [WARN] No configParams provided — running with defaults (all prompts, no test cases).");
    }
  } catch (e) {
    ticket.addOutput("ERRO CRITICO: JSON.parse failed: " + e.message);
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_FATAL);
    return;
  }

  // =========================================================================
  // STEP 2: EXTRACT PARAMETERS
  // =========================================================================
  ticket.addOutput("\n[STEP 2] Loading parameters...");
  testCases = options.testCases && Array.isArray(options.testCases) ? options.testCases : [];
  isDryRun = typeof options.isDryRun === "boolean" ? options.isDryRun : false;
  sleepBetweenMs = typeof options.sleepBetweenMs === "number" ? options.sleepBetweenMs : 2000;
  maxRetries = typeof options.maxRetries === "number" ? options.maxRetries : 2;
  retryDelayMs = typeof options.retryDelayMs === "number" ? options.retryDelayMs : 1000;
  errorCount = 0;
  testResults = [];

  ticket.addOutput("  [PARAM] testCases defined: " + testCases.length);
  ticket.addOutput("  [PARAM] isDryRun: " + isDryRun);
  ticket.addOutput("  [PARAM] sleepBetweenMs: " + sleepBetweenMs);
  ticket.addOutput("  [PARAM] maxRetries: " + maxRetries);

  // =========================================================================
  // DEFAULT VARS PER PROMPT
  // Applied automatically when no testCase is defined for a promptId.
  // testCase.vars always override these defaults.
  // Update CI names to real production values in your environment.
  // =========================================================================
  DEFAULT_VARS_MAP = {};
  DEFAULT_VARS_MAP["masterdb_cis_info"] = { CI: "GRA17" };
  DEFAULT_VARS_MAP["masterdb_cis_depoyed_clasification"] = { classification: "CMTS" };
  DEFAULT_VARS_MAP["masterdb_cis_depoyed_clasification_location_details"] = { classification: "PLC", concelho: "Viana do Castelo" };
  DEFAULT_VARS_MAP["masterdb_site_energy_autonomy"] = { ci_name: "COI57-1" };
  DEFAULT_VARS_MAP["masterdb_site_generator_power"] = { ci_name: "VCT716-1" };
  DEFAULT_VARS_MAP["masterdb_cis_dependency"] = { ci_classification_objetivo: "PLC", ci_name_origem: "SIN71-1POLT2" };
  DEFAULT_VARS_MAP["masterdb_cis_imapct"] = { ci_name: "GMR1CMTS005" };
  DEFAULT_VARS_MAP["masterdb_cis_imapct_topology"] = { ci_name: "GMR1CMTS005" };
  DEFAULT_VARS_MAP["masterdb_cis_export"] = { filtro: "SERVERS", returnFields: "ci_name;status;owner", email: "hugo.d.goncalves@nos.pt" };
  DEFAULT_VARS_MAP["masterdb_cis_support"] = { ci_name: "COI57-1" };
  DEFAULT_VARS_MAP["masterdb_cis_imapct_park"] = { ci_name: "GMR1CMTS005" };
  DEFAULT_VARS_MAP["masterdb_cis_imapct_park_geo"] = { ci_classification: "PLC", concelho: "Porto" };
  DEFAULT_VARS_MAP["masterdb_cis_attributes"] = { ci_classification: "SERVERS" };
  DEFAULT_VARS_MAP["masterdb_template_rules"] = { ci_classification: "SERVERS" };
  DEFAULT_VARS_MAP["masterdb_cis_classification"] = {};
  DEFAULT_VARS_MAP["masterdb_cis_coordinates"] = { ci_name: "GRA17" };
  DEFAULT_VARS_MAP["masterdb_cis_nwtwork_ip"] = { ci_name: "WSEQCASD002" };
  DEFAULT_VARS_MAP["masterdb_cis_location"] = { ci_name: "GOI2ARIP1" };
  DEFAULT_VARS_MAP["masterdb_cis_servers_virtual"] = {};
  DEFAULT_VARS_MAP["masterdb_cis_rede_erips"] = {};
  DEFAULT_VARS_MAP["masterdb_ci_infra_sites"] = { concelho: "Porto" };

  // =========================================================================
  // DEFAULT mustNotContain — array global aplicado a TODOS os prompts.
  // testCase.mustNotContain adiciona por cima (union, sem duplicados).
  // =========================================================================
  DEFAULT_MUST_NOT = ["I don't know", "não sei", "não tenho informação", "não foi possível", "Não foi possível", "erro interno", "not found", "não encontrado", "nenhum resultado", "erro", "lista vazia", "ERRO_LOGICA"];

  // =========================================================================
  // STEP 3: DEFINE HELPERS (inside function scope — ES5 safe)
  // =========================================================================

  function _sanitizeCsvField(value) {
    if (value === null || value === undefined) return "";
    return String(value)
      .replace(/\r\n|\r|\n|\u2028|\u2029/g, " ")
      .replace(/;/g, ",")
      .replace(/^[=+\-@]/, "'$&"); // CSV injection prevention
  }

  function _stripHtml(html) {
    if (!html) return "";
    var text = String(html);
    // Remove <script>...</script> blocks entirely
    text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
    // Remove <style>...</style> blocks entirely
    text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
    // Replace block-level tags with newline for readability
    text = text.replace(/<\/(p|div|h1|h2|h3|h4|h5|h6|li|tr|br)\s*>/gi, "\n");
    text = text.replace(/<br\s*\/?>/gi, "\n");
    // Replace list bullets with dash
    text = text.replace(/<li[^>]*>/gi, "- ");
    // Strip all remaining HTML tags
    text = text.replace(/<[^>]+>/g, "");
    // Decode common HTML entities
    text = text
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ")
      .replace(/&mdash;/g, "-")
      .replace(/&rarr;/g, "->");
    // Collapse multiple blank lines into one
    text = text.replace(/\n{3,}/g, "\n\n");
    return text.trim();
  }

  function _runWithRetry(fnPath, fnArgs, label) {
    var t, attempt, delay;
    for (attempt = 1; attempt <= maxRetries; attempt++) {
      t = null;
      try {
        if (Array.isArray(fnArgs)) {
          switch (fnArgs.length) {
            case 1:
              t = ModuleUtils.runFunction(fnPath, ticket.getRequestContext(), fnArgs[0]);
              break;
            case 2:
              t = ModuleUtils.runFunction(fnPath, ticket.getRequestContext(), fnArgs[0], fnArgs[1]);
              break;
            case 3:
              t = ModuleUtils.runFunction(fnPath, ticket.getRequestContext(), fnArgs[0], fnArgs[1], fnArgs[2]);
              break;
            case 4:
              t = ModuleUtils.runFunction(fnPath, ticket.getRequestContext(), fnArgs[0], fnArgs[1], fnArgs[2], fnArgs[3]);
              break;
            case 5:
              t = ModuleUtils.runFunction(fnPath, ticket.getRequestContext(), fnArgs[0], fnArgs[1], fnArgs[2], fnArgs[3], fnArgs[4]);
              break;
            case 6:
              t = ModuleUtils.runFunction(fnPath, ticket.getRequestContext(), fnArgs[0], fnArgs[1], fnArgs[2], fnArgs[3], fnArgs[4], fnArgs[5]);
              break;
            case 7:
              t = ModuleUtils.runFunction(fnPath, ticket.getRequestContext(), fnArgs[0], fnArgs[1], fnArgs[2], fnArgs[3], fnArgs[4], fnArgs[5], fnArgs[6]);
              break;
            default:
              t = ModuleUtils.runFunction(fnPath, ticket.getRequestContext(), fnArgs[0]);
              break;
          }
        } else if (fnArgs !== null && fnArgs !== undefined) {
          t = ModuleUtils.runFunction(fnPath, ticket.getRequestContext(), fnArgs);
        } else {
          t = ModuleUtils.runFunction(fnPath, ticket.getRequestContext());
        }
        if (t && ModuleUtils.waitForTicketsSuccess(t)) return t;
      } catch (runErr) {
        ticket.addOutput("  [RETRY] " + label + " attempt " + attempt + " threw: " + runErr.message);
      }
      delay = retryDelayMs * Math.pow(2, attempt - 1);
      if (attempt < maxRetries) {
        ticket.addOutput("  [RETRY] " + label + " attempt " + attempt + "/" + maxRetries + " failed. Waiting " + delay + "ms...");
        ModuleUtils.waitForTicketsSuccess(ModuleUtils.runFunction("/thesys/sleep", ticket.getRequestContext(), delay));
      }
    }
    ticket.addOutput("  [ERROR] " + label + " — all retries exhausted.");
    return null;
  }

  function _safeGetObject(t) {
    try {
      var obj = t && t.getResult ? t.getResult().getObject() : null;
      return obj !== null && obj !== undefined ? String(obj) : "";
    } catch (e) {
      return "";
    }
  }

  function _resolveVars(content, vars) {
    var resolved = content;
    var kk;
    if (!vars) return resolved;
    for (kk in vars) {
      if (vars.hasOwnProperty(kk)) {
        resolved = resolved.replace(new RegExp("\\{\\{" + kk + "\\}\\}", "g"), String(vars[kk]));
      }
    }
    return resolved;
  }

  function _findTestCase(promptId) {
    var ci;
    for (ci = 0; ci < testCases.length; ci++) {
      if (testCases[ci].promptId === promptId) return testCases[ci];
    }
    return null;
  }

  function _evaluateMustNotContain(responseText, mustNot) {
    var failures2 = [];
    var ki2, kw, rwLower, kwLower;
    if (!mustNot || !Array.isArray(mustNot) || mustNot.length === 0) return failures2;
    rwLower = responseText.toLowerCase();
    for (ki2 = 0; ki2 < mustNot.length; ki2++) {
      kw = String(mustNot[ki2]);
      kwLower = kw.toLowerCase();
      if (rwLower.indexOf(kwLower) !== -1) {
        failures2.push(kw);
      }
    }
    return failures2;
  }

  function _sanitizeForPrompt(str) {
    // Remove non-printable ASCII control chars that can break URL encoding
    return String(str || "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  }

  // =========================================================================
  // STEP 4: FETCH PROMPTS LIST
  // =========================================================================
  ticket.addOutput("\n[STEP 4] Fetching prompts via /aop/admin/servers/prompts/list...");

  promptsTicket = _runWithRetry("/aop/admin/servers/prompts/list", "masterdb", "aop servers/prompts/list masterdb");
  if (!promptsTicket) {
    ticket.addOutput("  [ERROR] Failed to fetch prompts list — cannot proceed.");
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_FATAL);
    return;
  }

  promptsRaw = _safeGetObject(promptsTicket);
  promptsParsed = null;
  try {
    promptsParsed = JSON.parse(promptsRaw);
  } catch (parsePromptErr) {
    ticket.addOutput("  [ERROR] Prompts list JSON.parse failed: " + parsePromptErr.message);
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_FATAL);
    return;
  }

  // Support both response formats:
  //   Old: result_data.data (array)           — full list endpoint
  //   New: result_data.data.prompts (object)  — serverid-filtered endpoint
  allPrompts = [];
  if (promptsParsed && promptsParsed.result_data && promptsParsed.result_data.data) {
    if (Array.isArray(promptsParsed.result_data.data)) {
      allPrompts = promptsParsed.result_data.data;
    } else if (promptsParsed.result_data.data.prompts && Array.isArray(promptsParsed.result_data.data.prompts)) {
      allPrompts = promptsParsed.result_data.data.prompts;
    }
  }

  filteredPrompts = [];
  for (pi = 0; pi < allPrompts.length; pi++) {
    if (allPrompts[pi].active === true) {
      filteredPrompts.push(allPrompts[pi]);
    }
  }

  ticket.addOutput("  [STEP 4] Total prompts fetched: " + allPrompts.length + ", active (filtered): " + filteredPrompts.length);

  // LESSON-009: zero records is valid — log explicitly
  if (filteredPrompts.length === 0) {
    ticket.addOutput("  [WARN] No active masterdb prompts found. Nothing to test. Treated as WARN.");
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_WARN);
    return;
  }

  // =========================================================================
  // STEP 5: EXECUTE TESTS SEQUENTIALLY
  // =========================================================================
  ticket.addOutput("\n[STEP 5] Executing " + filteredPrompts.length + " test(s) sequentially...");

  for (pi = 0; pi < filteredPrompts.length; pi++) {
    prompt = filteredPrompts[pi];
    ticket.addOutput("\n  [TEST " + (pi + 1) + "/" + filteredPrompts.length + "] " + prompt.id + " — " + (prompt.label || ""));

    matchedCase = _findTestCase(prompt.id);
    // Merge: defaults first, testCase.vars override
    defaultVarsForPrompt = DEFAULT_VARS_MAP[prompt.id] || {};
    mergedVars = {};
    for (dv in defaultVarsForPrompt) {
      if (defaultVarsForPrompt.hasOwnProperty(dv)) mergedVars[dv] = defaultVarsForPrompt[dv];
    }
    if (matchedCase && matchedCase.vars) {
      for (dv in matchedCase.vars) {
        if (matchedCase.vars.hasOwnProperty(dv)) mergedVars[dv] = matchedCase.vars[dv]; // testCase overrides
      }
    }
    varsMap = mergedVars;
    // mustNotContain: global defaults UNION testCase (no duplicates)
    mergedMustNot = DEFAULT_MUST_NOT.slice();
    if (matchedCase && Array.isArray(matchedCase.mustNotContain)) {
      for (mi = 0; mi < matchedCase.mustNotContain.length; mi++) {
        mnc = matchedCase.mustNotContain[mi];
        var alreadyIn = false;
        for (var mci = 0; mci < mergedMustNot.length; mci++) {
          if (mergedMustNot[mci].toLowerCase() === mnc.toLowerCase()) {
            alreadyIn = true;
            break;
          }
        }
        if (!alreadyIn) mergedMustNot.push(mnc);
      }
    }
    mustNotContainArr = mergedMustNot;
    resolvedPrompt = _resolveVars(prompt.content || "", varsMap);

    ticket.addOutput("  [PROMPT] " + resolvedPrompt.substring(0, 150));
    if (mustNotContainArr.length > 0) {
      ticket.addOutput("  [RULES] mustNotContain: " + mustNotContainArr.join(", "));
    } else {
      ticket.addOutput("  [RULES] No mustNotContain rules — evaluates response presence only.");
    }

    testStart = new Date();
    status = "ERROR";
    failReasons = "";
    responseSummary = "";
    eugeniaTicket = null;
    failures = [];

    if (isDryRun) {
      status = "SKIPPED";
      responseSummary = "[DRY RUN - Eugenia not called]";
      ticket.addOutput("  [DRY RUN] Skipping Eugenia call.");
    } else {
      encodedPrompt = encodeURIComponent(_sanitizeForPrompt(resolvedPrompt));
      try {
        eugeniaTicket = ModuleUtils.runFunction("/aop/eugenia/conversation/request", ticket.getRequestContext(), "", encodedPrompt, AGENT_CONTEXT, "all_tools", "all_agents");
      } catch (callErr) {
        ticket.addOutput("  [ERROR] Eugenia call threw: " + callErr.message);
        eugeniaTicket = null;
        errorCount++;
      }

      if (eugeniaTicket && ModuleUtils.waitForTicketsSuccess(eugeniaTicket)) {
        eugeniaRaw = _safeGetObject(eugeniaTicket);
        if (!eugeniaRaw || eugeniaRaw === "" || eugeniaRaw === "null") {
          ticket.addOutput("  [ERROR] Eugenia returned empty response.");
          errorCount++;
        } else {
          eugeniaResult = null;
          try {
            eugeniaResult = JSON.parse(eugeniaRaw);
          } catch (parseEugeniaErr) {
            ticket.addOutput("  [ERROR] Eugenia response parse failed: " + parseEugeniaErr.message);
            errorCount++;
          }

          if (eugeniaResult && eugeniaResult.result_data && eugeniaResult.result_data.data && eugeniaResult.result_data.data.response && eugeniaResult.result_data.data.response.reply && eugeniaResult.result_data.data.response.reply.content) {
            replyContent = String(eugeniaResult.result_data.data.response.reply.content);
            responseSummary = _stripHtml(replyContent);
            ticket.addOutput("  [RESPONSE] (" + replyContent.length + " chars) " + responseSummary.substring(0, 500));

            failures = _evaluateMustNotContain(replyContent, mustNotContainArr);
            if (failures.length > 0) {
              status = "FAIL";
              failReasons = failures.join(" | ");
              ticket.addOutput("  [FAIL] mustNotContain violations: " + failReasons);
              errorCount++;
            } else {
              status = "PASS";
              ticket.addOutput("  [PASS] Response OK" + (mustNotContainArr.length === 0 ? " (presence check only — no rules defined)" : "") + ".");
            }
          } else {
            ticket.addOutput("  [ERROR] Eugenia response malformed (missing result_data.data.response.reply.content).");
            errorCount++;
          }
        }
      } else {
        ticket.addOutput("  [ERROR] Eugenia ticket failed or null.");
        errorCount++;
      }
    }

    testDurationMs = new Date().getTime() - testStart.getTime();
    ticket.addOutput("  [DONE] status=" + status + " | duration=" + testDurationMs + "ms");

    testResults.push({
      promptId: _sanitizeCsvField(prompt.id),
      label: _sanitizeCsvField(prompt.label || ""),
      resolvedPrompt: _sanitizeCsvField(resolvedPrompt),
      mustNotContain: _sanitizeCsvField(mustNotContainArr.join(" | ")),
      status: status,
      failReasons: _sanitizeCsvField(failReasons),
      responseSummary: _sanitizeCsvField(responseSummary),
      durationMs: String(testDurationMs)
    });

    // [THROTTLE] Sleep between calls — skip after last test
    if (!isDryRun && pi < filteredPrompts.length - 1 && sleepBetweenMs > 0) {
      ticket.addOutput("  [SLEEP] " + sleepBetweenMs + "ms before next test...");
      ModuleUtils.waitForTicketsSuccess(ModuleUtils.runFunction("/thesys/sleep", ticket.getRequestContext(), sleepBetweenMs));
    }
  }

  // =========================================================================
  // STEP 6: BUILD CSV
  // =========================================================================
  ticket.addOutput("\n[STEP 6] Building CSV...");

  passCount = 0;
  failCount = 0;
  skipCount = 0;
  errorTestCount = 0;
  for (ri = 0; ri < testResults.length; ri++) {
    if (testResults[ri].status === "PASS") {
      passCount++;
    } else if (testResults[ri].status === "FAIL") {
      failCount++;
    } else if (testResults[ri].status === "SKIPPED") {
      skipCount++;
    } else {
      errorTestCount++;
    }
  }
  ticket.addOutput("  [CSV] PASS=" + passCount + " FAIL=" + failCount + " ERROR=" + errorTestCount + " SKIPPED=" + skipCount);

  csvArray = [["promptId", "label", "resolvedPrompt", "mustNotContain", "status", "failReasons", "responseSummary", "durationMs"]];
  for (ri = 0; ri < testResults.length; ri++) {
    csvRow = testResults[ri];
    csvArray.push([csvRow.promptId, csvRow.label, csvRow.resolvedPrompt, csvRow.mustNotContain, csvRow.status, csvRow.failReasons, csvRow.responseSummary, csvRow.durationMs]);
  }

  csvPath = null;
  if (!isDryRun) {
    try {
      dir = new File(STORAGE_BASE);
      if (!dir.exists()) dir.mkdirs();
    } catch (dirErr) {
      ticket.addOutput("  [WARN] Could not create storage dir: " + dirErr.message);
    }
    csvPath = STORAGE_BASE + File.separator + "eugenia_test_suite_" + startTime.getTime() + ".csv";
    ticket.addOutput("  [CSV] Writing " + testResults.length + " rows to: " + csvPath);
    csvTicket = _runWithRetry("/fileutils/storetocsvwithencoding", ["FIELDSEPARATOR=;", JSON.stringify(csvArray), csvPath, "yes", "Windows-1252"], "CSV write");
    if (!csvTicket) {
      ticket.addOutput("  [ERROR] CSV write failed — email will have no attachment.");
      errorCount++;
      csvPath = null;
    } else {
      ticket.addOutput("  [CSV] Written OK.");
    }
  } else {
    ticket.addOutput("  [DRY RUN] Would write CSV (" + csvArray.length + " rows including header).");
  }

  // =========================================================================
  // STEP 7: SEND EMAIL REPORT
  // =========================================================================
  ticket.addOutput("\n[STEP 7] Sending email report...");

  emailSubject = "[Eugenia Test Suite] MasterDB | " + startTime.toISOString().substring(0, 10) + " | PASS=" + passCount + " FAIL=" + failCount + " ERR=" + errorTestCount;

  htmlBody = "<p>Ola Hugo,</p>";
  htmlBody += "<p>Segue o relatorio de testes automaticos da Eugenia (serverid=masterdb).</p>";
  htmlBody += "<table border='1' cellpadding='6' cellspacing='0' style='border-collapse:collapse;font-size:13px;font-family:Arial,sans-serif;'>";
  htmlBody += "<tr style='background:#003087;color:white;'><th>Metrica</th><th>Valor</th></tr>";
  htmlBody += "<tr><td>Total prompts testados</td><td><b>" + testResults.length + "</b></td></tr>";
  htmlBody += "<tr style='color:green'><td>PASS</td><td><b>" + passCount + "</b></td></tr>";
  htmlBody += "<tr style='color:red'><td>FAIL</td><td><b>" + failCount + "</b></td></tr>";
  htmlBody += "<tr style='color:orange'><td>ERROR (API/parse)</td><td><b>" + errorTestCount + "</b></td></tr>";
  htmlBody += "<tr><td>SKIPPED (dryRun)</td><td><b>" + skipCount + "</b></td></tr>";
  htmlBody += "</table>";

  if (failCount > 0 || errorTestCount > 0) {
    htmlBody += "<br><h3 style='color:red'>Falhas detectadas:</h3><ul style='font-family:Arial,sans-serif;font-size:13px;'>";
    for (ri = 0; ri < testResults.length; ri++) {
      if (testResults[ri].status === "FAIL" || testResults[ri].status === "ERROR") {
        htmlBody += "<li><b>" + testResults[ri].label + "</b> (" + testResults[ri].promptId + ")";
        htmlBody += " &mdash; <span style='color:red'>" + testResults[ri].status + "</span>";
        if (testResults[ri].failReasons) {
          htmlBody += " &rarr; [" + testResults[ri].failReasons + "]";
        }
        htmlBody += "</li>";
      }
    }
    htmlBody += "</ul>";
  }

  htmlBody += "<br><p>Detalhe completo em anexo (CSV).</p>";
  htmlBody += "<p><i>Gerado automaticamente &mdash; NOS P&amp;C Automation</i></p>";

  // LESSON-008: validate emailRecipient immediately before send
  if (!isDryRun) {
    if (!EMAIL_RECIPIENT || String(EMAIL_RECIPIENT).trim() === "") {
      ticket.addOutput("  [ERROR] emailRecipient is empty — email not sent.");
      errorCount++;
    } else {
      ticket.addOutput("  [MAIL] Sending to: " + EMAIL_RECIPIENT);
      mailTicket = ModuleUtils.runFunction("/netutils/mail/sendhtmlmailwithattachments2", ticket.getRequestContext(), "", EMAIL_RECIPIENT, "", "", emailSubject, htmlBody, csvPath || "");
      mailOk = ModuleUtils.waitForTicketsSuccess(mailTicket);
      if (!mailOk) {
        rawMailErr = "";
        try {
          rawMailErr = mailTicket.getResult() ? String(mailTicket.getResult().getObject()) : "null";
        } catch (mailReadErr) {
          rawMailErr = "unavailable";
        }
        ticket.addOutput("  [ERROR] Email failed: " + rawMailErr.substring(0, 300));
        errorCount++;
      } else {
        ticket.addOutput("  [MAIL] Sent OK.");
      }
      // Best-effort cleanup of temp CSV
      if (csvPath) {
        ModuleUtils.runFunction("/cmd/executelocal", ticket.getRequestContext(), "rm " + csvPath);
        ticket.addOutput("  [CLEANUP] CSV file removed.");
      }
    }
  } else {
    ticket.addOutput("  [DRY RUN] Would send email to: " + EMAIL_RECIPIENT);
    ticket.addOutput("  [DRY RUN] Subject: " + emailSubject);
  }

  // =========================================================================
  // STEP 8: FINAL RESULT
  // =========================================================================
  endTime = new Date();
  deltaTime = (endTime.getTime() - startTime.getTime()) / 1000;

  ticket.addOutput("\n=== [EUGENIA TEST SUITE] EXECUTION SUMMARY ===");
  ticket.addOutput("[FINAL] Total: " + testResults.length + " | PASS: " + passCount + " | FAIL: " + failCount + " | ERROR: " + errorTestCount + " | SKIPPED: " + skipCount);
  ticket.addOutput("[FINAL] Global errors: " + errorCount);
  ticket.addOutput("[FINAL] Duration: " + deltaTime.toFixed(2) + "s");
  ticket.addOutput("[FINAL] isDryRun: " + isDryRun);

  resultObj = {
    total: testResults.length,
    pass: passCount,
    fail: failCount,
    error: errorTestCount,
    skipped: skipCount,
    globalErrors: errorCount,
    duration: deltaTime,
    isDryRun: isDryRun,
    results: testResults
  };

  ticket.getResult().setObject(JSON.stringify(resultObj));
  finalStatus = failCount > 0 || errorTestCount > 0 ? TheSysModuleFunctionResult.RESULT_WARN : TheSysModuleFunctionResult.RESULT_OK;
  ticket.getResult().setResult(finalStatus);
}

function aiToolsTRINInventoryAssuranceCreateChange(ticket, params) {
  var response = ModuleUtils.makeOutput(11, ticket.getRequestContext());
  var results = { content: null, logs: [] };

  // ── Logging helpers ──────────────────────────────────────────────────────
  function addLog(level, stage, msg) {
    results.logs.push("[" + level + "][" + stage + "] " + String(msg || ""));
  }

  function fail(msg, code) {
    addLog("ERROR", "FATAL", msg);
    results.content = { success: false, error: msg };
    response = ModuleUtils.setResponse(response, TheSysModuleFunctionResult.RESULT_NOK, code || "ERROR");
    response = ModuleUtils.setOutput(response, 11, JSON.stringify(results));
    ticket.getResult().setObject(response);
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
  }

  // =========================================================================
  // STEP 1: PARSE PARAMETERS
  // =========================================================================
  addLog("INFO", "PARSE_PARAMS", "Parsing input parameters...");

  var parameters;
  try {
    parameters = JSON.parse(params.get(0));
  } catch (e) {
    fail("Failed to parse input parameters: " + e.message, "MALFORMED_PARAMS");
    return;
  }

  var domain = String(parameters.domain || "")
    .trim()
    .toLowerCase();
  var summary = String(parameters.summary || "").trim();
  var notes = String(parameters.notes || "").trim();
  var isDryRun = typeof parameters.isDryRun === "boolean" ? parameters.isDryRun : false;

  addLog("INFO", "PARSE_PARAMS", "domain=" + domain + " | isDryRun=" + isDryRun);
  addLog("INFO", "PARSE_PARAMS", "summary=" + summary.substring(0, 100));

  // =========================================================================
  // STEP 2: VALIDATE
  // =========================================================================
  addLog("INFO", "VALIDATE", "Validating required fields...");

  if (!domain) {
    fail("Parameter 'domain' is required.", "MISSING_DOMAIN");
    return;
  }
  if (!summary) {
    fail("Parameter 'summary' is required.", "MISSING_SUMMARY");
    return;
  }
  if (!notes) {
    fail("Parameter 'notes' is required.", "MISSING_NOTES");
    return;
  }
  if (summary.length > 200) {
    fail("Parameter 'summary' exceeds 200 characters (" + summary.length + ").", "SUMMARY_TOO_LONG");
    return;
  }

  // =========================================================================
  // STEP 3: DOMAIN CONFIG
  // Extend this map when TRIN type IDs for other domains are provided.
  // =========================================================================
  addLog("INFO", "DOMAIN_CONFIG", "Resolving domain configuration...");

  var DOMAIN_CONFIG = {
    data_governance: {
      label: "Data Governance",
      trinTypeId: "69ae904279c0b8001a572a27", // MasterDB Type — Data Governance
      slaHours: 24 // SLA: 1 day (R_06)
    }
    // TODO: add remaining domains when TRIN type IDs are confirmed
    // "data_access":   { label: "Data Access",   trinTypeId: "TBD", slaHours: TBD },
    // "data_quality":  { label: "Data Quality",  trinTypeId: "TBD", slaHours: TBD },
    // "requisito":     { label: "Requisito",      trinTypeId: "TBD", slaHours: TBD },
    // "ai":            { label: "AI",             trinTypeId: "TBD", slaHours: TBD }
  };

  var domainConf = DOMAIN_CONFIG[domain];
  if (!domainConf) {
    fail("Domain '" + domain + "' is not yet supported. Supported domains: " + Object.keys(DOMAIN_CONFIG).join(", "), "UNSUPPORTED_DOMAIN");
    return;
  }

  addLog("INFO", "DOMAIN_CONFIG", "Resolved: label=" + domainConf.label + " | slaHours=" + domainConf.slaHours + " | trinTypeId=" + domainConf.trinTypeId);

  // =========================================================================
  // STEP 4: TRIN CONFIRMED IDs (production)
  // Source: pulse-action-executor.js — TRIN_IDS
  // =========================================================================
  var TRIN_IDS = {
    changeTemplate: "69a84791b27ba3001a6b442e",
    riskR4: "60cb64700b98b90013cc57b8",
    typeStandard: "60cb64b10b98b90013cc57bb",
    requestTypeChange: "60cb5fe90b98b90013cc57b3",
    plannedRollbackNo: "6335ae2c8ddae1b3eb0cbdd4",
    requestQualityControl: "641c39c183c255002961434e",
    automationLevel: "64591bc0237d7f00233a7f15",
    masterdbPriorityMajor: "627d2f35a58f26ae2e77b74d",
    operationalTier1Acesso: "60d5935d1939320011e3b9d2",
    companyNosRedes: "60cc596e8c2dc3482f3be941",
    impactPark: "676d42e1b3edea00526caa6f",
    impactProbability: "676d43d6881ad302f1710163",
    // Stakeholder: Gestão de Operação & Melhoria Contínua (defaultOrgId / defaultGroupId)
    ownerOrgId: "640877c2eacffcf2ab1d3d06",
    ownerGroupId: "64086dfbeacffcf2ab16dfff",
    ownerUserId: "6241c24269d4aee01a8e1bb9"
  };

  // =========================================================================
  // STEP 5: BUILD CHANGE PAYLOAD
  // =========================================================================
  addLog("INFO", "BUILD_PAYLOAD", "Building TRIN Change payload...");

  var nowMs = new Date().getTime();
  var scheduledEnd = new Date(nowMs + domainConf.slaHours * 3600000).toISOString();

  var changePayload = JSON.stringify({
    data: {
      template_id: TRIN_IDS.changeTemplate,
      status: "DRAFT",
      fields: {
        description: summary,
        notes: notes,
        risk: TRIN_IDS.riskR4,
        type: TRIN_IDS.typeStandard,
        request_type: TRIN_IDS.requestTypeChange,
        planned_rollback: TRIN_IDS.plannedRollbackNo,
        request_quality_control: TRIN_IDS.requestQualityControl,
        automation_level: TRIN_IDS.automationLevel,
        masterdb_type: domainConf.trinTypeId,
        masterdb_priority: TRIN_IDS.masterdbPriorityMajor,
        operational_tier_1: TRIN_IDS.operationalTier1Acesso,
        owner_company: TRIN_IDS.companyNosRedes,
        owner_organization: TRIN_IDS.ownerOrgId,
        owner_group: TRIN_IDS.ownerGroupId,
        customer_company: TRIN_IDS.companyNosRedes,
        customer_organization: TRIN_IDS.ownerOrgId,
        customer_group: TRIN_IDS.ownerGroupId,
        customer_user: TRIN_IDS.ownerUserId,
        scheduled_end_date: scheduledEnd,
        impact_park: TRIN_IDS.impactPark,
        impact_probability: TRIN_IDS.impactProbability
      }
    }
  });

  addLog("INFO", "BUILD_PAYLOAD", "Payload size: " + changePayload.length + " bytes | scheduledEnd: " + scheduledEnd);

  // =========================================================================
  // STEP 6: CREATE CHANGE (or simulate if isDryRun)
  // =========================================================================
  addLog("INFO", "CREATE_CHANGE", "Creating TRIN Change via /mac/activities/create...");

  if (isDryRun) {
    addLog("INFO", "DRY_RUN", "isDryRun=true — skipping real TRIN call. Payload preview (300): " + changePayload.substring(0, 300));
    results.content = {
      success: true,
      isDryRun: true,
      changeId: "DRYRUN_CHANGE_ID",
      changeTrinId: "CHG-DRYRUN",
      domain: domain,
      domainLabel: domainConf.label,
      summary: summary,
      slaHours: domainConf.slaHours,
      scheduledEnd: scheduledEnd,
      createdAt: new Date().toISOString()
    };
    addLog("INFO", "DONE", "Dry run complete.");
    response = ModuleUtils.setResponse(response, TheSysModuleFunctionResult.RESULT_OK, "DRY_RUN");
    response = ModuleUtils.setOutput(response, 11, JSON.stringify(results));
    ticket.getResult().setObject(response);
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_OK);
    return;
  }

  var createTicket;
  try {
    createTicket = ModuleUtils.runFunction("/mac/activities/create", ticket.getRequestContext(), changePayload);
  } catch (createErr) {
    fail("Exception calling /mac/activities/create: " + createErr.message, "TRIN_CALL_EXCEPTION");
    return;
  }

  if (!createTicket || !ModuleUtils.waitForTicketsSuccess(createTicket)) {
    fail("TRIN /mac/activities/create call failed or timed out.", "TRIN_CALL_FAILED");
    return;
  }

  addLog("INFO", "CREATE_CHANGE", "TRIN call completed. Parsing response...");

  // =========================================================================
  // STEP 7: PARSE RESPONSE
  // Three known response shapes from MAC/TheSys:
  //   A) { _id, _trin_id, ... }                             — direct object
  //   B) { data_output: { _id, _trin_id } }                 — wrapped object
  //   C) { data_output: { result: [ { _id, _trin_id } ] } } — wrapped array
  // =========================================================================
  var rawStr = "";
  try {
    var rawObj = createTicket.getResult ? createTicket.getResult().getObject() : null;
    rawStr = rawObj !== null && rawObj !== undefined ? String(rawObj) : "";
  } catch (e) {
    addLog("WARN", "PARSE_RESPONSE", "Could not read raw result: " + e.message);
  }

  addLog("INFO", "PARSE_RESPONSE", "Raw response (200): " + rawStr.substring(0, 200));

  var newChange = null;
  try {
    var parsed = JSON.parse(rawStr);
    if (parsed && parsed._id) {
      newChange = parsed; // shape A
    } else if (parsed && parsed.data_output && parsed.data_output._id) {
      newChange = parsed.data_output; // shape B
    } else if (parsed && parsed.data_output && parsed.data_output.result && parsed.data_output.result.length > 0) {
      newChange = parsed.data_output.result[0]; // shape C
    }
  } catch (parseErr) {
    fail("Failed to parse TRIN response: " + parseErr.message, "PARSE_ERROR");
    return;
  }

  if (!newChange || !newChange._id) {
    addLog("ERROR", "PARSE_RESPONSE", "Response did not contain a valid _id. Raw: " + rawStr.substring(0, 500));
    fail("TRIN returned an unexpected response (no _id). Please check TRIN directly.", "INVALID_RESPONSE");
    return;
  }

  addLog("INFO", "DONE", "Change created: trinId=" + (newChange._trin_id || "N/A") + " | _id=" + newChange._id);

  // =========================================================================
  // STEP 8: RETURN RESULT
  // =========================================================================
  results.content = {
    success: true,
    isDryRun: false,
    changeId: newChange._id,
    changeTrinId: newChange._trin_id || "N/A",
    domain: domain,
    domainLabel: domainConf.label,
    summary: summary,
    slaHours: domainConf.slaHours,
    scheduledEnd: scheduledEnd,
    createdAt: new Date().toISOString()
  };

  response = ModuleUtils.setResponse(response, TheSysModuleFunctionResult.RESULT_OK, "OK");
  response = ModuleUtils.setOutput(response, 11, JSON.stringify(results));
  ticket.getResult().setObject(response);
  ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_OK);
}

//MCP TOOLS
// ##################################
function mcpToolsParamAddSimple(ticket, params) {
  // Banner
  ticket.addOutput("--- MCP Param Add (Simple) ---");

  // 1) Ler o JSON de entrada (um único argumento string)
  if (!params || !params.size || params.size() < 1) {
    ticket.addOutput("ERROR: Falta o parâmetro (JSON).");
    ticket.getResult().setObject(
      JSON.stringify({
        error: "missing_payload"
      })
    );
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }

  var payloadStr = String(params.get(0) || "");
  var payload = {};
  try {
    payload = JSON.parse(payloadStr);
  } catch (e) {
    ticket.addOutput("ERROR: JSON inválido: " + e);
    ticket.getResult().setObject(
      JSON.stringify({
        error: "invalid_json"
      })
    );
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }

  // 2) Campos mínimos obrigatórios
  var serverid = payload.serverid;
  var toolid = payload.toolid;
  var name = payload.name;
  var descr = payload.description;

  if (!serverid || !toolid || !name || !descr) {
    ticket.addOutput("ERROR: Campos obrigatórios: serverid, toolid, name, description.");
    ticket.getResult().setObject(
      JSON.stringify({
        error: "missing_required_fields"
      })
    );
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }

  // Opcionais
  var values = payload.values && Array.isArray(payload.values) ? payload.values : null;
  // enum (opcional)
  var reqFlag = typeof payload.required === "boolean" ? payload.required : false;

  // 3) Obter lista de tools do server
  var listT = ModuleUtils.runFunction("/mcp/admin/servers/tools/list", ticket.getRequestContext(), serverid);
  if (!ModuleUtils.waitForTicketsSuccess(listT)) {
    ticket.addOutput("ERROR: Falha ao listar tools do server=" + serverid);
    ticket.getResult().setObject(
      JSON.stringify({
        error: "list_failed",
        serverid: serverid
      })
    );
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }

  var listObj = {};
  try {
    listObj = JSON.parse(String(listT.getResult().getObject() || "{}"));
  } catch (eList) {
    ticket.addOutput("ERROR: Falha a processar listagem de tools: " + eList);
    ticket.getResult().setObject(
      JSON.stringify({
        error: "list_parse_failed"
      })
    );
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }

  // 4) Encontrar o bloco do server e a tool pelo id
  // Estrutura esperada: { result_data: { data: [ { id: "masterdb", tools: [ ... ] } ] } }
  var serverBlock = null;
  if (listObj && listObj.result_data && Array.isArray(listObj.result_data.data)) {
    var serversArr = listObj.result_data.data;
    for (var s = 0; s < serversArr.length; s++) {
      if (serversArr[s] && serversArr[s].id === serverid) {
        serverBlock = serversArr[s];
        break;
      }
    }
    // fallback: se não encontrarmos pelo id, usar o primeiro bloco
    if (!serverBlock && serversArr.length > 0) {
      serverBlock = serversArr[0];
    }
  }

  if (!serverBlock || !Array.isArray(serverBlock.tools)) {
    ticket.addOutput("ERROR: Estrutura inesperada na listagem: não foi possível obter tools do server '" + serverid + "'.");
    ticket.getResult().setObject(
      JSON.stringify({
        error: "no_tools_block",
        serverid: serverid
      })
    );
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }

  var tools = serverBlock.tools;
  var tool = null;
  for (var i = 0; i < tools.length; i++) {
    if (tools[i] && tools[i].id === toolid) {
      tool = tools[i];
      break;
    }
  }

  if (!tool) {
    ticket.addOutput("ERROR: Tool não encontrada no server. toolid=" + toolid);
    ticket.getResult().setObject(
      JSON.stringify({
        error: "tool_not_found",
        serverid: serverid,
        toolid: toolid
      })
    );
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }

  // 5) Garantir estrutura e fazer merge do novo parâmetro
  tool["function"] = tool["function"] || {};
  tool["function"]["parameters"] = tool["function"]["parameters"] || {};
  tool["function"]["parameters"]["type"] = tool["function"]["parameters"]["type"] || "object";
  tool["function"]["parameters"]["properties"] = tool["function"]["parameters"]["properties"] || {};
  tool["function"]["parameters"]["required"] = tool["function"]["parameters"]["required"] || [];

  var pDef = {
    description: descr,
    type: "string"
  };
  if (values && values.length) {
    pDef["enum"] = values;
    // usar colchetes para 'enum' (palavra reservada)
  }

  tool["function"]["parameters"]["properties"][name] = pDef;

  if (reqFlag) {
    var reqArr = tool["function"]["parameters"]["required"];
    var exists = false;
    for (var r = 0; r < reqArr.length; r++) {
      if (reqArr[r] === name) {
        exists = true;
        break;
      }
    }
    if (!exists) reqArr.push(name);
  }

  // 6) Update da tool
  var updT = ModuleUtils.runFunction("/mcp/admin/servers/tools/update", ticket.getRequestContext(), serverid, JSON.stringify(tool));
  if (!ModuleUtils.waitForTicketsSuccess(updT)) {
    var rawUpd = "";
    try {
      rawUpd = String(updT.getResult().getObject() || updT.getOutput() || "");
    } catch (eUpd) {}
    ticket.addOutput("ERROR: Update falhou. Resposta: " + rawUpd);
    ticket.getResult().setObject(
      JSON.stringify({
        error: "update_failed",
        serverid: serverid,
        toolid: toolid
      })
    );
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }

  // 7) OK
  ticket.addOutput("SUCCESS: Parâmetro '" + name + "' adicionado/atualizado na tool '" + toolid + "' do server '" + serverid + "'.");
  ticket.getResult().setObject(
    JSON.stringify({
      serverid: serverid,
      toolid: toolid,
      name: name,
      required: reqFlag
    })
  );
  ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_OK);
}

/**
 * ============================================================================
 * AI Tool: MasterDB Find - Location Geo Info
 * ============================================================================
 *
 * NOME:    aiToolsMasterDBFindLocationGeoInfo
 * PATH:    /ai/tools/masterdb/find/LocationGeoInfo
 * TIPO:    read
 * PROPÓSITO: Resolve o país, concelho e distrito de um valor de `location`
 *            da MasterDB, seguindo um workflow de 3 passos:
 *
 *            1. STEP 1 — Pesquisa até 20 CIs com location=~eq~<location> e
 *               status=Deployed. Itera os resultados à procura de um `site`
 *               com formato de código válido: 2-5 letras seguidas de dígito
 *               (ex: "OEI32", "ODV2-1"). Sites inválidos como "IMOPOLIS1"
 *               (7 letras antes do dígito) ou vazios são saltados.
 *
 *            2. STEP 2 — Extrai o prefixo do site:
 *               "ODV2-1" → prefixo "ODV2" (parte antes do primeiro "-")
 *               "OEI32"  → prefixo "OEI32" (sem dash, usa valor completo)
 *
 *            3. STEP 3 — Pesquisa TECHNICAL_ROOM com ci_name=~like~<prefixo>-
 *               (o "-" garante precisão: "OEI32-" não apanha "OEI329").
 *               Extrai location_details.address e agrupa por endereço
 *               (distinct por country+concelho+district+postal_code).
 *
 * PARÂMETROS OBRIGATÓRIOS:
 *   - location (string) — valor da location (ex: "POVOASANTOADRIAOMSC")
 *
 * OUTPUT (results.content):
 * {
 *   location: string,
 *   site_raw: string|null,        — site encontrado no CI (ex: "ODV2-10")
 *   site_prefix: string|null,     — prefixo extraído (ex: "ODV2")
 *   technical_rooms: [
 *     {
 *       ci_names: string[],       — nomes de TRs com o mesmo endereço
 *       country: string|null,
 *       concelho: string|null,
 *       district: string|null,
 *       address: object|null,     — objecto completo location_details.address
 *       coordinates: object|null  — { latitude, longitude }
 *     }
 *   ]
 * }
 *
 * ERROS:
 *   MALFORMED_PARAMS       — JSON inválido em params.get(0)
 *   MISSING_INPUT          — location ausente
 *   BACKEND_ERROR          — falha em /masterdb/ci/search
 *   LOCATION_NOT_FOUND     — nenhum CI com esse valor de location
 *   SITE_FORMAT_UNSUPPORTED — nenhum dos 20 CIs tem site no formato válido
 *   TR_NOT_FOUND           — nenhum TECHNICAL_ROOM encontrado para o prefixo
 *
 * NOTA: NOT_FOUND retorna RESULT_OK com technical_rooms:[] — nunca RESULT_NOK.
 *
 * @param {TheSysTicket} ticket
 * @param {JavaCollection} params — índice 0 = JSON string
 */
function aiToolsMasterDBFindLocationGeoInfo(ticket, params) {
  // =========================================================================
  // HELPERS
  // =========================================================================
  function safeStr(v, max) {
    try {
      var s = String(v === null || v === undefined ? "" : v);
      return max && s.length > max ? s.substring(0, max) + "...[truncated]" : s;
    } catch (e) {
      return "[unavailable]";
    }
  }
  function addFilter(arr, k, v) {
    if (!k) return;
    if (v === undefined || v === null || v === "") return;
    if (Array.isArray(v)) {
      if (v.length > 0) arr.push(k + "=" + v.join(","));
    } else arr.push(k + "=" + v);
  }
  function normalizeReturnFields(rf) {
    if (!rf) return "";
    var s = String(rf).trim();
    return s.indexOf(",") !== -1
      ? s
          .split(",")
          .map(function (x) {
            return x.trim();
          })
          .join(";")
      : s;
  }
  function safeTryGet(t) {
    try {
      return String(t.getResult().getObject() || t.getOutput() || "");
    } catch (e) {
      return "";
    }
  }
  function runSearch(queryPayload) {
    var t = ModuleUtils.runFunction("/masterdb/ci/search", ticket.getRequestContext(), JSON.stringify(queryPayload));
    if (!ModuleUtils.waitForTicketsSuccess(t)) return { ok: false, raw: safeTryGet(t) };
    try {
      var rawStr = String(t.getResult().getObject());
      var parsedObj = JSON.parse(rawStr);
      var resultsArr = parsedObj && parsedObj.data_output && Array.isArray(parsedObj.data_output.result) ? parsedObj.data_output.result : [];
      var fullCount = parsedObj && parsedObj.data_output && typeof parsedObj.data_output.result_full_count === "number" ? parsedObj.data_output.result_full_count : null;
      return { ok: true, parsed: parsedObj, arr: resultsArr, full: fullCount, raw: rawStr };
    } catch (e) {
      return { ok: false, raw: "parse_error:" + e };
    }
  }

  // =========================================================================
  // INIT ENVELOPE
  // =========================================================================
  var responseEnvelope = ModuleUtils.makeOutput(11, ticket.getRequestContext());
  var resultsEnvelope = { content: null, logs: [] };

  function finish(okFlag, codeStr) {
    responseEnvelope = ModuleUtils.setResponse(responseEnvelope, okFlag ? TheSysModuleFunctionResult.RESULT_OK : TheSysModuleFunctionResult.RESULT_NOK, codeStr || (okFlag ? "OK" : "NOK"));
    responseEnvelope = ModuleUtils.setOutput(responseEnvelope, 11, JSON.stringify(resultsEnvelope));
    ticket.getResult().setObject(responseEnvelope);
    ticket.getResult().setResult(okFlag ? TheSysModuleFunctionResult.RESULT_OK : TheSysModuleFunctionResult.RESULT_NOK);
  }

  // =========================================================================
  // PARSE PARAMS
  // =========================================================================
  var p = {};
  var rawIn = "";
  try {
    rawIn = params && params.size && params.size() > 0 ? params.get(0) || "{}" : "{}";
    p = JSON.parse(rawIn);
  } catch (e) {
    resultsEnvelope.logs.push(JSON.stringify({ error: "MALFORMED_PARAMS", detail: safeStr(e, 400), raw: safeStr(rawIn, 400) }));
    return finish(false, "MALFORMED_PARAMS");
  }
  resultsEnvelope.logs.push(JSON.stringify({ parameters: p }));

  // =========================================================================
  // VALIDATE REQUIRED
  // =========================================================================
  var locationInput = p.location ? String(p.location).trim() : "";
  if (!locationInput) {
    resultsEnvelope.logs.push(JSON.stringify({ error: "MISSING_INPUT", message: "O parâmetro 'location' é obrigatório." }));
    return finish(false, "MISSING_INPUT");
  }

  // =========================================================================
  // STEP 1 — Resolver site a partir da location
  // =========================================================================
  resultsEnvelope.logs.push(JSON.stringify({ stage: "STEP1_RESOLVE_SITE", location: locationInput }));

  var filterStep1 = [];
  addFilter(filterStep1, "location", "~eq~" + locationInput);
  addFilter(filterStep1, "status", "~eq~Deployed");
  var filterStep1And = filterStep1.join("&");

  // Buscar até 20 CIs com esta location — alguns podem ter site sem dash (ex: "IMOPOLIS1"),
  // por isso iteramos para encontrar o primeiro com formato PREFIX-NUMBER.
  var queryStep1 = {
    skip: 0,
    limit: 20,
    sort_order: -1,
    sort_field: "_created_date",
    filters: filterStep1And ? [filterStep1And] : [],
    return_fields: normalizeReturnFields("ci_name,ci_classification,site,location"),
    relations: false
  };
  resultsEnvelope.logs.push(JSON.stringify({ stage: "BUILD_QUERY_STEP1", query: queryStep1 }));

  var resStep1 = runSearch(queryStep1);
  if (!resStep1.ok) {
    resultsEnvelope.logs.push(JSON.stringify({ error: "BACKEND_ERROR", stage: "STEP1", detail: resStep1.raw }));
    return finish(false, "BACKEND_ERROR");
  }
  resultsEnvelope.logs.push(JSON.stringify({ stage: "STEP1_DONE", result_count: resStep1.arr.length, full_count: resStep1.full }));

  if (resStep1.arr.length === 0) {
    resultsEnvelope.logs.push(JSON.stringify({ stage: "LOCATION_NOT_FOUND", message: "Nenhum CI com location='" + locationInput + "' encontrado." }));
    resultsEnvelope.content = {
      location: locationInput,
      site_raw: null,
      site_prefix: null,
      technical_rooms: []
    };
    return finish(true, "OK");
  }

  // =========================================================================
  // STEP 2 — Iterar sobre os resultados do Step 1 para encontrar um site
  // com formato de código de site válido: 2-5 letras seguidas de dígitos
  // (ex: "OEI32", "ODV2", "ODV2-1"). Sites como "IMOPOLIS1" (7 letras antes
  // do dígito) ou com espaços não são válidos para geo-resolução.
  // =========================================================================

  // Valida se o site tem o padrão: [2-5 letras][dígito] no início
  function isValidSiteCode(s) {
    return new RegExp("^[A-Za-z]{2,5}[0-9]").test(s);
  }

  var siteRaw = "";
  var siteFromCi = "";
  for (var s1i = 0; s1i < resStep1.arr.length; s1i++) {
    var candidate = resStep1.arr[s1i];
    var candidateSite = candidate && candidate.site ? String(candidate.site).trim() : "";
    if (candidateSite && isValidSiteCode(candidateSite)) {
      siteRaw = candidateSite;
      siteFromCi = candidate.ci_name || "";
      break;
    }
    resultsEnvelope.logs.push(JSON.stringify({ stage: "STEP1_SKIP_INVALID_SITE", ci_name: candidate.ci_name || "", site: candidateSite || "(empty)" }));
  }

  resultsEnvelope.logs.push(JSON.stringify({ stage: "STEP1_SITE_RESOLVED", site_raw: siteRaw, from_ci: siteFromCi }));

  if (!siteRaw) {
    resultsEnvelope.logs.push(JSON.stringify({ stage: "SITE_FORMAT_UNSUPPORTED", message: "Nenhum dos " + resStep1.arr.length + " CIs retornados tem site no formato valido (ex: OEI32, ODV2-1). Geo-resolucao nao e possivel para este location." }));
    resultsEnvelope.content = {
      location: locationInput,
      site_raw: null,
      site_prefix: null,
      technical_rooms: []
    };
    return finish(true, "OK");
  }

  // Extrair prefixo: se tem dash (ex: "ODV2-1") → parte antes do dash → "ODV2"
  //                  se não tem dash (ex: "OEI32") → usar valor completo → "OEI32"
  var dashIdx = siteRaw.indexOf("-");
  var sitePrefix = dashIdx > 0 ? siteRaw.substring(0, dashIdx) : siteRaw;
  resultsEnvelope.logs.push(JSON.stringify({ stage: "STEP2_PREFIX_EXTRACTED", site_raw: siteRaw, site_prefix: sitePrefix }));

  // =========================================================================
  // STEP 3 — Pesquisar TECHNICAL_ROOM por ci_name ~like~ prefixo
  // =========================================================================
  resultsEnvelope.logs.push(JSON.stringify({ stage: "STEP3_FIND_TR", ci_name_like: sitePrefix + "-" }));

  var filterStep3 = [];
  addFilter(filterStep3, "ci_classification", "~eq~TECHNICAL_ROOM");
  addFilter(filterStep3, "ci_name", "~like~" + sitePrefix + "-");
  var filterStep3And = filterStep3.join("&");

  var queryStep3 = {
    skip: 0,
    limit: 5,
    sort_order: -1,
    sort_field: "_created_date",
    filters: filterStep3And ? [filterStep3And] : [],
    return_fields: normalizeReturnFields("ci_name,ci_classification,location_details"),
    relations: false
  };
  resultsEnvelope.logs.push(JSON.stringify({ stage: "BUILD_QUERY_STEP3", query: queryStep3 }));

  var resStep3 = runSearch(queryStep3);
  if (!resStep3.ok) {
    resultsEnvelope.logs.push(JSON.stringify({ error: "BACKEND_ERROR", stage: "STEP3", detail: resStep3.raw }));
    return finish(false, "BACKEND_ERROR");
  }
  resultsEnvelope.logs.push(JSON.stringify({ stage: "STEP3_DONE", result_count: resStep3.arr.length }));

  if (resStep3.arr.length === 0) {
    resultsEnvelope.logs.push(JSON.stringify({ stage: "TR_NOT_FOUND", message: "Nenhum TECHNICAL_ROOM encontrado com ci_name ~like~ '" + sitePrefix + "'." }));
    resultsEnvelope.content = {
      location: locationInput,
      site_raw: siteRaw,
      site_prefix: sitePrefix,
      technical_rooms: []
    };
    return finish(true, "OK");
  }

  // =========================================================================
  // BUILD CONTENT — distinct por address (country+concelho+district+postal_code)
  // Múltiplos TECHNICAL_ROOMs com o mesmo endereço são colapsados numa entrada,
  // com ci_names a agregar todos os nomes.
  // =========================================================================
  var addrKeyMap = {}; // key → index in technicalRooms
  var technicalRooms = [];

  for (var i = 0; i < resStep3.arr.length; i++) {
    var trItem = resStep3.arr[i];
    var locDet = trItem.location_details || null;
    var addr = locDet && locDet.address ? locDet.address : null;
    var coords = locDet && locDet.coordinates ? locDet.coordinates : null;

    // Chave de desduplicação: combinação dos campos geográficos principais
    var addrKey = addr ? [String(addr.country || ""), String(addr.concelho || ""), String(addr.district || ""), String(addr.postal_code || "")].join("|") : "__no_address__" + i;

    if (addrKeyMap.hasOwnProperty(addrKey)) {
      // Endereço já existe — apenas adicionar o ci_name
      technicalRooms[addrKeyMap[addrKey]].ci_names.push(trItem.ci_name || "");
    } else {
      // Nova entrada
      addrKeyMap[addrKey] = technicalRooms.length;
      technicalRooms.push({
        ci_names: [trItem.ci_name || ""],
        country: addr && addr.country ? String(addr.country) : null,
        concelho: addr && addr.concelho ? String(addr.concelho) : null,
        district: addr && addr.district ? String(addr.district) : null,
        address: addr || null,
        coordinates: coords || null
      });
    }
  }

  resultsEnvelope.content = {
    location: locationInput,
    site_raw: siteRaw,
    site_prefix: sitePrefix,
    technical_rooms: technicalRooms
  };
  resultsEnvelope.logs.push(JSON.stringify({ stage: "CONTENT_BUILT", technical_rooms_found: resStep3.arr.length, distinct_addresses: technicalRooms.length }));

  return finish(true, "OK");
}

/**
 * ============================================================================
 * AI Tool: MasterDB Get ODF Chain
 * ============================================================================
 *
 * NOME:             aiToolsMasterDBGetODFChain
 * PATH:             /ai/tools/masterdb/ftth/GetODFChain
 * TIPO:             read / topology
 * PROPÓSITO:        A partir de qualquer CI da topologia FTTH (PLC, SPLITTER, ODF...),
 *                   navega a cadeia ODF_CHAIN e devolve os parâmetros de porta de
 *                   cada ligação (port_out, odf_in_port, odf_out_port).
 *
 * ALGORITMO (auto-detecção do ponto de entrada):
 *   1. ci/find?_relations=true no CI de entrada → detecta classificação real e
 *      verifica se já tem relações ODF_CHAIN
 *   Caso A — CI é ODF: devolve SPMs (R2L) e N3s (L2R) directamente
 *   Caso B — CI tem ODF_CHAIN R2L com ODFs (e.g. N3): vai buscar cada ODF e
 *             as suas ligações SPM
 *   Caso C — CI não tem ODF_CHAIN (e.g. PLC): faz searchv2 DEFAULT R2L para
 *             encontrar N3s, depois aplica o Caso B em cada N3
 *
 * PARÂMETROS:
 *   - ci_name             (string, obrig.) — ci_name do CI de entrada
 *   - ci_classification   (string, opt.)   — usado no fallback DEFAULT (Caso C)
 *                                            Aliases: classification
 *   - depth               (number, opt.)   — profundidade DEFAULT para Caso C. Default: 4
 *   - status              (string, opt.)   — filtro de status. Default: "Deployed"
 *
 * RESPOSTA (content):
 *   {
 *     source_ci_name, source_ci_classification,
 *     odf_count,
 *     odf_connections: [
 *       { odf_ci_name, odf_id, odf_netname, split_size,
 *         spm_connections: [{ spm_ci_name, spm_classification, port_out, odf_in_port }],
 *         n3_connections:  [{ n3_ci_name, odf_out_port }]
 *       }
 *     ]
 *   }
 *
 * NOTA: searchv2 não retorna parameters das dependências. Todos os parameters de
 *       porta são extraídos via ci/find?_relations=true. Confirmado Abril 2026.
 *
 * @Authors:Processes & Compliance@
 */
function aiToolsMasterDBGetODFChain(ticket, params) {
  // ── Helpers ──────────────────────────────────────────────────────────────
  function safeStr(v, max) {
    try {
      var s = String(v === null || v === undefined ? "" : v);
      return max && s.length > max ? s.substring(0, max) + "...[truncated]" : s;
    } catch (e) {
      return "[unavailable]";
    }
  }
  function addLog(obj) {
    try {
      results.logs.push(JSON.stringify(obj));
    } catch (e) {}
  }
  function toStr(v, dflt) {
    return v === undefined || v === null ? dflt || "" : String(v);
  }

  function callCIFind(name) {
    try {
      var t = ModuleUtils.runFunction("/masterdb/ci/find", ticket.getRequestContext(), "ci_name=" + name + "&_relations=true");
      if (!ModuleUtils.waitForTicketsSuccess(t)) {
        addLog({ error: "CI_FIND_FAILED", ci_name: name });
        return null;
      }
      var parsed = JSON.parse(String(t.getResult().getObject()));
      // Unwrap envelope layers: data_output → result (object or array[0])
      var ci = parsed;
      if (ci && ci.data_output) ci = ci.data_output;
      if (ci && ci.result) ci = Array.isArray(ci.result) ? ci.result[0] : ci.result;
      return ci || null;
    } catch (e) {
      addLog({ error: "CI_FIND_EXCEPTION", ci_name: name, detail: safeStr(e, 400) });
      return null;
    }
  }

  function callSearchv2Default(name, classification, depthVal) {
    try {
      var t = ModuleUtils.runFunction("/masterdb/dependency/searchv2", ticket.getRequestContext(), depthVal, "DEFAULT", name, classification, "R2L", status, "depth", "false");
      if (!ModuleUtils.waitForTicketsSuccess(t)) {
        addLog({ error: "SEARCHV2_FAILED", ci_name: name });
        return [];
      }
      var parsed = JSON.parse(String(t.getResult().getObject()));
      var data = parsed && parsed.data_output && parsed.data_output.result ? parsed.data_output.result : null;
      return data && Array.isArray(data.destinations) ? data.destinations : [];
    } catch (e) {
      addLog({ error: "SEARCHV2_EXCEPTION", detail: safeStr(e, 400) });
      return [];
    }
  }

  function callSearchv2OdfChain(name) {
    // searchv2 ODF_CHAIN R2L — finds ODFs connected to a given CI.
    // classifications="ODF" restricts destinations to ODF type only.
    // Works for any SPLITTER level and is the primary lookup path.
    try {
      var t = ModuleUtils.runFunction("/masterdb/dependency/searchv2", ticket.getRequestContext(), "1", "ODF_CHAIN", name, "ODF", "R2L", status, "depth", "false");
      if (!ModuleUtils.waitForTicketsSuccess(t)) {
        addLog({ error: "SEARCHV2_ODF_CHAIN_FAILED", ci_name: name });
        return [];
      }
      var parsed = JSON.parse(String(t.getResult().getObject()));
      var data = parsed && parsed.data_output && parsed.data_output.result ? parsed.data_output.result : null;
      return data && Array.isArray(data.destinations) ? data.destinations : [];
    } catch (e) {
      addLog({ error: "SEARCHV2_ODF_CHAIN_EXCEPTION", detail: safeStr(e, 400) });
      return [];
    }
  }

  // Extract R2L and L2R deps from ODF_CHAIN relations of a CI
  function extractODFChainDeps(ciData) {
    var r2l = [],
      l2r = [];
    if (!ciData) return { r2l: r2l, l2r: l2r };
    var rels = Array.isArray(ciData.relations) ? ciData.relations : [];
    for (var i = 0; i < rels.length; i++) {
      if (!rels[i] || rels[i].name !== "ODF_CHAIN") continue;
      var deps = Array.isArray(rels[i].depends) ? rels[i].depends : [];
      for (var j = 0; j < deps.length; j++) {
        if (!deps[j]) continue;
        if (deps[j].direction === "R2L") r2l.push(deps[j]);
        else if (deps[j].direction === "L2R") l2r.push(deps[j]);
      }
    }
    return { r2l: r2l, l2r: l2r };
  }

  function buildSPMConnections(r2lDeps) {
    var conns = [];
    for (var i = 0; i < r2lDeps.length; i++) {
      var d = r2lDeps[i],
        prm = d.parameters || {};
      conns.push({ spm_ci_name: d.resourceName || null, spm_classification: d.resourceClassification || null, port_out: prm.port_out || null, odf_in_port: prm.odf_in_port || null });
    }
    return conns;
  }

  function buildN3Connections(l2rDeps) {
    var conns = [];
    for (var i = 0; i < l2rDeps.length; i++) {
      var d = l2rDeps[i],
        prm = d.parameters || {};
      conns.push({ n3_ci_name: d.resourceName || null, odf_out_port: prm.odf_out_port || null });
    }
    return conns;
  }

  // Resolve full ODF entry: ci/find for odf_name, return odf_connection object
  function resolveODF(odfName) {
    var odfData = callCIFind(odfName);
    var odfDeps = extractODFChainDeps(odfData);
    return {
      odf_ci_name: odfName,
      odf_id: odfData && odfData._id ? String(odfData._id) : null,
      odf_netname: odfData && odfData.odf_netname ? String(odfData.odf_netname) : null,
      split_size: odfData && odfData.split_size ? String(odfData.split_size) : null,
      spm_connections: buildSPMConnections(odfDeps.r2l),
      n3_connections: buildN3Connections(odfDeps.l2r)
    };
  }

  // ── Envelope ─────────────────────────────────────────────────────────────
  var results = { content: null, logs: [] };

  // ── Parse params ─────────────────────────────────────────────────────────
  var p = {};
  try {
    p = JSON.parse(params && params.size && params.size() > 0 ? params.get(0) || "{}" : "{}");
  } catch (e) {
    addLog({ error: "MALFORMED_PARAMS", detail: safeStr(e, 600) });
    ticket.getResult().setObject(JSON.stringify(results));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }

  var ciName = toStr(p.ci_name || p.ci, "").trim();
  var ciClass = toStr(p.ci_classification || p.classification, "")
    .trim()
    .toUpperCase();
  var depth = toStr(p.depth, "4").trim();
  var status = toStr(p.status, "Deployed").trim();

  addLog({ stage: "INPUT", ci_name: ciName, ci_classification: ciClass, depth: depth, status: status });

  if (!ciName) {
    addLog({ error: "MISSING_INPUT", required: ["ci_name"] });
    results.content = null;
    ticket.getResult().setObject(JSON.stringify(results));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_OK);
    return;
  }

  // ── STEP 1: ci/find?_relations=true on input CI ───────────────────────────
  addLog({ stage: "STEP1", ci_name: ciName });
  var inputCIData = callCIFind(ciName);
  var actualClass = inputCIData && inputCIData.ci_classification ? String(inputCIData.ci_classification) : ciClass;
  var inputDeps = extractODFChainDeps(inputCIData);

  addLog({ stage: "STEP1_DONE", actual_classification: actualClass, odf_chain_r2l: inputDeps.r2l.length, odf_chain_l2r: inputDeps.l2r.length });

  var odfConnections = [];

  // ── STEP 2: Route based on CI type ────────────────────────────────────────

  if (actualClass === "ODF") {
    // Case A: input IS an ODF → extract connections directly from its relations
    addLog({ stage: "CASE_A", info: "Input is ODF — extracting connections directly" });
    odfConnections.push({
      odf_ci_name: ciName,
      odf_id: inputCIData && inputCIData._id ? String(inputCIData._id) : null,
      odf_netname: inputCIData && inputCIData.odf_netname ? String(inputCIData.odf_netname) : null,
      split_size: inputCIData && inputCIData.split_size ? String(inputCIData.split_size) : null,
      spm_connections: buildSPMConnections(inputDeps.r2l),
      n3_connections: buildN3Connections(inputDeps.l2r)
    });
  } else {
    // Routing priority for non-ODF inputs:
    //   B_L2R — ci/find returned L2R ODF deps (SPLITTER_SPM is origin of ODF_CHAIN)
    //   B     — searchv2 ODF_CHAIN R2L direct (SPLITTER N3 is destination of ODF_CHAIN)
    //   C     — DEFAULT R2L to find SPLITTERs, then ODF_CHAIN on each (PLC further upstream)
    var seenOdfConn = {};

    // Case B_L2R: ci/find showed this CI has L2R ODF deps (e.g. SPLITTER_SPM → ODF)
    var odfL2RDeps = [];
    for (var li = 0; li < inputDeps.l2r.length; li++) {
      if (inputDeps.l2r[li].resourceClassification === "ODF") odfL2RDeps.push(inputDeps.l2r[li]);
    }
    if (odfL2RDeps.length > 0) {
      addLog({ stage: "CASE_B_L2R", info: "L2R ODF deps found in ci/find (SPM origin path)", odf_count: odfL2RDeps.length });
      for (var li2 = 0; li2 < odfL2RDeps.length; li2++) {
        var odfNameL2R = odfL2RDeps[li2].resourceName;
        if (!odfNameL2R || seenOdfConn[odfNameL2R]) continue;
        seenOdfConn[odfNameL2R] = true;
        odfConnections.push(resolveODF(odfNameL2R));
      }
    } else {
      // Case B: searchv2 ODF_CHAIN R2L from input CI (SPLITTER N3 destination path)
      var directOdfDests = callSearchv2OdfChain(ciName);
      if (directOdfDests.length > 0) {
        addLog({ stage: "CASE_B", info: "Direct ODF_CHAIN R2L found from input CI", odf_count: directOdfDests.length });
        for (var bi = 0; bi < directOdfDests.length; bi++) {
          var odfCand = directOdfDests[bi];
          if (!odfCand || odfCand.ci_classification !== "ODF" || !odfCand.ci_name || seenOdfConn[odfCand.ci_name]) continue;
          seenOdfConn[odfCand.ci_name] = true;
          odfConnections.push(resolveODF(odfCand.ci_name));
        }
      } else {
        // Case C: no direct ODF_CHAIN — traverse DEFAULT R2L to reach downstream SPLITTERs.
        // classifications="SPLITTER" filters destinations to SPLITTER type only.
        addLog({ stage: "CASE_C", info: "No direct ODF_CHAIN — traversing DEFAULT R2L to find splitters", depth: depth });
        var defaultDests = callSearchv2Default(ciName, "SPLITTER", depth);
        var seenSplitter = {};
        for (var di = 0; di < defaultDests.length; di++) {
          var dest = defaultDests[di];
          if (!dest || dest.ci_classification !== "SPLITTER" || !dest.ci_name || seenSplitter[dest.ci_name]) continue;
          seenSplitter[dest.ci_name] = true;
          addLog({ stage: "SPLITTER_FOUND", ci_name: dest.ci_name, splitter_type: dest.splitter_type || "unknown" });
          var odfSearchDests = callSearchv2OdfChain(dest.ci_name);
          for (var osi = 0; osi < odfSearchDests.length; osi++) {
            var odfCandidate = odfSearchDests[osi];
            if (!odfCandidate || odfCandidate.ci_classification !== "ODF" || !odfCandidate.ci_name || seenOdfConn[odfCandidate.ci_name]) continue;
            seenOdfConn[odfCandidate.ci_name] = true;
            var fbconn = resolveODF(odfCandidate.ci_name);
            fbconn.via_splitter = dest.ci_name;
            fbconn.via_splitter_type = dest.splitter_type || null;
            odfConnections.push(fbconn);
          }
        }
        addLog({ stage: "CASE_C_DONE", splitters_checked: Object.keys(seenSplitter).length, odf_connections_found: odfConnections.length });
      }
    }
  }

  // ── Result ────────────────────────────────────────────────────────────────
  results.content = {
    source_ci_name: ciName,
    source_ci_classification: actualClass,
    odf_count: odfConnections.length,
    odf_connections: odfConnections
  };

  ticket.getResult().setObject(JSON.stringify(results));
  ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_OK);
}

// =============================================================================
// HELPER: lisbonISO
// Returns current time as ISO 8601 string in Europe/Lisbon timezone.
// DST rules: UTC+1 (WEST) from last Sunday of March 01:00 UTC
//             to last Sunday of October 01:00 UTC; UTC+0 (WET) otherwise.
// =============================================================================
function lisbonISO() {
  var now = new Date();
  var year = now.getUTCFullYear();

  function lastSundayUTC(month) {
    // Last day of month (month is 0-indexed)
    var d = new Date(Date.UTC(year, month + 1, 0));
    // Roll back to the last Sunday
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    d.setUTCHours(1, 0, 0, 0); // DST change at 01:00 UTC
    return d;
  }

  var dstStart = lastSundayUTC(2); // last Sunday of March
  var dstEnd = lastSundayUTC(9); // last Sunday of October
  var offsetMs = now >= dstStart && now < dstEnd ? 3600000 : 0;
  var offsetLabel = offsetMs > 0 ? "+01:00" : "+00:00";

  var local = new Date(now.getTime() + offsetMs);
  var pad = function (n) {
    return n < 10 ? "0" + n : String(n);
  };
  var ms = local.getUTCMilliseconds();
  var msStr = ms < 10 ? "00" + ms : ms < 100 ? "0" + ms : String(ms);
  return local.getUTCFullYear() + "-" + pad(local.getUTCMonth() + 1) + "-" + pad(local.getUTCDate()) + "T" + pad(local.getUTCHours()) + ":" + pad(local.getUTCMinutes()) + ":" + pad(local.getUTCSeconds()) + "." + msStr + offsetLabel;
}

// =============================================================================
// HELPER: computeRiskGlobals
// ARO v1.2 formula:
//   operational.global = round( mean( round(mean(accessibility_physical, accessibility_temporality, accessibility_disturbance)),
//                                     operation, security ) )
//                        — accessibility sub-group is averaged first; null dims excluded throughout
//   structural.global  = MAX-tier: any==4→4; any==3→3; else round(mean)
//   risk.global        = round(mean(op.global, st.global))
// Returns: { operational_global: int|null, structural_global: int|null, global: int|null }
// =============================================================================
function computeRiskGlobals(operational, structural) {
  var ACC_DIMS = ["accessibility_physical", "accessibility_temporality", "accessibility_disturbance"];
  var OTHER_OP_DIMS = ["operation", "security"];
  var ST_DIMS = ["seismic", "flood", "fire"];

  function safeGrade(obj, key) {
    if (!obj || !obj[key] || obj[key].grade === undefined || obj[key].grade === null) return null;
    var g = parseInt(obj[key].grade, 10);
    return !isNaN(g) && g >= 0 && g <= 4 ? g : null;
  }

  // Step 1: sub-mean of the 3 accessibility dims (unrounded, to avoid cascading rounding error)
  var accGrades = [];
  for (var i = 0; i < ACC_DIMS.length; i++) {
    var ag = safeGrade(operational, ACC_DIMS[i]);
    if (ag !== null) accGrades.push(ag);
  }
  var opInputs = [];
  if (accGrades.length > 0) {
    var accMean =
      accGrades.reduce(function (a, b) {
        return a + b;
      }, 0) / accGrades.length;
    opInputs.push(accMean);
  }

  // Step 2: add operation and security to the pool
  for (var j = 0; j < OTHER_OP_DIMS.length; j++) {
    var og = safeGrade(operational, OTHER_OP_DIMS[j]);
    if (og !== null) opInputs.push(og);
  }
  var opGlobal =
    opInputs.length > 0
      ? Math.round(
          opInputs.reduce(function (a, b) {
            return a + b;
          }, 0) / opInputs.length
        )
      : null;

  var stGrades = [];
  for (var k = 0; k < ST_DIMS.length; k++) {
    var sg = safeGrade(structural, ST_DIMS[k]);
    if (sg !== null) stGrades.push(sg);
  }
  var stGlobal = null;
  if (stGrades.length > 0) {
    var maxSt = Math.max.apply(null, stGrades);
    if (maxSt >= 4) {
      stGlobal = 4;
    } else if (maxSt >= 3) {
      stGlobal = 3;
    } else {
      stGlobal = Math.round(
        stGrades.reduce(function (a, b) {
          return a + b;
        }, 0) / stGrades.length
      );
    }
  }

  // Global: mean of op and st (rounded)
  var globalGrade = null;
  if (opGlobal !== null && stGlobal !== null) {
    globalGrade = Math.round((opGlobal + stGlobal) / 2);
  } else if (opGlobal !== null) {
    globalGrade = opGlobal;
  } else if (stGlobal !== null) {
    globalGrade = stGlobal;
  }

  return { operational_global: opGlobal, structural_global: stGlobal, global: globalGrade };
}

// =============================================================================
// HELPER: masterdbFetchRisk
// Fetches existing CI from MasterDB returning { _id, risk }.
// Returns: { ok: boolean, ci_id: string|null, risk: object|null, error: string|null }
// =============================================================================
function masterdbFetchRisk(ticket, ciName, ciClassification) {
  // Use minimal query — same format confirmed working: ci_name=LIS157-1
  // ci_classification and return_fields are NOT supported as query string params
  var filterStr = "ci_name=" + ciName;

  var t = ModuleUtils.runFunction("/masterdb/ci/find", ticket.getRequestContext(), filterStr);
  if (!ModuleUtils.waitForTicketsSuccess(t)) {
    return { ok: false, ci_id: null, risk: null, error: "MasterDB Find failed for: " + ciName };
  }

  try {
    var raw = String(t.getResult().getObject());
    var parsed = JSON.parse(raw);
    var result = parsed && parsed.data_output && Array.isArray(parsed.data_output.result) ? parsed.data_output.result : [];
    if (result.length > 0) {
      var ci = result[0];
      return { ok: true, ci_id: ci._id || null, risk: ci.risk || null, error: null };
    }
    return { ok: true, ci_id: null, risk: null, error: null };
  } catch (e) {
    return { ok: false, ci_id: null, risk: null, error: "Parse failed: " + e.message };
  }
}

// =============================================================================
// TOOL: aiToolsMasterDBRiskUpsert
// Path: /ai/tools/masterdb/risk/upsert
//
// Creates or updates operational/structural risk dimensions on a TECHNICAL_ROOM CI.
// Partial updates: only supplied dimensions are written; existing ones are preserved.
// Auto-computes globals (ARO v1.2). Auto-sets last_assessment_date and updated_by.
// Appends to risk.notes[] if note is provided.
// dry_run=true by default.
// =============================================================================
function aiToolsMasterDBRiskUpsert(ticket, params) {
  var response = ModuleUtils.makeOutput(11, ticket.getRequestContext());
  var results = { content: null, logs: [] };

  function addLog(level, stage, msg) {
    results.logs.push("[" + level + "][" + stage + "] " + String(msg || ""));
  }
  function fail(msg, code) {
    addLog("ERROR", "FATAL", msg);
    results.content = { success: false, error: msg };
    response = ModuleUtils.setResponse(response, TheSysModuleFunctionResult.RESULT_NOK, code || "ERROR");
    response = ModuleUtils.setOutput(response, 11, JSON.stringify(results));
    ticket.getResult().setObject(response);
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
  }
  function succeed() {
    response = ModuleUtils.setResponse(response, TheSysModuleFunctionResult.RESULT_OK, "OK");
    response = ModuleUtils.setOutput(response, 11, JSON.stringify(results));
    ticket.getResult().setObject(response);
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_OK);
  }

  // ── STEP 1: Parse ──────────────────────────────────────────────────────────
  addLog("INFO", "PARSE", "Parsing parameters...");
  var p;
  try {
    p = JSON.parse(params.get(0));
  } catch (e) {
    fail("Failed to parse params: " + e.message, "MALFORMED_PARAMS");
    return;
  }

  var ciName = String(p.ci_name || "").trim();
  var ciClassification = String(p.ci_classification || "TECHNICAL_ROOM").trim();
  var incomingOp = p.operational || null;
  var incomingSt = p.structural || null;
  var note = String(p.note || "").trim();
  var assessmentVersion = String(p.assessment_version || "").trim();
  var dryRun = p.dry_run !== false;

  if (typeof incomingOp === "string") {
    try {
      incomingOp = JSON.parse(incomingOp);
    } catch (e) {
      fail("Invalid JSON in 'operational': " + e.message, "MALFORMED_PARAMS");
      return;
    }
  }
  if (typeof incomingSt === "string") {
    try {
      incomingSt = JSON.parse(incomingSt);
    } catch (e) {
      fail("Invalid JSON in 'structural': " + e.message, "MALFORMED_PARAMS");
      return;
    }
  }

  if (!ciName) {
    fail("'ci_name' is required.", "MISSING_CI_NAME");
    return;
  }
  if (!incomingOp && !incomingSt && !note) {
    fail("At least one of 'operational', 'structural', or 'note' is required.", "MISSING_DATA");
    return;
  }

  addLog("INFO", "PARSE", "ci_name=" + ciName + " | dry_run=" + dryRun);

  // ── STEP 2: Resolve authenticated user ────────────────────────────────────
  var username = "UNKNOWN";
  try {
    var theSysUser = ticket.getTheSysUser();
    username = theSysUser.getName();
    addLog("INFO", "USER", "username=" + username + " TheSysUser=" + theSysUser);
  } catch (e) {
    addLog("WARN", "USER", "Could not resolve user: " + e.message);
  }

  // ── STEP 3: Fetch existing risk data ──────────────────────────────────────
  addLog("INFO", "FETCH", "Fetching existing risk data...");
  var fetchResult = masterdbFetchRisk(ticket, ciName, ciClassification);
  if (!fetchResult.ok) {
    fail(fetchResult.error, "FETCH_FAILED");
    return;
  }
  if (!fetchResult.ci_id) {
    fail("CI '" + ciName + "' not found in MasterDB.", "CI_NOT_FOUND");
    return;
  }

  var existingRisk = fetchResult.risk || {};
  addLog("INFO", "FETCH", "_id=" + fetchResult.ci_id + " | existing risk.global=" + (existingRisk.global !== undefined ? existingRisk.global : "none"));

  // ── STEP 4: Validate grades ───────────────────────────────────────────────
  var OP_DIMS = ["accessibility_physical", "accessibility_temporality", "accessibility_disturbance", "operation", "security"];
  var ST_DIMS = ["seismic", "flood", "fire"];

  function validateDims(incoming, dims, category) {
    if (!incoming) return true;
    for (var k = 0; k < dims.length; k++) {
      var d = dims[k];
      if (incoming[d] !== undefined) {
        var gv = parseInt(incoming[d].grade, 10);
        if (isNaN(gv) || gv < 0 || gv > 4) {
          fail("Invalid grade for " + category + "." + d + ": must be integer 0-4.", "INVALID_GRADE");
          return false;
        }
      }
    }
    return true;
  }
  if (!validateDims(incomingOp, OP_DIMS, "operational")) return;
  if (!validateDims(incomingSt, ST_DIMS, "structural")) return;

  // ── STEP 5: Merge (partial update — preserve existing unset dims) ─────────
  addLog("INFO", "MERGE", "Merging with existing data...");
  var now = lisbonISO();
  var mergedOp = existingRisk.operational ? JSON.parse(JSON.stringify(existingRisk.operational)) : {};
  var mergedSt = existingRisk.structural ? JSON.parse(JSON.stringify(existingRisk.structural)) : {};

  if (incomingOp) {
    for (var i = 0; i < OP_DIMS.length; i++) {
      var dim = OP_DIMS[i];
      if (incomingOp[dim] !== undefined) {
        mergedOp[dim] = {
          grade: parseInt(incomingOp[dim].grade, 10),
          detail: incomingOp[dim].detail || (mergedOp[dim] && mergedOp[dim].detail) || "",
          updated_date: now,
          updated_by: username
        };
        addLog("INFO", "MERGE", "operational." + dim + "=" + mergedOp[dim].grade);
      }
    }
  }

  if (incomingSt) {
    for (var j = 0; j < ST_DIMS.length; j++) {
      var sdim = ST_DIMS[j];
      if (incomingSt[sdim] !== undefined) {
        mergedSt[sdim] = {
          grade: parseInt(incomingSt[sdim].grade, 10),
          detail: incomingSt[sdim].detail || (mergedSt[sdim] && mergedSt[sdim].detail) || "",
          updated_date: now,
          updated_by: username
        };
        addLog("INFO", "MERGE", "structural." + sdim + "=" + mergedSt[sdim].grade);
      }
    }
  }

  // ── STEP 6: Compute globals (ARO v1.2) ────────────────────────────────────
  addLog("INFO", "COMPUTE", "Computing global grades...");
  var globals = computeRiskGlobals(mergedOp, mergedSt);
  mergedOp.global = globals.operational_global;
  mergedSt.global = globals.structural_global;
  addLog("INFO", "COMPUTE", "op.global=" + globals.operational_global + " | st.global=" + globals.structural_global + " | risk.global=" + globals.global);

  // ── STEP 7: Append note to logbook ────────────────────────────────────────
  var mergedNotes = existingRisk.notes ? JSON.parse(JSON.stringify(existingRisk.notes)) : [];
  if (note) {
    mergedNotes.push({ date: now, by: username, text: note });
    addLog("INFO", "NOTES", "Note appended. logbook_size=" + mergedNotes.length);
  }

  // ── STEP 8: Build full risk payload ───────────────────────────────────────
  var riskPayload = {
    operational: mergedOp,
    structural: mergedSt,
    global: globals.global,
    last_assessment_date: now,
    notes: mergedNotes
  };
  if (assessmentVersion) {
    riskPayload.assessment_version = assessmentVersion;
  } else if (existingRisk.assessment_version) {
    riskPayload.assessment_version = existingRisk.assessment_version;
  }

  // ── STEP 9: Dry run — preview only ────────────────────────────────────────
  if (dryRun) {
    addLog("INFO", "DRY_RUN", "dry_run=true — returning preview, no write.");
    results.content = { success: true, dry_run: true, ci_name: ciName, ci_id: fetchResult.ci_id, computed: globals, risk_payload: riskPayload };
    succeed();
    return;
  }

  // ── STEP 10: Write to MasterDB ────────────────────────────────────────────
  addLog("INFO", "UPDATE", "Writing to MasterDB CI: " + ciName + " | _id=" + fetchResult.ci_id);

  var updateTicket = ModuleUtils.runFunction("/masterdb/ci/update", ticket.getRequestContext(), fetchResult.ci_id, JSON.stringify({ risk: riskPayload }));
  if (!ModuleUtils.waitForTicketsSuccess(updateTicket)) {
    fail("MasterDB Update failed for: " + ciName, "UPDATE_FAILED");
    return;
  }

  addLog("INFO", "DONE", "Upsert complete. ci=" + ciName + " | risk.global=" + globals.global);
  results.content = { success: true, dry_run: false, ci_name: ciName, ci_id: fetchResult.ci_id, computed: globals, risk_payload: riskPayload };
  succeed();
}

// =============================================================================
// TOOL: aiToolsMasterDBRiskDeleteDimension
// Path: /ai/tools/masterdb/risk/delete
//
// Removes a specific risk dimension from a TECHNICAL_ROOM CI and recomputes globals.
// Does NOT delete the entire risk attribute (use masterdb_update directly for that).
// Automatically appends a deletion note to risk.notes[].
// dry_run=true by default.
// =============================================================================
function aiToolsMasterDBRiskDeleteDimension(ticket, params) {
  var response = ModuleUtils.makeOutput(11, ticket.getRequestContext());
  var results = { content: null, logs: [] };

  function addLog(level, stage, msg) {
    results.logs.push("[" + level + "][" + stage + "] " + String(msg || ""));
  }
  function fail(msg, code) {
    addLog("ERROR", "FATAL", msg);
    results.content = { success: false, error: msg };
    response = ModuleUtils.setResponse(response, TheSysModuleFunctionResult.RESULT_NOK, code || "ERROR");
    response = ModuleUtils.setOutput(response, 11, JSON.stringify(results));
    ticket.getResult().setObject(response);
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
  }
  function succeed() {
    response = ModuleUtils.setResponse(response, TheSysModuleFunctionResult.RESULT_OK, "OK");
    response = ModuleUtils.setOutput(response, 11, JSON.stringify(results));
    ticket.getResult().setObject(response);
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_OK);
  }

  // ── STEP 1: Parse ──────────────────────────────────────────────────────────
  var p;
  try {
    p = JSON.parse(params.get(0));
  } catch (e) {
    fail("Failed to parse params: " + e.message, "MALFORMED_PARAMS");
    return;
  }

  var ciName = String(p.ci_name || "").trim();
  var ciClassification = String(p.ci_classification || "TECHNICAL_ROOM").trim();
  var category = String(p.category || "")
    .trim()
    .toLowerCase();
  var dimension = String(p.dimension || "")
    .trim()
    .toLowerCase();
  var dryRun = p.dry_run !== false;

  var VALID_OP = ["accessibility_physical", "accessibility_temporality", "accessibility_disturbance", "operation", "security"];
  var VALID_ST = ["seismic", "flood", "fire"];

  if (!ciName) {
    fail("'ci_name' is required.", "MISSING_CI_NAME");
    return;
  }
  if (!category) {
    fail("'category' is required: 'operational' or 'structural'.", "MISSING_CATEGORY");
    return;
  }
  if (!dimension) {
    fail("'dimension' is required.", "MISSING_DIMENSION");
    return;
  }

  if (category !== "operational" && category !== "structural") {
    fail("'category' must be 'operational' or 'structural'. Got: " + category, "INVALID_CATEGORY");
    return;
  }

  var validDims = category === "operational" ? VALID_OP : VALID_ST;
  var isValid = false;
  for (var v = 0; v < validDims.length; v++) {
    if (validDims[v] === dimension) {
      isValid = true;
      break;
    }
  }
  if (!isValid) {
    fail("Invalid dimension '" + dimension + "' for '" + category + "'. Valid: " + validDims.join(", "), "INVALID_DIMENSION");
    return;
  }

  addLog("INFO", "PARSE", "Delete " + category + "." + dimension + " from " + ciName + " | dry_run=" + dryRun);

  // ── STEP 2: Resolve user ───────────────────────────────────────────────────
  var username = "UNKNOWN";
  try {
    var theSysUser = ticket.getTheSysUser();
    username = theSysUser.getName();
    addLog("INFO", "USER", "username=" + username + " TheSysUser=" + theSysUser);
  } catch (e) {
    addLog("WARN", "USER", "Could not resolve user: " + e.message);
  }

  // ── STEP 3: Fetch existing data ────────────────────────────────────────────
  var fetchResult = masterdbFetchRisk(ticket, ciName, ciClassification);
  if (!fetchResult.ok) {
    fail(fetchResult.error, "FETCH_FAILED");
    return;
  }
  if (!fetchResult.ci_id) {
    fail("CI '" + ciName + "' not found.", "CI_NOT_FOUND");
    return;
  }

  var existingRisk = fetchResult.risk || {};
  var categoryObj = existingRisk[category] ? JSON.parse(JSON.stringify(existingRisk[category])) : {};

  if (!categoryObj[dimension]) {
    fail("Dimension '" + category + "." + dimension + "' does not exist in '" + ciName + "'. Nothing to delete.", "DIMENSION_NOT_FOUND");
    return;
  }

  // ── STEP 4: Remove dimension ───────────────────────────────────────────────
  var removedValue = categoryObj[dimension];
  delete categoryObj[dimension];
  addLog("INFO", "DELETE", "Removed " + category + "." + dimension + " (was grade=" + removedValue.grade + ")");

  // ── STEP 5: Recompute globals ─────────────────────────────────────────────
  var mergedOp = category === "operational" ? categoryObj : existingRisk.operational ? JSON.parse(JSON.stringify(existingRisk.operational)) : {};
  var mergedSt = category === "structural" ? categoryObj : existingRisk.structural ? JSON.parse(JSON.stringify(existingRisk.structural)) : {};

  var globals = computeRiskGlobals(mergedOp, mergedSt);
  mergedOp.global = globals.operational_global;
  mergedSt.global = globals.structural_global;
  addLog("INFO", "COMPUTE", "Recomputed: op.global=" + globals.operational_global + " | st.global=" + globals.structural_global + " | risk.global=" + globals.global);

  // MasterDB deep-merges nested objects — absent keys are kept, not removed.
  // Setting the deleted dimension to null signals MasterDB to clear the field.
  if (category === "operational") {
    mergedOp[dimension] = null;
  } else {
    mergedSt[dimension] = null;
  }
  addLog("INFO", "DELETE", "Set " + category + "." + dimension + "=null in payload for MasterDB removal.");

  // ── STEP 6: Append deletion note ──────────────────────────────────────────
  var now = lisbonISO();
  var mergedNotes = existingRisk.notes ? JSON.parse(JSON.stringify(existingRisk.notes)) : [];
  mergedNotes.push({ date: now, by: username, text: "Removed dimension " + category + "." + dimension + " (was grade=" + removedValue.grade + ")" });

  // ── STEP 7: Build payload ─────────────────────────────────────────────────
  var riskPayload = {
    operational: mergedOp,
    structural: mergedSt,
    global: globals.global,
    last_assessment_date: now,
    notes: mergedNotes
  };
  if (existingRisk.assessment_version) riskPayload.assessment_version = existingRisk.assessment_version;

  if (dryRun) {
    addLog("INFO", "DRY_RUN", "dry_run=true — preview only, no write.");
    results.content = { success: true, dry_run: true, ci_name: ciName, removed: { category: category, dimension: dimension, was: removedValue }, computed: globals, risk_payload: riskPayload };
    succeed();
    return;
  }

  // ── STEP 8: Write ──────────────────────────────────────────────────────────
  addLog("INFO", "UPDATE", "Writing to MasterDB CI: " + ciName + " | _id=" + fetchResult.ci_id);

  var updateTicket = ModuleUtils.runFunction("/masterdb/ci/update", ticket.getRequestContext(), fetchResult.ci_id, JSON.stringify({ risk: riskPayload }));
  if (!ModuleUtils.waitForTicketsSuccess(updateTicket)) {
    fail("MasterDB Update failed for: " + ciName, "UPDATE_FAILED");
    return;
  }

  addLog("INFO", "DONE", "Dimension deleted. ci=" + ciName + " | removed=" + category + "." + dimension + " | new risk.global=" + globals.global);
  results.content = { success: true, dry_run: false, ci_name: ciName, removed: { category: category, dimension: dimension, was: removedValue }, computed: globals };
  succeed();
}

// =============================================================================
// TOOL: aiToolsMasterDBRiskBulkLoad
// Path: /pc/masterdb/risk/bulk-load
//
// Bulk loads risk assessments from ARO CSV data (pre-processed to JSON).
// Modes:
//   dry_run  — preview: fetches each CI, computes globals, returns preview + backup
//   execute  — writes risk payload to each CI, returns results + backup for rollback
//   rollback — restores previous risk state from backup data
//
// Parameters (JSON):
//   mode               — "dry_run" | "execute" | "rollback"
//   assessment_version — e.g. "v1.2"
//   note_prefix        — text prepended to each CI note
//   records            — [{ci_name, operational:{dim:{grade}}, structural:{dim:{grade}}, note}]
//   rollback_data      — [{ci_name, ci_id, risk_before}] (for rollback mode only)
// =============================================================================
function aiToolsMasterDBRiskBulkLoad(ticket, params) {
  var startTime = new Date();
  ticket.addOutput("=== [RISK BULK LOAD] Starting ===");

  // ── Parse params ──────────────────────────────────────────────────────────
  var p;
  try {
    p = JSON.parse(params.get(0));
  } catch (e) {
    ticket.addOutput("[ERROR] Failed to parse params: " + e.message);
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }

  var mode = String(p.mode || "dry_run").toLowerCase();
  var assessmentVersion = String(p.assessment_version || "v1.2");
  var notePrefix = String(p.note_prefix || "Carregamento ARO " + assessmentVersion + " \u2014 bulk load.");
  var records = p.records || [];
  var rollbackData = p.rollback_data || [];

  ticket.addOutput("[CONFIG] mode=" + mode + " | version=" + assessmentVersion + " | records=" + records.length);

  // ── Resolve user ──────────────────────────────────────────────────────────
  var username = "UNKNOWN";
  try {
    username = ticket.getTheSysUser().getName();
  } catch (e) {}
  ticket.addOutput("[USER] " + username);

  var OP_DIMS = ["accessibility_physical", "accessibility_temporality", "accessibility_disturbance", "operation", "security"];
  var ST_DIMS = ["seismic", "flood", "fire"];

  // =========================================================================
  // ROLLBACK MODE
  // =========================================================================
  if (mode === "rollback") {
    ticket.addOutput("[ROLLBACK] Restoring " + rollbackData.length + " CIs...");
    var restored = 0,
      rollFailed = 0;

    for (var ri = 0; ri < rollbackData.length; ri++) {
      var rb = rollbackData[ri];
      if (!rb.ci_id) {
        rollFailed++;
        ticket.addOutput("[ROLLBACK] SKIP: no ci_id for " + (rb.ci_name || "unknown"));
        continue;
      }

      try {
        var riskValue = rb.risk_before !== undefined ? rb.risk_before : null;
        var updateTicket = ModuleUtils.runFunction("/masterdb/ci/update", ticket.getRequestContext(), rb.ci_id, JSON.stringify({ risk: riskValue }));
        if (ModuleUtils.waitForTicketsSuccess(updateTicket)) {
          restored++;
          ticket.addOutput("[ROLLBACK] OK: " + rb.ci_name);
        } else {
          rollFailed++;
          ticket.addOutput("[ROLLBACK] FAIL: " + rb.ci_name);
        }
      } catch (e) {
        rollFailed++;
        ticket.addOutput("[ROLLBACK] ERROR: " + rb.ci_name + " \u2014 " + e.message);
      }
    }

    var rbEnd = new Date();
    ticket.addOutput("=== [ROLLBACK] Done. Restored=" + restored + " Failed=" + rollFailed + " Duration=" + ((rbEnd.getTime() - startTime.getTime()) / 1000).toFixed(2) + "s ===");
    ticket.getResult().setObject(JSON.stringify({ mode: "rollback", restored: restored, failed: rollFailed }));
    ticket.getResult().setResult(rollFailed > 0 ? TheSysModuleFunctionResult.RESULT_WARN : TheSysModuleFunctionResult.RESULT_OK);
    return;
  }

  // =========================================================================
  // EXECUTE / DRY_RUN MODE
  // =========================================================================
  var results = [];
  var backup = [];
  var successCount = 0,
    failCount = 0,
    skipCount = 0;

  for (var i = 0; i < records.length; i++) {
    var rec = records[i];
    var ciName = String(rec.ci_name || "").trim();

    if (!ciName) {
      skipCount++;
      ticket.addOutput("[SKIP] Record " + (i + 1) + ": no ci_name");
      continue;
    }

    // ── Fetch existing ──────────────────────────────────────────────────
    var fetchResult = masterdbFetchRisk(ticket, ciName, "TECHNICAL_ROOM");
    if (!fetchResult.ok) {
      failCount++;
      ticket.addOutput("[FAIL] " + ciName + ": " + fetchResult.error);
      results.push({ ci_name: ciName, status: "FETCH_FAILED", error: fetchResult.error });
      continue;
    }
    if (!fetchResult.ci_id) {
      failCount++;
      ticket.addOutput("[FAIL] " + ciName + ": CI_NOT_FOUND");
      results.push({ ci_name: ciName, status: "CI_NOT_FOUND" });
      continue;
    }

    // ── Store backup ────────────────────────────────────────────────────
    backup.push({
      ci_name: ciName,
      ci_id: fetchResult.ci_id,
      risk_before: fetchResult.risk ? JSON.parse(JSON.stringify(fetchResult.risk)) : null
    });

    // ── Build merged payload ────────────────────────────────────────────
    var now = lisbonISO();
    var existingRisk = fetchResult.risk || {};
    var mergedOp = existingRisk.operational ? JSON.parse(JSON.stringify(existingRisk.operational)) : {};
    var mergedSt = existingRisk.structural ? JSON.parse(JSON.stringify(existingRisk.structural)) : {};

    var inOp = rec.operational || {};
    for (var oi = 0; oi < OP_DIMS.length; oi++) {
      var odim = OP_DIMS[oi];
      if (inOp[odim] !== undefined && inOp[odim] !== null) {
        var gv = parseInt(inOp[odim].grade, 10);
        if (!isNaN(gv) && gv >= 0 && gv <= 4) {
          mergedOp[odim] = {
            grade: gv,
            detail: inOp[odim].detail || (mergedOp[odim] && mergedOp[odim].detail) || "",
            updated_date: now,
            updated_by: username
          };
        }
      }
    }

    var inSt = rec.structural || {};
    for (var si = 0; si < ST_DIMS.length; si++) {
      var sdim = ST_DIMS[si];
      if (inSt[sdim] !== undefined && inSt[sdim] !== null) {
        var sgv = parseInt(inSt[sdim].grade, 10);
        if (!isNaN(sgv) && sgv >= 0 && sgv <= 4) {
          mergedSt[sdim] = {
            grade: sgv,
            detail: inSt[sdim].detail || (mergedSt[sdim] && mergedSt[sdim].detail) || "",
            updated_date: now,
            updated_by: username
          };
        }
      }
    }

    // ── Compute globals ─────────────────────────────────────────────────
    var globals = computeRiskGlobals(mergedOp, mergedSt);
    mergedOp.global = globals.operational_global;
    mergedSt.global = globals.structural_global;

    // ── Notes ───────────────────────────────────────────────────────────
    var mergedNotes = existingRisk.notes ? JSON.parse(JSON.stringify(existingRisk.notes)) : [];
    var noteText = notePrefix;
    if (rec.note) noteText += " " + rec.note;
    mergedNotes.push({ date: now, by: username, text: noteText });

    // ── Payload ─────────────────────────────────────────────────────────
    var riskPayload = {
      operational: mergedOp,
      structural: mergedSt,
      global: globals.global,
      last_assessment_date: now,
      assessment_version: assessmentVersion,
      notes: mergedNotes
    };

    if (mode === "execute") {
      try {
        var writeTicket = ModuleUtils.runFunction("/masterdb/ci/update", ticket.getRequestContext(), fetchResult.ci_id, JSON.stringify({ risk: riskPayload }));
        if (ModuleUtils.waitForTicketsSuccess(writeTicket)) {
          successCount++;
          ticket.addOutput("[OK] (" + (i + 1) + "/" + records.length + ") " + ciName + " | risk.global=" + globals.global);
          results.push({ ci_name: ciName, status: "OK", ci_id: fetchResult.ci_id, globals: globals });
        } else {
          failCount++;
          ticket.addOutput("[FAIL] " + ciName + ": UPDATE_FAILED");
          results.push({ ci_name: ciName, status: "UPDATE_FAILED" });
        }
      } catch (e) {
        failCount++;
        ticket.addOutput("[ERROR] " + ciName + ": " + e.message);
        results.push({ ci_name: ciName, status: "ERROR", error: e.message });
      }
    } else {
      successCount++;
      ticket.addOutput("[DRY] (" + (i + 1) + "/" + records.length + ") " + ciName + " | op=" + globals.operational_global + " st=" + globals.structural_global + " risk=" + globals.global);
      results.push({ ci_name: ciName, status: "DRY_RUN", ci_id: fetchResult.ci_id, globals: globals });
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  var endTime = new Date();
  var duration = (endTime.getTime() - startTime.getTime()) / 1000;

  ticket.addOutput("=== [RISK BULK LOAD] SUMMARY ===");
  ticket.addOutput("Mode: " + mode + " | Total: " + records.length + " | OK: " + successCount + " | FAIL: " + failCount + " | SKIP: " + skipCount);
  ticket.addOutput("Duration: " + duration.toFixed(2) + "s");

  if (mode === "execute" && backup.length > 0) {
    ticket.addOutput("[BACKUP] " + backup.length + " CIs backed up. Save the 'backup' array from the result for rollback.");
  }

  var output = {
    mode: mode,
    total: records.length,
    success: successCount,
    failed: failCount,
    skipped: skipCount,
    duration: duration,
    results: results,
    backup: backup
  };

  ticket.getResult().setObject(JSON.stringify(output));
  ticket.getResult().setResult(failCount > 0 ? TheSysModuleFunctionResult.RESULT_WARN : TheSysModuleFunctionResult.RESULT_OK);
}

//OTHER FUNCTIONS
//********************************************

function printOutputConsole(ticket, response) {
  try {
    var stringResponse = JSON.stringify(JSON.parse(response), null, 2);
    var arrOfString = stringResponse.split("\n");
    for (var k = 0; k < arrOfString.length; k++) {
      ticket.addOutput(arrOfString[k]);
    }
  } catch (error) {
    logSevere("printOutputConsole", error.toString());
  }
}

function setResponse(ticket, response, message, data, result, thesysCode, httpCode) {
  response = ModuleUtils.setResponse(response, result, message);
  response = ModuleUtils.setOutput(response, 11, "eugenia.swarm.", data);
  ticket.getRequestContext().putParameter("thesys.webconnector.HttpStatusCode", httpCode);
  var objToDisplay = JSON.parse(response);
  if (objToDisplay.result_data && objToDisplay.result_data.data && objToDisplay.result_data.data._id) {
    delete objToDisplay.result_data.data._id;
  }
  //printOutputConsole(ticket,response);
  //ModuleUtils.prettyDisplayJSON(ticket, new JSONObject(objToDisplay));
  ticket.getResult().setObject(response);
  ticket.getResult().setResult(thesysCode);
}

function getEnvironment() {
  return TheSysController.getRunningMode() === TheSysController.RUNMODE_PREPRODUCTION ? ".pp" : "";
}

// ####################### Start module ###########################
// # Called every time module starts                              #
// # When this file is saved, thoe module is stopped and started  #
// ################################################################
function startModule() {
  logInfo("startModule", "Starting ...");

  var runTicketKeystoreChatBotAPIPRD = ModuleUtils.runFunction("/keystore/getentry", "EUGENIA_CHATBOT_API_PRD", getRequestContext());
  if (ModuleUtils.waitForTicketsSuccess(runTicketKeystoreChatBotAPIPRD)) {
    chatbotApiPrd = runTicketKeystoreChatBotAPIPRD.getOutput();
  }

  var runTicketKeystoreChatBotAPIPP = ModuleUtils.runFunction("/keystore/getentry", "EUGENIA_CHATBOT_API_PP", getRequestContext());
  if (ModuleUtils.waitForTicketsSuccess(runTicketKeystoreChatBotAPIPP)) {
    chatbotApiPP = runTicketKeystoreChatBotAPIPP.getOutput();
  }

  var runTicketKeystoreChatBotToken = ModuleUtils.runFunction("/keystore/getentry", "EUGENIA_K8S_TOKEN", getRequestContext());
  if (ModuleUtils.waitForTicketsSuccess(runTicketKeystoreChatBotToken)) {
    chatbotToken = runTicketKeystoreChatBotToken.getOutput();
  }

  if (TheSysController.isRunningModeProduction()) {
    chatbotApi = chatbotApiPrd + "/eugenia";
  } else {
    chatbotApi = chatbotApiPP + "/eugenia";
  }

  var functions = [
    {
      name: "aiToolsMasterDBFindEnergyInfra",
      path: "/ai/tools/masterdb/find/EnergyInfra",
      parameters: "params*string",
      description: "Function Tools MasterDB Cis. @Authors:Processes & Compliance@"
    },
    {
      name: "aiToolsHelloWorld",
      path: "/ai/tools/helloWorld",
      parameters: "params*string",
      description: "o meu primeiro hello world@Authors:Processes & Compliance@"
    },
    {
      name: "aiToolsMasterDBFind",
      path: "/ai/tools/masterdb/find",
      parameters: "params*string",
      description: "Function Tools MasterDB Cis. @Authors:Processes & Compliance@"
    },
    {
      name: "mcpToolsParamAddSimple",
      path: "/ai/tools/mcp/ParamAddSimple",
      parameters: "params*string",
      description: "Function to add Parameters. @Authors:Processes & Compliance@"
    },
    {
      name: "aiToolsMasterDBGeoSearch",
      path: "/ai/tools/masterdb/GEOSearch",
      parameters: "params*string",
      description: "Function Tools MasterDB Cis. @Authors:Processes & Compliance@"
    },
    {
      name: "aiToolsMasterDBFindSupport",
      path: "/ai/tools/masterdb/find/EnergyAutonomy",
      parameters: "params*string",
      description: "Function Tools MasterDB Cis. @Authors:Processes & Compliance@"
    },
    {
      name: "aiToolsMasterDBFindEnergyGenerator",
      path: "/ai/tools/masterdb/find/EnergyGenerator",
      parameters: "params*string",
      description: "Function Tools MasterDB Cis. @Authors:Processes & Compliance@"
    },
    {
      name: "aiToolsMasterDBFindEnergySupplier",
      path: "/ai/tools/masterdb/find/EnergySupplier",
      parameters: "params*string",
      description: "Function Tools MasterDB Cis. @Authors:Processes & Compliance@"
    },
    {
      name: "aiToolsMasterDBFindSupport",
      path: "/ai/tools/masterdb/find/Support",
      parameters: "params*string",
      description: "Function Tools MasterDB Cis. @Authors:Processes & Compliance@"
    },
    {
      name: "aiToolsMasterDBTemplateAttributesGet",
      path: "/ai/tools/masterdb/find/TemplateAttributes",
      parameters: "params*string",
      description: "Function Tools MasterDB Cis. @Authors:Processes & Compliance@"
    },
    {
      name: "aiToolsMasterDBClassificationsGet",
      path: "/ai/tools/masterdb/find/Classifications",
      parameters: "params*string",
      description: "Function Tools MasterDB Cis. @Authors:Processes & Compliance@"
    },
    {
      name: "aiToolsMasterDBDependencySearch",
      path: "/ai/tools/masterdb/find/DependencySearch",
      parameters: "params*string",
      description: "Function Tools MasterDB Cis. @Authors:Processes & Compliance@"
    },
    {
      name: "aiToolsMasterDBImpact",
      path: "/ai/tools/masterdb/find/Impact",
      parameters: "params*string",
      description: "Function Tools MasterDB Cis. @Authors:Processes & Compliance@"
    },
    {
      name: "aiToolsMasterDBExportEmailCSV",
      path: "/ai/tools/masterdb/export/EmailCsv",
      parameters: "params*string",
      description: "Function Tools MasterDB Cis. @Authors:Processes & Compliance@"
    },
    {
      name: "aiToolsMasterDBNetworkIPGet",
      path: "/ai/tools/masterdb/find/NetworkIPGet",
      parameters: "params*string",
      description: "Function Tools MasterDB Cis. @Authors:Processes & Compliance@"
    },
    {
      name: "aiToolsMasterDBFindAttributeValues",
      path: "/ai/tools/masterdb/find/AttributeValues",
      parameters: "params*string",
      description: "Function Tools MasterDB Cis. @Authors:Processes & Compliance@"
    },
    {
      name: "aiToolsMasterDBCockpitFindData",
      path: "/ai/tools/masterdb/find/CockpitData",
      parameters: "params*string",
      description: "Function Tools MasterDB Cis. @Authors:Processes & Compliance@"
    },
    {
      name: "aiToolsMasterDBUpdate",
      path: "/ai/tools/masterdb/update",
      parameters: "params*string",
      description: "Function Tools MasterDB Cis. @Authors:Processes & Compliance@"
    },
    {
      name: "aiToolsSystemUptime",
      path: "/ai/tools/thesys/uptime",
      parameters: "params*string",
      description: "Function Tools Thesys uptime. @Authors:Processes & Compliance@"
    },
    {
      name: "aiToolsMasterDBFindTransformations",
      path: "/ai/tools/masterdb/find/Transformations",
      parameters: "params*string",
      description: "Function Tools MasterDB Cis. @Authors:Processes & Compliance@"
    },
    {
      name: "aiToolsMasterDBTransformAdd",
      path: "/ai/tools/masterdb/update/Transformations",
      parameters: "params*string",
      description: "Function Tools MasterDB Cis. @Authors:Processes & Compliance@"
    },
    {
      name: "aiToolsMasterDBComplianceSearch",
      path: "/ai/tools/masterdb/find/Compliances",
      parameters: "params*string",
      description: "Function Tools MasterDB Cis. @Authors:Processes & Compliance@"
    },
    {
      name: "aiToolsMasterDBFindLocationGeoInfo",
      path: "/ai/tools/masterdb/find/LocationGeoInfo",
      parameters: "params*string",
      description: "Resolves country, concelho and district from a MasterDB location value via 3-step workflow: location→site→TECHNICAL_ROOM.location_details. @Authors:Processes & Compliance@"
    },
    {
      name: "aiToolsMasterDBGetODFChain",
      path: "/ai/tools/masterdb/ftth/GetODFChain",
      parameters: "params*string",
      description: "FTTH topology: given any CI (PLC, ONT, SPLITTER, etc.), resolves associated ODFs via ODF_CHAIN and returns port parameters (port_out, odf_in_port, odf_out_port). 3-step: DEFAULT R2L→N3, ODF_CHAIN R2L→ODF, ci/find?_relations→params. Required: ci_name, ci_classification. Optional: depth (default 4), status. @Authors:Processes & Compliance@"
    },
    {
      name: "masterDBEugeniaTest",
      path: "/pc/masterdb/eugenia/test",
      parameters: "configJson*string",
      description: "Auto-tests all active masterdb Eugenia prompts. Evaluates mustNotContain rules. Reports PASS/FAIL/ERROR via CSV email. @Authors:Processes & Compliance@"
    },
    {
      name: "aiToolsMasterDBRiskUpsert",
      path: "/ai/tools/masterdb/risk/upsert",
      parameters: "params*string",
      description: "Creates or updates operational/structural risk assessment dimensions on a TECHNICAL_ROOM CI. Partial updates supported. Auto-computes globals (ARO v1.2 formula). Auto-sets updated_by, updated_date, last_assessment_date. Appends to notes logbook. dry_run=true by default. @Authors:OS@"
    },
    {
      name: "aiToolsMasterDBRiskDeleteDimension",
      path: "/ai/tools/masterdb/risk/delete",
      parameters: "params*string",
      description: "Removes a specific risk dimension (operational or structural) from a TECHNICAL_ROOM CI and recomputes globals (ARO v1.2). Auto-appends deletion note to logbook. dry_run=true by default. @Authors:OS@"
    },
    {
      name: "aiToolsMasterDBRiskBulkLoad",
      path: "/pc/masterdb/risk/bulk/load",
      parameters: "params*string",
      description: "Bulk loads risk assessments from pre-processed ARO CSV data. Modes: dry_run (preview), execute (write + backup), rollback (restore from backup). Params: mode, assessment_version, note_prefix, records[], rollback_data[]. @Authors:OS@"
    }
  ];

  addFunctions(functions);
  removeFunctions(functions);

  logInfo("startModule", "Started.");

  logEvent(getRequestContext().getUser().getName(), "MODULE_STARTED", "");
}

// ####################### Stop module ############################
// # Called every time module stops                               #
// # When this file is saved, thoe module is stopped and started  #
// ################################################################
function stopModule() {
  logInfo("stopModule", "Stopping ...");
  logInfo("stopModule", "Stopped.");

  logEvent(getRequestContext().getUser().getName(), "MODULE_STOPPED", "");
}
