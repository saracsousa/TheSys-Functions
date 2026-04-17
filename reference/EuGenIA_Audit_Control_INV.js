/*jslint node: true */
"use strict";

// #### Usefull global variables ####
var objectSpace = "sara";
var debug = 1;
var defaultLogLevel = "WARNING";
// ##################################

// #####################################################
// This function lists old investigations (not updated
// in 3+ months) assigned to a specific user.
//
// Input: JSON with owner_user_username
//   e.g. {"owner_user_username": "john.doe"}
// Returns: list of stale investigations for that user
// #####################################################
function staleInvestigationsByUser(ticket, params) {
  var rawInput = params.get(0);
  var ownerUsername = "";
  var result = { content: "", logs: "" };

  // Parse input — support JSON or plain string
  try {
    var jsonObject = JSON.parse(rawInput);
    ownerUsername = jsonObject.owner_user_username || jsonObject.input || "";
  } catch (e) {
    ownerUsername = rawInput ? rawInput.trim() : "";
  }

  ticket.addOutput("staleInvestigationsByUser: ownerUsername=" + ownerUsername);

  if (!ownerUsername) {
    result.logs = "ERROR: owner_user_username parameter is required";
    ticket.addOutput("staleInvestigationsByUser: " + result.logs);
    ticket.getResult().setObject(JSON.stringify(result));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }

  // Calculate date 3 months ago (epoch ms for comparison with MAC API timestamps)
  var now = new Date();
  var threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
  var cutoffTimestamp = threeMonthsAgo.getTime();

  ticket.addOutput("staleInvestigationsByUser: cutoffTimestamp=" + cutoffTimestamp + " (" + threeMonthsAgo.toISOString() + ")");

  // Search for open investigations assigned to this user
  var templateNameQuery = "template_name=~eq~Investigation";
  var statusNotClosedQuery = "&status=~neq~CLOSED";
  var statusNotCancelledQuery = "&status=~neq~CANCELLED";
  var ownerQuery = "&fields.owner_user.username=~eq~" + ownerUsername;

  var q = {
    skip: 0,
    limit: 1000,
    sort_order: 1,
    sort_field: "_updated_date",
    filters: [templateNameQuery + statusNotClosedQuery + statusNotCancelledQuery + ownerQuery],
    "return_fields": ""
  };

  ticket.addOutput("staleInvestigationsByUser: query=" + JSON.stringify(q));

  var runTicket = ModuleUtils.runFunction('/mac/activities/search', ticket.getRequestContext(), JSON.stringify(q));
  if (!ModuleUtils.waitForTicketsSuccess(runTicket)) {
    result.logs = "ERROR: Failed to search investigation activities.";
    ticket.addOutput("staleInvestigationsByUser: " + result.logs);
    ticket.getResult().setObject(JSON.stringify(result));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }

  var resultRaw = runTicket.getResult().getObject();
  var resultParsed;
  try {
    resultParsed = JSON.parse(resultRaw.toString());
  } catch (e) {
    result.logs = "ERROR: Failed to parse search result: " + e;
    ticket.addOutput("staleInvestigationsByUser: " + result.logs);
    ticket.getResult().setObject(JSON.stringify(result));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }

  // Extract investigations array from response
  var investigations = null;
  if (Array.isArray(resultParsed)) {
    investigations = resultParsed;
  } else if (resultParsed.data_output && resultParsed.data_output.result && Array.isArray(resultParsed.data_output.result)) {
    investigations = resultParsed.data_output.result;
  } else if (resultParsed.data && Array.isArray(resultParsed.data)) {
    investigations = resultParsed.data;
  } else if (resultParsed.results && Array.isArray(resultParsed.results)) {
    investigations = resultParsed.results;
  }

  var staleList = [];

  if (Array.isArray(investigations)) {
    for (var i = 0; i < investigations.length; i++) {
      var inv = investigations[i];
      var updatedDate = inv._updated_date || null;

      // Check if updated_date is older than 3 months (epoch ms comparison)
      if (updatedDate && Number(updatedDate) < cutoffTimestamp) {
        // Extract priority safely
        var priorityRaw = inv.fields && inv.fields.priority ? inv.fields.priority : null;
        var priority = null;
        if (priorityRaw) {
          if (typeof priorityRaw === "string") {
            priority = priorityRaw;
          } else if (Array.isArray(priorityRaw) && priorityRaw.length > 0) {
            priority = priorityRaw[0].value || priorityRaw[0].label || null;
          } else if (typeof priorityRaw === "object") {
            priority = priorityRaw.value || priorityRaw.label || null;
          }
        }

        staleList.push({
          _trin_id: inv._trin_id,
          status: inv.status,
          priority: priority,
          _updated_date: inv._updated_date,
          description: inv.fields && inv.fields.description
            ? (inv.fields.description.substring ? inv.fields.description.substring(0, 200) : String(inv.fields.description).substring(0, 200))
            : "",
          owner_user: inv.fields && inv.fields.owner_user ? inv.fields.owner_user : null
        });
      }
    }
  }

  result.content = {
    owner_user_username: ownerUsername,
    cutoff_timestamp: cutoffTimestamp,
    stale_count: staleList.length,
    stale_investigations: staleList
  };
  result.logs = "Found " + staleList.length + " stale investigation(s) for user " + ownerUsername;

  ticket.addOutput("staleInvestigationsByUser: " + result.logs);
  ticket.getResult().setObject(JSON.stringify(result));
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
     name: "staleInvestigationsByUser",
     path: "/ai/sara/staleInvestigationsByUser",
     parameters: "input*string",
     description: "Lists open investigations not updated in 3+ months for a given owner_user username @Authors:Sara@"
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
