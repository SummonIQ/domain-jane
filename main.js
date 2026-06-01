const { app, BrowserWindow, ipcMain } = require("electron");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_TLDS = ["com", "net", "org", "io", "co", "ai", "app", "dev"];
const AI_IDEA_TLDS = ["com"];
const DAY_MS = 24 * 60 * 60 * 1000;
const COMMON_DROP_GRACE_DAYS = 75;
const RDAP_BOOTSTRAP_URL = "https://data.iana.org/rdap/dns.json";
const OPENAI_API_URL = "https://api.openai.com/v1/responses";
const OPENAI_MODEL = "gpt-4o-mini";

let mainWindow;
let bootstrapCache;
let envCache;
let reloadTimer;
let relaunching = false;
const devWatchers = [];

function debounceReload(action, delay = 140) {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(action, delay);
}

function watchPath(targetPath, onChange) {
  if (!fsSync.existsSync(targetPath)) {
    return;
  }

  const watcher = fsSync.watch(targetPath, { recursive: false }, () => {
    onChange();
  });

  devWatchers.push(watcher);
}

function closeDevWatchers() {
  while (devWatchers.length > 0) {
    const watcher = devWatchers.pop();
    try {
      watcher.close();
    } catch {
      // Ignore close failures.
    }
  }
}

function setupDevReload() {
  if (!app.isPackaged) {
    const srcDir = path.join(__dirname, "src");
    const rendererFiles = ["index.html", "renderer.js", "styles.css"].map((file) => path.join(srcDir, file));
    for (const file of rendererFiles) {
      watchPath(file, () => {
        debounceReload(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.reloadIgnoringCache();
          }
        });
      });
    }

    watchPath(path.join(__dirname, "preload.js"), () => {
      debounceReload(() => {
        if (relaunching) {
          return;
        }
        relaunching = true;
        closeDevWatchers();
        app.relaunch();
        app.exit(0);
      });
    });

    watchPath(path.join(__dirname, "main.js"), () => {
      debounceReload(() => {
        if (relaunching) {
          return;
        }
        relaunching = true;
        closeDevWatchers();
        app.relaunch();
        app.exit(0);
      });
    });
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 760,
    height: 600,
    minWidth: 360,
    minHeight: 420,
    backgroundColor: "#071014",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "src", "index.html"));
  mainWindow.webContents.setVisualZoomLevelLimits(1, 3);
  mainWindow.webContents.setZoomLevel(0);
}

function getStorePath() {
  return path.join(app.getPath("userData"), "favorites.json");
}

function getEnvPath() {
  return path.join(__dirname, ".env.local");
}

async function loadEnvConfig() {
  if (envCache) {
    return envCache;
  }

  try {
    const raw = await fs.readFile(getEnvPath(), "utf8");
    const entries = {};

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) {
        continue;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      let value = trimmed.slice(separatorIndex + 1).trim();

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      entries[key] = value;
    }

    envCache = entries;
    return entries;
  } catch (error) {
    if (error.code === "ENOENT") {
      envCache = {};
      return envCache;
    }

    throw error;
  }
}

async function loadFavorites() {
  try {
    const data = await fs.readFile(getStorePath(), "utf8");
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function saveFavorites(favorites) {
  await fs.mkdir(path.dirname(getStorePath()), { recursive: true });
  await fs.writeFile(getStorePath(), JSON.stringify(favorites, null, 2), "utf8");
  return favorites;
}

function cleanLookupInput(query) {
  return query
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .replace(/\.+$/, "");
}

function normalizeExactDomain(query) {
  const cleaned = cleanLookupInput(query);
  if (!cleaned || !cleaned.includes(".")) {
    return "";
  }

  if (!/^[a-z0-9.-]+$/.test(cleaned)) {
    return "";
  }

  return cleaned;
}

function slugifyKeyword(query) {
  return cleanLookupInput(query)
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function suggestionCandidates(query) {
  const normalized = slugifyKeyword(query);
  if (!normalized) {
    return [];
  }

  return DEFAULT_TLDS.map((tld) => `${normalized}.${tld}`);
}

async function loadBootstrap() {
  if (bootstrapCache) {
    return bootstrapCache;
  }

  const response = await fetch(RDAP_BOOTSTRAP_URL, {
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`RDAP bootstrap lookup failed with status ${response.status}`);
  }

  bootstrapCache = await response.json();
  return bootstrapCache;
}

async function rdapEndpointsForDomain(domain) {
  const tld = domain.split(".").pop();
  const endpoints = [];

  try {
    const bootstrap = await loadBootstrap();
    for (const [tlds, urls] of bootstrap.services || []) {
      if (Array.isArray(tlds) && tlds.includes(tld)) {
        for (const baseUrl of urls || []) {
          const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
          endpoints.push(new URL(`domain/${domain}`, normalizedBase).toString());
        }
      }
    }
  } catch {
    // Fall through to public gateways.
  }

  endpoints.push(`https://rdap.org/domain/${encodeURIComponent(domain)}`);
  endpoints.push(`https://rdap.net/domain/${encodeURIComponent(domain)}`);

  return [...new Set(endpoints)];
}

async function fetchRdapPayload(url) {
  const response = await fetch(url, {
    headers: {
      accept: "application/rdap+json, application/json"
    }
  });

  if (response.status === 404) {
    return { type: "notFound" };
  }

  if (!response.ok) {
    let message = `Lookup failed with status ${response.status}`;
    try {
      const payload = await response.json();
      message = payload?.error?.message || payload?.title || message;
    } catch {
      // Keep generic message.
    }

    return { type: "error", message };
  }

  return { type: "ok", payload: await response.json() };
}

function profileFromAvailableDomain(domain) {
  return {
    domain,
    available: true,
    status: "Likely available",
    registrar: null,
    expirationDate: null,
    estimatedDropDate: null,
    checkedAt: new Date().toISOString(),
    notes: "No active RDAP record was found for this domain. Confirm availability with your registrar before buying."
  };
}

function parseRegisteredDomainProfile(domain, payload) {
  const eventMap = new Map();
  for (const event of payload.events || []) {
    if (event?.eventAction && event?.eventDate) {
      eventMap.set(event.eventAction.toLowerCase(), event.eventDate);
    }
  }

  const expirationDate =
    eventMap.get("expiration") ||
    eventMap.get("expiry") ||
    eventMap.get("expiration date") ||
    null;

  const registrar = payload.entities?.find((entity) =>
    (entity.roles || []).some((role) => role === "registrar")
  );
  const registrarName = registrar?.vcardArray?.[1]?.find((item) => item[0] === "fn")?.at(3) || null;

  const estimatedDropDate = expirationDate
    ? new Date(new Date(expirationDate).getTime() + COMMON_DROP_GRACE_DAYS * DAY_MS).toISOString()
    : null;

  return {
    domain,
    available: false,
    status: Array.isArray(payload.status) ? payload.status.join(", ") : "Registered",
    registrar: registrarName,
    expirationDate,
    estimatedDropDate,
    checkedAt: new Date().toISOString(),
    notes: expirationDate
      ? "Estimated drop date assumes a common 75-day post-expiration lifecycle. Registry rules vary."
      : "A registration record was found, but the registry did not expose an expiration event."
  };
}

async function fetchDomainProfile(domain) {
  const endpoints = await rdapEndpointsForDomain(domain);
  let sawNotFound = false;
  let lastError = null;

  for (const endpoint of endpoints) {
    const result = await fetchRdapPayload(endpoint);

    if (result.type === "ok") {
      return parseRegisteredDomainProfile(domain, result.payload);
    }

    if (result.type === "notFound") {
      sawNotFound = true;
      continue;
    }

    lastError = result.message;
  }

  if (sawNotFound) {
    return profileFromAvailableDomain(domain);
  }

  throw new Error(lastError || "RDAP lookup failed.");
}

function mergeFavorite(existingFavorites, record) {
  const favorite = {
    domain: record.domain,
    available: record.available,
    status: record.status,
    registrar: record.registrar,
    expirationDate: record.expirationDate,
    estimatedDropDate: record.estimatedDropDate,
    checkedAt: record.checkedAt,
    notes: record.notes,
    rationale: record.rationale || "",
    pinnedAt: new Date().toISOString()
  };

  const remainder = existingFavorites.filter((item) => item.domain !== favorite.domain);
  return [favorite, ...remainder];
}

function urgencySortValue(record) {
  const estimatedDrop = record.estimatedDropDate ? new Date(record.estimatedDropDate).getTime() : Number.MAX_SAFE_INTEGER;
  const expiration = record.expirationDate ? new Date(record.expirationDate).getTime() : Number.MAX_SAFE_INTEGER;
  return Math.min(estimatedDrop, expiration);
}

async function requestOpenAi(apiKey, body) {
  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    let message = `OpenAI request failed with status ${response.status}`;
    try {
      const payload = await response.json();
      message = payload?.error?.message || message;
    } catch {
      // Keep generic message.
    }
    throw new Error(message);
  }

  return response.json();
}

function extractResponseText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const parts =
    payload?.output
      ?.flatMap((item) => item.content || [])
      .map((item) => {
        if (typeof item?.text === "string" && item.text.trim()) {
          return item.text.trim();
        }

        if (typeof item?.json === "string" && item.json.trim()) {
          return item.json.trim();
        }

        if (item?.json && typeof item.json === "object") {
          return JSON.stringify(item.json);
        }

        return "";
      })
      .filter(Boolean) || [];

  return parts.join("\n").trim();
}

function dedupeIdeaRecords(ideas) {
  const deduped = [];
  const seen = new Set();

  for (const idea of ideas || []) {
    const label = slugifyKeyword(idea.label || "");
    if (!label || seen.has(label)) {
      continue;
    }

    seen.add(label);
    deduped.push({
      label,
      rationale: idea.rationale || "Short brandable domain candidate."
    });
  }

  return deduped;
}

function parsePlainIdeaLines(outputText) {
  const ideas = outputText
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s\-*\d.)]+/, "").trim())
    .filter(Boolean)
    .map((line) => {
      const [labelPart, ...rest] = line.split(/\s+[–—:-]\s+|:\s+/);
      return {
        label: labelPart,
        rationale: rest.join(" ").trim() || "Short brandable domain candidate."
      };
    });

  return dedupeIdeaRecords(ideas);
}

async function generateAiDomainIdeas({ query, count = 18 }) {
  const env = await loadEnvConfig();
  const apiKey = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY was not found in .env.local.");
  }

  const brief = cleanLookupInput(query || "") || "general premium brandable domains";
  const baseInput = [
    {
      role: "system",
      content: [
        {
          type: "input_text",
          text:
            "You generate short, catchy, premium-feeling domain labels for acquisition research. Prefer names that sound like strong startups or valuable digital brands. The final output will be checked only as .com domains, so prioritize labels that feel strong as premium .com brands."
        }
      ]
    },
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: `Generate ${count} short brandable domain labels for this theme or brief: ${brief}

Rules:
- Prefer 4 to 10 characters when possible.
- No hyphens.
- Easy to pronounce and spell.
- Mix invented brandables and high-value keyword-leaning names.
- Prioritize names that would still make sense as an expiring-domain opportunity.
- Return labels only, without TLDs.`
        }
      ]
    }
  ];

  const structuredPayload = await requestOpenAi(apiKey, {
    model: OPENAI_MODEL,
    input: baseInput,
    text: {
      format: {
        type: "json_schema",
        name: "domain_ideas",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            ideas: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  label: { type: "string" },
                  rationale: { type: "string" }
                },
                required: ["label", "rationale"]
              }
            }
          },
          required: ["ideas"]
        }
      }
    }
  });

  const structuredText = extractResponseText(structuredPayload);
  if (structuredText) {
    try {
      const parsed = JSON.parse(structuredText);
      const deduped = dedupeIdeaRecords(parsed.ideas);
      if (deduped.length > 0) {
        return deduped;
      }
    } catch {
      // Fall through to plain-text retry.
    }
  }

  const plainPayload = await requestOpenAi(apiKey, {
    model: OPENAI_MODEL,
    input: [
      ...baseInput,
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              "Return one idea per line. Format each line as label - short rationale. Do not use JSON. Do not include TLDs."
          }
        ]
      }
    ]
  });

  const plainText = extractResponseText(plainPayload);
  const deduped = parsePlainIdeaLines(plainText);
  if (deduped.length === 0) {
    throw new Error("OpenAI returned no usable domain ideas.");
  }

  return deduped;
}

ipcMain.handle("domains:lookup", async (_event, rawQuery) => {
  const domain = normalizeExactDomain(rawQuery);
  if (!domain) {
    throw new Error("Enter a full domain like winzen.com.");
  }

  return fetchDomainProfile(domain);
});

ipcMain.handle("domains:suggest", async (_event, rawQuery) => {
  const candidates = suggestionCandidates(rawQuery).slice(0, 12);
  if (candidates.length === 0) {
    return [];
  }

  const results = await Promise.all(
    candidates.map(async (domain) => {
      try {
        return await fetchDomainProfile(domain);
      } catch (error) {
        return {
          domain,
          available: false,
          status: "Lookup failed",
          registrar: null,
          expirationDate: null,
          estimatedDropDate: null,
          checkedAt: new Date().toISOString(),
          notes: error.message
        };
      }
    })
  );

  return results.sort((left, right) => left.domain.localeCompare(right.domain));
});

ipcMain.handle("domains:ai-ideas", async (_event, rawQuery) => {
  const ideas = await generateAiDomainIdeas({ query: rawQuery, count: 18 });
  const candidates = [];

  for (const idea of ideas) {
    for (const tld of AI_IDEA_TLDS) {
      candidates.push({
        domain: `${idea.label}.${tld}`,
        rationale: idea.rationale
      });
    }
  }

  const uniqueCandidates = [];
  const seen = new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate.domain)) {
      continue;
    }
    seen.add(candidate.domain);
    uniqueCandidates.push(candidate);
  }

  const limitedCandidates = uniqueCandidates.slice(0, 54);
  const results = await Promise.all(
    limitedCandidates.map(async (candidate) => {
      try {
        const record = await fetchDomainProfile(candidate.domain);
        return { ...record, rationale: candidate.rationale };
      } catch (error) {
        return {
          domain: candidate.domain,
          available: false,
          status: "Lookup failed",
          registrar: null,
          expirationDate: null,
          estimatedDropDate: null,
          checkedAt: new Date().toISOString(),
          notes: error.message,
          rationale: candidate.rationale
        };
      }
    })
  );

  return results.sort((left, right) => {
    const urgencyDelta = urgencySortValue(left) - urgencySortValue(right);
    if (urgencyDelta !== 0) {
      return urgencyDelta;
    }

    if (left.available !== right.available) {
      return left.available ? 1 : -1;
    }

    return left.domain.localeCompare(right.domain);
  });
});

ipcMain.handle("favorites:list", async () => {
  return loadFavorites();
});

ipcMain.handle("favorites:add", async (_event, record) => {
  const favorites = await loadFavorites();
  const nextFavorites = mergeFavorite(favorites, record);
  await saveFavorites(nextFavorites);
  return nextFavorites;
});

ipcMain.handle("favorites:remove", async (_event, domain) => {
  const favorites = await loadFavorites();
  const nextFavorites = favorites.filter((item) => item.domain !== domain);
  await saveFavorites(nextFavorites);
  return nextFavorites;
});

ipcMain.handle("favorites:refresh", async () => {
  const favorites = await loadFavorites();
  const refreshed = await Promise.all(
    favorites.map(async (favorite) => {
      try {
        const latest = await fetchDomainProfile(favorite.domain);
        return {
          ...favorite,
          ...latest,
          pinnedAt: favorite.pinnedAt || new Date().toISOString()
        };
      } catch (error) {
        return {
          ...favorite,
          checkedAt: new Date().toISOString(),
          status: "Refresh failed",
          notes: error.message
        };
      }
    })
  );

  await saveFavorites(refreshed);
  return refreshed.sort((left, right) => urgencySortValue(left) - urgencySortValue(right));
});

app.whenReady().then(() => {
  createWindow();
  setupDevReload();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  closeDevWatchers();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  closeDevWatchers();
});
