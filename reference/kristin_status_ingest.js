/*jslint node: true */
"use strict";

// #### Global variables ####
var objectSpace = "helloworld";
var debug = 1;
var defaultLogLevel = "WARNING";
var gcpFullTable = "`ops-dpt-lab-204386.status_fixo.kristin_status_2h`";
var elasticIndex = "auto_kristin_devices_status";
var minutesInterval = 150; // 2h30m query window (covers 2h data cycle + 30min safety buffer to guarantee no data is missed)
var batchSize = 150;       // number of rows per INSERT batch sent to BigQuery
// ##########################

function kristinStatusIngest(ticket, params) {
  var startDate = new Date();
  var endDate = new Date();
  endDate.setSeconds(0);
  startDate.setSeconds(0);
  endDate.setMilliseconds(0);
  startDate.setMilliseconds(0);
  startDate.setMinutes(endDate.getMinutes() - minutesInterval);

  ticket.addOutput("=== Kristin Status Ingest - Start ===");
  ticket.addOutput("Time window: " + startDate.toISOString() + " to " + endDate.toISOString());

  var queryResultJson = queryElasticKristin(ticket, startDate, endDate);
  if (queryResultJson === null) {
    ticket.addOutput("Elastic error after retries. Exiting...");
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_OK);
    return;
  }

  var hits = queryResultJson.hits.hits;
  ticket.addOutput("Total hits from Elastic: " + hits.length + " (total in index: " + (queryResultJson.hits.total && queryResultJson.hits.total.value ? queryResultJson.hits.total.value : queryResultJson.hits.total) + ")");

  if (hits.length >= 10000) {
    ticket.addOutput("WARNING: Hit the 10000 document limit. Some records may be missing. Consider reducing the interval or implementing pagination.");
  }

  if (hits.length === 0) {
    ticket.addOutput("No records found in this window. Nothing to insert.");
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_OK);
    return;
  }

  var records = parseElasticData(ticket, hits);
  ticket.addOutput("Parsed records: " + records.length);

  deleteOverlappingRecords(ticket, startDate, endDate);

  insertArrayInGCP(ticket, records);

  ticket.addOutput("=== Kristin Status Ingest - Complete ===");
  ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_OK);
}

function deleteOverlappingRecords(ticket, startDate, endDate) {
  var startDateText = startDate.toISOString();
  var endDateText = endDate.toISOString();

  var deleteQuery = "DELETE FROM " + gcpFullTable +
    " WHERE event_timestamp >= '" + startDateText + "'" +
    " AND event_timestamp <= '" + endDateText + "'";

  if (debug === 1) ticket.addOutput("DELETE query: " + deleteQuery);

  var runTicket = ModuleUtils.runFunction("/bigquery/executeQuery", ticket.getTheSysUser(), "MONIT", deleteQuery);
  if (!ModuleUtils.waitForTicketsSuccess(runTicket)) {
    ticket.addOutput("WARNING: Could not delete overlapping records. Proceeding with insert (may cause duplicates).");
  } else {
    ticket.addOutput("Overlapping records deleted successfully.");
  }
}

function insertArrayInGCP(ticket, records) {
  var columns = "(ingest_timestamp, event_timestamp, concelho, device_mac, device_model, distrito, " +
    "olt_node_name, ont_mac, ont_model, plc_netname, rede_ftth, service_account, " +
    "splitter1_netname, splitter2_netname, state)";

  var queryValuesString = "";
  var queryString = "";
  var batchCount = 0;

  if (debug === 1) ticket.addOutput("Inserting " + records.length + " records into GCP...");

  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    var valueRow = "(\"" + r.ingest_timestamp + "\", \"" + r.event_timestamp + "\", \"" +
      sanitize(r.concelho) + "\", \"" + sanitize(r.device_mac) + "\", \"" + sanitize(r.device_model) + "\", \"" +
      sanitize(r.distrito) + "\", \"" + sanitize(r.olt_node_name) + "\", \"" + sanitize(r.ont_mac) + "\", \"" +
      sanitize(r.ont_model) + "\", \"" + sanitize(r.plc_netname) + "\", \"" + sanitize(r.rede_ftth) + "\", \"" +
      sanitize(r.service_account) + "\", \"" + sanitize(r.splitter1_netname) + "\", \"" +
      sanitize(r.splitter2_netname) + "\", \"" + sanitize(r.state) + "\")";

    if (queryValuesString === "") {
      queryValuesString = valueRow;
    } else {
      queryValuesString += ",\n" + valueRow;
    }

    if ((i > 0 && ((i + 1) % batchSize) === 0) || i === records.length - 1) {
      queryString = "INSERT INTO " + gcpFullTable + " " + columns + " VALUES " + queryValuesString;
      queryValuesString = "";
      batchCount++;

      if (debug === 1) ticket.addOutput("Executing INSERT batch #" + batchCount + " (up to record " + (i + 1) + "/" + records.length + ")");

      var runTicket = ModuleUtils.runFunction("/bigquery/executeQuery", ticket.getTheSysUser(), "MONIT", queryString);
      if (!ModuleUtils.waitForTicketsSuccess(runTicket)) {
        throw "Could not insert data in GCP at batch #" + batchCount + " (record index " + i + ")";
      }
    }
  }

  ticket.addOutput("Successfully inserted " + records.length + " records in " + batchCount + " batch(es).");
}

function parseElasticData(ticket, hits) {
  var records = [];
  var dateNow = new Date();
  var ingestTimestamp = dateNow.toISOString();

  for (var i = 0; i < hits.length; i++) {
    var source = hits[i]._source;

    var eventTs = source.event_timestamp || "";
    if (typeof eventTs === "number") {
      eventTs = new Date(eventTs).toISOString();
    }

    var record = {
      ingest_timestamp:  ingestTimestamp,
      event_timestamp:   eventTs,
      concelho:          source.concelho || "",
      device_mac:        source.device_mac || "",
      device_model:      source.device_model || "",
      distrito:          source.distrito || "",
      olt_node_name:     source.olt_node_name || "",
      ont_mac:           source.ont_mac || "",
      ont_model:         source.ont_model || "",
      plc_netname:       source.plc_netname || "",
      rede_ftth:         source.rede_ftth || "",
      service_account:   source.service_account || "",
      splitter1_netname: source.splitter1_netname || "",
      splitter2_netname: source.splitter2_netname || "",
      state:             source.state || ""
    };

    records.push(record);
  }

  if (debug === 1) ticket.addOutput("Parsed " + records.length + " records from " + hits.length + " hits.");
  return records;
}

function queryElasticKristin(ticket, startDate, endDate) {
  var attemptsNumberForNOK = 3;
  var nokCount = 0;
  var retrySecondsBetweenQueries = 45;

  var startDateText = "" + startDate.getUTCFullYear() + "-" + padNumber((startDate.getUTCMonth() + 1), 2) + "-" + padNumber(startDate.getUTCDate(), 2) + "T" + padNumber(startDate.getUTCHours(), 2) + ":" + padNumber(startDate.getUTCMinutes(), 2) + ":" + padNumber(startDate.getUTCSeconds(), 2) + ".000Z";
  var endDateText = "" + endDate.getUTCFullYear() + "-" + padNumber((endDate.getUTCMonth() + 1), 2) + "-" + padNumber(endDate.getUTCDate(), 2) + "T" + padNumber(endDate.getUTCHours(), 2) + ":" + padNumber(endDate.getUTCMinutes(), 2) + ":" + padNumber(endDate.getUTCSeconds(), 2) + ".000Z";

  var elasticArgument = "{" +
    "\"size\": 10000," +
    "\"sort\": [{\"event_timestamp\":{\"order\": \"asc\"}}]," +
    "\"query\":{\"bool\": {\"must\": [" +
      "{\"range\": {\"event_timestamp\": {" +
        "\"gte\": \"" + startDateText + "\"," +
        "\"lte\": \"" + endDateText + "\"," +
        "\"format\": \"strict_date_optional_time\"" +
      "}}}" +
    "],\"filter\": [],\"should\": [],\"must_not\": []}}" +
  "}";

  ticket.addOutput("Elastic query window: " + startDateText + " -> " + endDateText);
  if (debug === 1) ticket.addOutput("Elastic query body: " + elasticArgument);

  var runTicket = ModuleUtils.runFunction("/elasticNA/queryWithBody", ticket.getTheSysUser(), elasticIndex, elasticArgument);

  for (var i = 0; i < attemptsNumberForNOK; i++) {
    if (!ModuleUtils.waitForTicketsSuccess(runTicket)) {
      nokCount++;
      ticket.addOutput("Elastic query attempt " + nokCount + " failed.");
      if (nokCount === attemptsNumberForNOK) {
        return null;
      }
      ModuleUtils.executeFunction("/thesys/sleep", getRequestContext(), retrySecondsBetweenQueries * 1000);
      runTicket = ModuleUtils.runFunction("/elasticNA/queryWithBody", ticket.getTheSysUser(), elasticIndex, elasticArgument);
    } else {
      var jsonObj = runTicket.getResult().getObject();
      if (debug === 1) ticket.addOutput("Elastic raw response: " + jsonObj);
      var json = JSON.parse(jsonObj);
      if (!json || !json.hits || !json.hits.hits) {
        ticket.addOutput("ERROR: Elastic response has no hits. Possible access/permissions issue. Response: " + JSON.stringify(json).substring(0, 500));
        return null;
      }
      return json;
    }
  }

  return null;
}

function sanitize(val) {
  if (val === null || val === undefined) return "";
  return String(val).replace(/"/g, '\\"');
}

function padNumber(num, size) {
  num = num.toString();
  while (num.length < size) num = "0" + num;
  return num;
}


// ####################### Start module ###########################
function startModule() {
  logInfo("startModule", "Starting ...");

  var functions = [
    {
      name: "kristinStatusIngest",
      path: "/dpt/kristinStatusIngest",
      parameters: "",
      description: "Ingests device status data from Elastic index auto_kristin_devices_status into GCP BigQuery. Schedule every 2 hours.@Authors:TheSys@"
    }
  ];

  addFunctions(functions);
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
// Internal code - leave it as is //
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