const lookupCardTemplate = document.querySelector("#lookup-card-template");
const watchRowTemplate = document.querySelector("#watch-row-template");
const ideaCardTemplate = document.querySelector("#idea-card-template");
const lookupForm = document.querySelector("#lookup-form");
const lookupInput = document.querySelector("#lookup-input");
const lookupButton = document.querySelector("#lookup-button");
const lookupStatus = document.querySelector("#lookup-status");
const lookupResultContainer = document.querySelector("#lookup-result");
const lookupProgressBlock = document.querySelector("#lookup-progress-block");
const lookupProgressFill = document.querySelector("#lookup-progress-fill");
const favoritesContainer = document.querySelector("#favorites");
const favoritesStatus = document.querySelector("#favorites-status");
const favoritesProgressBlock = document.querySelector("#favorites-progress-block");
const favoritesProgressFill = document.querySelector("#favorites-progress-fill");
const refreshFavoritesButton = document.querySelector("#refresh-favorites");
const ideasForm = document.querySelector("#ideas-form");
const ideasInput = document.querySelector("#ideas-input");
const ideasButton = document.querySelector("#ideas-button");
const ideasStatus = document.querySelector("#ideas-status");
const ideasProgressBlock = document.querySelector("#ideas-progress-block");
const ideasProgressFill = document.querySelector("#ideas-progress-fill");
const ideasResults = document.querySelector("#ideas-results");
const watchlistCount = document.querySelector("#watchlist-count");
const watchlistNextExpiry = document.querySelector("#watchlist-next-expiry");
const watchlistNextDrop = document.querySelector("#watchlist-next-drop");
const tabButtons = document.querySelectorAll(".tab-button");
const tabPanels = document.querySelectorAll(".tab-panel");

const numberFormatter = new Intl.NumberFormat("en-US");
const STATUS_LABELS = {
  "client delete prohibited": "Registrar lock: deletion is blocked",
  "client renew prohibited": "Registrar lock: auto-renew changes are restricted",
  "client transfer prohibited": "Registrar lock: transfers are blocked",
  "client update prohibited": "Registrar lock: contact or DNS updates are blocked"
};

function normalizeErrorMessage(error, fallback) {
  const raw = String(error?.message || error || "").trim();
  if (!raw) {
    return fallback;
  }

  if (raw.startsWith("Error invoking remote method")) {
    const parts = raw.split(": ");
    return parts[parts.length - 1] || fallback;
  }

  return raw;
}

function setProgress(progressBlock, progressFill, value, visible) {
  if (!progressBlock || !progressFill) {
    return;
  }

  progressBlock.classList.toggle("is-hidden", !visible);
  progressBlock.classList.remove("is-indeterminate");
  progressBlock.setAttribute("aria-hidden", visible ? "false" : "true");
  progressFill.style.width = `${Math.max(0, Math.min(100, value))}%`;
}

function setIndeterminateProgress(progressBlock, progressFill, visible) {
  if (!progressBlock || !progressFill) {
    return;
  }

  progressBlock.classList.toggle("is-hidden", !visible);
  progressBlock.classList.toggle("is-indeterminate", visible);
  progressBlock.setAttribute("aria-hidden", visible ? "false" : "true");
  progressFill.style.width = visible ? "34%" : "0%";
}

function setStatus(node, message, tone = "muted") {
  if (!node) {
    return;
  }

  node.textContent = message || "";
  node.dataset.tone = tone;
}

function splitStatusText(status) {
  return String(status || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function plainStatusSummary(status, available) {
  if (available) {
    return "No active registration found";
  }

  const parts = splitStatusText(status);
  if (parts.length === 0) {
    return "Registered";
  }

  const lockFlags = parts.filter((part) => STATUS_LABELS[part.toLowerCase()]);
  if (lockFlags.length > 0) {
    return "Registered with registrar lock";
  }

  return "Registered";
}

function statusDetailText(status) {
  const parts = splitStatusText(status);
  if (parts.length === 0) {
    return "No special registry flags were returned.";
  }

  const translated = parts
    .map((part) => STATUS_LABELS[part.toLowerCase()])
    .filter(Boolean);

  if (translated.length === 0) {
    return "The registry returned standard registration status flags.";
  }

  return translated.join(" • ");
}

function registrarSummary(record) {
  if (record.available) {
    return "Available path";
  }

  return record.registrar ? `Registered with ${record.registrar}` : "Registered domain";
}

function formatDate(value) {
  if (!value) {
    return "Unknown";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(date);
}

function countdownText(value) {
  if (!value) {
    return "No timer";
  }

  const target = new Date(value).getTime();
  if (Number.isNaN(target)) {
    return "No timer";
  }

  const diff = target - Date.now();
  const days = Math.ceil(diff / (24 * 60 * 60 * 1000));

  if (days > 1) {
    return `${numberFormatter.format(days)}d`;
  }

  if (days === 1) {
    return "1d";
  }

  if (days === 0) {
    return "Today";
  }

  return `${numberFormatter.format(Math.abs(days))}d ago`;
}

function urgencySortValue(record) {
  const drop = record.estimatedDropDate ? new Date(record.estimatedDropDate).getTime() : Number.MAX_SAFE_INTEGER;
  const expiry = record.expirationDate ? new Date(record.expirationDate).getTime() : Number.MAX_SAFE_INTEGER;
  return Math.min(drop, expiry);
}

function tabForRoute() {
  const route = window.location.hash.replace(/^#/, "") || "/lookup";
  if (route === "/watchlist") {
    return "watchlist";
  }
  if (route === "/ideas") {
    return "ideas";
  }
  return "lookup";
}

function selectTab(tabName) {
  for (const button of tabButtons) {
    button.classList.toggle("is-active", button.dataset.tab === tabName);
  }

  for (const panel of tabPanels) {
    panel.classList.toggle("is-active", panel.dataset.panel === tabName);
  }
}

function navigateToTab(tabName, replace = false) {
  const nextHash = `#/${tabName}`;
  if (replace) {
    window.history.replaceState(null, "", nextHash);
  } else {
    window.location.hash = nextHash;
  }
  selectTab(tabName);
}

function wireItemMenu(node) {
  const trigger = node.querySelector(".item-menu-button");
  const wrapper = node.querySelector(".item-menu-wrap");
  if (!trigger || !wrapper) {
    return;
  }

  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    const isOpen = wrapper.classList.contains("is-open");
    document.querySelectorAll(".item-menu-wrap.is-open").forEach((item) => item.classList.remove("is-open"));
    wrapper.classList.toggle("is-open", !isOpen);
  });
}

function renderLookupResult(result) {
  lookupResultContainer.innerHTML = "";

  if (!result) {
    return;
  }

  const node = lookupCardTemplate.content.firstElementChild.cloneNode(true);
  node.querySelector(".domain-name").textContent = result.domain;
  node.querySelector(".record-summary").textContent = registrarSummary(result);
  node.querySelector(".registrar-value").textContent = result.registrar || "Unknown";
  node.querySelector(".expiry-value").textContent = formatDate(result.expirationDate);
  node.querySelector(".drop-value").textContent = formatDate(result.estimatedDropDate);
  node.querySelector(".countdown-value").textContent = countdownText(result.estimatedDropDate || result.expirationDate);
  node.querySelector(".card-copy").textContent = result.notes;
  node.querySelector(".status-explainer").textContent = plainStatusSummary(result.status, result.available);
  node.querySelector(".lock-explainer").textContent = statusDetailText(result.status);

  const badge = node.querySelector(".badge");
  badge.textContent = result.available ? "Likely available" : "Registered";
  badge.dataset.variant = result.available ? "available" : "taken";

  const saveButton = node.querySelector(".save-button");
  saveButton.addEventListener("click", async () => {
    saveButton.disabled = true;
    await window.domainJane.addFavorite(result);
    await loadFavorites("Added to watchlist.");
    navigateToTab("watchlist");
  });

  lookupResultContainer.appendChild(node);
}

function renderFavorites(favorites) {
  favoritesContainer.innerHTML = "";
  watchlistCount.textContent = String(favorites.length);

  const nextExpiryRecord = [...favorites]
    .filter((favorite) => favorite.expirationDate)
    .sort((left, right) => new Date(left.expirationDate).getTime() - new Date(right.expirationDate).getTime())[0];
  const nextDropRecord = [...favorites]
    .filter((favorite) => favorite.estimatedDropDate)
    .sort((left, right) => new Date(left.estimatedDropDate).getTime() - new Date(right.estimatedDropDate).getTime())[0];

  watchlistNextExpiry.textContent = nextExpiryRecord ? formatDate(nextExpiryRecord.expirationDate) : "None";
  watchlistNextDrop.textContent = nextDropRecord ? formatDate(nextDropRecord.estimatedDropDate) : "None";

  if (favorites.length === 0) {
    favoritesContainer.innerHTML =
      '<div class="empty-state">No tracked domains yet. Add one from Lookup or AI Ideas.</div>';
    return;
  }

  const sorted = [...favorites].sort((left, right) => urgencySortValue(left) - urgencySortValue(right));

  for (const favorite of sorted) {
    const node = watchRowTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector(".domain-name").textContent = favorite.domain;
    node.querySelector(".watch-note").textContent = registrarSummary(favorite);
    node.querySelector(".watch-status").textContent = plainStatusSummary(favorite.status, favorite.available);
    node.querySelector(".expiry-date").textContent = `Expires ${formatDate(favorite.expirationDate)}`;
    node.querySelector(".drop-date").textContent = `Drops ${formatDate(favorite.estimatedDropDate)}`;
    node.querySelector(".countdown-pill").textContent = countdownText(
      favorite.estimatedDropDate || favorite.expirationDate
    );

    const removeButton = node.querySelector(".remove-button");
    removeButton.addEventListener("click", async () => {
      await window.domainJane.removeFavorite(favorite.domain);
      await loadFavorites("Removed from watchlist.");
    });

    wireItemMenu(node);
    favoritesContainer.appendChild(node);
  }
}

function renderIdeas(results) {
  ideasResults.innerHTML = "";

  if (results.length === 0) {
    ideasResults.innerHTML = '<div class="empty-state">No AI candidate results yet.</div>';
    return;
  }

  for (const result of results) {
    const node = ideaCardTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector(".domain-name").textContent = result.domain;
    node.querySelector(".rationale").textContent = result.rationale || "AI-generated candidate.";
    node.querySelector(".idea-status").textContent = plainStatusSummary(result.status, result.available);
    node.querySelector(".expiry-date").textContent = `Expires ${formatDate(result.expirationDate)}`;
    node.querySelector(".drop-date").textContent = `Drops ${formatDate(result.estimatedDropDate)}`;
    node.querySelector(".card-copy").textContent = result.notes;
    node.querySelector(".idea-explainer").textContent = statusDetailText(result.status);

    const saveButton = node.querySelector(".save-button");
    saveButton.addEventListener("click", async () => {
      saveButton.disabled = true;
      await window.domainJane.addFavorite(result);
      await loadFavorites("Added AI result to watchlist.");
      navigateToTab("watchlist");
    });

    wireItemMenu(node);
    ideasResults.appendChild(node);
  }
}

async function loadFavorites(statusMessage) {
  const favorites = await window.domainJane.listFavorites();
  renderFavorites(favorites);

  if (statusMessage) {
    setStatus(favoritesStatus, statusMessage, "muted");
    return;
  }

  setStatus(
    favoritesStatus,
    favorites.length > 0
      ? `${favorites.length} tracked domain${favorites.length === 1 ? "" : "s"}, sorted by nearest expiry/drop.`
      : "Saved domains are stored locally on this machine."
  );
}

lookupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = lookupInput.value.trim();
  if (!query) {
    setStatus(lookupStatus, "Enter a full domain like winzen.com.", "warning");
    return;
  }

  lookupButton.disabled = true;
  setStatus(lookupStatus, "Checking domain record...", "muted");
  setProgress(lookupProgressBlock, lookupProgressFill, 24, true);

  try {
    setProgress(lookupProgressBlock, lookupProgressFill, 62, true);
    const result = await window.domainJane.lookupDomain(query);
    renderLookupResult(result);
    setProgress(lookupProgressBlock, lookupProgressFill, 100, true);
    setStatus(
      lookupStatus,
      result.available
        ? "No registration record found. Confirm with your registrar before buying."
        : "Registration details loaded.",
      "success"
    );
  } catch (error) {
    setStatus(lookupStatus, normalizeErrorMessage(error, "Unable to load this domain right now."), "error");
    renderLookupResult(null);
  } finally {
    setTimeout(() => setProgress(lookupProgressBlock, lookupProgressFill, 0, false), 250);
    lookupButton.disabled = false;
  }
});

refreshFavoritesButton.addEventListener("click", async () => {
  refreshFavoritesButton.disabled = true;
  setStatus(favoritesStatus, "Refreshing watchlist...", "muted");
  setProgress(favoritesProgressBlock, favoritesProgressFill, 28, true);

  try {
    setProgress(favoritesProgressBlock, favoritesProgressFill, 64, true);
    const favorites = await window.domainJane.refreshFavorites();
    renderFavorites(favorites);
    setProgress(favoritesProgressBlock, favoritesProgressFill, 100, true);
    setStatus(
      favoritesStatus,
      `Refreshed ${favorites.length} tracked domain${favorites.length === 1 ? "" : "s"}.`,
      "success"
    );
  } catch (error) {
    setStatus(favoritesStatus, normalizeErrorMessage(error, "Unable to refresh the watchlist."), "error");
  } finally {
    setTimeout(() => setProgress(favoritesProgressBlock, favoritesProgressFill, 0, false), 250);
    refreshFavoritesButton.disabled = false;
  }
});

ideasForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = ideasInput.value.trim();

  ideasButton.disabled = true;
  setStatus(
    ideasStatus,
    query ? "Generating names and checking domains..." : "Generating a general batch of names and checking domains...",
    "muted"
  );
  setIndeterminateProgress(ideasProgressBlock, ideasProgressFill, true);

  try {
    const results = await window.domainJane.generateAiIdeas(query);
    renderIdeas(results);
    setProgress(ideasProgressBlock, ideasProgressFill, 100, true);
    setStatus(
      ideasStatus,
      `Generated and checked ${results.length} AI candidates${query ? ` for "${query}"` : ""}, sorted by the nearest expiry window.`,
      "success"
    );
  } catch (error) {
    setStatus(ideasStatus, normalizeErrorMessage(error, "Unable to generate ideas right now."), "error");
    renderIdeas([]);
  } finally {
    setTimeout(() => setProgress(ideasProgressBlock, ideasProgressFill, 0, false), 250);
    ideasButton.disabled = false;
  }
});

for (const button of tabButtons) {
  button.addEventListener("click", () => {
    navigateToTab(button.dataset.tab);
  });
}

window.addEventListener("hashchange", () => {
  selectTab(tabForRoute());
});

document.addEventListener("click", () => {
  document.querySelectorAll(".item-menu-wrap.is-open").forEach((item) => item.classList.remove("is-open"));
});

if (!window.location.hash) {
  navigateToTab("lookup", true);
} else {
  selectTab(tabForRoute());
}
renderLookupResult(null);
renderIdeas([]);
loadFavorites();
