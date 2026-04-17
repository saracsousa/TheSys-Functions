/*jslint node: true */
"use strict";

// #### Usefull global variables ####
var objectSpace = "helloworld";
var debug = 1;
var defaultLogLevel = "WARNING";
// ##################################

// #####################################################
// This function prints 'Hello World' in the console.
//  
// Type in the console:
// console$> /demo/helloWorld ""
//
// #####################################################
function helloWorld(ticket, params) {
  ticket.addOutput('Hello world!');

  ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_OK);
}

// #####################################################
// This function takes 2 parameters and sums then, printing the result in the console.
//  
// Type in the console:
// console$> /demo/math/sum "2" "3"
//
// #####################################################
function sumAPlusB(ticket, params) {
  var a = params.get(0);
  var b = params.get(1);

  var result = a + b;

  ticket.addOutput(a + ' + ' + b + ' = ' + result);

  ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_OK);
}

// #####################################################
// This function supports a meny entry. It is a simple form use case.
//  
// Type in the console:
// console$> /demo/portal/menu1 ""
//
// If the output is html, it's all done :)
// 
// Go to the webportal and check a menu entry called "Demo -> Menu 1". Enjoy. You can change this file on the fly.
//
// #####################################################
function demoMenu1(ticket, params) {
  var parameters = {};

  try {
    if (params.length > 0 && params.get(0).length > 0) {
      parameters = JSON.parse(params.get(0));
    }
  } catch (e) {
  }

  /*!INLINE!
   <div class="col-12"><h1>Hello world</h1></div>

   <div class="col-12">
   <form method="POST" action="THESYS.WEBCONTROLLER" class="form-horizontal">
   <input type="hidden" name="target" value="THESYS.MENUID">
   Texto a testar <input type="text" name="text2find" class="form-control" value="" placeholder="Introduza o texto que sera enviado no form"/>
   <button type="submit" class="btn btn-primary">Send text</button>
   </form>
   </div>
   
&nbsp;
&nbsp;
&nbsp;
&nbsp;
   <b>Lista de parametros passada para a função:</b>
   <table class="table table-condensed table-hover">
   <thead>
   <tr><th>Posicao</th><th>Valor</th></tr>
   </thead>
   <tbody>
   !INLINE!*/
  for (var param in params) {
    ticket.addOutput("<tr><td>" + param + "</td><td>" + params.get(param) + "</td></tr>");
  }
  /*!INLINE!
   </table>

   <b>Lista de parametros passada do WebPortal</b>
   <table class="table table-condensed table-hover">
   <thead>
   <tr><th>Parametro</th><th>Valor</th></tr>
   </thead>
   <tbody>
   !INLINE!*/
  for (var param in parameters) {
    ticket.addOutput("<tr><td>" + param + "</td><td>" + parameters[param] + "</td></tr>");
  }
  /*!INLINE!
   </tbody>
   </table>
   !INLINE!*/

  ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_OK);
}

// #####################################################
// This function supports a menu entry. It is a simple form use case.
//  
// Type in the console:
// console$> /demo/portal/menuPing ""
//
// If the output is html, it's all done :)
// 
// Go to the webportal and check a menu entry called "Demo -> Menu Ping". Enjoy. You can change this file on the fly.
//
// #####################################################
function demoMenuPing(ticket, params) {
  var parameters = {};
  var ip = '';

  try {
    if (params.length > 0 && params.get(0).length > 0) {
      parameters = JSON.parse(params.get(0));
    }
  } catch (e) {
  }

  /*!INLINE!
   <div class="col-12"><h1>Hello world</h1></div>

   !INLINE!*/

  if (parameters.action == 'ping') {
    ip = parameters.ip;
    if (ip === '') {
      ticket.addOutput("<font color=red>Please specify a valid IP</font>");
    } else {
      ticket.addOutput("Executing: <b>/netutils/ip/pingc \"" + ip + "\" \"4\"</b><br><br>");

      var runTicket = ModuleUtils.runFunction('/netutils/ip/pingc', ticket.getRequestContext(), ip, 4);
      if (ModuleUtils.waitForTicketsSuccess(runTicket)) {
        var idx = 0;
        while (idx < runTicket.getOutputSize()) {
          var line = runTicket.getOutput(idx).toString();

          line = line.replaceAll('0% packet loss', '<b><font color=green>0% packet loss</font></b>');

          ticket.addOutput(line + '<br>');

          idx++;
        }

        logEvent(ticket.getRequestContext(), "PING_SUCCESS", {ip: ip});
      } else {
        ticket.addOutput("<font color=red>General error pinging '" + ip + "'</font>");
        logEvent(ticket.getRequestContext(), "PING_FAILED", {ip: ip});
      }
    }
  }

  /*!INLINE!
   </tbody>
   </table>
   


   <form method="POST" action="THESYS.WEBCONTROLLER" class="form-horizontal">
   <input type="hidden" name="target" class="form-control" value="THESYS.MENUID">

   <input type="hidden" name="action" class="form-control" value="ping">
   Target <input type="text" name="ip" class="form-control" value="'+ip+'" placeholder="Please input target to ping"/>
   <button type="submit" class="btn btn-primary">Ping target ...</button>
   </form>
   </div>
   
&nbsp;
&nbsp;
&nbsp;
&nbsp;
   <b>Lista de parametros passada para a função:</b>
   <table class="table table-condensed table-hover">
   <thead>
   <tr><th>Posicao</th><th>Valor</th></tr>
   </thead>
   <tbody>
   !INLINE!*/
  for (var param in params) {
    ticket.addOutput("<tr><td>" + param + "</td><td>" + params.get(param) + "</td></tr>");
  }
  /*!INLINE!
   </table>

   <b>Lista de parametros passada do WebPortal</b>
   <table class="table table-condensed table-hover">
   <thead>
   <tr><th>Parametro</th><th>Valor</th></tr>
   </thead>
   <tbody>
   !INLINE!*/
  for (var param in parameters) {
    ticket.addOutput("<tr><td>" + param + "</td><td>" + parameters[param] + "</td></tr>");
  }
  /*!INLINE!
   </tbody>
   </table>
   !INLINE!*/

  ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_OK);
}

// #####################################################
// This function supports a menu entry. It is a simple form use case.
//  
// Go to the webportal and check a menu entry called "Demo -> Menu Upload File". Enjoy. You can change this file on the fly.
//
// #####################################################
function demoMenuUploadFile(ticket, params) {
  var parameters = {};

  try {
    if (params.length > 0 && params.get(0).length > 0) {
      parameters = JSON.parse(params.get(0));
    }
  } catch (e) {
  }

  /*!INLINE!
   <div class="col-12"><h1>Hello world</h1></div>
   !INLINE!*/

  if (parameters.action == 'upload') {
    var file = parameters.file ? parameters.file : "";
    if (file === '') {
      ticket.addOutput("<font color=red>Please specify a valid file!</font>");
    } else {
      ticket.addOutput("<b>File details</b><br>");
      ticket.addOutput("&nbsp;&nbsp;Name: " + parameters["file.name"] + "<br>");
      ticket.addOutput("&nbsp;&nbsp;Location: " + parameters["file.location"] + "<br>");
      ticket.addOutput("&nbsp;&nbsp;Size: " + new File(parameters["file.location"]).length() + "<br>");
    }
  }

  /*!INLINE!
   </tbody>
   </table>
   


   <form method="POST" action="THESYS.WEBCONTROLLER" class="form-horizontal" enctype="multipart/form-data">
   <input type="hidden" name="target" value="THESYS.MENUID">

   <input type="hidden" name="action" value="upload">
   Target <input type="file" name="file" class="form-control" placeholder="Please select file"/>
   <button type="submit" class="btn btn-primary">Upload file ...</button>
   </form>
   </div>
   
&nbsp;
&nbsp;
&nbsp;
&nbsp;
   <b>Lista de parametros passada para a função:</b>
   <table class="table table-condensed table-hover">
   <thead>
   <tr><th>Posicao</th><th>Valor</th></tr>
   </thead>
   <tbody>
   !INLINE!*/
  for (var param in params) {
    ticket.addOutput("<tr><td>" + param + "</td><td>" + params.get(param) + "</td></tr>");
  }
  /*!INLINE!
   </table>

   <b>Lista de parametros passada do WebPortal</b>
   <table class="table table-condensed table-hover">
   <thead>
   <tr><th>Parametro</th><th>Valor</th></tr>
   </thead>
   <tbody>
   !INLINE!*/
  for (var param in parameters) {
    ticket.addOutput("<tr><td>" + param + "</td><td>" + parameters[param] + "</td></tr>");
  }
  /*!INLINE!
   </tbody>
   </table>
   !INLINE!*/

  ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_OK);
}

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
// This function retrieves an E2E Request activity by ID
// (e.g., DGA-0015933) and returns all its fields:
// status, priority, request_type, platform, disclaimer,
// plus all standard metadata fields.
//
// Template: E2E Requests (id: 68f9f7c7d64210001acae1ef)
//
// Parameters (JSON):
//   { "request_id": "DGA-0015933" }
//
// Returns: full activity object with all fields
// #####################################################
function aiToolsE2ERequestById(ticket, params) {
  var parameters = {};
  var result = { content: "", logs: "" };
  var requestId = null;

  try {
    if (params.length > 0 && params.get(0).length > 0) {
      var raw = params.get(0).toString().trim();
      // Try JSON parse first; if it fails treat the raw value as the request_id directly
      try {
        parameters = JSON.parse(raw);
        requestId = parameters.request_id || parameters.id || null;
      } catch (parseErr) {
        // Plain string passed (e.g. "DGA-0015933")
        requestId = raw;
      }
    }
  } catch (e) {
    // Use default empty parameters if parsing fails
  }

  if (!requestId || requestId === "") {
    setResponse(ticket, "Missing required parameter: request_id (e.g., DGA-0015933)", "", 1, TheSysModuleFunctionResult.RESULT_NOK, "400");
    return;
  }

  // Search by _trin_id within E2E Requests template
  var templateNameQuery = "template_name=~eq~E2E Requests";
  var trinIdQuery = "&_trin_id=~eq~" + requestId;

  var q = {
    skip: 0,
    limit: 1,
    sort_order: -1,
    sort_field: "_created_date",
    filters: [templateNameQuery + trinIdQuery],
    return_fields: ""
  };

  var runTicket = ModuleUtils.runFunction('/mac/activities/search', ticket.getRequestContext(), JSON.stringify(q));
  if (!ModuleUtils.waitForTicketsSuccess(runTicket)) {
    result.content = { error: "Failed to search E2E Request activities." };
    result.logs = "/mac/activities/search " + JSON.stringify(q);
    setResponse(ticket, "Failed to search E2E Request activities.", JSON.stringify(result), 1, TheSysModuleFunctionResult.RESULT_NOK, "500");
    return;
  }

  var resultRaw = runTicket.getResult().getObject();
  var resultParsed;
  try {
    resultParsed = JSON.parse(resultRaw.toString());
  } catch (e) {
    result.content = { error: "Failed to parse search result: " + e };
    result.logs = "/mac/activities/search " + JSON.stringify(q);
    setResponse(ticket, "Failed to parse result.", JSON.stringify(result), 1, TheSysModuleFunctionResult.RESULT_NOK, "500");
    return;
  }

  // Extract activities from response (handle multiple response shapes)
  var activities = null;
  if (Array.isArray(resultParsed)) {
    activities = resultParsed;
  } else if (resultParsed.data_output && resultParsed.data_output.result && Array.isArray(resultParsed.data_output.result)) {
    activities = resultParsed.data_output.result;
  } else if (resultParsed.data && Array.isArray(resultParsed.data)) {
    activities = resultParsed.data;
  } else if (resultParsed.results && Array.isArray(resultParsed.results)) {
    activities = resultParsed.results;
  }

  if (!activities || activities.length === 0) {
    result.content = { error: "No E2E Request found with ID: " + requestId };
    result.logs = "/mac/activities/search " + JSON.stringify(q);
    setResponse(ticket, "No E2E Request found with ID: " + requestId, JSON.stringify(result), 0, TheSysModuleFunctionResult.RESULT_OK, "200");
    return;
  }

  var activity = activities[0];

  // Build response with all available fields
  var output = {
    _id: activity._id || null,
    _trin_id: activity._trin_id || null,
    _mac_id: activity._mac_id || null,
    status: activity.status || null,
    _created_date: activity._created_date || null,
    _updated_date: activity._updated_date || null,
    _created_by: activity._created_by || null,
    _updated_by: activity._updated_by || null,
    template_name: activity.template_name || null
  };

  // Extract all template-specific fields (priority, request_type, platform, disclaimer, etc.)
  if (activity.fields) {
    output.fields = activity.fields;
  }

  // Also include any other top-level properties not yet captured
  for (var key in activity) {
    if (!output.hasOwnProperty(key) && key !== "fields") {
      output[key] = activity[key];
    }
  }

  result.content = output;
  result.logs = "/mac/activities/search " + JSON.stringify(q);

  ticket.getResult().setObject(JSON.stringify(result));
  ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_OK);
  return;
}

// ####################### Start module ###########################
// # Called every time module starts                              #
// # When this file is saved, thoe module is stopped and started  #
// ################################################################
function startModule() {
  logInfo("startModule", "Starting ...");

  var functions = [
    {
     name: "aiToolsE2ERequestById",
     path: "/ai/e2e/e2eRequestById",
     parameters: "input*string",
     description: "Retrieves an E2E Request by its ID (e.g. DGA-0015933) and returns all fields: status, priority, request_type, platform, disclaimer, etc.@Authors:SparkOps@"
    }
    /*{
     name: "helloWorld",
     path: "/demo/helloWorld",
     parameters: "",
     description: "HelloWorld function@Authors:TheSys@"
     },
     {
     name: "sumAPlusB",
     path: "/demo/math/sum",
     parameters: "a*integer,b*integer",
     description: "Sum function@Authors:TheSys@"
     },
     {
     name: "demoMenu1",
     path: "/demo/portal/menu1",
     parameters: "THESYS.ALLPARAMETERS.JSON*string",
     description: "Function for Menu 1@Authors:TheSys@",
     menu: {
     path: "Demo|Menu 1"
     }
     },
     {
     name: "demoMenuPing",
     path: "/demo/portal/menuPing",
     parameters: "THESYS.ALLPARAMETERS.JSON*string",
     description: "Function for Menu Ping@Authors:TheSys@",
     menu: {
     path: "Demo|Menu Ping"
     }
     },
     {
     name: "demoMenuUploadFile",
     path: "/demo/portal/menuUploadFile",
     parameters: "THESYS.ALLPARAMETERS.JSON*string",
     description: "Function for Menu UploadFile@Authors:TheSys@",
     menu: {
     path: "Demo|Menu Upload File"
     }
     }*/
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
