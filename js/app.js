// =============================================================================
//  app.js — AlgEduDocs Blogger: site selection, discovery (SSE), results
//  table, download (SSE), cloud upload with provider selection.
// =============================================================================

/* global ALGEDU_API */

var ALGEDU_API = ALGEDU_API || 'http://127.0.0.1:5000';

var state = {
  site: null,
  cycle: null,
  niveau: null,
  matieresDisponibles: {},
  matieresSelectionnees: new Set(),
  fiches: [],
  fichesFiltrees: [],
  fichesSelectionnees: new Set(),
  currentDiscoveryJob: null,
  currentDownloadJob: null,
  dernierDossierTelecharge: null,
  vue: 'table',
};

// ── THEME TOGGLE ─────────────────────────────────────────────────────

function initThemeToggle() {
  var saved = localStorage.getItem("algEdudocs_theme") || "light";
  document.documentElement.setAttribute("data-theme", saved);
  var btn = document.getElementById("btn-theme");
  if (!btn) {
    btn = document.createElement("button");
    btn.className = "theme-toggle";
    btn.id = "btn-theme";
    btn.setAttribute("aria-label", "Basculer le thème");
    btn.textContent = saved === "dark" ? "\u2600\ufe0f" : "\u{1F319}";
    btn.addEventListener("click", function() {
      var current = document.documentElement.getAttribute("data-theme");
      var next = current === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("algEdudocs_theme", next);
      btn.textContent = next === "dark" ? "\u2600\ufe0f" : "\u{1F319}";
    });
    var header = document.querySelector(".top");
    if (header) header.appendChild(btn);
  }
}

// ── ÉTAPE 1 : choix du site ──────────────────────────────────────────

function initSiteCards() {
  document.querySelectorAll(".site-card").forEach(function(card) {
    card.addEventListener("click", function() {
      document.querySelectorAll(".site-card").forEach(function(c) { c.classList.remove("active"); });
      card.classList.add("active");
      state.site = card.getAttribute("data-site");
      resetApresSite();
      chargerCycles();
    });
  });
}

function resetApresSite() {
  state.cycle = null;
  state.niveau = null;
  state.matieresDisponibles = {};
  state.matieresSelectionnees.clear();
  state.fiches = [];
  state.fichesSelectionnees.clear();
  var panelNiveau = document.getElementById("panel-niveau");
  if (panelNiveau) panelNiveau.style.display = "block";
  var panelFiches = document.getElementById("panel-fiches");
  if (panelFiches) panelFiches.style.display = "none";
  var panelDownload = document.getElementById("panel-download");
  if (panelDownload) panelDownload.style.display = "none";
  var selectCycle = document.getElementById("select-cycle");
  if (selectCycle) {
    selectCycle.innerHTML = '<option value="">\u2014 Choisir \u2014</option>';
  }
  var selectNiveau = document.getElementById("select-niveau");
  if (selectNiveau) {
    selectNiveau.innerHTML = '<option value="">\u2014 Choisir le cycle d\'abord \u2014</option>';
    selectNiveau.disabled = true;
  }
  var matieresGrid = document.getElementById("matieres-grid");
  if (matieresGrid) {
    matieresGrid.innerHTML = '<span class="chip-empty">Choisir un niveau pour voir les mati\u00e8res</span>';
  }
  var btnDecouvrir = document.getElementById("btn-decouvrir");
  if (btnDecouvrir) btnDecouvrir.disabled = true;
}

async function chargerCycles() {
  var res = await fetch(ALGEDU_API + "/api/cycles/" + state.site);
  var data = await res.json();
  state._cyclesData = data;
  var sel = document.getElementById("select-cycle");
  sel.innerHTML = '<option value="">\u2014 Choisir \u2014</option>';
  Object.keys(data).forEach(function(slug) {
    var info = data[slug];
    var opt = document.createElement("option");
    opt.value = slug;
    opt.textContent = info.label || slug;
    sel.appendChild(opt);
  });
}

function initCycleNiveau() {
  var selectCycle = document.getElementById("select-cycle");
  if (selectCycle) {
    selectCycle.addEventListener("change", function() {
      state.cycle = selectCycle.value;
      var selectNiveau = document.getElementById("select-niveau");
      selectNiveau.disabled = true;
      selectNiveau.innerHTML = '<option value="">\u2014 Chargement... \u2014</option>';
      var data = state._cyclesData && state._cyclesData[state.cycle];
      if (data && data.niveaux) {
        selectNiveau.innerHTML = '<option value="">\u2014 Choisir \u2014</option>';
        Object.keys(data.niveaux).forEach(function(nid) {
          var ninfo = data.niveaux[nid];
          var opt = document.createElement("option");
          opt.value = nid;
          opt.textContent = typeof ninfo === "string" ? ninfo : (ninfo.label || nid);
          selectNiveau.appendChild(opt);
        });
        selectNiveau.disabled = false;
      }
    });
  }

  var selectNiveau = document.getElementById("select-niveau");
  if (selectNiveau) {
    selectNiveau.addEventListener("change", function() {
      state.niveau = selectNiveau.value;
      chargerMatieres();
    });
  }
}

async function chargerMatieres() {
  var matieresGrid = document.getElementById("matieres-grid");
  if (!matieresGrid) return;
  matieresGrid.innerHTML = '<span class="chip-empty">Chargement des mati\u00e8res...</span>';
  try {
    var res = await fetch(ALGEDU_API + "/api/matieres", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({site: state.site, cycle: state.cycle, niveau: state.niveau}),
    });
    var data = await res.json();
    if (data.job_id) {
      var job = await waitForJob(data.job_id);
      if (job && job.error) {
        matieresGrid.innerHTML = '<span class="chip-empty">\u26a0 ' + escapeHTML(job.error) + '</span>';
        return;
      }
      if (job && job.result && job.result.matieres) {
        state.matieresDisponibles = {};
        job.result.matieres.forEach(function(m) { state.matieresDisponibles[m.slug || m] = m.label || m; });
        renderMatieres();
      } else {
        matieresGrid.innerHTML = '<span class="chip-empty">\u26a0 Aucune mati\u00e8re trouv\u00e9e ou timeout.</span>';
      }
    } else if (data.error) {
      matieresGrid.innerHTML = '<span class="chip-empty">\u26a0 ' + escapeHTML(data.error) + '</span>';
    }
  } catch(e) {
    matieresGrid.innerHTML = '<span class="chip-empty">\u26a0 Erreur de connexion : ' + escapeHTML(e.message) + '</span>';
  }
}

function renderMatieres() {
  var matieresGrid = document.getElementById("matieres-grid");
  if (!matieresGrid) return;
  matieresGrid.innerHTML = '';
  Object.keys(state.matieresDisponibles).forEach(function(slug) {
    var label = state.matieresDisponibles[slug];
    var chip = document.createElement("button");
    chip.className = "chip" + (state.matieresSelectionnees.has(slug) ? " selected" : "");
    chip.textContent = label;
    chip.addEventListener("click", function() {
      if (state.matieresSelectionnees.has(slug)) {
        state.matieresSelectionnees.delete(slug);
        chip.classList.remove("selected");
      } else {
        state.matieresSelectionnees.add(slug);
        chip.classList.add("selected");
      }
    });
    matieresGrid.appendChild(chip);
  });
  var btnDecouvrir = document.getElementById("btn-decouvrir");
  if (btnDecouvrir) btnDecouvrir.disabled = false;
}

// ── ÉTAPE 2 : découverte ─────────────────────────────────────────────

function initDecouverte() {
  var btn = document.getElementById("btn-decouvrir");
  if (btn) {
    btn.addEventListener("click", function() {
      lancerDecouverte();
    });
  }
}

async function lancerDecouverte() {
  var panelFiches = document.getElementById("panel-fiches");
  if (panelFiches) panelFiches.style.display = "block";
  var fichesLog = document.getElementById("fiches-log");
  if (fichesLog) fichesLog.innerHTML = '';
  var fichesCount = document.getElementById("fiches-count");
  if (fichesCount) fichesCount.textContent = '';

  try {
    var res = await fetch(ALGEDU_API + "/api/decouvrir", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        site: state.site,
        cycle: state.cycle,
        niveau: state.niveau,
        matieres: Array.from(state.matieresSelectionnees),
      }),
    });
    var data = await res.json();
    if (data.job_id) {
      state.currentDiscoveryJob = data.job_id;
      listenSSE(data.job_id, "fiches", function(evt) {
        if (evt.msg) appendLog("fiches-log", evt.msg);
      }, function(result) {
        if (result && result.fiches) {
          state.fiches = result.fiches;
          state.fichesFiltrees = result.fiches.slice();
          renderFiches();
          var panelDownload = document.getElementById("panel-download");
          if (panelDownload) panelDownload.style.display = "block";
        }
      });
    }
  } catch(e) {
    appendLog("fiches-log", "\u2717 Erreur de connexion");
  }
}

// ── ÉTAPE 3 : résultats ──────────────────────────────────────────────

function renderFiches() {
  var wrap = document.getElementById("fiches-table-wrap");
  if (!wrap) return;
  var count = document.getElementById("fiches-count");
  if (count) count.textContent = state.fichesFiltrees.length + " fiche(s)";

  var filtersRow = document.getElementById("filtres-row");
  if (filtersRow) filtersRow.style.display = state.fiches.length > 0 ? "flex" : "none";

  if (state.fichesFiltrees.length === 0) {
    wrap.innerHTML = '<div class="empty-state"><div class="glyph">\u2300</div>Aucune fiche trouv\u00e9e.</div>';
    return;
  }

  if (state.vue === "cards") {
    renderCards(wrap);
  } else {
    renderTable(wrap);
  }
}

function renderTable(wrap) {
  var html = '<table class="fiches-table"><thead><tr>';
  html += '<th><input type="checkbox" id="check-all"></th>';
  html += '<th>Titre</th><th>Mati\u00e8re</th><th>Trimestre</th><th>Ann\u00e9e</th><th>Corrig\u00e9</th>';
  html += '</tr></thead><tbody>';
  state.fichesFiltrees.forEach(function(f, i) {
    var sel = state.fichesSelectionnees.has(i) ? " checked" : "";
    html += '<tr>';
    html += '<td><input type="checkbox" class="fiche-check" data-idx="' + i + '"' + sel + '></td>';
    html += '<td>' + escapeHTML(f.titre || '—') + '</td>';
    html += '<td>' + escapeHTML(f.matiere || '—') + '</td>';
    html += '<td>' + (f.trimestre || '—') + '</td>';
    html += '<td>' + (f.annee || '—') + '</td>';
    html += '<td>' + (f.corrige ? '✅' : '❌') + '</td>';
    html += '</tr>';
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;

  var checkAll = document.getElementById("check-all");
  if (checkAll) {
    checkAll.addEventListener("change", function() {
      var checked = checkAll.checked;
      state.fichesSelectionnees.clear();
      if (checked) {
        state.fichesFiltrees.forEach(function(_, i) { state.fichesSelectionnees.add(i); });
      }
      document.querySelectorAll(".fiche-check").forEach(function(cb) {
        cb.checked = checked;
      });
      updateDownloadButton();
    });
  }

  document.querySelectorAll(".fiche-check").forEach(function(cb) {
    cb.addEventListener("change", function() {
      var idx = parseInt(cb.getAttribute("data-idx"));
      if (cb.checked) {
        state.fichesSelectionnees.add(idx);
      } else {
        state.fichesSelectionnees.delete(idx);
      }
      updateDownloadButton();
    });
  });

  updateDownloadButton();
}

function renderCards(wrap) {
  var html = '<div class="fiches-cards">';
  state.fichesFiltrees.forEach(function(f, i) {
    var sel = state.fichesSelectionnees.has(i) ? " selected" : "";
    html += '<div class="fiche-card' + sel + '" data-idx="' + i + '">';
    html += '<div class="card-title">' + escapeHTML(f.titre || '—') + '</div>';
    html += '<div class="card-meta">' + escapeHTML(f.matiere || '—') + ' &middot; ' + (f.trimestre || '—') + ' &middot; ' + (f.annee || '—') + '</div>';
    html += '<div class="card-badge">' + (f.corrige ? '✅ Corrigé' : '❌ Non corrigé') + '</div>';
    html += '</div>';
  });
  html += '</div>';
  wrap.innerHTML = html;

  document.querySelectorAll(".fiche-card").forEach(function(card) {
    card.addEventListener("click", function() {
      var idx = parseInt(card.getAttribute("data-idx"));
      if (state.fichesSelectionnees.has(idx)) {
        state.fichesSelectionnees.delete(idx);
        card.classList.remove("selected");
      } else {
        state.fichesSelectionnees.add(idx);
        card.classList.add("selected");
      }
      updateDownloadButton();
    });
  });

  updateDownloadButton();
}

function updateDownloadButton() {
  var btn = document.getElementById("btn-telecharger");
  if (btn) {
    btn.textContent = "⬇ Téléchargement (" + state.fichesSelectionnees.size + ")";
    btn.disabled = state.fichesSelectionnees.size === 0;
  }
  var btnZip = document.getElementById("btn-telecharger-zip");
  if (btnZip) {
    btnZip.disabled = state.fichesSelectionnees.size === 0;
  }
  var btnCloud = document.getElementById("btn-telecharger-cloud");
  if (btnCloud) {
    btnCloud.disabled = state.fichesSelectionnees.size === 0;
  }
  var btnCloudPlus = document.getElementById("btn-telecharger-plus-cloud");
  if (btnCloudPlus) {
    btnCloudPlus.disabled = state.fichesSelectionnees.size === 0;
  }
}

function changerVue(v) {
  state.vue = v;
  document.querySelectorAll(".vbtn").forEach(function(b) {
    b.classList.toggle("act", b.getAttribute("data-view") === v);
  });
  renderFiches();
}

// ── ÉTAPE 4 : téléchargement ─────────────────────────────────────────

function initTelechargement() {
  var btn = document.getElementById("btn-telecharger");
  if (btn) {
    btn.addEventListener("click", function() {
      lancerTelechargement("normal");
    });
  }

  var btnZip = document.getElementById("btn-telecharger-zip");
  if (btnZip) {
    btnZip.addEventListener("click", function() {
      lancerTelechargement("zip");
    });
  }

  var btnCloud = document.getElementById("btn-telecharger-cloud");
  if (btnCloud) {
    btnCloud.addEventListener("click", function() {
      lancerTelechargement("cloud");
    });
  }

  var btnCloudPlus = document.getElementById("btn-telecharger-plus-cloud");
  if (btnCloudPlus) {
    btnCloudPlus.addEventListener("click", function() {
      lancerTelechargement("cloud-plus");
    });
  }

  var btnAnnuler = document.getElementById("btn-annuler-telechargement");
  if (btnAnnuler) {
    btnAnnuler.addEventListener("click", function() {
      annulerTelechargement();
    });
  }

  initCloudComptes();
}

async function lancerTelechargement(mode) {
  var fiches = [];
  state.fichesSelectionnees.forEach(function(idx) {
    fiches.push(state.fichesFiltrees[idx]);
  });
  if (fiches.length === 0) return;

  var panel = document.getElementById("download-progress");
  if (panel) panel.style.display = "block";
  var logEl = document.getElementById("download-log");
  if (logEl) logEl.innerHTML = '';
  var resultEl = document.getElementById("download-result");
  if (resultEl) resultEl.innerHTML = '';

  var url = ALGEDU_API + "/api/telecharger";
  var body = {
    site: state.site,
    fiches: fiches,
    dossier: state.site + "_export",
    niveau: state.niveau,
    separer_corrige: true,
    clean_pdf: true,
    cover_footer: false,
  };

  if (mode === "cloud" || mode === "cloud-plus") {
    var select = document.getElementById("select-cloud-compte");
    var val = select ? select.value : "";
    if (!val) {
      appendLog("download-log", "\u2717 Aucun compte cloud sélectionné");
      return;
    }
    var parts = val.split("::");
    url = ALGEDU_API + "/api/telecharger-cloud";
    body.provider = parts[0];
    body.compte = parts[1];
    if (mode === "cloud-plus") {
      url = ALGEDU_API + "/api/telecharger-cloud";
    }
  }

  try {
    var res = await fetch(url, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(body),
    });
    var data = await res.json();
    if (data.job_id) {
      state.currentDownloadJob = data.job_id;
      listenSSE(data.job_id, "download", function(evt) {
        if (evt.msg) appendLog("download-log", evt.msg);
      }, function(result) {
        if (result && result.ok !== undefined) {
          var resultEl = document.getElementById("download-result");
          if (resultEl) {
            resultEl.innerHTML = '<div class="result-banner">\u2705 Termin\u00e9 : ' + result.ok + ' r\u00e9ussis, ' + result.err + ' \u00e9checs.</div>';
          }
        }
      });
    }
  } catch(e) {
    appendLog("download-log", "\u2717 Erreur de connexion");
  }
}

function annulerTelechargement() {
  if (state.currentDownloadJob) {
    fetch(ALGEDU_API + "/api/annuler/" + state.currentDownloadJob, {method: "POST"});
  }
}

// ── Cloud comptes ─────────────────────────────────────────────────────

async function initCloudComptes() {
  try {
    var res = await fetch(ALGEDU_API + "/api/cloud-status");
    var data = await res.json();
    var select = document.getElementById("select-cloud-compte");
    if (!select) return;
    select.innerHTML = '<option value="">\u2014 Cloud (optionnel) \u2014</option>';
    if (data.comptes) {
      Object.keys(data.comptes).forEach(function(provider) {
        data.comptes[provider].forEach(function(nom) {
          var opt = document.createElement("option");
          opt.value = provider + "::" + nom;
          opt.textContent = provider.toUpperCase() + " / " + nom;
          select.appendChild(opt);
        });
      });
    }
  } catch(e) { /* ignore */ }
}

// ── SSE helper ────────────────────────────────────────────────────────

function listenSSE(jobId, prefix, onLog, onDone) {
  var url = ALGEDU_API + "/api/stream/" + jobId;
  var source = new EventSource(url);
  source.onmessage = function(e) {};
  source.addEventListener("log", function(e) {
    try {
      var data = JSON.parse(e.data);
      if (onLog) onLog(data);
    } catch(ex) { /* ignore */ }
  });
  source.addEventListener("end", function(e) {
    source.close();
    fetch(ALGEDU_API + "/api/job/" + jobId).then(function(r) { return r.json(); }).then(function(job) {
      if (onDone && job.result) onDone(job.result);
    }).catch(function() {});
  });
  source.addEventListener("error", function() {
    source.close();
  });
}

// ── Helpers ───────────────────────────────────────────────────────────

function appendLog(elId, msg) {
  var el = document.getElementById(elId);
  if (!el) return;
  var line = document.createElement("div");
  line.className = "log-line";
  line.textContent = msg;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

function escapeHTML(str) {
  if (typeof str !== "string") return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function waitForJob(jobId) {
  var url = ALGEDU_API + "/api/job/" + jobId;
  for (var i = 0; i < 300; i++) {
    try {
      var res = await fetch(url);
      if (res.status === 404) {
        await new Promise(function(r) { setTimeout(r, 2000); });
        continue;
      }
      var job = await res.json();
      if (job.status === "done" || job.status === "error") {
        return job;
      }
    } catch(e) { /* retry */ }
    await new Promise(function(r) { setTimeout(r, 1000); });
  }
  return null;
}

// ── Init ──────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", function() {
  initThemeToggle();
  initSiteCards();
  initCycleNiveau();
  initDecouverte();
  initTelechargement();
  changerVue("table");
});

window.changerVue = changerVue;
