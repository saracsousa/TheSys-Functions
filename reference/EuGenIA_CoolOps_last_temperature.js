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
   <br>&nbsp;<br>&nbsp;<br>&nbsp;<br>&nbsp;
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
   <br><br>
   <form method="POST" action="THESYS.WEBCONTROLLER" class="form-horizontal">
   <input type="hidden" name="target" class="form-control" value="THESYS.MENUID">
   
   <input type="hidden" name="action" class="form-control" value="ping">
   Target <input type="text" name="ip" class="form-control" value="'+ip+'" placeholder="Please input target to ping"/>
   <button type="submit" class="btn btn-primary">Ping target ...</button>
   </form>
   </div>
   <br>&nbsp;<br>&nbsp;<br>&nbsp;<br>&nbsp;
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
   <br><br>
   <form method="POST" action="THESYS.WEBCONTROLLER" class="form-horizontal" enctype="multipart/form-data">
   <input type="hidden" name="target" value="THESYS.MENUID">
   
   <input type="hidden" name="action" value="upload">
   Target <input type="file" name="file" class="form-control" placeholder="Please select file"/>
   <button type="submit" class="btn btn-primary">Upload file ...</button>
   </form>
   </div>
   <br>&nbsp;<br>&nbsp;<br>&nbsp;<br>&nbsp;
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
// This function retrieves the latest temperature readings
// for technical rooms from BigQuery, joining with the
// sensor mapping table to return ci_name, sala, fila,
// temperature and timestamp.
//
// Input (optional): JSON with sala filter
//   e.g. {"sala": "MHE"} or "" for all rooms
//
// Returns: latest temperature per sensor with columns:
//   ci_name, sala, fila, temperature, timestamp
// #####################################################
function getTemperaturasSalasTecnicas(ticket, params) {
  var rawInput = "";
  var filterValue = "";
  var filterType = ""; // "ci_name" or "sala"
  var result = { content: "", logs: "" };
  var parsedInput = null;

  ticket.addOutput("getTemperaturasSalasTecnicas: params.length=" + params.length);
  for (var i = 0; i < params.length; i++) {
    ticket.addOutput("getTemperaturasSalasTecnicas: params[" + i + "]=" + params.get(i));
  }

  // Safely get first param
  try {
    if (params.length > 0 && params.get(0) !== null && params.get(0) !== undefined) {
      rawInput = "" + params.get(0); // force to string
    }
  } catch (e) {
    rawInput = "";
  }

  ticket.addOutput("getTemperaturasSalasTecnicas: rawInput=" + rawInput);

  // Parse rawInput and handle array / array-like / object / plain string
  if (rawInput !== "") {
    try {
      var jsonObject = JSON.parse(rawInput);

      if (jsonObject && Array.isArray(jsonObject) && jsonObject.length >= 1) {
        // THESYS.ALLPARAMETERS.JSON may pass arguments as an array
        ticket.addOutput("getTemperaturasSalasTecnicas: DETECTED: Arguments as array in first parameter");
        parsedInput = jsonObject[0];
      } else if (jsonObject && typeof jsonObject === "object" && jsonObject.length >= 1) {
        // Array-like object (Java list, etc.)
        ticket.addOutput("getTemperaturasSalasTecnicas: DETECTED: Arguments as array-like object in first parameter");
        parsedInput = jsonObject[0];
      } else {
        // Plain object or primitive
        ticket.addOutput("getTemperaturasSalasTecnicas: DETECTED: Arguments as direct parameter");
        parsedInput = jsonObject;
      }
    } catch (e) {
      // Not valid JSON — treat rawInput as plain string
      parsedInput = rawInput.trim();
    }
  }

  ticket.addOutput("getTemperaturasSalasTecnicas: parsedInput=" + String(parsedInput).substring(0, 200));

  // Extract filterValue from parsedInput
  if (parsedInput !== null && parsedInput !== undefined) {
    if (typeof parsedInput === "object") {
      filterValue = parsedInput.input || "";
    } else {
      filterValue = ("" + parsedInput).trim();
    }
  }

  ticket.addOutput("getTemperaturasSalasTecnicas: filterValue (raw)=" + filterValue);

  // If input starts with IMO1 → filter by ci_name, otherwise → filter by sala
  if (filterValue !== "" && filterValue.toUpperCase().indexOf("IMO1") === 0) {
    filterType = "ci_name";
    filterValue = filterValue.toUpperCase();
  } else if (filterValue !== "") {
    filterType = "sala";
    filterValue = filterValue.toUpperCase();
  }

  ticket.addOutput("getTemperaturasSalasTecnicas: filterType=" + filterType + " filterValue=" + filterValue);

  var sql_query = 'WITH sensor_map AS (' +
      '  SELECT * FROM UNNEST([' +
      '    STRUCT(\'IMO1SENS0001\' AS ci_name, \'MHE\' AS sala, \'AMBIENTE\' AS fila),' +
      '    STRUCT(\'IMO1SENS0002\', \'MHE\', \'A\'),' +
      '    STRUCT(\'IMO1SENS0003\', \'MHE\', \'B_C\'),' +
      '    STRUCT(\'IMO1SENS0004\', \'MHE\', \'D_E\'),' +
      '    STRUCT(\'IMO1SENS0005\', \'MHE\', \'F_G\'),' +
      '    STRUCT(\'IMO1SENS0006\', \'TELCO3\', \'AMBIENTE\'),' +
      '    STRUCT(\'IMO1SENS0007\', \'TELCO3\', \'A\'),' +
      '    STRUCT(\'IMO1SENS0008\', \'TELCO3\', \'B_C\'),' +
      '    STRUCT(\'IMO1SENS0009\', \'TELCO3\', \'D_E\'),' +
      '    STRUCT(\'IMO1SENS0010\', \'DATA2\', \'AMBIENTE\'),' +
      '    STRUCT(\'IMO1SENS0011\', \'DATA2\', \'A\'),' +
      '    STRUCT(\'IMO1SENS0012\', \'DATA2\', \'A_B\'),' +
      '    STRUCT(\'IMO1SENS0013\', \'DATA2\', \'A_B\'),' +
      '    STRUCT(\'IMO1SENS0014\', \'DATA2\', \'A_B\'),' +
      '    STRUCT(\'IMO1SENS0015\', \'DATA2\', \'C_D\'),' +
      '    STRUCT(\'IMO1SENS0016\', \'DATA2\', \'C_D\'),' +
      '    STRUCT(\'IMO1SENS0017\', \'DATA2\', \'E_F\'),' +
      '    STRUCT(\'IMO1SENS0018\', \'DATA2\', \'E_F\'),' +
      '    STRUCT(\'IMO1SENS0019\', \'DATA2\', \'E_F\'),' +
      '    STRUCT(\'IMO1SENS0020\', \'DATA2\', \'G_H\'),' +
      '    STRUCT(\'IMO1SENS0021\', \'DATA2\', \'G_H\'),' +
      '    STRUCT(\'IMO1SENS0022\', \'DATA2\', \'G_H\'),' +
      '    STRUCT(\'IMO1SENS0023\', \'COM\', \'AMBIENTE\'),' +
      '    STRUCT(\'IMO1SENS0024\', \'COM\', \'AMBIENTE\'),' +
      '    STRUCT(\'IMO1SENS0025\', \'COM\', \'A_B\'),' +
      '    STRUCT(\'IMO1SENS0026\', \'COM\', \'A_B\'),' +
      '    STRUCT(\'IMO1SENS0027\', \'COM\', \'C_D\'),' +
      '    STRUCT(\'IMO1SENS0028\', \'COM\', \'C_D\'),' +
      '    STRUCT(\'IMO1SENS0029\', \'COM\', \'C_D\'),' +
      '    STRUCT(\'IMO1SENS0030\', \'COM\', \'E_F\'),' +
      '    STRUCT(\'IMO1SENS0031\', \'COM\', \'E_F\'),' +
      '    STRUCT(\'IMO1SENS0032\', \'COM\', \'E_F\'),' +
      '    STRUCT(\'IMO1SENS0033\', \'DATA1\', \'B_C\'),' +
      '    STRUCT(\'IMO1SENS0034\', \'DATA1\', \'D_E\'),' +
      '    STRUCT(\'IMO1SENS0035\', \'DATA1\', \'J_K\'),' +
      '    STRUCT(\'IMO1SENS0036\', \'DATA5\', \'AMBIENTE\'),' +
      '    STRUCT(\'IMO1SENS0037\', \'TRANSMISSAO\', \'AMBIENTE\'),' +
      '    STRUCT(\'IMO1SENS0038\', \'IP+ISP\', \'A_B\'),' +
      '    STRUCT(\'IMO1SENS0039\', \'IP+ISP\', \'D_E\'),' +
      '    STRUCT(\'IMO1SENS0040\', \'IRIS\', \'AMBIENTE\'),' +
      '    STRUCT(\'IMO1SENS0041\', \'DATA6\', \'AMBIENTE\'),' +
      '    STRUCT(\'IMO1SENS0042\', \'TAPEMACHINE\', \'AMBIENTE\'),' +
      '    STRUCT(\'IMO1SENS0043\', \'DISKSTORE\', \'A\'),' +
      '    STRUCT(\'IMO1SENS0044\', \'DISKSTORE\', \'G\'),' +
      '    STRUCT(\'IMO1SENS0045\', \'CPM\', \'AMBIENTE\'),' +
      '    STRUCT(\'IMO1SENS0046\', \'CPM\', \'A1\'),' +
      '    STRUCT(\'IMO1SENS0047\', \'CPM\', \'A2\'),' +
      '    STRUCT(\'IMO1SENS0048\', \'CPM\', \'B_C\'),' +
      '    STRUCT(\'IMO1SENS0049\', \'CPM\', \'B_C\')' +
      '  ])' +
      '),' +
      ' latest AS (' +
      '  SELECT' +
      '    site_label,' +
      '    sensor_name,' +
      '    temperature,' +
      '    timestamp,' +
      '    ROW_NUMBER() OVER (' +
      '      PARTITION BY site_label, sensor_name' +
      '      ORDER BY timestamp DESC' +
      '    ) AS rn' +
      '  FROM `ops-dpt-lab-204386.cool_ops.temperaturas_salas_tecnicas`' +
      '),' +
      ' normalized AS (' +
      '  SELECT' +
      '    site_label,' +
      '    sensor_name,' +
      '    temperature,' +
      '    timestamp,' +
      '    UPPER(TRIM(site_label)) AS sala_norm,' +
      '    CASE' +
      '      WHEN REGEXP_CONTAINS(LOWER(TRIM(sensor_name)), r\'(?i)^(temp_)?ambiente$\') THEN \'AMBIENTE\'' +
      '      ELSE UPPER(REGEXP_REPLACE(TRIM(sensor_name), r\'(?i)^temp_fila_\', \'\'))' +
      '    END AS fila_norm' +
      '  FROM latest' +
      '  WHERE rn = 1' +
      ')' +
      ' SELECT' +
      '  m.ci_name,' +
      '  m.sala,' +
      '  m.fila,' +
      '  CAST(n.temperature AS STRING) AS temperature,' +
      '  CAST(n.timestamp AS STRING) AS timestamp' +
      ' FROM normalized n' +
      ' JOIN sensor_map m' +
      '  ON UPPER(TRIM(m.sala)) = n.sala_norm' +
      '  AND REPLACE(UPPER(TRIM(m.fila)), \'_\', \'\') = REPLACE(n.fila_norm, \'_\', \'\')' +
      (filterType === "ci_name" ? ' WHERE m.ci_name = \'' + filterValue + '\'' : '') +
      (filterType === "sala" ? ' WHERE UPPER(m.sala) = \'' + filterValue + '\'' : '') +
      ' ORDER BY m.ci_name';

  ticket.addOutput("getTemperaturasSalasTecnicas: sql_query=" + sql_query);

  var runTicketGCP = ModuleUtils.runFunction("/bigquery/executeQuery", "MONIT", sql_query, getRequestContext());

  if (!ModuleUtils.waitForTicketsSuccess(runTicketGCP)) {
    ticket.addOutput("getTemperaturasSalasTecnicas: Query falhou");
    result.logs = "ERROR: Query failed";
    ticket.getResult().setObject(JSON.stringify(result));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }

  var data_runTicketGCP = JSON.parse(runTicketGCP.getResult().getObject());
  ticket.addOutput("getTemperaturasSalasTecnicas: raw GCP response=" + JSON.stringify(data_runTicketGCP).substring(0, 500));

  if (data_runTicketGCP.Result === undefined) {
    result.logs = "ERROR: " + data_runTicketGCP.Error;
    ticket.addOutput("getTemperaturasSalasTecnicas: " + result.logs);
    ticket.getResult().setObject(JSON.stringify(result));
    ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
    return;
  }

  result.content = data_runTicketGCP.Result;
  result.logs = "Found " + data_runTicketGCP.Result.length + " record(s)" + (filterValue !== "" ? " for " + filterType + " " + filterValue : "");
  ticket.addOutput("getTemperaturasSalasTecnicas: " + result.logs);

  // Sanitize JSON: ensure decimal separators are dots (locale safety)
  var resultJson = JSON.stringify(result);
  // Replace comma-decimals inside number-like patterns: "10,4" → "10.4"
  resultJson = resultJson.replace(/"(\d+),(\d+)"/g, '"$1.$2"');

  ticket.addOutput("getTemperaturasSalasTecnicas: result=" + resultJson.substring(0, 500));
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
     name: "getTemperaturasSalasTecnicas",
     path: "/ai/coolops/temperaturasSalasTecnicas",
     parameters: "THESYS.ALLPARAMETERS.JSON*string",
     description: "Function for getting the latest temperature readings for technical rooms from BigQuery @Authors:Tiago@"
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
