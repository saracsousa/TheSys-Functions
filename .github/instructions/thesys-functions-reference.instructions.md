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

#### `contagemSAsPorLocalidade` — SA Counts by Location (Distrito/Concelho/Freguesia)
- **File:** `contagemSAsPorLocalidade.js`
- **Path:** `/ai/cadastro/contagemSAsPorLocalidade`
- **Parameters:** `THESYS.ALLPARAMETERS.JSON*string`
- **Input:** Optional JSON `{"distrito": "...", "concelho": "...", "freguesia": "..."}`
- **What it does:** Counts distinct service accounts grouped by distrito, concelho, and freguesia. Unions data from both HFC and FTTH cadastro tables. Supports optional filters.
- **BigQuery tables:**
  - `ops-dpt-lab-204386.topology.hfc_tabela_centralizada_cadastro` (partitioned by `day_part`)
  - `ops-dpt-lab-204386.topology.ftth_tabela_centralizada_cadastro` (partitioned by `day_part`)
- **Partition filter:** `day_part >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 DAY)` — applied inside each SELECT of the UNION
- **Returns:** `{ por_distrito: [{distrito, count_sa}], por_concelho: [{distrito, concelho, count_sa}], por_freguesia: [{distrito, concelho, freguesia, count_sa}] }`

#### `listarContagensSAs` — Distinct SA Counts by Distrito/Concelho/Freguesia
- **File:** `ListarContagensSAs.js`
- **Path:** `/ai/teste/listarContagensSAs`
- **Parameters:** `THESYS.ALLPARAMETERS.JSON*string`
- **Input:** None required (no filters)
- **What it does:** Counts distinct service accounts grouped by `distrito_cliente`, `concelho_cliente`, and `freguesia_cliente`. Unions data from both HFC and FTTH cadastro tables.
- **BigQuery tables:**
  - `ops-dpt-lab-204386.topology.hfc_tabela_centralizada_cadastro` (partitioned by `day_part`)
  - `ops-dpt-lab-204386.topology.ftth_tabela_centralizada_cadastro` (partitioned by `day_part`)
- **Partition filter:** `day_part >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 DAY)` — applied inside each SELECT of the UNION
- **Returns:** `[{distrito_cliente, concelho_cliente, freguesia_cliente, distinct_sa_count}]`

#### `listarContagensSAsPorLocalidade` — Distinct SA Counts by Location with Filtering
- **File:** `listarContagensSAsPorLocalidade.js`
- **Path:** `/ai/greatops/listar_contagens_sa_por_localidade`
- **Parameters:** `THESYS.ALLPARAMETERS.JSON*string`
- **Input:** Plain string (e.g. `"ALMADA"`) searches across distrito, concelho, and freguesia (case-insensitive). JSON object `{"distrito": "...", "concelho": "...", "freguesia": "..."}` filters specific columns. Empty for all.
- **What it does:** Counts distinct service accounts grouped by distrito, concelho, and freguesia. Unions data from both HFC and FTTH cadastro tables. Applies the input as a filter on the location columns using case-insensitive exact match. Filters empty/null service accounts.
- **BigQuery tables:**
  - `ops-dpt-lab-204386.topology.hfc_tabela_centralizada_cadastro` (partitioned by `day_part`)
  - `ops-dpt-lab-204386.topology.ftth_tabela_centralizada_cadastro` (partitioned by `day_part`)
- **Partition filter:** `day_part >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 DAY)` — applied inside each SELECT of the UNION
- **Returns:** `[{distrito, concelho, freguesia, SAs}]`

#### `navigationLogsUltimoDayPartPorTecnologia` — Last Day Part per Technology
- **File:** `navigationLogsUltimoDayPartPorTecnologia.js`
- **Path:** `/ai/greatops/navigation_logs_ultimo_day_part_por_tecnologia`
- **Parameters:** `THESYS.ALLPARAMETERS.JSON*string`
- **Input:** None required
- **What it does:** Returns the most recent `day_part` and its `count_chamadas` for each `tecnologia` in the navigation logs aggregation table. Uses `ROW_NUMBER() OVER (PARTITION BY tecnologia ORDER BY day_part DESC)` to get the latest row per technology, filtered to the last 30 days.
- **BigQuery table:** `ops-dpt-lab-204386.indisponibilidades.navigation_logs_agg1d`
- **Partition filter:** `day_part >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)` (inside subquery)
- **Returns:** `[{tecnologia, ultimo_day_part, count_chamadas}]`

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

### 2.6 MasterDB — CI Management & AI Tools (`masterdb-agent-tools.js`)

These functions query and manage Configuration Items (CIs) in the MasterDB platform via `/masterdb/ci/search`, `/masterdb/ci/find`, `/masterdb/ci/update`, and related endpoints. All share the pattern `params*string` (single JSON argument). All are in `reference/masterdb-agent-tools.js`.

#### `aiToolsMasterDBFind` — Generic CI Search with Full Fallback
- **Path:** `/ai/tools/masterdb/find`
- **Input:** JSON with any CI attribute filter plus optional control fields (`limit`, `sort_field`, `sort_order`, `return_fields`, `items`, `status`).
- **What it does:** Searches CIs with a 3-phase fallback: (1) exact query, (2) case variations on attribute values, (3) alternative attribute names (e.g. `manufacturer` → `vendor`). If 0 results after fallback, suggests similar values via distinct+like queries. Supports `items` as AND string or array. Strips `fields.` prefix from attribute names. Default `status=Deployed`; use `status=ALL` to disable.
- **Returns:** `{ content: { results, total, query_used, fallback_applied, suggestions }, logs }`

#### `aiToolsMasterDBFindEnergyInfra` — Energy Infrastructure CI Search
- **Path:** `/ai/tools/masterdb/find/EnergyInfra`
- **Input:** JSON with any CI attributes (dynamically inferred as filters). Optional `status` (default `Deployed`).
- **What it does:** Searches energy-infrastructure CIs. Builds the filter query dynamically from all provided JSON keys (excluding `limit`, `sort_*`, `return_fields`). Intended for UPS, PDU, and related energy infrastructure equipment.
- **Returns:** `{ content, logs }`

#### `aiToolsMasterDBFindEnergyGenerator` — Energy Generator CI Search
- **Path:** `/ai/tools/masterdb/find/EnergyGenerator`
- **Input:** JSON with any CI attribute filters.
- **What it does:** Searches generator CIs in MasterDB. Same dynamic filter logic as `FindEnergyInfra`.
- **Returns:** `{ content, logs }`

#### `aiToolsMasterDBFindEnergySupplier` — Energy Supplier CI Search
- **Path:** `/ai/tools/masterdb/find/EnergySupplier`
- **Input:** JSON with any CI attribute filters.
- **What it does:** Searches energy supplier CIs (electricity providers, connections) in MasterDB.
- **Returns:** `{ content, logs }`

#### `aiToolsMasterDBFindSupport` — Support / Energy Autonomy CI Search
- **Paths:** `/ai/tools/masterdb/find/Support` AND `/ai/tools/masterdb/find/EnergyAutonomy` (same function, registered twice)
- **Input:** JSON with any CI attribute filters.
- **What it does:** Searches support and energy autonomy CIs (batteries, autonomy records). Same dynamic filter pattern.
- **Returns:** `{ content, logs }`

#### `aiToolsMasterDBGeoSearch` — Geographic CI Search
- **Path:** `/ai/tools/masterdb/GEOSearch`
- **Input:** JSON with any combination of: `latitude`+`longitude`, `district`, `concelho`/`municipality`, `trigram`, `ci_classification`, `ci_name`, `site_type`, `address`, `postal_code`, `radius_meters`, `status`, `limit`, `return_fields`.
- **What it does:** Resolves CIs by geographic criteria. For `TECHNICAL_ROOM`: multi-strategy search via address fields, coords (rounded by precision derived from radius), or site trigram. For other CIs: resolves by coords → concelho trigram → direct trigram → district trigramlist → ci_name lookup with site/TR coordinates fallback. Deduplicates by `ci_name`.
- **Returns:** `{ content: { results, strategy, count }, logs }`

#### `aiToolsMasterDBTemplateAttributesGet` — Template Attribute Schema
- **Path:** `/ai/tools/masterdb/find/TemplateAttributes`
- **Input:** JSON with `ci_classification` (required) and optional filters.
- **What it does:** Retrieves the attribute schema (field names, types, required flags) for a given CI classification template from MasterDB.
- **Returns:** `{ content: { attributes: [...] }, logs }`

#### `aiToolsMasterDBClassificationsGet` — List All CI Classifications
- **Path:** `/ai/tools/masterdb/find/Classifications`
- **Input:** Optional JSON (currently unused; params logged only).
- **What it does:** Calls `/masterdb/ci/classifications` to retrieve the full list of available CI classification types.
- **Returns:** `{ content: { classifications: [...] }, logs }`

#### `aiToolsMasterDBDependencySearch` — CI Dependency Graph Search
- **Path:** `/ai/tools/masterdb/find/DependencySearch`
- **Input:** JSON with `ci_name` or `ip`/`ip_address`, optional `classifications` (pipe or comma-separated), `depth`, `direction` (`L2R`/`R2L`/`BOTH`), `limit`, `status`.
- **What it does:** Traverses the MasterDB dependency graph from a given CI. Supports multi-classification filtering. Extracts IP addresses from `network.addresses`. Returns dependency tree with CI details.
- **Returns:** `{ content: { source_ci, dependencies: [...], total }, logs }`

#### `aiToolsMasterDBImpact` — CI Impact Analysis
- **Path:** `/ai/tools/masterdb/find/Impact`
- **Input:** JSON with `ci_name` (or `ci_names` array), optional `ci_classification`, `depth` (default 3), `direction` (default `L2R`), `by` (`name`/`id`), `status`.
- **What it does:** Performs impact analysis by traversing dependencies from a given CI. Identifies which CIs would be affected (downstream) or what a CI depends on (upstream). Returns impact tree and summary.
- **Returns:** `{ content: { source, impact_tree, affected_count }, logs }`

#### `aiToolsMasterDBExportEmailCSV` — Export CI Search Results as CSV via Email
- **Path:** `/ai/tools/masterdb/export/EmailCsv`
- **Input:** JSON with `filters` (search criteria), `return_fields`, `email` (recipient), `subject`, optional `limit` and `filename`.
- **What it does:** Executes a paginated CI search (all pages up to limit), converts results to CSV, saves to local storage, and sends via email. Validates email format. Uses `getValueFromPath` to flatten nested fields.
- **Returns:** `{ content: { sent, recipient, rows_exported, filename }, logs }`

#### `aiToolsMasterDBNetworkIPGet` — CI Network & IP Information
- **Path:** `/ai/tools/masterdb/find/NetworkIPGet`
- **Input:** JSON with `ci_name` or IP filter criteria, optional `return_fields`, `limit`, `status`.
- **What it does:** Retrieves network and IP address information for CIs. Extracts `network.addresses`, identifies SSH-capable addresses (checks `properties` array), and returns structured IP data.
- **Returns:** `{ content: { results: [{ci_name, addresses, ssh_ips}], total }, logs }`

#### `aiToolsMasterDBFindAttributeValues` — Distinct Attribute Values Discovery
- **Path:** `/ai/tools/masterdb/find/AttributeValues`
- **Input:** JSON with `attribute` (required), optional `ci_classification`, `value_filter` (like), `status`, `limit`.
- **What it does:** Queries MasterDB to find all distinct values for a given CI attribute. Removes diacritics for normalization. Useful for building filter dropdowns or discovering valid enum values.
- **Returns:** `{ content: { attribute, distinct_values: [...], count }, logs }`

#### `aiToolsMasterDBCockpitFindData` — Monitoring Cockpit Data Retrieval
- **Path:** `/ai/tools/masterdb/find/CockpitData`
- **Input:** JSON with `object` (required, e.g. `masterdb.ftth.topologyAnalysis`), optional `space` (default `dummy`), `row`, `column`, `period` (default `86400`), `backoff` (default `86400`).
- **What it does:** Calls `/mon/dataserver/finddata` to retrieve pre-computed cockpit metrics/aggregations from the TheSys monitoring dataserver. Used to fetch topology analysis, compliance summaries, backup stats, etc.
- **Returns:** `{ content: { data, object, row, column }, logs }`

#### `aiToolsMasterDBUpdate` — Update CI Attributes
- **Path:** `/ai/tools/masterdb/update`
- **Input:** JSON with `ci_name` (required), `ci_classification` (required), `attributes` (object with key-value pairs to update), optional `dry_run` (default `true`).
- **What it does:** Updates CI attributes in MasterDB. Enforces a security blacklist (`_id`, `ci_name`, `ci_classification`, audit fields — cannot be modified). Supports nested attribute paths (dot notation). Retries up to 3 times on failure. Fetches current CI state before update for audit trail.
- **Returns:** `{ content: { ci_name, updated_attributes, dry_run, previous_values }, logs }`

#### `aiToolsMasterDBFindTransformations` — List & Filter Transformation Rules
- **Path:** `/ai/tools/masterdb/find/Transformations`
- **Input:** Optional JSON with `filter_field`, `filter_value`, `output_field`, `output_value`, `limit` (default `100`), `show_stats` (default `true`).
- **What it does:** Retrieves transformation rules from `/masterdb/admin/transform/list`. Supports filtering by input/output field and value. Returns stats (total, by type) and matched transformations.
- **Returns:** `{ content: { total, stats, transformations: [...] }, logs }`

#### `aiToolsMasterDBTransformAdd` — Add / Update Transformation Rules
- **Path:** `/ai/tools/masterdb/update/Transformations`
- **Input:** JSON with transformation rule fields: `input_field`, `input_value`, `output_field`, `output_value`, `type`, optional `description`, `dry_run` (default `true`).
- **What it does:** Creates or updates a MasterDB transformation rule via `/masterdb/admin/transform/add`. Supports query-string format in addition to JSON. Uses similarity threshold (`0.7`) to detect near-duplicate rules before adding. Retries on failure.
- **Returns:** `{ content: { action, rule, similar_rules }, logs }`

#### `aiToolsMasterDBComplianceSearch` — CI Compliance Status Analysis
- **Path:** `/ai/tools/masterdb/find/Compliances`
- **Input:** JSON with optional `ci_classification`, `compliance_check` (e.g. `tenable`, `antivirus`), `compliance_state` (0–4 or string), `os`, `mode` (`summary`/`list`/`count`), `limit`, `status`.
- **What it does:** Analyses the `compliances` attribute of CIs. States: 0=UNDEFINED, 1=IMPLEMENTED, 2=NOT_IMPLEMENTED, 3=IGNORED, 4=IMPLEMENTATION. Returns aggregated summary by classification+check+state, or CI list in `list` mode.
- **Returns:** `{ content: { mode, total_cis_with_compliances, compliance_summary, classifications_with_compliances, items (list mode), count (count mode) }, logs }`

#### `aiToolsMasterDBFindLocationGeoInfo` — Resolve Geo Info from Location Value
- **Path:** `/ai/tools/masterdb/find/LocationGeoInfo`
- **Input:** JSON with `location` (required, e.g. `POVOASANTOADRIAOMSC`).
- **What it does:** 3-step resolution: (1) Find CIs with `location=~eq~<value>`, extract a `site` with valid format (2–5 letters + digit, e.g. `OEI32`, `ODV2-1`). (2) Extract site prefix (part before first `-`). (3) Search `TECHNICAL_ROOM` with `ci_name=~like~<prefix>-` and extract `location_details.address`. Groups by distinct address.
- **Returns:** `{ content: { location, site_raw, site_prefix, technical_rooms: [{ci_names, country, concelho, district, address, coordinates}] }, logs }`

#### `aiToolsMasterDBGetODFChain` — FTTH ODF Chain Traversal
- **Path:** `/ai/tools/masterdb/ftth/GetODFChain`
- **Input:** JSON with `ci_name` (required), optional `ci_classification`, `depth` (default `4`), `status`.
- **What it does:** Navigates the FTTH ODF_CHAIN dependency from any CI (PLC, ONT, SPLITTER, ODF). Auto-detects entry type: Case A (CI is ODF → SPMs + N3s), Case B (CI has ODF_CHAIN R2L with ODFs → fetch each ODF + SPMs), Case C (no ODF_CHAIN → DEFAULT R2L search for N3s → apply Case B). All port parameters (`port_out`, `odf_in_port`, `odf_out_port`) are fetched via `ci/find?_relations=true`.
- **Returns:** `{ content: { source_ci_name, source_ci_classification, odf_count, odf_connections: [{odf_ci_name, spm_connections, n3_connections}] }, logs }`

#### `aiToolsMasterDBRiskUpsert` — Create / Update CI Risk Dimensions
- **Path:** `/ai/tools/masterdb/risk/upsert`
- **Input:** JSON with `ci_name` (required), `ci_classification` (required), `operational` and/or `structural` (objects with dimension grades), optional `note`, `dry_run` (default `true`), `updated_by`.
- **What it does:** Creates or updates risk dimensions on a `TECHNICAL_ROOM` CI using ARO v1.2 formula. Partial updates preserve existing dimensions. Auto-computes `operational.global` (mean of sub-group means), `structural.global` (MAX-tier), and `risk.global`. Appends to `risk.notes[]` if note provided.
- **Returns:** `{ content: { ci_name, dry_run, risk_before, risk_after, globals_computed }, logs }`

#### `aiToolsMasterDBRiskDeleteDimension` — Remove a Risk Dimension
- **Path:** `/ai/tools/masterdb/risk/delete`
- **Input:** JSON with `ci_name`, `ci_classification`, `dimension_type` (`operational`/`structural`), `dimension_name`, optional `note`, `dry_run` (default `true`).
- **What it does:** Removes a specific risk dimension from a `TECHNICAL_ROOM` CI and recomputes globals. Automatically appends a deletion note to `risk.notes[]`. Does NOT delete the entire `risk` attribute.
- **Returns:** `{ content: { ci_name, dimension_removed, risk_after }, logs }`

#### `aiToolsMasterDBRiskBulkLoad` — Bulk Load Risk Assessments (ARO CSV)
- **Path:** `/pc/masterdb/risk/bulk/load`
- **Input:** JSON with `mode` (`dry_run`/`execute`/`rollback`), `assessment_version`, `note_prefix`, `records` array (`[{ci_name, operational, structural, note}]`), or `rollback_data` (for rollback mode).
- **What it does:** Batch-processes risk assessments from pre-processed ARO CSV data. `dry_run`: previews changes + generates backup. `execute`: writes to each CI + backup for rollback. `rollback`: restores from backup data.
- **Returns:** `{ content: { mode, total, pass, fail, results: [...], backup_data }, logs }`

#### `masterDBEugeniaTest` — Auto-Test EuGenIA Prompts
- **Path:** `/pc/masterdb/eugenia/test`
- **Input:** JSON config with `testCases` array, `isDryRun`, `sleepBetweenMs`, `maxRetries`, `retryDelayMs`.
- **What it does:** Fetches all active EuGenIA prompts, runs them through the EuGenIA API, evaluates `mustNotContain` rules, and generates a PASS/FAIL/ERROR report as CSV sent by email to the configured recipient.
- **Returns:** Sends email with CSV report; ticket output contains test summary.

#### `mcpToolsParamAddSimple` — Add Parameter to MCP Tool
- **Path:** `/ai/tools/mcp/ParamAddSimple`
- **Input:** JSON with `serverid`, `toolid`, `name`, `description` (required), optional `values` (array), `required` (boolean).
- **What it does:** Registers a new parameter definition on an MCP tool server entry. Validates required fields.
- **Returns:** `{ content: { success, param_added }, logs }`

#### `aiToolsSystemUptime` — TheSys System Uptime
- **Path:** `/ai/tools/thesys/uptime`
- **Input:** None required.
- **What it does:** Calls `/thesys/uptime`, parses the raw uptime string (format `Xd Yh Zm`), and returns a human-readable uptime summary with total minutes.
- **Returns:** `{ content: { raw, days, hours, minutes, total_minutes, human_readable }, logs }`

#### `aiToolsTRINInventoryAssuranceCreateChange` — Create TRIN Change for Inventory Assurance
- **Path:** *(defined but NOT registered in startModule — not publicly callable)*
- **Input:** JSON with `domain` (required), `summary` (required, max 200 chars), `notes` (required), `isDryRun` (default `false`).
- **What it does:** Creates a TRIN Change record for inventory assurance workflows. Validates inputs, builds the change payload for the target domain.
- **Returns:** `{ content: { success, change_id, dry_run }, logs }`

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
  ticket.addOutput("[myFunction] ERROR at STEP=" + STEP + ": " + result.logs);
  logWarning("myFunction", result.logs + " | SQL=" + sql_query);
  ticket.getResult().setObject(JSON.stringify(result));
  ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_NOK);
  return;
}
var data_runTicketGCP = JSON.parse(runTicketGCP.getResult().getObject());
if (data_runTicketGCP.Result === undefined) {
  result.logs = "ERROR: " + data_runTicketGCP.Error;
  ticket.addOutput("[myFunction] ERROR at STEP=" + STEP + ": " + result.logs);
  logWarning("myFunction", result.logs);
  // handle error...
  return;
}
result.content = data_runTicketGCP.Result;
ticket.addOutput("[myFunction] rows=" + (result.content ? result.content.length : 0));
```

**IMPORTANT — BigQuery Subquery Alias Rule:**
BigQuery requires every subquery used as a table source to have an alias. Without it, the query fails silently.
```sql
-- WRONG (will fail):
SELECT * FROM (SELECT a, b FROM t1 UNION ALL SELECT a, b FROM t2) WHERE a IS NOT NULL

-- CORRECT:
SELECT * FROM (SELECT a, b FROM t1 UNION ALL SELECT a, b FROM t2) AS t WHERE a IS NOT NULL
```
Always add `AS t` (or a meaningful alias) after closing the subquery parenthesis.

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
### 3.7 Mandatory Step-by-Step Debugging Pattern

Every function MUST include `ticket.addOutput()` and `logInfo()`/`logWarning()`/`logSevere()` at every step. Use a `STEP` variable to track execution progress:

```javascript
function myFunction(ticket, params) {
  var result = { content: "", logs: "" };
  var STEP = "INIT";

  ticket.addOutput("[myFunction] START");
  logInfo("myFunction", "Function called");

  // --- 1. Parse input ---
  STEP = "PARSE_INPUT";
  ticket.addOutput("[myFunction] STEP: " + STEP);
  // ... parse ...
  ticket.addOutput("[myFunction] parsedInput=" + JSON.stringify(parsedInput));

  // --- 2. Query ---
  STEP = "QUERY_DATA";
  ticket.addOutput("[myFunction] STEP: " + STEP);
  logInfo("myFunction", "Executing query");
  // ... execute ...
  // On error:
  ticket.addOutput("[myFunction] ERROR at STEP=" + STEP + ": " + result.logs);
  logWarning("myFunction", result.logs + " | SQL=" + sql_query);
  // On success:
  ticket.addOutput("[myFunction] rows=" + count);

  // --- Catch block ---
  } catch (err) {
    result.logs = "EXCEPTION at STEP=" + STEP + ": " + err;
    ticket.addOutput("[myFunction] " + result.logs);
    logSevere("myFunction", result.logs);
  }
}
```

Key rules:
- `ticket.addOutput()` = visible in TheSys console (user-facing)
- `logInfo()/logWarning()/logSevere()` = platform logs (audit/search)
- Every error exit MUST have both `ticket.addOutput()` and a `log*()` call
- The `STEP` variable allows catch blocks to report WHERE the exception occurred
- On query failure, always log the SQL query for reproduction

### 3.8 Helper Functions Placement

Define helper/utility functions (e.g. `safeSql()`) as **top-level functions** before the business function, NOT as nested functions inside it. Nested function definitions create a new function object on every call and are harder to reuse.

```javascript
// CORRECT — top-level helper
function safeSql(v) {
  if (v === null || v === undefined) return "";
  return ("" + v).replace(/'/g, "''");
}

function myBusinessFunction(ticket, params) {
  // ... use safeSql() here ...
}
```

### 3.9 BigQuery Subquery Alias

BigQuery requires subqueries used as table sources to have an alias. This is a **mandatory** rule.

```sql
-- WRONG:
SELECT * FROM (SELECT ... UNION ALL SELECT ...) WHERE ...

-- CORRECT:
SELECT * FROM (SELECT ... UNION ALL SELECT ...) AS t WHERE ...
```

### 3.10 BigQuery Partition Filter Requirement (`day_part`)

Many BigQuery tables in the `topology`, `problem_management`, `trin`, and other datasets are **partitioned by `day_part`** (a DATE column). BigQuery enforces a partition filter — queries without one fail with:

> `Cannot query over table '...' without a filter over column(s) 'day_part' that can be used for partition elimination`

**When creating a new function that queries BigQuery, the agent MUST ask the user:**

> Does the table(s) you want to query require a `day_part` partition filter?
> - **Yes** — I will add a `day_part` filter. What time window? (default: last 2 days)
> - **No** — No partition filter needed.
> - **I don't know** — I will add a safe default (`day_part >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 DAY)`) which can be removed later if not needed.

This should be asked as a **survey-style question** before generating the SQL.

**Standard patterns (pick the one that fits):**

| Use case | Filter | Example |
|----------|--------|---------|
| Latest snapshot (cadastro, parques) | `WHERE day_part >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 DAY)` | `EUGenIA_cadastro_centralizado.js` |
| Latest partition only | `WHERE day_part = (SELECT MAX(day_part) FROM table)` | `getParqueByCell` |
| Historical range | `WHERE day_part > "2020-01-01"` | `investigationByTrinId` |
| Configurable window | `WHERE day_part >= DATE_SUB(CURRENT_DATE(), INTERVAL N DAY)` | `getGuiasHistoricoByCellDate` |

**Important:** When using UNION ALL across partitioned tables, the `day_part` filter must be applied **inside each SELECT** of the union, not on the outer query:

```sql
-- CORRECT:
SELECT col FROM table_a WHERE day_part >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 DAY)
UNION ALL
SELECT col FROM table_b WHERE day_part >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 DAY)

-- WRONG (partition filter on outer query does not push down):
SELECT col FROM (
  SELECT col FROM table_a UNION ALL SELECT col FROM table_b
) AS t WHERE day_part >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 DAY)
```

### 3.11 `objectSpace` — Auto-Inference Rule

The `objectSpace` variable should be **inferred automatically** by the agent from the function's `path` prefix — do NOT ask the user.

| Function path | Inferred `objectSpace` |
|--------------|------------------------|
| `/ai/nexus/...` | `"nexus"` |
| `/ai/sara/...` | `"sara"` |
| `/ai/coolops/...` | `"coolops"` |
| `/ai/guides/...` | `"guides"` |
| `/ai/cadastro/...` | `"cadastro"` |
| `/ai/e2e/...` | `"e2e"` |
| `/dpt/...` | `"dpt"` |
| `/skills/...` | `"skills"` |

If the path does not match any known prefix, use the second segment of the path (e.g., `/ai/myapp/fn` → `"myapp"`).
If the user explicitly provides an objectSpace, use that instead.

### 3.12 Result Data Visibility — MANDATORY `addOutput` Rule

`ticket.getResult().setObject(JSON.stringify(result))` stores the result **programmatically** (for machine callers) but does **NOT** display it visibly in the TheSys console. The agent will appear to return "nothing" even when it returns 6+ rows.

**You MUST also call `ticket.addOutput(JSON.stringify(result))` to make the data visible:**

```javascript
// CORRECT — data is both stored and visible
result.content = data.Result;
result.logs = "rows=" + (data.Result ? data.Result.length : 0);

ticket.addOutput("[myFunction] SUCCESS: " + result.logs);
ticket.addOutput(JSON.stringify(result));          // <-- MANDATORY for visibility
ticket.getResult().setObject(JSON.stringify(result));
ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_OK);
```

```javascript
// WRONG — data stored but invisible to user
result.content = data.Result;
ticket.getResult().setObject(JSON.stringify(result));
ticket.getResult().setResult(TheSysModuleFunctionResult.RESULT_OK);
// No addOutput(JSON.stringify(result)) → user sees only log lines, not the data
```

Also avoid double-prefixing the `logs` string:
```javascript
// WRONG:
result.logs = "SUCCESS: rows=6";                          // already has "SUCCESS:"
ticket.addOutput("[fn] SUCCESS: " + result.logs);         // → "SUCCESS: SUCCESS: rows=6"

// CORRECT:
result.logs = "rows=6";
ticket.addOutput("[fn] SUCCESS: " + result.logs);         // → "SUCCESS: rows=6"
```

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
| `contagemSAsPorLocalidade` | `/ai/cadastro/contagemSAsPorLocalidade` | contagemSAsPorLocalidade.js | BigQuery | AI Query |
| `setActiveRegularEugenias` | `/dpt/sara/setActiveRegularEugenias` | EuGenIA_Logo_Manager.js | EuGenIA API | Management |
| `listarContagensSAs` | `/ai/teste/listarContagensSAs` | ListarContagensSAs.js | BigQuery | AI Query |
| `listarContagensSAsPorLocalidade` | `/ai/greatops/listar_contagens_sa_por_localidade` | listarContagensSAsPorLocalidade.js | BigQuery | AI Query |
| `navigationLogsUltimoDayPartPorTecnologia` | `/ai/greatops/navigation_logs_ultimo_day_part_por_tecnologia` | navigationLogsUltimoDayPartPorTecnologia.js | BigQuery | AI Query |
| `getPortugueseDishes` | `/skills/getPortugueseDishes` | função_skills.js | Static | Demo/Test |
| `aiToolsMasterDBFind` | `/ai/tools/masterdb/find` | masterdb-agent-tools.js | MasterDB API | AI Query |
| `aiToolsMasterDBFindEnergyInfra` | `/ai/tools/masterdb/find/EnergyInfra` | masterdb-agent-tools.js | MasterDB API | AI Query |
| `aiToolsMasterDBFindEnergyGenerator` | `/ai/tools/masterdb/find/EnergyGenerator` | masterdb-agent-tools.js | MasterDB API | AI Query |
| `aiToolsMasterDBFindEnergySupplier` | `/ai/tools/masterdb/find/EnergySupplier` | masterdb-agent-tools.js | MasterDB API | AI Query |
| `aiToolsMasterDBFindSupport` | `/ai/tools/masterdb/find/Support` | masterdb-agent-tools.js | MasterDB API | AI Query |
| `aiToolsMasterDBFindSupport` | `/ai/tools/masterdb/find/EnergyAutonomy` | masterdb-agent-tools.js | MasterDB API | AI Query |
| `aiToolsMasterDBGeoSearch` | `/ai/tools/masterdb/GEOSearch` | masterdb-agent-tools.js | MasterDB API | AI Query |
| `aiToolsMasterDBTemplateAttributesGet` | `/ai/tools/masterdb/find/TemplateAttributes` | masterdb-agent-tools.js | MasterDB API | AI Query |
| `aiToolsMasterDBClassificationsGet` | `/ai/tools/masterdb/find/Classifications` | masterdb-agent-tools.js | MasterDB API | AI Query |
| `aiToolsMasterDBDependencySearch` | `/ai/tools/masterdb/find/DependencySearch` | masterdb-agent-tools.js | MasterDB API | AI Query |
| `aiToolsMasterDBImpact` | `/ai/tools/masterdb/find/Impact` | masterdb-agent-tools.js | MasterDB API | AI Query |
| `aiToolsMasterDBExportEmailCSV` | `/ai/tools/masterdb/export/EmailCsv` | masterdb-agent-tools.js | MasterDB API | Export |
| `aiToolsMasterDBNetworkIPGet` | `/ai/tools/masterdb/find/NetworkIPGet` | masterdb-agent-tools.js | MasterDB API | AI Query |
| `aiToolsMasterDBFindAttributeValues` | `/ai/tools/masterdb/find/AttributeValues` | masterdb-agent-tools.js | MasterDB API | AI Query |
| `aiToolsMasterDBCockpitFindData` | `/ai/tools/masterdb/find/CockpitData` | masterdb-agent-tools.js | MasterDB / DataServer | AI Query |
| `aiToolsMasterDBUpdate` | `/ai/tools/masterdb/update` | masterdb-agent-tools.js | MasterDB API | AI Write |
| `aiToolsMasterDBFindTransformations` | `/ai/tools/masterdb/find/Transformations` | masterdb-agent-tools.js | MasterDB API | AI Query |
| `aiToolsMasterDBTransformAdd` | `/ai/tools/masterdb/update/Transformations` | masterdb-agent-tools.js | MasterDB API | AI Write |
| `aiToolsMasterDBComplianceSearch` | `/ai/tools/masterdb/find/Compliances` | masterdb-agent-tools.js | MasterDB API | AI Query |
| `aiToolsMasterDBFindLocationGeoInfo` | `/ai/tools/masterdb/find/LocationGeoInfo` | masterdb-agent-tools.js | MasterDB API | AI Query |
| `aiToolsMasterDBGetODFChain` | `/ai/tools/masterdb/ftth/GetODFChain` | masterdb-agent-tools.js | MasterDB API | AI Query |
| `aiToolsMasterDBRiskUpsert` | `/ai/tools/masterdb/risk/upsert` | masterdb-agent-tools.js | MasterDB API | AI Write |
| `aiToolsMasterDBRiskDeleteDimension` | `/ai/tools/masterdb/risk/delete` | masterdb-agent-tools.js | MasterDB API | AI Write |
| `aiToolsMasterDBRiskBulkLoad` | `/pc/masterdb/risk/bulk/load` | masterdb-agent-tools.js | MasterDB API | Bulk/Admin |
| `masterDBEugeniaTest` | `/pc/masterdb/eugenia/test` | masterdb-agent-tools.js | EuGenIA API | Admin/Test |
| `mcpToolsParamAddSimple` | `/ai/tools/mcp/ParamAddSimple` | masterdb-agent-tools.js | MCP API | Management |
| `aiToolsSystemUptime` | `/ai/tools/thesys/uptime` | masterdb-agent-tools.js | TheSys API | Utility |
| `aiToolsTRINInventoryAssuranceCreateChange` | *(not registered)* | masterdb-agent-tools.js | TRIN/MAC API | AI Write |
