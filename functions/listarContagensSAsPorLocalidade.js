/*jslint node: true */
"use strict";

// ============================================================
//  listarContagensSAsPorLocalidade (TheSys)
//  Conta SAs distintas por distrito, concelho e freguesia
//  Tables: ops-dpt-lab-204386.topology.hfc_tabela_centralizada_cadastro
//          ops-dpt-lab-204386.topology.ftth_tabela_centralizada_cadastro
//
//  Input (optional, JSON as first parameter):
//    Plain string: "ALMADA" -> searches across distrito, concelho and freguesia (case-insensitive)
//    JSON object:  {"distrito": "SETUBAL", "concelho": "ALMADA", "freguesia": "..."} -> filters specific columns
//    Empty / no input -> returns all rows
// ============================================================

var objectSpace = "greatops";   // set to the application object space
var debug = 1;
var defaultLogLevel = "WARNING";

// SQL injection safety helper — top-level per convention
function safeSql(v) {
  if (v === null || v === undefined) return "";
  return ("" + v).replace(/'/g, "''");
}

function listarContagensSAsPorLocalidade(ticket, params) {
  var result = { content: "", logs: "" };
  var STEP = "INIT";

  ticket.addOutput("[listarContagensSAsPorLocalidade] START");
  logInfo("listarContagensSAsPorLocalidade", "Function called");

  // --- PARSE INPUT ---
  STEP = "PARSE_INPUT";
  ticket.addOutput("[listarContagensSAsPorLocalidade] STEP: " + STEP);
  var rawInput = "";
  try {
    if (params.length > 0 && params.get(0) !== null && params.get(0) !== undefined) {
      rawInput = "" + params.get(0);
    }
  } catch (e) { rawInput = ""; }

  var parsedInput = null;
  if (rawInput !== "") {
    try {
      var jsonObject = JSON.parse(rawInput);
      if (jsonObject && Array.isArray(jsonObject) && jsonObject.length >= 1) {
        parsedInput = jsonObject[0];
      } else if (jsonObject && typeof jsonObject === "object" && !Array.isArray(jsonObject)) {
        parsedInput = jsonObject;
      } else {
        parsedInput = jsonObject;
      }
    } catch (e) {
      parsedInput = rawInput.trim();
    }
  }

  ticket.addOutput("[listarContagensSAsPorLocalidade] parsedInput=" + JSON.stringify(parsedInput));
  logInfo("listarContagensSAsPorLocalidade", "parsedInput=" + JSON.stringify(parsedInput));

  // --- BUILD FILTER CLAUSES ---
  STEP = "BUILD_FILTERS";
  ticket.addOutput("[listarContagensSAsPorLocalidade] STEP: " + STEP);

  var filterWhere = "";
  if (parsedInput !== null && parsedInput !== undefined) {
    if (typeof parsedInput === "object") {
      // JSON object input: filter by specific columns
      var filterClauses = [];
      if (parsedInput.distrito && parsedInput.distrito !== "") {
        filterClauses.push("LOWER(distrito_cliente) = '" + safeSql(parsedInput.distrito.toLowerCase()) + "'");
      }
      if (parsedInput.concelho && parsedInput.concelho !== "") {
        filterClauses.push("LOWER(concelho_cliente) = '" + safeSql(parsedInput.concelho.toLowerCase()) + "'");
      }
      if (parsedInput.freguesia && parsedInput.freguesia !== "") {
        filterClauses.push("LOWER(freguesia_cliente) = '" + safeSql(parsedInput.freguesia.toLowerCase()) + "'");
      }
      // Also support generic "input" key from AI/MCP callers
      if (filterClauses.length === 0 && parsedInput.input && parsedInput.input !== "") {
        var genericVal = safeSql(parsedInput.input.toLowerCase());
        filterClauses.push("(LOWER(distrito_cliente) = '" + genericVal + "' OR LOWER(concelho_cliente) = '" + genericVal + "' OR LOWER(freguesia_cliente) = '" + genericVal + "')");
      }
      if (filterClauses.length > 0) {
        filterWhere = " AND " + filterClauses.join(" AND ");
      }
    } else {
      // Plain string input: search across all three location columns
      var searchVal = safeSql(("" + parsedInput).toLowerCase());
      if (searchVal !== "") {
        filterWhere = " AND (LOWER(distrito_cliente) = '" + searchVal + "' OR LOWER(concelho_cliente) = '" + searchVal + "' OR LOWER(freguesia_cliente) = '" + searchVal + "')";
      }
    }
  }

  ticket.addOutput("[listarContagensSAsPorLocalidade] filterWhere=" + filterWhere);
  logInfo("listarContagensSAsPorLocalidade", "filterWhere=" + filterWhere);

  try {
    // --- BUILD SQL ---
    STEP = "BUILD_SQL";
    ticket.addOutput("[listarContagensSAsPorLocalidade] STEP: " + STEP);
    logInfo("listarContagensSAsPorLocalidade", "Building BigQuery SQL");

    var sql_query = ''
      + 'SELECT IFNULL(distrito_cliente, "") AS distrito, '
      + 'IFNULL(concelho_cliente, "") AS concelho, '
      + 'IFNULL(freguesia_cliente, "") AS freguesia, '
      + 'COUNT(DISTINCT service_account) AS SAs '
      + 'FROM ( '
      + '  SELECT service_account, distrito_cliente, concelho_cliente, freguesia_cliente'
      + '  FROM `ops-dpt-lab-204386.topology.hfc_tabela_centralizada_cadastro`'
      + '  WHERE day_part >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 DAY)'
      + '  AND service_account IS NOT NULL AND TRIM(service_account) != ""'
      + filterWhere
      + '  UNION ALL'
      + '  SELECT service_account, distrito_cliente, concelho_cliente, freguesia_cliente'
      + '  FROM `ops-dpt-lab-204386.topology.ftth_tabela_centralizada_cadastro`'
      + '  WHERE day_part >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 DAY)'
      + '  AND service_account IS NOT NULL AND TRIM(service_account) != ""'
      + filterWhere
      + ' ) AS t '
      + 'GROUP BY distrito_cliente, concelho_cliente, freguesia_cliente '
      + 'ORDER BY distrito, concelho, freguesia';

    ticket.addOutput("[listarContagensSAsPorLocalidade] SQL_preview=" + sql_query.substring(0, 1200));
    logInfo("listarContagensSAsPorLocalidade", "SQL_preview=" + sql_query.substring(0, 1200));

    // --- EXECUTE QUERY ---
    STEP = "QUERY_BIGQUERY";
    ticket.addOutput("[listarContagensSAsPorLocalidade] STEP: " + STEP);
    logInfo("listarContagensSAsPorLocalidade", "Executing BigQuery");

    var runTicketGCP = ModuleUtils.runFunction("/bigquery/executeQuery", "MONIT", sql_query, getRequestContext());
    if (!ModuleUtils.waitForTicketsSuccess(runTicketGCP)) {
      result.logs = "ERROR: BigQuery query failed";
      ticket.addOutput("[listarContagensSAsPorLocalidade] ERROR at STEP=" + STEP + ": " + result.logs);
      logWarning("listarContagensSAsPorLocalidade", result.logs + " | SQL=" + sql_query);
      ticket.getResult().setObject(JSON.stringify(result));
      ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
      return;
    }

    var data = JSON.parse(runTicketGCP.getResult().getObject());
    if (data.Result === undefined) {
      result.logs = "ERROR: " + (data.Error || "unknown");
      ticket.addOutput("[listarContagensSAsPorLocalidade] ERROR at STEP=" + STEP + ": " + result.logs);
      logWarning("listarContagensSAsPorLocalidade", result.logs);
      ticket.getResult().setObject(JSON.stringify(result));
      ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
      return;
    }

    ticket.addOutput("[listarContagensSAsPorLocalidade] rows=" + (data.Result ? data.Result.length : 0));

    // --- COMPOSE RESPONSE ---
    STEP = "COMPOSE_RESPONSE";
    ticket.addOutput("[listarContagensSAsPorLocalidade] STEP: " + STEP);

    result.content = data.Result;
    result.logs = "SUCCESS: rows=" + (data.Result ? data.Result.length : 0);

    ticket.addOutput("[listarContagensSAsPorLocalidade] SUCCESS: " + result.logs);
    logInfo("listarContagensSAsPorLocalidade", result.logs);

    ticket.getResult().setObject(JSON.stringify(result));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_OK);

  } catch (err) {
    result.logs = "EXCEPTION at STEP=" + STEP + ": " + err;
    ticket.addOutput("[listarContagensSAsPorLocalidade] " + result.logs);
    logSevere("listarContagensSAsPorLocalidade", result.logs);
    ticket.getResult().setObject(JSON.stringify(result));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
  }
}


// ####################### Start module ###########################
function startModule() {
  logInfo("startModule", "Starting ...");

  var functions = [
    {
      name: "listarContagensSAsPorLocalidade",
      path: "/ai/greatops/listar_contagens_sa_por_localidade",
      parameters: "THESYS.ALLPARAMETERS.JSON*string",
      description: "Listar contagens de SAs distintas por concelho, distrito e freguesia @Authors:automated@"
    }
  ];

  addFunctions(functions, true);
  removeFunctions(functions);

  logInfo("startModule", "Started.");
  logEvent(getRequestContext().getUser().getName(), "MODULE_STARTED", "");
}


// ####################### Stop module ############################
function stopModule() {
  logInfo("stopModule", "Stopping ...");
  logInfo("stopModule", "Stopped.");
  logEvent(getRequestContext().getUser().getName(), "MODULE_STOPPED", "");
}


///////////////////////////////////
// Internal code - copied from template (leave as-is)
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
