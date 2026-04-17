/*jslint node: true */
"use strict";

// #### Usefull global variables ####
var objectSpace = "helloworld";
var debug = 1;
var defaultLogLevel = "WARNING";
var gcpTableName = "guias_consults";
var minutesInterval = 5;
// ##################################

function guidesConsult(ticket, params) { // Este script deve estar no scheduler a correr de 5 em 5 mins
	var dissuasoesObjectArray, queryResultJson, hits;
  var startDate = new Date();
  var endDate = new Date();
  endDate.setSeconds(0);
  startDate.setSeconds(0);
  endDate.setMilliseconds(0);
  startDate.setMilliseconds(0);
  startDate.setMinutes(endDate.getMinutes() - minutesInterval);
  
  // Efetuar query em Elastic nos últimos 5 mins
  var kibanaFilter = "(apiResourcePath_split:\\\\/guides\\\\/2.0\\\\/Consult?tipo=Rede&ativo=1 OR apiResourcePath_split:\\\\/guides\\\\/2.0\\\\/Consult?tipo=Rede&ativo=1&area=&celula=)"; // só funciona bem se se meter as paretices because of course...
  queryResultJson = queryFramework40Prd_last5mins(ticket, kibanaFilter, startDate, endDate);
  if(queryResultJson === null)
  {
      ticket.addOutput("elastic error, retry schema didnt resolve. exiting...");
      ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_OK);
  }
  else
  {
    hits = queryResultJson.hits.hits;
  }
  
  // Fazer parse dos dados, construir objeto dissuasoes
  dissuasoesObjectArray = parseElasticData(ticket, hits, startDate);
  
  // Agrupar alguns objetos num unico query e meter em GCP- Não se pode meter 1 a 1, dá merda. Não se pode fazer um query demasiado grande, dá merda.
  insertArrayInGCP(ticket, dissuasoesObjectArray);

  ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_OK);
}

function insertArrayInGCP(ticket, dissuasoesObjectArray){
  var queryValuesString, queryString;
  queryValuesString = "";
  queryString = "";
  if(debug === 1) ticket.addOutput("numero de objetos de dissuasoes: " +  dissuasoesObjectArray.length);
  for(var wtf = 0; wtf < dissuasoesObjectArray.length; wtf++){
    if(debug === 1) ticket.addOutput("inside obj[" + wtf + "] - area:" + dissuasoesObjectArray[wtf].area);
  }
  
  for(var i = 0; i < dissuasoesObjectArray.length; i++){
    if(i === 0) { 
      dissuasoesObjectArray[i].completeJSONObject = dissuasoesObjectArray[i].completeJSONObject.replace(/\"/g, "'");
      queryValuesString = "(\"" + dissuasoesObjectArray[i].thesysDateTimestamp + "\", \"" + dissuasoesObjectArray[i].dataDateTimestamp + "\", \"" + dissuasoesObjectArray[i].responseCode +
        "\", \"" + dissuasoesObjectArray[i].area + "\", \"" + dissuasoesObjectArray[i].ativo + "\", \"" + dissuasoesObjectArray[i].celula  + "\", \"" + dissuasoesObjectArray[i].codigoDissuasao +
        "\", \"" + dissuasoesObjectArray[i].codigoDissuasaoServico + "\", \"" + dissuasoesObjectArray[i].dataInicio + "\", \"" + dissuasoesObjectArray[i].dataFim + "\", \"" + dissuasoesObjectArray[i].dissuasionPrompt + "\", \"" + 
        dissuasoesObjectArray[i].horasFim + "\", \"" + dissuasoesObjectArray[i].id_diss +
        "\", \"" + dissuasoesObjectArray[i].order + "\", \"" + dissuasoesObjectArray[i].codigoDissuasao + "\", \"" + dissuasoesObjectArray[i].particaoPrestadorServico + "\", \"" + dissuasoesObjectArray[i].particaodirecao +
        "\", \"" + dissuasoesObjectArray[i].pd + "\", \"" + dissuasoesObjectArray[i].subjectNumber + "\", \"" + dissuasoesObjectArray[i].tipo  + "\", \"" + dissuasoesObjectArray[i].completeJSONObject +
        "\" )";
    }
		else {
      dissuasoesObjectArray[i].completeJSONObject = dissuasoesObjectArray[i].completeJSONObject.replace(/\"/g, "'");
		   queryValuesString += "\n(\"" + dissuasoesObjectArray[i].thesysDateTimestamp + "\", \"" + dissuasoesObjectArray[i].dataDateTimestamp + "\", \"" + dissuasoesObjectArray[i].responseCode +
        "\", \"" + dissuasoesObjectArray[i].area + "\", \"" + dissuasoesObjectArray[i].ativo + "\", \"" + dissuasoesObjectArray[i].celula  + "\", \"" + dissuasoesObjectArray[i].codigoDissuasao +
        "\", \"" + dissuasoesObjectArray[i].codigoDissuasaoServico + "\", \"" + dissuasoesObjectArray[i].dataInicio + "\", \"" + dissuasoesObjectArray[i].dataFim + "\", \"" + dissuasoesObjectArray[i].dissuasionPrompt + "\", \"" + 
        dissuasoesObjectArray[i].horasFim + "\", \"" + dissuasoesObjectArray[i].id_diss +
        "\", \"" + dissuasoesObjectArray[i].order + "\", \"" + dissuasoesObjectArray[i].codigoDissuasao + "\", \"" + dissuasoesObjectArray[i].particaoPrestadorServico + "\", \"" + dissuasoesObjectArray[i].particaodirecao +
        "\", \"" + dissuasoesObjectArray[i].pd + "\", \"" + dissuasoesObjectArray[i].subjectNumber + "\", \"" + dissuasoesObjectArray[i].tipo  + "\", \"" + dissuasoesObjectArray[i].completeJSONObject +
        "\" )";
    } 
    
		if(i === dissuasoesObjectArray.length -1) {
      queryValuesString += ";";
    }
    else if((i % 150) === 0){
      queryValuesString += ";";
      queryString = "INSERT INTO guias." + gcpTableName + " (thesysDateTimestamp, dataDateTimestamp, responseCode, area, ativo, celula, codigoDissuasao, codigoDissuasaoServico, dataInicio, dataFim, dissuasionPrompt, horasFim, id_diss, " +
      "_order, particaoArea, particaoPrestadorServico, particaodirecao, pd, subjectNumber, tipo, completeJSONObject) values " + queryValuesString;
      queryValuesString = "";
      
      if(debug === 1) ticket.addOutput("will try to execute query: " + queryString);
      
      var runTicket = ModuleUtils.runFunction("/bigquery/executeQuery", ticket.getTheSysUser(), "MONIT", queryString);
	    if (!ModuleUtils.waitForTicketsSuccess(runTicket)) {// TODO <- Acrescentar retries quando n consegue correr query
		    throw "Could not insert data in GCP ";
      }
    }
    else{
      queryValuesString += ",";
    } 
  }
  queryString = "INSERT INTO guias." + gcpTableName + " (thesysDateTimestamp, dataDateTimestamp, responseCode, area, ativo, celula, codigoDissuasao, codigoDissuasaoServico, dataInicio, dataFim, dissuasionPrompt, horasFim, id_diss, " +
      "_order, particaoArea, particaoPrestadorServico, particaodirecao, pd, subjectNumber, tipo, completeJSONObject) values " + queryValuesString;
  
  
  if(debug === 1) ticket.addOutput("will try to execute query: " + queryString);
	var runTicket2 = ModuleUtils.runFunction("/bigquery/executeQuery", ticket.getTheSysUser(), "MONIT", queryString);
  
	if (!ModuleUtils.waitForTicketsSuccess(runTicket2)){ // TODO <- Acrescentar retries quando n consegue correr query
		throw "Could not insert data in GCP ";  
  }
}

function parseElasticData(ticket, hits, startDate) {
    var dissuasoesObjectArray = [];

    for (var i = 0; i < hits.length; i++) {
        if (debug === 1) ticket.addOutput("i = " + i);
        
        if (hits[i]._source.hasOwnProperty("responseBody")){
          if(hits[i]._source.responseBody.hasOwnProperty("dissuasoes")) {
            dissuasoesObjectArray = [];
            for (var j = 0; j < hits[i]._source.responseBody.dissuasoes.length; j++) {
                var dissuasoesObject = {
                    area: "",
                    ativo: "",
                    celula: "",
                    codigoDissuasao: "",
                    codigoDissuasaoServico: "",
                    dataInicio: "",
                    dataFim: "",
                    dissuasionPrompt: "",
                    horasFim: "",
                    id_diss: "",
                    order: "",
                    particaoArea: "",
                    particaoPrestadorServico: "",
                    particaodirecao: "",
                    pd: "",
                    subjectNumber: "",
                    tipo: "",
                    completeJSONObject: "",
                    responseCode: "",
                    dataDateTimestamp: "",
                    thesysDateTimestamp: ""
                };

                if (hits[i]._source.responseBody.dissuasoes[j].hasOwnProperty("area")) dissuasoesObject.area = hits[i]._source.responseBody.dissuasoes[j].area;
                if (hits[i]._source.responseBody.dissuasoes[j].hasOwnProperty("ativo")) dissuasoesObject.ativo = hits[i]._source.responseBody.dissuasoes[j].ativo;
                if (hits[i]._source.responseBody.dissuasoes[j].hasOwnProperty("celula")) dissuasoesObject.celula = hits[i]._source.responseBody.dissuasoes[j].celula;
                if (hits[i]._source.responseBody.dissuasoes[j].hasOwnProperty("codigoDissuasao")) dissuasoesObject.codigoDissuasao = hits[i]._source.responseBody.dissuasoes[j].codigoDissuasao;
                if (hits[i]._source.responseBody.dissuasoes[j].hasOwnProperty("codigoDissuasaoServico")) dissuasoesObject.codigoDissuasaoServico = hits[i]._source.responseBody.dissuasoes[j].codigoDissuasaoServico;
                if (hits[i]._source.responseBody.dissuasoes[j].hasOwnProperty("dataInicio")) dissuasoesObject.dataInicio = hits[i]._source.responseBody.dissuasoes[j].dataInicio;
                if (hits[i]._source.responseBody.dissuasoes[j].hasOwnProperty("dataFim")) dissuasoesObject.dataFim = hits[i]._source.responseBody.dissuasoes[j].dataFim;
                if (hits[i]._source.responseBody.dissuasoes[j].hasOwnProperty("dissuasionPrompt")) dissuasoesObject.dissuasionPrompt = hits[i]._source.responseBody.dissuasoes[j].dissuasionPrompt;
                if (hits[i]._source.responseBody.dissuasoes[j].hasOwnProperty("horasFim")) dissuasoesObject.horasFim = hits[i]._source.responseBody.dissuasoes[j].horasFim;
                if (hits[i]._source.responseBody.dissuasoes[j].hasOwnProperty("id_diss")) dissuasoesObject.id_diss = hits[i]._source.responseBody.dissuasoes[j].id_diss;
                if (hits[i]._source.responseBody.dissuasoes[j].hasOwnProperty("order")) dissuasoesObject.order = hits[i]._source.responseBody.dissuasoes[j].order;
                if (hits[i]._source.responseBody.dissuasoes[j].hasOwnProperty("particaoArea")) dissuasoesObject.particaoArea = hits[i]._source.responseBody.dissuasoes[j].particaoArea;
                if (hits[i]._source.responseBody.dissuasoes[j].hasOwnProperty("particaoPrestadorServico")) dissuasoesObject.particaoPrestadorServico = hits[i]._source.responseBody.dissuasoes[j].particaoPrestadorServico;
                if (hits[i]._source.responseBody.dissuasoes[j].hasOwnProperty("particaodirecao")) dissuasoesObject.particaodirecao = hits[i]._source.responseBody.dissuasoes[j].particaodirecao;
                if (hits[i]._source.responseBody.dissuasoes[j].hasOwnProperty("pd")) dissuasoesObject.pd = hits[i]._source.responseBody.dissuasoes[j].pd;
                if (hits[i]._source.responseBody.dissuasoes[j].hasOwnProperty("subjectNumber")) dissuasoesObject.subjectNumber = hits[i]._source.responseBody.dissuasoes[j].subjectNumber;
                if (hits[i]._source.responseBody.dissuasoes[j].hasOwnProperty("tipo")) dissuasoesObject.tipo = hits[i]._source.responseBody.dissuasoes[j].tipo;

                dissuasoesObject.completeJSONObject = JSON.stringify(hits[i]._source.responseBody.dissuasoes[j]);
                var dateNow = new Date();
                dissuasoesObject.thesysDateTimestamp = dateNow.toISOString();

                if (hits[i]._source.hasOwnProperty("requestTimestamp")) {
                    dissuasoesObject.dataDateTimestamp = parseInt(parseInt(hits[i]._source.requestTimestamp, 0)/1000, 0);
                }
                
                if (hits[i]._source.hasOwnProperty("responseCode")) {
                    dissuasoesObject.responseCode = hits[i]._source.responseCode || ""; 
                }

                dissuasoesObjectArray.push(dissuasoesObject);
             }
          }
        }
    }

    for (var wtf = 0; wtf < dissuasoesObjectArray.length; wtf++) {
        if (debug === 1) ticket.addOutput("inside obj[" + wtf + "] - area: " + dissuasoesObjectArray[wtf].area);
    }
    
    return dissuasoesObjectArray;
}

/*function parseElasticData(ticket, hits)
{
  var dissuasoesObjectArray = [];
  
  for(var i = 0; i < hits.length; i++)
  {
    ticket.addOutput("i = " + i);
    var dissuasoesObject = {
      area : "",
      ativo : "",
      celula : "",
      codigoDissuasao : "",
      codigoDissuasaoServico : "",
      dataInicio: "",
      dataFim: "",
      dissuasionPrompt : "",
      horasFim: "",
      id_diss : "",
      order : "",
      particaoArea : "",
      particaoPrestadorServico : "",
      particaodirecao : "",
      pd : "",
      subjectNumber : "",
      tipo : "",
          
      // Others? Add here
      
      completeJSONObject : "", // In case there are more fields in the dissuasoes object? If not possible, delete this and dont insert in table
      
      // Unrelated info to store
      responseCode: "",
      dataDateTimestamp : "",
      thesysDateTimestamp : ""
    };
  
		if(hits[i]._source.hasOwnProperty("responseBody")){
			if(hits[i]._source.responseBody.hasOwnProperty("dissuasoes")){
        for(var j = 0; j <  hits[i]._source.responseBody.dissuasoes.length; j++){
          if(hits[i]._source.responseBody.dissuasoes[j].hasOwnProperty("area")) dissuasoesObject.area = hits[i]._source.responseBody.dissuasoes[j].area;
          if(hits[i]._source.responseBody.dissuasoes[j].hasOwnProperty("ativo")) dissuasoesObject.ativo = hits[i]._source.responseBody.dissuasoes[j].ativo;
          if(hits[i]._source.responseBody.dissuasoes[j].hasOwnProperty("celula")) dissuasoesObject.celula = hits[i]._source.responseBody.dissuasoes[j].celula;
          if(hits[i]._source.responseBody.dissuasoes[j].hasOwnProperty("codigoDissuasao")) dissuasoesObject.codigoDissuasao = hits[i]._source.responseBody.dissuasoes[j].codigoDissuasao;
          if(hits[i]._source.responseBody.dissuasoes[j].hasOwnProperty("codigoDissuasaoServico")) dissuasoesObject.codigoDissuasaoServico = hits[i]._source.responseBody.dissuasoes[j].codigoDissuasaoServico;
          if(hits[i]._source.responseBody.dissuasoes[j].hasOwnProperty("dataInicio")) dissuasoesObject.dataInicio = hits[i]._source.responseBody.dissuasoes[j].dataInicio;
          if(hits[i]._source.responseBody.dissuasoes[j].hasOwnProperty("dataFim")) dissuasoesObject.dataInicio = hits[i]._source.responseBody.dissuasoes[j].dataFim;
          if(hits[i]._source.responseBody.dissuasoes[j].hasOwnProperty("dissuasionPrompt")) dissuasoesObject.dissuasionPrompt = hits[i]._source.responseBody.dissuasoes[j].dissuasionPrompt;
          if(hits[i]._source.responseBody.dissuasoes[j].hasOwnProperty("horasFim")) dissuasoesObject.horasFim = hits[i]._source.responseBody.dissuasoes[j].horasFim;
          if(hits[i]._source.responseBody.dissuasoes[j].hasOwnProperty("id_diss")) dissuasoesObject.id_diss = hits[i]._source.responseBody.dissuasoes[j].id_diss;
          if(hits[i]._source.responseBody.dissuasoes[j].hasOwnProperty("order")) dissuasoesObject.order = hits[i]._source.responseBody.dissuasoes[j].order;
          if(hits[i]._source.responseBody.dissuasoes[j].hasOwnProperty("particaoArea")) dissuasoesObject.particaoArea = hits[i]._source.responseBody.dissuasoes[j].particaoArea;
          if(hits[i]._source.responseBody.dissuasoes[j].hasOwnProperty("particaoPrestadorServico")) dissuasoesObject.particaoPrestadorServico = hits[i]._source.responseBody.dissuasoes[j].particaoPrestadorServico;
          if(hits[i]._source.responseBody.dissuasoes[j].hasOwnProperty("particaodirecao")) dissuasoesObject.particaodirecao = hits[i]._source.responseBody.dissuasoes[j].particaodirecao;
          if(hits[i]._source.responseBody.dissuasoes[j].hasOwnProperty("pd")) dissuasoesObject.pd = hits[i]._source.responseBody.dissuasoes[j].pd;
          if(hits[i]._source.responseBody.dissuasoes[j].hasOwnProperty("subjectNumber")) dissuasoesObject.subjectNumber = hits[i]._source.responseBody.dissuasoes[j].subjectNumber;
					if(hits[i]._source.responseBody.dissuasoes[j].hasOwnProperty("tipo")) dissuasoesObject.tipo = hits[i]._source.responseBody.dissuasoes[j].tipo;
          
          // Others? Add here

          dissuasoesObject.completeJSONObject = JSON.stringify(hits[i]._source.responseBody.dissuasoes[j]); // In case there are more fields? If not possible, delete this and dont insert in table
          var dateNow = new Date();
          var dateText = "" + dateNow.getFullYear() + "-" + padNumber((dateNow.getMonth()+1), 2) + "-" + padNumber(dateNow.getDate(), 2) + "T" + padNumber(dateNow.getHours(), 2) + ":"  + padNumber(dateNow.getMinutes(), 2) + ":" + padNumber(dateNow.getSeconds(), 2) +".000Z";
          if(debug === 1) ticket.addOutput("area:" + dissuasoesObject.area + " dateText is: " + dateText);
					dissuasoesObject.thesysDateTimestamp = dateText;
					
          if(hits[i]._source.hasOwnProperty("requestTimestamp")) 
					{
						dissuasoesObject.dataDateTimestamp = parseInt(parseInt(hits[i]._source.requestTimestamp, 0)/1000, 0);
          }
          if(hits[i]._source.hasOwnProperty("responseCode")) 
          {
            dissuasoesObject.responseCode = hits[i]._source.responseCode;
          }
          dissuasoesObjectArray.push(dissuasoesObject);
				}
      }
    }
    

  }
  
  for(var wtf = 0; wtf < dissuasoesObjectArray.length; wtf++){
    if(debug === 1) ticket.addOutput("inside obj[" + wtf + "] - area:" + dissuasoesObjectArray[wtf].area);
  }
  
  return dissuasoesObjectArray;
}
*/

function queryFramework40Prd_last5mins(ticket, elasticQuery, startDate, endDate){
  var attemptsNumberForNOK = 3;
  var nokCount = 0;
  var retrySecondsBetweenQueries = 45;
  
  var startDateText = "" + startDate.getUTCFullYear() + "-" + padNumber((startDate.getUTCMonth()+1), 2) + "-" + padNumber(startDate.getUTCDate(), 2) + "T" + padNumber(startDate.getUTCHours(), 2) + ":"  + padNumber(startDate.getUTCMinutes(), 2) + ":" + padNumber(startDate.getUTCSeconds(), 2) +".000Z";
  var endDateText = "" + endDate.getUTCFullYear() + "-" + padNumber((endDate.getUTCMonth()+1), 2)  + "-" + padNumber(endDate.getUTCDate(), 2) + "T" + padNumber(endDate.getUTCHours(), 2) + ":"  + padNumber(endDate.getUTCMinutes(), 2) + ":" + padNumber(endDate.getUTCSeconds(), 2)+".000Z";
  
  var elasticArgument ="{\"size\": 10000,\"sort\": [{\"@timestamp\":{\"order\": \"asc\",\"unmapped_type\": \"boolean\"}}],\"query\":{\"bool\": {\"must\": [{\"query_string\": {\"query\": \"_index:framework_40_logs_prd-* AND " + elasticQuery + "\",\"analyze_wildcard\": true,\"default_field\": \"*\"}},{\"range\": {\"@timestamp\": {\"gte\": \"" + startDateText + "\",\"lte\": \"" + endDateText + "\",\"format\": \"strict_date_optional_time\"}}}],\"filter\": [],\"should\": [],\"must_not\": []}}}";
  
  ticket.addOutput("startDate: " + startDateText);
  ticket.addOutput("endDate: " + endDateText);
  ticket.addOutput("query: " + elasticArgument);
  var runTicket = ModuleUtils.runFunction("/elasticNA/queryWithBody", ticket.getTheSysUser(), "framework_40_logs_prd-*", elasticArgument);
  
  // Retry schema
  for(var i = 0; i < attemptsNumberForNOK; i++)
	{
	  if (!ModuleUtils.waitForTicketsSuccess(runTicket)){
			nokCount++;
      if(nokCount === attemptsNumberForNOK)
      {
        return null;
      }
      ModuleUtils.executeFunction("/thesys/sleep", getRequestContext(), retrySecondsBetweenQueries * 1000);
		}
		else 
		{
      var jsonObj = runTicket.getResult().getObject();
      if (debug===1) ticket.addOutput("jsonObj: " + jsonObj);
			var json = JSON.parse(jsonObj);
      return json;
    }
  }
}

function padNumber(num, size) {
  num = num.toString();
  while (num.length < size) num = "0" + num;
  return num;
}


// ####################### Start module ###########################
// # Called every time module starts                              #
// # When this file is saved, thoe module is stopped and started  #
// ################################################################
function startModule() {
  logInfo("startModule", "Starting ...");

  var functions = [
    {
     name: "guidesConsult",
     path: "/dpt/guidesConsult",
     parameters: "",
     description: "Imports consult data from API ETC_GestaoDissuasao_IVR to GCP@Authors:TheSys@"
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
