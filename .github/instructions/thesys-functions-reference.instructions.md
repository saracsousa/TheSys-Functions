---
description: "Use when writing TheSys functions, BigQuery queries, TRIN/MAC API calls, Elasticsearch ETL, or registering functions in startModule. Contains the full TheSys platform API reference, conventions, and all existing functions grouped by data source."
applyTo: "**/*.js"
---
# TheSys Functions Reference

> Context document for the **Functions Architect** agent.
> Describes the TheSys function platform, its conventions, and all existing functions grouped by data source.

---

## 1. How a TheSys Function Works

### 1.1 Runtime Environment

TheSys functions are **server-side JavaScript** modules executed inside the TheSys platform (a Java-based orchestration engine). They run in a Nashorn/Rhino-like JS runtime — **not Node.js** — so:

- Use `var` (not `let`/`const`).
- No ES6+ features (no arrow functions, no template literals, no destructuring).
- **NEVER use angle brackets `<>` in string values** (e.g. `"<your_app>"`, `"<something>"`). The platform pre-processes JS files and angle brackets cause the entire module to silently fail to load — no error, no function registration, nothing appears.
- Standard Java interop is available via `ModuleUtils`, `TheSysModuleFunctionResult`, `File`, etc.
- No ES6+ features (no arrow functions, no template literals, no destructuring).
- Standard Java interop is available via `ModuleUtils`, `TheSysModuleFunctionResult`, `File`, etc.
- There is no `require()` or module import system; each `.js` file is a self-contained module.

### 1.2 File Structure (Anatomy of a Module)

Every TheSys `.js` file follows this standard skeleton:

```
┌─────────────────────────────────────────────────┐
│  1. Header & Global Variables                   │
│     - objectSpace, debug, defaultLogLevel       │
│                                                 │
│  2. Helper Functions (optional)                 │
│     - setResponse(), normalizeDate(), etc.      │
│                                                 │
│  3. Business Functions                          │
│     - The actual logic (one or more per file)   │
│                                                 │
│  4. startModule()                               │
│     - Registers functions via addFunctions()    │
│                                                 │
│  5. stopModule()                                │
│     - Cleanup on module shutdown                │
│                                                 │
│  6. Boilerplate (DO NOT MODIFY)                 │
│     - addFunctions(), removeFunctions()         │
│     - getWrapperModuleId(), getWebPortalModuleId│
│     - setupDataStoreHints(), logEvent()         │
└─────────────────────────────────────────────────┘
```

### 1.3 Function Signature

Every business function has the same signature:

```javascript
function myFunction(ticket, params) { ... }
```

| Argument | Description |
|----------|-------------|
| `ticket` | The execution context. Used for logging (`ticket.addOutput()`), getting the request context (`ticket.getRequestContext()` or `ticket.getTheSysUser()`), and setting the result. |
| `params` | An indexed list of parameters. Access via `params.get(0)`, `params.get(1)`, etc. `params.length` gives the count. |

### 1.4 Input Parsing Convention

Most AI-facing functions receive a single JSON string as the first parameter. The standard parsing pattern handles multiple input shapes:

```javascript
var rawInput = params.get(0);
var parsedInput = null;
try {
  var jsonObject = JSON.parse(rawInput);
  // Handle array (THESYS.ALLPARAMETERS.JSON wraps args in an array)
  if (Array.isArray(jsonObject) && jsonObject.length >= 1) {
    parsedInput = jsonObject[0];
  } else {
    parsedInput = jsonObject;
  }
} catch (e) {
  // Not JSON — treat as plain string
  parsedInput = rawInput ? rawInput.trim() : "";
}
```

Key points:
- When parameters are declared as `THESYS.ALLPARAMETERS.JSON*string`, the platform may wrap arguments in a JSON array.
- Always support both JSON object (`{"cell": "XYZ"}`) and plain string (`"XYZ"`) inputs.
- Always support `input` as a generic key (used by AI/MCP callers): `parsedInput.input || parsedInput.cell || ""`.

### 1.5 Output / Return Convention

Functions return results by setting the ticket result object:

```javascript
// Success
var result = { content: <data>, logs: "Found N records" };
ticket.getResult().setObject(JSON.stringify(result));
ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_OK);

// Failure
ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
```

The standard return shape is:
```json
{
  "content": "<actual data — array of objects, string, etc.>",
  "logs": "<human-readable summary of what happened>"
}
```

Some functions use an alternative `setResponse()` helper:
```javascript
function setResponse(ticket, message, content, errorCode, result, httpCode) { ... }
```

### 1.6 Function Registration (startModule)

Functions are exposed to the platform (and AI agents) via `startModule()`:

```javascript
function startModule() {
  var functions = [
    {
      name: "myFunction",              // JS function name
      path: "/ai/myapp/myFunction",    // URL path for invocation
      parameters: "THESYS.ALLPARAMETERS.JSON*string",  // Parameter declaration
      description: "What this function does @Authors:AuthorName@"
    }
  ];
  addFunctions(functions, true);
  removeFunctions(functions);
}
```

| Field | Description |
|-------|-------------|
| `name` | Must match the JavaScript function name exactly. |
| `path` | The URL-like path used to call the function (e.g., `/ai/guides/guiasAtivas`). Convention: `/ai/<app>/<functionName>` for AI-callable functions. |
| `parameters` | Parameter declaration. Common patterns: `""` (no params), `"input*string"` (one string), `"THESYS.ALLPARAMETERS.JSON*string"` (full JSON), `"a*integer,b*integer"` (typed params). |
| `description` | Human-readable description. Author tag format: `@Authors:Name@`. |

### 1.7 Calling Other TheSys Functions

Use `ModuleUtils.runFunction()` to call other platform functions:

```javascript
var runTicket = ModuleUtils.runFunction(
  "/path/to/function",
  ticket.getRequestContext(),  // or ticket.getTheSysUser()
  arg1, arg2, ...
);
if (!ModuleUtils.waitForTicketsSuccess(runTicket)) {
  // Handle failure
}
var result = runTicket.getResult().getObject();
```

### 1.8 Common Data Source Patterns

| Data Source | How to Call | Example |
|-------------|-------------|---------|
| **BigQuery (GCP)** | `ModuleUtils.runFunction("/bigquery/executeQuery", "MONIT", sqlQuery, getRequestContext())` | Query returns `{Result: [...], Error: "..."}` |
| **TRIN / MAC (Activities API)** | `ModuleUtils.runFunction("/mac/activities/search", ticket.getRequestContext(), JSON.stringify(query))` | Query returns array or `{data_output: {result: [...]}}` |
| **Elasticsearch** | `ModuleUtils.runFunction("/elasticNA/queryWithBody", ticket.getTheSysUser(), indexName, bodyJson)` | Returns `{hits: {hits: [...]}}` |
| **EuGenIA API (Logos)** | `ModuleUtils.runFunction("/ps/eugenia/logo/list", ticket.getTheSysUser())` | Returns `{result_data: {data: [...]}}` |
| **Network Utils** | `ModuleUtils.runFunction("/netutils/ip/pingc", ticket.getRequestContext(), ip, count)` | Output via `runTicket.getOutputSize()` / `.getOutput(idx)` |
| **DataStore** | `ModuleUtils.runFunction("/datastore/setFieldProperty", getRequestContext(), space, field, hint)` | Key-value store |

### 1.9 Logging & Debugging

```javascript
ticket.addOutput("myFunction: message");       // Runtime output (visible in console)
logInfo("context", "message");                  // Platform log (INFO level)
logWarning("context", "message");               // Platform log (WARNING level)
logEvent(user, "ACTION_NAME", {data});          // Audit event
```

### 1.10 Web Portal / Menu Integration

Functions can be exposed as web portal menu entries with HTML output using the `/*!INLINE! ... !INLINE!*/` comment syntax for inline HTML, and adding a `menu` property to the registration:

```javascript
{
  name: "demoMenu1",
  path: "/demo/portal/menu1",
  parameters: "THESYS.ALLPARAMETERS.JSON*string",
  description: "Menu entry function",
  menu: { path: "Category|SubMenu" }
}
```

---

## 2. Functions by Data Source

### 2.1 BigQuery (GCP) — Query Functions

These functions build SQL queries and execute them against Google BigQuery via `/bigquery/executeQuery`.

#### `getGuiasAtivas` — Currently Open Guides
- **File:** `EuGenIA_guias_ativas.js`
- **Path:** `/ai/guides/guiasAtivas`
- **Parameters:** `THESYS.ALLPARAMETERS.JSON*string`
- **Input:** Optional JSON `{"cell": "XYZ"}` or `{"itsm_id": "INC..."}` or empty for all
- **What it does:** Retrieves currently open guides (where `end_time IS NULL`) from `guias.consults_final`, enriched with data from `kpis_os.guias`, dissuasion prompt descriptions, incidents, and TRIN ID mappings.
- **BigQuery tables:**
  - `ops-dpt-lab-204386.guias.consults_final`
  - `ops-reporting-p-448320.kpis_os.guias`
  - `ops-reporting-p-448320.kpis_os_archive.guias_dissuation_prompt_description`
  - `ops-dpt-lab-204386.indisponibilidades.incidentes`
  - `networkanalytics-p-292818.trin.incident`
  - `networkanalytics-p-292818.trin.change`
- **Returns:** `cell, start_time, itsm_id, trin_id, type, dissuassion_prompt, process, use_case, tecnologia, parque_cnd, parque_pings, dia_inc_chg, minutos_sem_guia`

#### `getGuiasHistoricoByIncOrChg` — Historical Guides by Incident/Change
- **File:** `EuGenIA_guias_ativas.js`
- **Path:** `/ai/guides/guiasHistoricoByIncOrChg`
- **Parameters:** `THESYS.ALLPARAMETERS.JSON*string`
- **Input:** Plain string with incident/change ID (e.g., `"INC000180875604"`, `"CRQ000002920402"`, `"CHG000001234567"`)
- **What it does:** Retrieves historical guide records by ITSM or TRIN ID. INC searches both; CRQ searches itsm_id only; CHG searches trin_id only.
- **BigQuery tables:**
  - `ops-dpt-lab-204386.indisponibilidades.guias`
  - `networkanalytics-p-292818.trin.incident`
  - `networkanalytics-p-292818.trin.change`

#### `getGuiasHistoricoByCellDate` — Historical Guides by Cell and Date
- **File:** `EuGenIA_guias_ativas.js`
- **Path:** `/ai/guides/guiasHistoricoByCellDate`
- **Parameters:** `THESYS.ALLPARAMETERS.JSON*string`
- **Input:** `"CELL,DD-MM-YYYY"` (cell + from-date) or `"CELL"` (last 30 days). Cell <=3 chars = area prefix search; >3 chars = exact match.
- **What it does:** Retrieves historical guides filtered by cell/area and optional start date.

#### `getParqueByCell` — Equipment Park by Cell
- **File:** `EUGenIA_cadastro_centralizado.js`
- **Path:** `/ai/nexus/getParqueByCell`
- **Parameters:** `THESYS.ALLPARAMETERS.JSON*string`
- **Input:** Optional cell name filter (e.g., `"LSB01"` or `"LSB%"` or empty for all)
- **What it does:** Retrieves device/account/SA counts per cell from the pre-computed parques table.
- **BigQuery table:** `ops-dpt-lab-204386.problem_management.parques_celulas`
- **Returns:** `cell, PINGs_number_of_devices, CRAMER_number_of_accounts, CND_number_of_SAs`

#### `getParqueByCMTSOrOLT` — Equipment Park by CMTS/OLT
- **File:** `EUGenIA_cadastro_centralizado.js`
- **Path:** `/ai/nexus/getParqueByCMTSOrOLT`
- **Parameters:** `THESYS.ALLPARAMETERS.JSON*string`
- **Input:** Optional equipment name filter (e.g., `"VNG2208-1_POLT_1"` or empty for all). Handles underscore-variant OLT names.
- **What it does:** Retrieves device/account/SA counts per OLT or CMTS equipment.
- **BigQuery table:** `ops-dpt-lab-204386.problem_management.parque_cmts_olt`
- **Returns:** `equipment, PINGs_number_of_devices, CRAMER_number_of_accounts, CND_number_of_SAs`
- **Note:** `CRAMER_number_of_accounts` is NULL for HFC/CMTS equipment by design.

#### `getModelsByCell` — STB/HGW Model Breakdown by Cell
- **File:** `EUGenIA_cadastro_centralizado.js`
- **Path:** `/ai/nexus/getModelsByCell`
- **Parameters:** `THESYS.ALLPARAMETERS.JSON*string`
- **Input:** Optional cell name filter
- **What it does:** Retrieves distinct service account counts per STB and HGW model, grouped by cell.
- **BigQuery tables:**
  - `ops-dpt-lab-204386.topology.ftth_tabela_centralizada_cadastro`
  - `ops-dpt-lab-204386.topology.hfc_tabela_centralizada_cadastro`
- **Returns:** `celula, clientes_parque, model_type (STB/HGW), model_name, model_count, data_info`

#### `getModelsByCMTSOrOLT` — STB/HGW Model Breakdown by Equipment
- **File:** `EUGenIA_cadastro_centralizado.js`
- **Path:** `/ai/nexus/getModelsByCMTSOrOLT`
- **Parameters:** `THESYS.ALLPARAMETERS.JSON*string`
- **Input:** Optional equipment name filter
- **What it does:** Same as `getModelsByCell` but grouped by OLT/CMTS equipment instead of cell.
- **Returns:** `equipment, clientes_parque, model_type, model_name, model_count, data_info`

#### `getTemperaturasSalasTecnicas` — Technical Room Temperatures
- **File:** `EuGenIA_CoolOps_last_temperature.js`
- **Path:** `/ai/coolops/temperaturasSalasTecnicas`
- **Parameters:** `THESYS.ALLPARAMETERS.JSON*string`
- **Input:** Optional JSON `{"sala": "MHE"}` or sensor name `"IMO1SENS0001"` or empty for all
- **What it does:** Retrieves latest temperature readings for datacenter/technical rooms from BigQuery, joining with a hardcoded sensor mapping table. Filters by `ci_name` (if input starts with "IMO1") or by `sala` (room name).
- **BigQuery table:** `ops-dpt-lab-204386.cool_ops.temperaturas_salas_tecnicas`
- **Returns:** `ci_name, sala, fila, temperature, timestamp`

#### `investigationByTrinId` — Investigation by TRIN ID
- **File:** `EuGenIA_Navigator_INVs.js`
- **Path:** `/ai/sara/investigationsByTrinId`
- **Parameters:** `input*string,extra*string`
- **Input:** JSON `{"trin_id": "INV-0006018"}` or plain string
- **What it does:** Retrieves the most recent investigation row from BigQuery by trin_id, using `QUALIFY ROW_NUMBER()` to get the latest by `updated_date`.
- **BigQuery table:** `networkanalytics-p-292818.trin.investigation`

---

### 2.2 TRIN / MAC (Activities API) — Functions That Query the Activities Platform

These functions use `/mac/activities/search` to query investigation, E2E request, and other activity templates.

#### `aiToolsTrinInvestigations` — Investigation Status Overview
- **File:** `EuGenIA_Status_INVs.js`
- **Path:** `/ai/sara/overviewInvestigations`
- **Parameters:** `input*string`
- **Input:** Optional JSON (currently unused filters)
- **What it does:** Retrieves all open (not CLOSED/CANCELLED) Investigations from the MAC activities API. Returns total count, count by priority (High/Medium/Low), a list of high-priority investigations, and steering_check count/list.
- **API filter:** `template_name=~eq~Investigation & status=~neq~CLOSED & status=~neq~CANCELLED`
- **Returns:** `{ total_count, priority_counts, high_priority_list, steering_check_count, steering_check_list }`

#### `staleInvestigationsByUser` — Stale Investigations per User
- **File:** `EuGenIA_Audit_Control_INV.js`
- **Path:** `/ai/sara/staleInvestigationsByUser`
- **Parameters:** `input*string`
- **Input:** JSON `{"owner_user_username": "john.doe"}` or plain string username
- **What it does:** Lists open investigations not updated in 3+ months for a given owner username. Uses epoch timestamp comparison.
- **API filter:** `template_name=~eq~Investigation & status != CLOSED/CANCELLED & owner_user.username = <input>`
- **Returns:** `{ owner_user_username, cutoff_timestamp, stale_count, stale_investigations: [{_trin_id, status, priority, _updated_date, description, owner_user}] }`

#### `aiToolsE2ERequestById` — E2E Request by ID
- **File:** `Maggie_E2E_requests.js`
- **Path:** `/ai/e2e/e2eRequestById`
- **Parameters:** `input*string`
- **Input:** JSON `{"request_id": "DGA-0015933"}` or plain string
- **What it does:** Retrieves an E2E Request activity by its TRIN ID. Returns all fields: status, priority, request_type, platform, disclaimer, etc.
- **API filter:** `template_name=~eq~E2E Requests & _trin_id=~eq~<requestId>`
- **Returns:** Full activity object with all fields.

---

### 2.3 Elasticsearch — Ingestion / ETL Functions

These functions query Elasticsearch indices and push data into BigQuery. They are typically scheduler-driven (not AI-callable).

#### `guidesConsult` — Guides Consult Ingest (Elastic → GCP)
- **File:** `guidesConsult.js`
- **Path:** (scheduler function)
- **Schedule:** Every 5 minutes
- **What it does:** Queries the `framework_40_logs_prd-*` Elasticsearch index for guide consult API calls from the last 5 minutes, parses the response body to extract dissuasion data, and batch-inserts into BigQuery.
- **Elastic index:** `framework_40_logs_prd-*`
- **BigQuery target:** `guias.guias_consults`
- **Pattern:** Query Elastic → Parse hits → Batch INSERT into GCP (150 rows per batch)

#### `kristinStatusIngest` — Device Status Ingest (Elastic → GCP)
- **File:** `kristin_status_ingest.js`
- **Path:** `/dpt/kristinStatusIngest`
- **Schedule:** Every 2 hours
- **What it does:** Queries the `auto_kristin_devices_status` Elasticsearch index for device status data in a 2h30m window (2h cycle + 30min safety buffer), then uses DELETE + INSERT strategy to ingest into BigQuery without duplicates.
- **Elastic index:** `auto_kristin_devices_status`
- **BigQuery target:** `ops-dpt-lab-204386.status_fixo.kristin_status_2h`
- **Fields ingested:** `event_timestamp, concelho, device_mac, device_model, distrito, olt_node_name, ont_mac, ont_model, plc_netname, rede_ftth, service_account, splitter1_netname, splitter2_netname, state`
- **Pattern:** Query Elastic → Parse hits → DELETE overlapping window from GCP → Batch INSERT

---

### 2.4 EuGenIA Internal API — Platform Management Functions

#### `setAllInactive` — Deactivate All EuGenIA Logos
- **File:** `EuGenIA_Logo_Manager.js`
- **Path:** `/dpt/sara/setAllInactive`
- **Parameters:** none
- **What it does:** Calls `/ps/eugenia/logo/list` to get all logos, then iterates and calls `/ps/eugenia/logo/setinactive` for each one.

#### `setActiveRegularEugenias` — Activate Standard EuGenIA Logos
- **File:** `EuGenIA_Logo_Manager.js`
- **Path:** `/dpt/sara/setActiveRegularEugenias`
- **Parameters:** none
- **What it does:** Sets EuGenIA logos with IDs 2-7 to active by calling `/ps/eugenia/logo/setactive`.

---

### 2.5 Demo / Test Functions

#### `getPortugueseDishes` — Test Function (Static Data)
- **File:** `função_skills.js`
- **Path:** `/skills/getPortugueseDishes`
- **Parameters:** `input*string, extra*string`
- **What it does:** Returns a hardcoded list of 15 traditional Portuguese dishes. Used for testing function structure and AI integration.

#### Boilerplate Demo Functions (present in most files, usually commented out)
- `helloWorld` — Prints "Hello world!"
- `sumAPlusB` — Sums two numbers
- `demoMenu1` — Web portal form demo
- `demoMenuPing` — Web portal ping tool
- `demoMenuUploadFile` — Web portal file upload demo

---

## 3. Common Patterns & Best Practices

### 3.1 Standard Input Parsing Template

```javascript
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

// Extract filter value
var filterValue = "";
if (parsedInput !== null && parsedInput !== undefined) {
  if (typeof parsedInput === "object") {
    filterValue = parsedInput.input || parsedInput.<specific_key> || "";
  } else {
    filterValue = ("" + parsedInput).trim();
  }
}
```

### 3.2 Standard BigQuery Query Template

```javascript
var sql_query = 'SELECT ... FROM `project.dataset.table` WHERE ...';
var runTicketGCP = ModuleUtils.runFunction("/bigquery/executeQuery", "MONIT", sql_query, getRequestContext());
if (!ModuleUtils.waitForTicketsSuccess(runTicketGCP)) {
  result.logs = "ERROR: Query failed";
  ticket.getResult().setObject(JSON.stringify(result));
  ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
  return;
}
var data_runTicketGCP = JSON.parse(runTicketGCP.getResult().getObject());
if (data_runTicketGCP.Result === undefined) {
  result.logs = "ERROR: " + data_runTicketGCP.Error;
  // handle error...
  return;
}
result.content = data_runTicketGCP.Result;
```

### 3.3 Standard MAC/TRIN Activities Query Template

```javascript
var q = {
  skip: 0,
  limit: 1000,
  sort_order: -1,
  sort_field: "_created_date",
  filters: ["template_name=~eq~<TemplateName>&status=~neq~CLOSED"],
  return_fields: ""
};
var runTicket = ModuleUtils.runFunction('/mac/activities/search', ticket.getRequestContext(), JSON.stringify(q));
```

### 3.4 Standard Elasticsearch Query Template

```javascript
var elasticArgument = '{"size": 10000, "sort": [...], "query": {"bool": {"must": [...]}}}';
var runTicket = ModuleUtils.runFunction("/elasticNA/queryWithBody", ticket.getTheSysUser(), indexName, elasticArgument);
```

### 3.5 JSON Sanitization (Locale Safety)
Always run this before returning JSON to handle locale-specific decimal separators:
```javascript
resultJson = resultJson.replace(/"(\d+),(\d+)"/g, '"$1.$2"');
```

### 3.6 Naming Conventions

| Convention | Example |
|-----------|---------|
| AI-callable function path | `/ai/<app>/<functionName>` |
| Scheduler/internal function path | `/dpt/<functionName>` |
| Skills/demo function path | `/skills/<functionName>`, `/demo/<functionName>` |
| BigQuery project IDs | `ops-dpt-lab-204386`, `ops-reporting-p-448320`, `networkanalytics-p-292818` |

---

## 4. Quick Reference: All Registered Functions

| Function | Path | File | Data Source | Type |
|----------|------|------|-------------|------|
| `getGuiasAtivas` | `/ai/guides/guiasAtivas` | EuGenIA_guias_ativas.js | BigQuery | AI Query |
| `getGuiasHistoricoByIncOrChg` | `/ai/guides/guiasHistoricoByIncOrChg` | EuGenIA_guias_ativas.js | BigQuery | AI Query |
| `getGuiasHistoricoByCellDate` | `/ai/guides/guiasHistoricoByCellDate` | EuGenIA_guias_ativas.js | BigQuery | AI Query |
| `getParqueByCell` | `/ai/nexus/getParqueByCell` | EUGenIA_cadastro_centralizado.js | BigQuery | AI Query |
| `getParqueByCMTSOrOLT` | `/ai/nexus/getParqueByCMTSOrOLT` | EUGenIA_cadastro_centralizado.js | BigQuery | AI Query |
| `getModelsByCell` | `/ai/nexus/getModelsByCell` | EUGenIA_cadastro_centralizado.js | BigQuery | AI Query |
| `getModelsByCMTSOrOLT` | `/ai/nexus/getModelsByCMTSOrOLT` | EUGenIA_cadastro_centralizado.js | BigQuery | AI Query |
| `getTemperaturasSalasTecnicas` | `/ai/coolops/temperaturasSalasTecnicas` | EuGenIA_CoolOps_last_temperature.js | BigQuery | AI Query |
| `investigationByTrinId` | `/ai/sara/investigationsByTrinId` | EuGenIA_Navigator_INVs.js | BigQuery | AI Query |
| `aiToolsTrinInvestigations` | `/ai/sara/overviewInvestigations` | EuGenIA_Status_INVs.js | TRIN/MAC API | AI Query |
| `staleInvestigationsByUser` | `/ai/sara/staleInvestigationsByUser` | EuGenIA_Audit_Control_INV.js | TRIN/MAC API | AI Query |
| `aiToolsE2ERequestById` | `/ai/e2e/e2eRequestById` | Maggie_E2E_requests.js | TRIN/MAC API | AI Query |
| `guidesConsult` | (scheduler) | guidesConsult.js | Elastic → GCP | ETL/Ingest |
| `kristinStatusIngest` | `/dpt/kristinStatusIngest` | kristin_status_ingest.js | Elastic → GCP | ETL/Ingest |
| `setAllInactive` | `/dpt/sara/setAllInactive` | EuGenIA_Logo_Manager.js | EuGenIA API | Management |
| `setActiveRegularEugenias` | `/dpt/sara/setActiveRegularEugenias` | EuGenIA_Logo_Manager.js | EuGenIA API | Management |
| `getPortugueseDishes` | `/skills/getPortugueseDishes` | função_skills.js | Static | Demo/Test |
