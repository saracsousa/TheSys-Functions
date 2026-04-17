/*jslint node: true */
"use strict";

// #### Usefull global variables ####
var objectSpace = "helloworld";
var debug = 1;
var defaultLogLevel = "WARNING";
// ##################################

// #####################################################
// Helper function for setting response
// #####################################################
function setResponse(ticket, message, content, errorCode, result, httpCode) {
  var responseObj = {
    "message": message,
    "content": content,
    "errorCode": errorCode,
    "httpCode": httpCode
  };
  ticket.getResult().setObject(JSON.stringify(responseObj));
  ticket.getResult().setResult(result);
}

// #####################################################
// This function retrieves the currently open guides
// (where end_time IS NULL) from the BigQuery
// guias.consults_final table, enriched with fields from
// kpis_os.guias, prompt descriptions, and incidents.
//
// Input (optional): JSON with filter
//   e.g. {"cell": "XYZ"} or "" for all open guides
//
// Returns: open guides with columns:
//   cell, start_time, itsm_id, type,
//   dissuassion_prompt, process, use_case,
//   tecnologia, parque_cnd, parque_pings,
//   dia_inc_chg, minutos_sem_guia
// #####################################################
function getGuiasAtivas(ticket, params) {
  var rawInput = "";
  var filterValue = "";
  var filterType = "";
  var result = { content: "", logs: "" };
  var parsedInput = null;
  var t0 = new Date().getTime();

  ticket.addOutput("getGuiasAtivas: === START ===");
  ticket.addOutput("getGuiasAtivas: params.length=" + params.length);
  for (var i = 0; i < params.length; i++) {
    ticket.addOutput("getGuiasAtivas: params[" + i + "]=" + params.get(i));
  }

  // Safely get first param
  try {
    if (params.length > 0 && params.get(0) !== null && params.get(0) !== undefined) {
      rawInput = "" + params.get(0); // force to string
    }
  } catch (e) {
    rawInput = "";
  }

  ticket.addOutput("getGuiasAtivas: rawInput=" + rawInput);

  // Parse rawInput and handle array / array-like / object / plain string
  if (rawInput !== "") {
    try {
      var jsonObject = JSON.parse(rawInput);

      if (jsonObject && Array.isArray(jsonObject) && jsonObject.length >= 1) {
        ticket.addOutput("getGuiasAtivas: DETECTED: Arguments as array in first parameter");
        parsedInput = jsonObject[0];
      } else if (jsonObject && typeof jsonObject === "object" && jsonObject.length >= 1) {
        ticket.addOutput("getGuiasAtivas: DETECTED: Arguments as array-like object in first parameter");
        parsedInput = jsonObject[0];
      } else {
        ticket.addOutput("getGuiasAtivas: DETECTED: Arguments as direct parameter");
        parsedInput = jsonObject;
      }
    } catch (e) {
      parsedInput = rawInput.trim();
    }
  }

  ticket.addOutput("getGuiasAtivas: parsedInput=" + String(parsedInput).substring(0, 200));

  // Extract filterValue from parsedInput
  if (parsedInput !== null && parsedInput !== undefined) {
    if (typeof parsedInput === "object") {
      // Support filtering by cell or itsm_id
      if (parsedInput.input) {
        filterValue = parsedInput.input;
      } else if (parsedInput.cell) {
        filterType = "cell";
        filterValue = parsedInput.cell;
      } else if (parsedInput.itsm_id) {
        filterType = "itsm_id";
        filterValue = parsedInput.itsm_id;
      }
    } else {
      filterValue = ("" + parsedInput).trim();
    }
  }

  // Auto-detect filter type if not already set
  if (filterValue !== "" && filterType === "") {
    filterType = "cell";
  }

  ticket.addOutput("getGuiasAtivas: filterType=" + filterType + " filterValue=" + filterValue);
  ticket.addOutput("getGuiasAtivas: Building SQL query...");

  var sql_query =
      'WITH active_cf AS (' +
      '  SELECT' +
      '    SAFE_CAST(cf.id_diss_c3t AS INT64) AS id_diss_c3t,' +
      '    CASE WHEN RIGHT(cf.celula, 2) = \'--\' THEN LEFT(cf.celula, 3) ELSE cf.celula END AS cell,' +
      '    cf.start_time,' +
      '    cf.id,' +
      '    cf.prestador_servico,' +
      '    cf.dissuasion_prompt_id,' +
      '    COALESCE(cf.parque_ca_ativos, 0) AS parque_ca_ativos,' +
      '    COALESCE(cf.parque_routers_ativos, 0) AS parque_routers_ativos' +
      '  FROM `ops-dpt-lab-204386.guias.consults_final` cf' +
      '  WHERE cf.end_time IS NULL' +
      '    AND cf.start_time > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)' +
      '),' +
      ' enriched AS (' +
      '  SELECT' +
      '    ag.cell,' +
      '    ag.start_time,' +
      '    ag.id,' +
      '    COALESCE(g.type, CASE' +
      '      WHEN UPPER(LEFT(ag.id, 3)) = \'INC\' THEN \'Incidente\'' +
      '      WHEN UPPER(LEFT(ag.id, 3)) = \'CRQ\' THEN \'Change\'' +
      '      WHEN ag.prestador_servico = \'1010\' THEN \'SNOC sem automatismo\'' +
      '      ELSE \'Manual\' END) AS type,' +
      '    dp.short_description AS dissuassion_prompt,' +
      '    CASE WHEN g.process = \'SYNC\' THEN \'CARRO VASSOURA\' ELSE g.process END AS process,' +
      '    g.use_case,' +
      '    CASE' +
      '      WHEN LEFT(ag.cell, 1) = \'X\' THEN \'FTTH VDF\'' +
      '      WHEN LEFT(ag.cell, 1) = \'Y\' THEN \'FTTH NOS\'' +
      '      WHEN LEFT(ag.cell, 1) = \'K\' THEN \'FTTH DST\'' +
      '      WHEN LEFT(ag.cell, 1) = \'Z\' THEN \'FTTH FBG\'' +
      '      WHEN LEFT(ag.cell, 1) = \'H\' THEN \'FTTH FFR\'' +
      '      WHEN RIGHT(ag.cell, 2) = \'00\' THEN \'DTH\'' +
      '      WHEN ag.cell = \'null\' THEN \'null\'' +
      '      ELSE \'HFC\' END AS tecnologia,' +
      '    ag.parque_ca_ativos,' +
      '    ag.parque_routers_ativos' +
      '  FROM active_cf ag' +
      '  LEFT JOIN `ops-reporting-p-448320.kpis_os.guias` g' +
      '    ON ag.id_diss_c3t = g.id_diss_c3t' +
      '    AND CASE WHEN RIGHT(g.cell, 2) = \'--\' THEN LEFT(g.cell, 3) ELSE g.cell END = ag.cell' +
      '  LEFT JOIN `ops-reporting-p-448320.kpis_os_archive.guias_dissuation_prompt_description` dp' +
      '    ON SAFE_CAST(ag.dissuasion_prompt_id AS INT64) = SAFE_CAST(dp.dissuasion_prompt AS INT64)' +
      '),' +
      ' incident_deduped AS (' +
      '  SELECT * FROM (' +
      '    SELECT *, ROW_NUMBER() OVER (' +
      '      PARTITION BY incident_id' +
      '      ORDER BY actual_end_date IS NULL, actual_end_date DESC, submit_date DESC' +
      '    ) AS rn' +
      '    FROM `ops-dpt-lab-204386.indisponibilidades.incidentes`' +
      '  ) WHERE rn = 1' +
      '),' +
      ' itsm_trin AS (' +
      '  SELECT DISTINCT fields_itsm_id, trin_id' +
      '  FROM `networkanalytics-p-292818.trin.incident`' +
      '  WHERE day_part >= \'2025-01-01\' AND fields_itsm_id != \'null\' AND trin_id != \'null\'' +
      '  UNION DISTINCT' +
      '  SELECT DISTINCT fields_itsm_id, trin_id' +
      '  FROM `networkanalytics-p-292818.trin.change`' +
      '  WHERE day_part >= \'2025-01-01\' AND fields_itsm_id != \'null\' AND trin_id != \'null\'' +
      ')' +
      ' SELECT DISTINCT' +
      '  e.cell,' +
      '  e.start_time,' +
      '  e.id AS itsm_id,' +
      '  it.trin_id,' +
      '  e.type,' +
      '  e.dissuassion_prompt,' +
      '  e.process,' +
      '  e.use_case,' +
      '  e.tecnologia,' +
      '  e.parque_ca_ativos AS parque_cnd,' +
      '  e.parque_routers_ativos AS parque_pings,' +
      '  CASE WHEN e.type = \'Incidente\' THEN GREATEST(ii.submit_date, ii.actual_start_date) ELSE e.start_time END AS dia_inc_chg,' +
      '  CASE WHEN e.type = \'Manual\' THEN NULL' +
      '    ELSE GREATEST(TIMESTAMP_DIFF(e.start_time,' +
      '      CASE WHEN e.type = \'Incidente\' THEN GREATEST(ii.submit_date, ii.actual_start_date) ELSE e.start_time END,' +
      '      SECOND), 1) / 60.0 END AS minutos_sem_guia' +
      ' FROM enriched e' +
      ' LEFT JOIN incident_deduped ii' +
      '  ON SAFE_CAST(e.id AS STRING) = SAFE_CAST(ii.incident_id AS STRING)' +
      ' LEFT JOIN itsm_trin it' +
      '  ON e.id = it.fields_itsm_id' +
      ' WHERE 1=1' +
      (filterType === "cell" ? ' AND e.cell = \'' + filterValue + '\'' : '') +
      (filterType === "itsm_id" ? ' AND e.id = \'' + filterValue + '\'' : '') +
      ' ORDER BY e.start_time DESC';

  ticket.addOutput("getGuiasAtivas: sql_query length=" + sql_query.length + " chars");
  ticket.addOutput("getGuiasAtivas: sql_query (first 1000)=" + sql_query.substring(0, 1000));
  ticket.addOutput("getGuiasAtivas: sql_query (rest)=" + sql_query.substring(1000));
  ticket.addOutput("getGuiasAtivas: Sending query to BigQuery...");
  var t1 = new Date().getTime();

  var runTicketGCP = ModuleUtils.runFunction("/bigquery/executeQuery", "MONIT", sql_query, getRequestContext());

  if (!ModuleUtils.waitForTicketsSuccess(runTicketGCP)) {
    var t2 = new Date().getTime();
    ticket.addOutput("getGuiasAtivas: Query FAILED after " + (t2 - t1) + "ms");
    try {
      var failObj = runTicketGCP.getResult().getObject();
      ticket.addOutput("getGuiasAtivas: Failure details=" + ("" + failObj).substring(0, 1000));
    } catch (e) {
      ticket.addOutput("getGuiasAtivas: Could not read failure details: " + e);
    }
    result.logs = "ERROR: Query failed";
    ticket.getResult().setObject(JSON.stringify(result));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }

  var t2 = new Date().getTime();
  ticket.addOutput("getGuiasAtivas: Query succeeded in " + (t2 - t1) + "ms");

  var rawResponse = runTicketGCP.getResult().getObject();
  ticket.addOutput("getGuiasAtivas: raw response type=" + typeof rawResponse + " length=" + ("" + rawResponse).length);
  var data_runTicketGCP = JSON.parse(rawResponse);
  ticket.addOutput("getGuiasAtivas: parsed GCP response keys=" + Object.keys(data_runTicketGCP).join(","));
  ticket.addOutput("getGuiasAtivas: raw GCP response=" + JSON.stringify(data_runTicketGCP).substring(0, 500));

  if (data_runTicketGCP.Result === undefined) {
    result.logs = "ERROR: " + data_runTicketGCP.Error;
    ticket.addOutput("getGuiasAtivas: " + result.logs);
    ticket.getResult().setObject(JSON.stringify(result));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }

  result.content = data_runTicketGCP.Result;
  var recordCount = data_runTicketGCP.Result ? data_runTicketGCP.Result.length : 0;
  result.logs = "Found " + recordCount + " record(s)" + (filterValue !== "" ? " for " + filterType + " " + filterValue : "");
  ticket.addOutput("getGuiasAtivas: " + result.logs);
  if (recordCount > 0) {
    ticket.addOutput("getGuiasAtivas: First record sample=" + JSON.stringify(data_runTicketGCP.Result[0]).substring(0, 500));
  }

  // Sanitize JSON: ensure decimal separators are dots (locale safety)
  var resultJson = JSON.stringify(result);
  resultJson = resultJson.replace(/"(\d+),(\d+)"/g, '"$1.$2"');

  var t3 = new Date().getTime();
  ticket.addOutput("getGuiasAtivas: result json length=" + resultJson.length + " chars");
  ticket.addOutput("getGuiasAtivas: result=" + resultJson.substring(0, 500));
  ticket.addOutput("getGuiasAtivas: === END === total time=" + (t3 - t0) + "ms");
  ticket.getResult().setObject(resultJson);
  ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_OK);
}

// #####################################################
// Helper: normalize date string to YYYY-MM-DD
// Accepts DD-MM-YYYY, DD/MM/YYYY, or YYYY-MM-DD
// #####################################################
function normalizeDate(dateStr) {
  if (!dateStr || dateStr === "") return "";
  dateStr = ("" + dateStr).trim();
  // DD-MM-YYYY
  if (/^\d{2}-\d{2}-\d{4}$/.test(dateStr)) {
    var parts = dateStr.split("-");
    return parts[2] + "-" + parts[1] + "-" + parts[0];
  }
  // DD/MM/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
    var parts = dateStr.split("/");
    return parts[2] + "-" + parts[1] + "-" + parts[0];
  }
  // Already YYYY-MM-DD (or other)
  return dateStr;
}

// #####################################################
// Retrieves historical guides by incident/change ID
// (ITSM or TRIN). Searches both itsm_id and trin_id.
//
// Input: plain string with the incident/change ID
//   e.g. "INC000180875604", "CRQ000002920402",
//        or "CHG000001234567"
//
// INC → searched in both itsm_id and trin_id
// CRQ → searched in itsm_id only
// CHG → searched in trin_id only
//
// Returns: all guide records matching that ID,
//   including both itsm_id and trin_id columns.
// #####################################################
function getGuiasHistoricoByIncOrChg(ticket, params) {
  var rawInput = "";
  var incidentId = "";
  var result = { content: "", logs: "" };
  var t0 = new Date().getTime();

  ticket.addOutput("getGuiasHistoricoByIncOrChg: === START ===");
  ticket.addOutput("getGuiasHistoricoByIncOrChg: params.length=" + params.length);
  for (var i = 0; i < params.length; i++) {
    ticket.addOutput("getGuiasHistoricoByIncOrChg: params[" + i + "]=" + params.get(i));
  }

  // Safely get first param
  try {
    if (params.length > 0 && params.get(0) !== null && params.get(0) !== undefined) {
      rawInput = "" + params.get(0);
    }
  } catch (e) {
    rawInput = "";
  }

  ticket.addOutput("getGuiasHistoricoByIncOrChg: rawInput=" + rawInput);

  // Parse: could be plain string, JSON string, array, or object
  if (rawInput !== "") {
    try {
      var jsonObject = JSON.parse(rawInput);
      if (jsonObject && Array.isArray(jsonObject) && jsonObject.length >= 1) {
        ticket.addOutput("getGuiasHistoricoByIncOrChg: DETECTED: array — taking first element");
        incidentId = "" + jsonObject[0];
      } else if (typeof jsonObject === "object" && jsonObject !== null) {
        ticket.addOutput("getGuiasHistoricoByIncOrChg: DETECTED: object — extracting incident_id/id/input");
        incidentId = "" + (jsonObject.incident_id || jsonObject.id || jsonObject.input || "");
      } else {
        incidentId = ("" + jsonObject).trim();
      }
    } catch (e) {
      incidentId = rawInput.trim();
    }
  }

  // Strip stray quotes
  incidentId = incidentId.replace(/['"]/g, "").trim();

  ticket.addOutput("getGuiasHistoricoByIncOrChg: incidentId=" + incidentId);

  if (incidentId === "") {
    result.logs = "ERROR: incident/change ID is required. Pass a plain string like INC000180875604, CRQ000002920402, or CHG000001234567";
    ticket.addOutput("getGuiasHistoricoByIncOrChg: " + result.logs);
    ticket.getResult().setObject(JSON.stringify(result));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }

  // Determine search strategy based on ID prefix
  var prefix = incidentId.substring(0, 3).toUpperCase();
  var whereCondition = '';
  if (prefix === 'CHG') {
    // CHG is TRIN format — search trin_id only
    whereCondition = ' WHERE it.trin_id = \'' + incidentId + '\'';
    ticket.addOutput("getGuiasHistoricoByIncOrChg: CHG prefix detected — searching trin_id only");
  } else if (prefix === 'CRQ') {
    // CRQ is ITSM format — search itsm_id only
    whereCondition = ' WHERE g.id = \'' + incidentId + '\'';
    ticket.addOutput("getGuiasHistoricoByIncOrChg: CRQ prefix detected — searching itsm_id only");
  } else {
    // INC or other — search both columns
    whereCondition = ' WHERE (g.id = \'' + incidentId + '\' OR it.trin_id = \'' + incidentId + '\')';
    ticket.addOutput("getGuiasHistoricoByIncOrChg: INC/other prefix detected — searching both itsm_id and trin_id");
  }

  ticket.addOutput("getGuiasHistoricoByIncOrChg: Building SQL query...");

  var sql_query =
      'WITH itsm_trin AS (' +
      '  SELECT DISTINCT fields_itsm_id, trin_id' +
      '  FROM `networkanalytics-p-292818.trin.incident`' +
      '  WHERE day_part >= \'2025-01-01\' AND fields_itsm_id != \'null\' AND trin_id != \'null\'' +
      '  UNION DISTINCT' +
      '  SELECT DISTINCT fields_itsm_id, trin_id' +
      '  FROM `networkanalytics-p-292818.trin.change`' +
      '  WHERE day_part >= \'2025-01-01\' AND fields_itsm_id != \'null\' AND trin_id != \'null\'' +
      ')' +
      ' SELECT' +
      '  g.id_diss_c3t,' +
      '  CASE WHEN RIGHT(g.cell, 2) = \'--\' THEN LEFT(g.cell, 3) ELSE g.cell END AS cell,' +
      '  g.start_time,' +
      '  g.end_time,' +
      '  g.id AS itsm_id,' +
      '  it.trin_id,' +
      '  g.prestador_servico,' +
      '  g.dissuassion_prompt_short,' +
      '  g.process,' +
      '  g.use_case,' +
      '  g.duration_minute,' +
      '  g.day_part,' +
      '  g.parque_ca_ativos,' +
      '  g.parque_routers_ativos,' +
      '  g.day_INC,' +
      '  g.tecnologia,' +
      '  g.minutos_sem_guia' +
      ' FROM `ops-dpt-lab-204386.indisponibilidades.guias` g' +
      ' LEFT JOIN itsm_trin it ON g.id = it.fields_itsm_id' +
      whereCondition +
      ' ORDER BY g.start_time DESC';

  ticket.addOutput("getGuiasHistoricoByIncOrChg: sql_query=" + sql_query);
  ticket.addOutput("getGuiasHistoricoByIncOrChg: Sending query to BigQuery...");
  var t1 = new Date().getTime();

  var runTicketGCP = ModuleUtils.runFunction("/bigquery/executeQuery", "MONIT", sql_query, getRequestContext());

  if (!ModuleUtils.waitForTicketsSuccess(runTicketGCP)) {
    var t2 = new Date().getTime();
    ticket.addOutput("getGuiasHistoricoByIncOrChg: Query FAILED after " + (t2 - t1) + "ms");
    try {
      var failObj = runTicketGCP.getResult().getObject();
      ticket.addOutput("getGuiasHistoricoByIncOrChg: Failure details=" + ("" + failObj).substring(0, 1000));
    } catch (e) {
      ticket.addOutput("getGuiasHistoricoByIncOrChg: Could not read failure details: " + e);
    }
    result.logs = "ERROR: Query failed";
    ticket.getResult().setObject(JSON.stringify(result));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }

  var t2 = new Date().getTime();
  ticket.addOutput("getGuiasHistoricoByIncOrChg: Query succeeded in " + (t2 - t1) + "ms");

  var rawResponse = runTicketGCP.getResult().getObject();
  ticket.addOutput("getGuiasHistoricoByIncOrChg: raw response type=" + typeof rawResponse + " length=" + ("" + rawResponse).length);
  var data_runTicketGCP = JSON.parse(rawResponse);
  ticket.addOutput("getGuiasHistoricoByIncOrChg: parsed GCP response keys=" + Object.keys(data_runTicketGCP).join(","));
  ticket.addOutput("getGuiasHistoricoByIncOrChg: raw GCP response=" + JSON.stringify(data_runTicketGCP).substring(0, 500));

  if (data_runTicketGCP.Result === undefined) {
    result.logs = "ERROR: " + data_runTicketGCP.Error;
    ticket.addOutput("getGuiasHistoricoByIncOrChg: " + result.logs);
    ticket.getResult().setObject(JSON.stringify(result));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }

  result.content = data_runTicketGCP.Result;
  var recordCount = data_runTicketGCP.Result ? data_runTicketGCP.Result.length : 0;
  result.logs = "Found " + recordCount + " record(s) for id=" + incidentId;
  ticket.addOutput("getGuiasHistoricoByIncOrChg: " + result.logs);
  if (recordCount > 0) {
    ticket.addOutput("getGuiasHistoricoByIncOrChg: First record sample=" + JSON.stringify(data_runTicketGCP.Result[0]).substring(0, 500));
  }

  var resultJson = JSON.stringify(result);
  resultJson = resultJson.replace(/"(\d+),(\d+)"/g, '"$1.$2"');

  var t3 = new Date().getTime();
  ticket.addOutput("getGuiasHistoricoByIncOrChg: result json length=" + resultJson.length + " chars");
  ticket.addOutput("getGuiasHistoricoByIncOrChg: result=" + resultJson.substring(0, 500));
  ticket.addOutput("getGuiasHistoricoByIncOrChg: === END === total time=" + (t3 - t0) + "ms");
  ticket.getResult().setObject(resultJson);
  ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_OK);
}

// #####################################################
// Retrieves historical guides by cell (or area) with
// an optional "from date" filter on day_part.
//
// Input: a single string in the format:
//   "CELL,DD-MM-YYYY"  — cell + from-date
//   "CELL"             — cell only (last 30 days)
//
// Cell rules:
//   <= 3 chars  → area prefix search (e.g. "ARE")
//   >  3 chars  → exact cell search  (e.g. "ARE10")
//
// The date means "from this day onwards" (day_part >=).
// Accepts DD-MM-YYYY, DD/MM/YYYY, or YYYY-MM-DD.
//
// Returns: matching guide records ordered by start_time.
// #####################################################
function getGuiasHistoricoByCellDate(ticket, params) {
  var rawInput = "";
  var result = { content: "", logs: "" };
  var t0 = new Date().getTime();
  var filterCell = "";
  var fromDate = "";

  ticket.addOutput("getGuiasHistoricoByCellDate: === START ===");
  ticket.addOutput("getGuiasHistoricoByCellDate: params.length=" + params.length);
  for (var i = 0; i < params.length; i++) {
    ticket.addOutput("getGuiasHistoricoByCellDate: params[" + i + "]=" + params.get(i));
  }

  // Safely get first param
  try {
    if (params.length > 0 && params.get(0) !== null && params.get(0) !== undefined) {
      rawInput = "" + params.get(0);
    }
  } catch (e) {
    rawInput = "";
  }

  ticket.addOutput("getGuiasHistoricoByCellDate: rawInput=" + rawInput);

  // Parse: support plain "CELL,DATE", JSON object, array, quoted string
  var parsed = "";
  if (rawInput !== "") {
    try {
      var jsonObject = JSON.parse(rawInput);
      if (jsonObject && Array.isArray(jsonObject) && jsonObject.length >= 1) {
        ticket.addOutput("getGuiasHistoricoByCellDate: DETECTED: array — taking first element");
        parsed = "" + jsonObject[0];
      } else if (typeof jsonObject === "object" && jsonObject !== null) {
        // Object form: extract cell and from_date / day_part
        ticket.addOutput("getGuiasHistoricoByCellDate: DETECTED: object");
        filterCell = ("" + (jsonObject.cell || jsonObject.input || "")).trim();
        fromDate = normalizeDate(jsonObject.from_date || jsonObject.day_part || jsonObject.date || "");
        parsed = ""; // already extracted
      } else {
        parsed = ("" + jsonObject).trim();
      }
    } catch (e) {
      parsed = rawInput.trim();
    }
  }

  // If we got a flat string, split by comma or space
  if (parsed !== "" && filterCell === "") {
    parsed = parsed.replace(/['"]/g, "").trim();
    var separatorIdx = parsed.indexOf(",");
    if (separatorIdx === -1) separatorIdx = parsed.indexOf(" ");
    if (separatorIdx > 0) {
      filterCell = parsed.substring(0, separatorIdx).trim();
      fromDate = normalizeDate(parsed.substring(separatorIdx + 1).trim());
    } else {
      filterCell = parsed;
    }
  }

  ticket.addOutput("getGuiasHistoricoByCellDate: filterCell=" + filterCell);
  ticket.addOutput("getGuiasHistoricoByCellDate: fromDate=" + fromDate);

  if (filterCell === "") {
    result.logs = "ERROR: cell is required. Pass a string like ARE10,09-03-2025 or just ARE10";
    ticket.addOutput("getGuiasHistoricoByCellDate: " + result.logs);
    ticket.getResult().setObject(JSON.stringify(result));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }

  ticket.addOutput("getGuiasHistoricoByCellDate: Building SQL query...");

  // Cell condition: area (<=3 chars) vs exact cell
  var cellCondition = "";
  if (filterCell.length <= 3) {
    ticket.addOutput("getGuiasHistoricoByCellDate: Cell filter is AREA prefix (<=" + filterCell.length + " chars): " + filterCell);
    cellCondition = ' AND LEFT(CASE WHEN RIGHT(g.cell, 2) = \'--\' THEN LEFT(g.cell, 3) ELSE g.cell END, ' + filterCell.length + ') = \'' + filterCell + '\'';
  } else {
    ticket.addOutput("getGuiasHistoricoByCellDate: Cell filter is EXACT cell: " + filterCell);
    cellCondition = ' AND CASE WHEN RIGHT(g.cell, 2) = \'--\' THEN LEFT(g.cell, 3) ELSE g.cell END = \'' + filterCell + '\'';
  }

  // Default: if no from_date provided, limit to last 30 days
  var dateCondition = "";
  if (fromDate !== "") {
    dateCondition = ' AND g.day_part >= \'' + fromDate + '\'';
    ticket.addOutput("getGuiasHistoricoByCellDate: Date filter day_part >= " + fromDate);
  } else {
    dateCondition = ' AND g.day_part >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)';
    ticket.addOutput("getGuiasHistoricoByCellDate: No date provided — defaulting to last 30 days");
  }

  var sql_query =
      'WITH itsm_trin AS (' +
      '  SELECT DISTINCT fields_itsm_id, trin_id' +
      '  FROM `networkanalytics-p-292818.trin.incident`' +
      '  WHERE day_part >= \'2025-01-01\' AND fields_itsm_id != \'null\' AND trin_id != \'null\'' +
      '  UNION DISTINCT' +
      '  SELECT DISTINCT fields_itsm_id, trin_id' +
      '  FROM `networkanalytics-p-292818.trin.change`' +
      '  WHERE day_part >= \'2025-01-01\' AND fields_itsm_id != \'null\' AND trin_id != \'null\'' +
      ')' +
      ' SELECT' +
      '  g.id_diss_c3t,' +
      '  CASE WHEN RIGHT(g.cell, 2) = \'--\' THEN LEFT(g.cell, 3) ELSE g.cell END AS cell,' +
      '  g.start_time,' +
      '  g.end_time,' +
      '  g.id AS itsm_id,' +
      '  it.trin_id,' +
      '  g.prestador_servico,' +
      '  g.dissuassion_prompt_short,' +
      '  g.process,' +
      '  g.use_case,' +
      '  g.duration_minute,' +
      '  g.day_part,' +
      '  g.parque_ca_ativos,' +
      '  g.parque_routers_ativos,' +
      '  g.day_INC,' +
      '  g.tecnologia,' +
      '  g.minutos_sem_guia' +
      ' FROM `ops-dpt-lab-204386.indisponibilidades.guias` g' +
      ' LEFT JOIN itsm_trin it ON g.id = it.fields_itsm_id' +
      ' WHERE 1=1' +
      cellCondition +
      dateCondition +
      ' ORDER BY g.start_time DESC';

  ticket.addOutput("getGuiasHistoricoByCellDate: sql_query length=" + sql_query.length + " chars");
  ticket.addOutput("getGuiasHistoricoByCellDate: sql_query (first 1000)=" + sql_query.substring(0, 1000));
  ticket.addOutput("getGuiasHistoricoByCellDate: sql_query (rest)=" + sql_query.substring(1000));
  ticket.addOutput("getGuiasHistoricoByCellDate: Sending query to BigQuery...");
  var t1 = new Date().getTime();

  var runTicketGCP = ModuleUtils.runFunction("/bigquery/executeQuery", "MONIT", sql_query, getRequestContext());

  if (!ModuleUtils.waitForTicketsSuccess(runTicketGCP)) {
    var t2 = new Date().getTime();
    ticket.addOutput("getGuiasHistoricoByCellDate: Query FAILED after " + (t2 - t1) + "ms");
    try {
      var failObj = runTicketGCP.getResult().getObject();
      ticket.addOutput("getGuiasHistoricoByCellDate: Failure details=" + ("" + failObj).substring(0, 1000));
    } catch (e) {
      ticket.addOutput("getGuiasHistoricoByCellDate: Could not read failure details: " + e);
    }
    result.logs = "ERROR: Query failed";
    ticket.getResult().setObject(JSON.stringify(result));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }

  var t2 = new Date().getTime();
  ticket.addOutput("getGuiasHistoricoByCellDate: Query succeeded in " + (t2 - t1) + "ms");

  var rawResponse = runTicketGCP.getResult().getObject();
  ticket.addOutput("getGuiasHistoricoByCellDate: raw response type=" + typeof rawResponse + " length=" + ("" + rawResponse).length);
  var data_runTicketGCP = JSON.parse(rawResponse);
  ticket.addOutput("getGuiasHistoricoByCellDate: parsed GCP response keys=" + Object.keys(data_runTicketGCP).join(","));
  ticket.addOutput("getGuiasHistoricoByCellDate: raw GCP response=" + JSON.stringify(data_runTicketGCP).substring(0, 500));

  if (data_runTicketGCP.Result === undefined) {
    result.logs = "ERROR: " + data_runTicketGCP.Error;
    ticket.addOutput("getGuiasHistoricoByCellDate: " + result.logs);
    ticket.getResult().setObject(JSON.stringify(result));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }

  result.content = data_runTicketGCP.Result;
  var recordCount = data_runTicketGCP.Result ? data_runTicketGCP.Result.length : 0;
  result.logs = "Found " + recordCount + " record(s) for cell=" + filterCell + (fromDate !== "" ? ", from_date=" + fromDate : " (last 30 days)");
  ticket.addOutput("getGuiasHistoricoByCellDate: " + result.logs);
  if (recordCount > 0) {
    ticket.addOutput("getGuiasHistoricoByCellDate: First record sample=" + JSON.stringify(data_runTicketGCP.Result[0]).substring(0, 500));
  }

  var resultJson = JSON.stringify(result);
  resultJson = resultJson.replace(/"(\d+),(\d+)"/g, '"$1.$2"');

  var t3 = new Date().getTime();
  ticket.addOutput("getGuiasHistoricoByCellDate: result json length=" + resultJson.length + " chars");
  ticket.addOutput("getGuiasHistoricoByCellDate: result=" + resultJson.substring(0, 500));
  ticket.addOutput("getGuiasHistoricoByCellDate: === END === total time=" + (t3 - t0) + "ms");
  ticket.getResult().setObject(resultJson);
  ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_OK);
}

// ####################### Start module ###########################
// # Called every time module starts                              #
// # When this file is saved, thoe module is stopped and started  #
// ################################################################
function startModule() {
  logInfo("startModule", "Starting ...");

  var functions = [
    {
     name: "getGuiasAtivas",
     path: "/ai/guides/guiasAtivas",
     parameters: "THESYS.ALLPARAMETERS.JSON*string",
     description: "Function for getting currently open guides (end_time IS NULL) from guias.consults_final, enriched with kpis_os.guias and incidents data @Authors:REM@"
    },
    {
     name: "getGuiasHistoricoByIncOrChg",
     path: "/ai/guides/guiasHistoricoByIncOrChg",
     parameters: "THESYS.ALLPARAMETERS.JSON*string",
     description: "Get historical guides by incident/change ID (ITSM or TRIN). Input: plain string e.g. INC000180875604, CRQ000002920402, or CHG000001234567. INC searches both itsm_id and trin_id; CRQ searches itsm_id; CHG searches trin_id. @Authors:REM@"
    },
    {
     name: "getGuiasHistoricoByCellDate",
     path: "/ai/guides/guiasHistoricoByCellDate",
     parameters: "THESYS.ALLPARAMETERS.JSON*string",
     description: "Get historical guides by cell/area with optional from-date. Input: CELL,DD-MM-YYYY (e.g. ARE10,09-03-2025) or just CELL (e.g. ARE10 for last 30 days). <=3 chars = area prefix. @Authors:REM@"
    }
  ];

  addFunctions(functions, true);
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

///////////////////////////////////
// Internal code - leave it asis //
///////////////////////////////////

function setupDataStoreHints(hints, requestedTries) {
  var tries = 4;
  if (requestedTries)
    tries = requestedTries;

  while (tries-- > 0) {
    try {
      for (var idx in hints) {
        var hint = hints[idx];

        var runTicket = ModuleUtils.runFunction("/datastore/setFieldProperty", getRequestContext(), hint.space, hint.field, hint.hint);
        if (!ModuleUtils.waitForTicketsSuccess(runTicket)) {
          throw "[" + getModuleName() + ".setupDataStoreHints] Failed do start module: Failed to initialize datastore!";
        }
      }

      tries = 0;
    } catch (error) {
      if (tries > 0) {
        logWarning("setupDataStoreHints", "Failed to initilize datastore! Sleeping so we can give it a new try. [tries=" + tries + "] [error=" + error + "]");
        ModuleUtils.executeFunction("/thesys/sleep", getRequestContext(), "15000");
      } else {
        logWarning("setupDataStoreHints", "Failed to initilize datastore! [tries=" + tries + "] [error=" + error + "]");
      }
    }
  }
}

function addFunctions(functions, forceCreation) {
  var wrapperModulePathId = getWrapperModuleId();
  if (wrapperModulePathId !== "")
    wrapperModulePathId = "/" + wrapperModulePathId;

  var webPortalModulePathId = getWebPortalModuleId();
  if (webPortalModulePathId !== "")
    webPortalModulePathId = "/" + webPortalModulePathId;

  for (var idx in functions) {
    var func = functions[idx];
    if (func.hasOwnProperty("remove") && func.remove === "true") {
      continue;
    }

    var alreadyDefined = false;

    var runTicket = ModuleUtils.runFunction("/wrapper" + wrapperModulePathId + "/getcommanddetails", getRequestContext(), func.path);
    if (!ModuleUtils.waitForTicketsSuccess(runTicket)) {
      throw "[" + getModuleName() + ".addFunction] Failed do start module: Could not create command!";
    }
    var list = JSON.parse(runTicket.getResult().getObject());
    for (var idx1 in list) {
      var functioData = list[idx1].commandData["function"] + "|" + list[idx1].commandData["file"];
      var newFunctioData = func.name + "|<SCRIPTS.DIR>/" + getModuleName() + ".js";
      if (functioData === newFunctioData) {
        alreadyDefined = true;
        break;
      }
    }

    if (!alreadyDefined || forceCreation) {
      logInfo("addFunctions", "Add function '" + func.path + "' [alreadyDefined=" + alreadyDefined + "]");

      if (alreadyDefined) {
        runTicket = ModuleUtils.runFunction("/wrapper" + wrapperModulePathId + "/deletecommand", getRequestContext(), func.path);
        ModuleUtils.waitForTickets(runTicket);
      }

      var remoteExecution = "yes";
      if (func.hasOwnProperty("remoteExecution")) {
        remoteExecution = func.remoteExecution === "no" ? "no" : "yes";
      }

      logInfo("", "/wrapper" + wrapperModulePathId + "/addcommandv1 \"" + func.path + "\"  \"" + func.parameters + "\"  \"" + func.description + "\"  \"EMBEB_SCRIPT_JS\"  \"" + func.name + "|<SCRIPTS.DIR>/" + getModuleName() + ".js\" \"no\" \"yes\" \"yes\" \"" + remoteExecution + "\"");

      runTicket = ModuleUtils.runFunction("/wrapper" + wrapperModulePathId + "/addcommandv1", getRequestContext(), func.path, func.parameters, func.description, "EMBEB_SCRIPT_JS", func.name + "|<SCRIPTS.DIR>/" + getModuleName() + ".js", "no", "yes", "yes", remoteExecution);
      if (!ModuleUtils.waitForTicketsSuccess(runTicket)) {
        throw "[" + getModuleName() + ".addFunction] Failed do start module: Could not create command!";
      }
    }

    if (func.menu) {
      runTicket = ModuleUtils.runFunction("/webportal" + webPortalModulePathId + "/deletemenu", getRequestContext(), func.name);
      ModuleUtils.waitForTickets(runTicket);

      var position = "SORTED";
      if (func.menu.position) {
        position = func.menu.position;
      }
      runTicket = ModuleUtils.runFunction("/webportal" + webPortalModulePathId + "/addmenu", getRequestContext(), func.name, func.menu.path, "WRAPPER_THESYS", position, "", func.path);
      if (!ModuleUtils.waitForTicketsSuccess(runTicket)) {
        throw "[" + getModuleName() + ".addFunction] Failed to add menu '" + func.name + "'" + func.name + "|" + func.menu.path + "|WRAPPER_THESYS|" + position + "|" + func.path;
      }
    }
  }
}

function removeFunctions(functions) {
  var wrapperModulePathId = getWrapperModuleId();
  if (wrapperModulePathId !== "")
    wrapperModulePathId = "/" + wrapperModulePathId;

  var webPortalModulePathId = getWebPortalModuleId();
  if (webPortalModulePathId !== "")
    webPortalModulePathId = "/" + webPortalModulePathId;

  for (var idx in functions) {
    var func = functions[idx];
    logInfo("removeFunctions", "Func: " + JSON.stringify(func));
    if (!func.hasOwnProperty("remove") || func.remove !== "true") {
      continue;
    }

    var runTicket = ModuleUtils.runFunction("/wrapper" + wrapperModulePathId + "/deletecommand", getRequestContext(), func.path);
    if (!ModuleUtils.waitForTicketsSuccess(runTicket)) {
      logWarning("removeFunctions", "[" + getModuleName() + ".deleteFunction] Failed to delete command " + func.path);
    }

    if (func.menu) {
      runTicket = ModuleUtils.runFunction("/webportal" + webPortalModulePathId + "/deletemenu", getRequestContext(), func.name);
      if (!ModuleUtils.waitForTicketsSuccess(runTicket)) {
        logWarning("removeFunctions", "[" + getModuleName() + ".deleteFunction] Failed to delete menu " + func.menu.path);
      }
    }
  }
}

var thesys_wrapperModuleName = null;
var thesys_wrapperModuleId = null;
function getWrapperModuleId() {
  if (thesys_wrapperModuleId !== null)
    return thesys_wrapperModuleId;

  if (thesys_wrapperModuleName === null) {
    var runTicket = ModuleUtils.runFunction("/wrapper/localprovider/getinstances", getRequestContext());
    if (!ModuleUtils.waitForTicketsSuccess(runTicket))
      throw "Could not get WrapperModule id";

    var list = JSON.parse(runTicket.getResult().getObject());
    if (list.length === 0)
      throw "Could not get WrapperModule id";

    var index = 0;
    for (var inst in list) {
      if (!(list[inst].toLowerCase().contains("public") || list[inst].toLowerCase().contains("external"))) {
        index = inst;
        break;
      }
    }
    thesys_wrapperModuleName = list[index];
  }

  var runTicket = ModuleUtils.runFunction("/wrapper/" + thesys_wrapperModuleName + "/getmenuid", getRequestContext());
  if (!ModuleUtils.waitForTicketsSuccess(runTicket))
    throw "Could not get WrapperModule id";

  var result = JSON.parse(runTicket.getResult().getObject());

  thesys_wrapperModuleId = result.moduleId;

  return result.moduleId;
}

var thesys_webPortalModuleId = null;
function getWebPortalModuleId() {
  if (thesys_webPortalModuleId !== null)
    return thesys_webPortalModuleId;

  var runTicket = ModuleUtils.runFunction("/webportal/localprovider/getinstances", getRequestContext());
  if (!ModuleUtils.waitForTicketsSuccess(runTicket))
    throw "Could not get WrapperModule id";

  var list = JSON.parse(runTicket.getResult().getObject());
  if (list.length === 0)
    throw "Could not get WebPortalModule id";

  runTicket = ModuleUtils.runFunction("/webportal/" + list[0] + "/getmenuid", getRequestContext());
  if (!ModuleUtils.waitForTicketsSuccess(runTicket))
    throw "Could not get WebPortalModule id";

  var result = JSON.parse(runTicket.getResult().getObject());

  thesys_webPortalModuleId = result.moduleId;

  return result.moduleId;
}

function logEvent(user, action, data) {
  try {
    // This is because for a while, the standard template had a error in first parameter - it was passing getRequestContext() and not getRequestContext().getUser().getName()
    user = user.getUser().getName();
  } catch (e) {
  }
  if (data === null) {
    data = "";
  }
  if (data !== "") {
    try {
      data = JSON.stringify(data);
    } catch (e) {
    }
  }

  ModuleUtils.runFunction(getRequestContext(), "/thesys/logger/newevent1", getModuleName(), "", user, "", action, data);
}

function logFine(area, message) {
  thesys_logger.log(Level.FINE, "[" + getModuleName() + "][" + area + "] " + message);
}

function logInfo(area, message) {
  thesys_logger.log(Level.INFO, "[" + getModuleName() + "][" + area + "] " + message);
}

function logWarning(area, message) {
  thesys_logger.log(Level.WARNING, "[" + getModuleName() + "][" + area + "] " + message);
}

function logSevere(area, message) {
  thesys_logger.log(Level.SEVERE, "[" + getModuleName() + "][" + area + "] " + message);
}

function helpDocument(f) {
  return f.toString().
          replace(/^[^\/]+\/\*!?/, '').
          replace(/\*\/[^\/]+$/, '');
}

function getModuleName() {
  return thesys_moduleName;
}

function getRequestContext() {
  return thesys_moduleRequestContext;
}

function getLogger() {
  return thesys_logger;
}

function getJavaClass(name) {
  if (thesys_javaClassCache.hasOwnProperty(name)) {
    return thesys_javaClassCache[name];
  }

  thesys_javaClassCache[name] = Java.type(name);

  return thesys_javaClassCache[name];
}

var Util = null;
var Level = null;
var Exception = null;
var Long = null;
var Integer = null;
var ArrayList = null;
var TheSysController = null;
var RequestContext = null;
var ModuleUtils = null;
var TheSysModuleFunctionResult = null;
var FileInputStream = null;
var BufferedReader = null;
var FileReader = null;
var PrintWriter = null;
var File = null;
var StringTokenizer = null;
var SimpleDateFormat = null;
var Transation = null;
var HashMap = null;
var GregorianCalendar = null;
var Calendar = null;
var Locale = null;
var JavaDate = null;

var thesys_moduleName = null;
var thesys_moduleRequestContext = null;
var thesys_logger = null;
var thesys_initialized = false;
var thesys_newBaseFormat = true;
var thesys_javaClassCache = {};

function initialize(moduleName, moduleRequestContext, wrapperModuleName) {
  if (thesys_initialized) {
    return;
  }

  if (wrapperModuleName) {
    thesys_wrapperModuleName = wrapperModuleName;
  }

  thesys_moduleName = moduleName;
  thesys_moduleRequestContext = moduleRequestContext;

  Util = getJavaClass('com.zon.gopm.util.Util');
  Level = getJavaClass('java.util.logging.Level');
  Exception = getJavaClass('java.lang.Exception');
  Long = getJavaClass('java.lang.Long');
  Integer = getJavaClass('java.lang.Integer');
  ArrayList = getJavaClass('java.util.ArrayList');
  TheSysController = getJavaClass('com.nos.gopm.thesys.controller.TheSysController');
  RequestContext = getJavaClass('com.nos.gopm.thesys.controller.RequestContext');
  ModuleUtils = getJavaClass('com.nos.gopm.modules.ModuleUtils');
  TheSysModuleFunctionResult = getJavaClass('com.nos.gopm.thesys.modules.TheSysModuleFunctionResult');
  FileInputStream = getJavaClass('java.io.FileInputStream');
  BufferedReader = getJavaClass('java.io.BufferedReader');
  FileReader = getJavaClass('java.io.FileReader');
  PrintWriter = getJavaClass('java.io.PrintWriter');
  File = getJavaClass('java.io.File');
  StringTokenizer = getJavaClass('java.util.StringTokenizer');
  SimpleDateFormat = getJavaClass('java.text.SimpleDateFormat');
  Transation = getJavaClass('com.nos.gopm.thesys.client.Transation');
  HashMap = getJavaClass('java.util.HashMap');
  GregorianCalendar = getJavaClass('java.util.GregorianCalendar');
  Calendar = getJavaClass('java.util.Calendar');
  Locale = getJavaClass('java.util.Locale');
  JavaDate = getJavaClass('java.util.Date');

  if (typeof defaultLogLevel === "undefined") {
    thesys_logger = Util.getLogger(getModuleName(), "INFO");
  } else {
    thesys_logger = Util.getLogger(getModuleName(), defaultLogLevel);
  }

  thesys_initialized = true;
}
