/* ========================================================================
   BACKROOM by FMR - v15.3 (Comptabilité, Dépenses, Suppression Dossier & UX)
   ======================================================================== */

window.gapiClientLoaded = function() { googleApiManager.gapiClientLoaded(); };
window.gisClientLoaded = function() { googleApiManager.gisClientLoaded(); };

let gapiReady = false;
let gisReady = false;
let onLoginCallback = null;
let tokenClient = null;
let mainChartInstance = null;

const COMPTA_SHEET_NAME = "Comptabilite";
const EXPENSES_SHEET_NAME = "Depenses";
const PROJECTS_SHEET_NAME = "Projets";

const COMPTA_HEADERS = [
    "Date", "Origine/Dossier", "Reference", "Nom/Description", 
    "Prix TTC", "HT (80%)", "TVA", "Mode Reglement", 
    "Type Transaction", "Details Specifiques", "Donnees Produit Origine", "Statut Operation"
];

const EXPENSES_HEADERS = [
    "ID", "Date", "Categorie", "Description", "Montant TTC", "Montant HT", "TVA", "Mode Paiement", "ProjetID"
];

const PROJECTS_HEADERS = [
    "ID", "Nom", "Date Debut", "Date Fin", "Statut", "Description", "Canaux", "Budget Ads", "Budget Prod", "Drive Link", "Plan", "Checklist", "Priorite", "Trello Link"
];

const PROJECT_TEMPLATES = {
    capsule: {
        name: "Lancement Collection Capsule",
        desc: "Campagne de communication globale pour la nouvelle capsule vintage et custom.",
        channels: ["Instagram", "TikTok", "Newsletter", "Shooting", "Boutique"],
        priority: "Haute",
        tasks: ["Sélection des pièces maîtresses", "Shooting lookbook photo & vidéo", "Montage 3x Reels / TikToks", "Rédaction newsletter teasing", "Installation corner vitrine boutique"],
        budgetAds: "50", budgetProd: "100"
    },
    depot: {
        name: "Mise en avant Dépôt-Vente & Créateurs",
        desc: "Showcase des nouvelles pièces déposées en boutique pour stimuler les ventes dépositaires.",
        channels: ["Instagram", "TikTok", "Boutique"],
        priority: "Moyenne",
        tasks: ["Photos portées des pièces du dépositaire", "Story interview / présentation marque", "Création étiquettes et mise en rayon dédiée"],
        budgetAds: "20", budgetProd: "0"
    },
    concours: {
        name: "Jeu Concours Réseaux Sociaux",
        desc: "Fidélisation et gain d'abonnés avec une pièce emblématique à gagner.",
        channels: ["Instagram", "TikTok"],
        priority: "Moyenne",
        tasks: ["Définition des règles et lot", "Visuel d'annonce interactif", "Lancement et animation stories", "Tirage au sort et remise en main propre"],
        budgetAds: "30", budgetProd: "0"
    },
    shoot: {
        name: "Shooting Photo & Lookbook",
        desc: "Production de contenus visuels haute définition pour le site et les réseaux.",
        channels: ["Shooting", "Instagram"],
        priority: "Basse",
        tasks: ["Moodboard & sélection des looks", "Réservation mannequin / lieu", "Shooting & tri des rushes", "Export et retouches HD sur Google Drive"],
        budgetAds: "0", budgetProd: "80"
    }
};

// ======================= INDEXEDDB CACHE & SYNC ======================= //
const idbManager = {
    db: null,
    init: () => {
        return new Promise((resolve) => {
            const req = indexedDB.open("BackroomFMR_IDB", 2);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains("pendingSales")) {
                    db.createObjectStore("pendingSales", { keyPath: "id", autoIncrement: true });
                }
                if (!db.objectStoreNames.contains("sheetCache")) {
                    db.createObjectStore("sheetCache", { keyPath: "sheetName" });
                }
            };
            req.onsuccess = (e) => {
                idbManager.db = e.target.result;
                resolve();
            };
            req.onerror = () => resolve();
        });
    },

    savePendingSale: async (saleData) => {
        if (!idbManager.db) return;
        const tx = idbManager.db.transaction("pendingSales", "readwrite");
        tx.objectStore("pendingSales").add(saleData);
        updateOfflineBadge();
    },

    getPendingSales: () => {
        return new Promise((resolve) => {
            if (!idbManager.db) return resolve([]);
            const tx = idbManager.db.transaction("pendingSales", "readonly");
            const req = tx.objectStore("pendingSales").getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
        });
    },

    clearPendingSales: () => {
        if (!idbManager.db) return;
        const tx = idbManager.db.transaction("pendingSales", "readwrite");
        tx.objectStore("pendingSales").clear();
        updateOfflineBadge();
    },

    cacheSheetData: async (sheetName, rows) => {
        if (!idbManager.db) return;
        const tx = idbManager.db.transaction("sheetCache", "readwrite");
        tx.objectStore("sheetCache").put({ sheetName, rows, timestamp: Date.now() });
    },

    getCachedSheetData: (sheetName) => {
        return new Promise((resolve) => {
            if (!idbManager.db) return resolve(null);
            const tx = idbManager.db.transaction("sheetCache", "readonly");
            const req = tx.objectStore("sheetCache").get(sheetName);
            req.onsuccess = () => resolve(req.result ? req.result.rows : null);
            req.onerror = () => resolve(null);
        });
    }
};

function updateOfflineBadge() {
    idbManager.getPendingSales().then(items => {
        const badge = document.getElementById('offline-badge');
        if (badge) {
            if (!navigator.onLine || items.length > 0) {
                badge.classList.remove('hidden');
                badge.innerHTML = `<i class="fas fa-wifi-slash"></i> ${items.length} opération(s) en attente`;
            } else {
                badge.classList.add('hidden');
            }
        }
    });
}

window.addEventListener('online', async () => {
    updateOfflineBadge();
    showNotification("Connexion rétablie. Synchronisation...", "info");
    await syncPendingSales();
});
window.addEventListener('offline', updateOfflineBadge);

async function syncPendingSales() {
    if (!navigator.onLine || !state.currentSpreadsheetId) return;
    const pendings = await idbManager.getPendingSales();
    if (pendings.length === 0) return;

    for (const item of pendings) {
        if (item.action === "soldProduct") {
            await googleApiManager.appendRow(state.currentSpreadsheetId, `${COMPTA_SHEET_NAME}!A:L`, item.comptaRow);
            if (item.originSheetId && item.rowIdx) {
                await googleApiManager.deleteRow(state.currentSpreadsheetId, item.originSheetId, item.rowIdx);
            }
        } else if (item.action === "directSale") {
            await googleApiManager.appendRow(state.currentSpreadsheetId, `${COMPTA_SHEET_NAME}!A:L`, item.comptaRow);
        }
    }
    idbManager.clearPendingSales();
    showNotification("Synchronisation terminée !", "success");
    loadComptaData();
}

// ======================= GOOGLE API MANAGER ======================= //
const googleApiManager = {
    CLIENT_ID: '539526644294-d6jju7s5artqk518ptt3t27laih4i7qg.apps.googleusercontent.com',
    gapi: null,
    gis: null,

    initClient: (onLoginStatusChange) => {
        onLoginCallback = onLoginStatusChange;
    },

    loadGoogleScripts: () => {
        const scriptGis = document.createElement('script');
        scriptGis.src = "https://accounts.google.com/gsi/client";
        scriptGis.async = true; scriptGis.defer = true;
        scriptGis.onload = window.gisClientLoaded;
        scriptGis.onerror = () => showNotification("Erreur Identity", "error");
        document.body.appendChild(scriptGis);

        const scriptGapi = document.createElement('script');
        scriptGapi.src = "https://apis.google.com/js/api.js";
        scriptGapi.async = true; scriptGapi.defer = true;
        scriptGapi.onload = window.gapiClientLoaded;
        scriptGapi.onerror = () => showNotification("Erreur API", "error");
        document.body.appendChild(scriptGapi);
    },

    gapiClientLoaded: () => {
        gapi.load('client:picker', async () => {
            try {
                await gapi.client.init({ discoveryDocs: ['https://sheets.googleapis.com/$discovery/rest?version=v4'] });
                googleApiManager.gapi = gapi;
                gapiReady = true;
                if (gisReady) googleApiManager.tryAutoLogin();
            } catch (err) {
                console.error("Erreur GAPI", err);
            }
        });
    },

    gisClientLoaded: () => {
        try {
            googleApiManager.gis = window.google.accounts;
            tokenClient = googleApiManager.gis.oauth2.initTokenClient({
                client_id: googleApiManager.CLIENT_ID,
                scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.readonly',
                callback: (tokenResponse) => {
                    if (tokenResponse && tokenResponse.access_token) {
                        showNotification("Connexion réussie", "success");
                        if (onLoginCallback) onLoginCallback(true);
                    }
                },
            });
            gisReady = true;
            const loginBtn = document.getElementById('g-login-btn-main');
            if(loginBtn) {
                loginBtn.disabled = false; loginBtn.style.opacity = '1'; loginBtn.style.cursor = 'pointer';
                loginBtn.textContent = "Connexion avec Google";
            }
            if (gapiReady) googleApiManager.tryAutoLogin();
        } catch (e) { console.error("Erreur GIS", e); }
    },

    tryAutoLogin: () => {
        if (!googleApiManager.gapi || !googleApiManager.gapi.client) return;
        const token = googleApiManager.gapi.client.getToken();
        if (token && onLoginCallback) onLoginCallback(true);
    },

    handleLogin: () => {
        if (tokenClient) tokenClient.requestAccessToken({prompt: ''}); 
        else showNotification("Connexion non prête.", "error");
    },

    handleLogout: (onLoginStatusChange) => {
        if (!googleApiManager.gapi) return;
        const token = googleApiManager.gapi.client.getToken();
        if (token) {
            googleApiManager.gis.oauth2.revoke(token.access_token, () => {
                googleApiManager.gapi.client.setToken(null);
                onLoginStatusChange(false);
                showNotification("Déconnecté", "info");
            });
        }
    },

    getSpreadsheetDetails: async (id) => {
        try {
            const res = await googleApiManager.gapi.client.sheets.spreadsheets.get({ spreadsheetId: id });
            return res.result;
        } catch (e) { handleApiError(e, "lecture onglets"); return null; }
    },

    getSheetData: async (id, range) => {
        const sheetName = range.split('!')[0];
        try {
            if (!navigator.onLine) throw new Error("Offline");
            const res = await googleApiManager.gapi.client.sheets.spreadsheets.values.get({ spreadsheetId: id, range });
            const rows = res.result.values || [];
            await idbManager.cacheSheetData(sheetName, rows);
            return rows;
        } catch (e) {
            const cached = await idbManager.getCachedSheetData(sheetName);
            if (cached) {
                showNotification("Mode hors-ligne : Données chargées depuis le cache", "info");
                return cached;
            }
            return [];
        }
    },

    getBatchSheetData: async (id, ranges) => {
        try {
            if (!navigator.onLine) throw new Error("Offline");
            const res = await googleApiManager.gapi.client.sheets.spreadsheets.values.batchGet({ spreadsheetId: id, ranges });
            return res.result.valueRanges || [];
        } catch (e) {
            return [];
        }
    },

    appendRow: async (id, range, values) => {
        try {
            if (!navigator.onLine) throw new Error("Offline");
            await googleApiManager.gapi.client.sheets.spreadsheets.values.append({
                spreadsheetId: id, range, valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS',
                resource: { values: [values] }
            });
            return true;
        } catch (e) { handleApiError(e, "ajout"); return false; }
    },

    updateRow: async (id, range, values) => {
        try {
            if (!navigator.onLine) throw new Error("Offline");
            await googleApiManager.gapi.client.sheets.spreadsheets.values.update({
                spreadsheetId: id, range, valueInputOption: 'USER_ENTERED', resource: { values: [values] }
            });
            return true;
        } catch (e) { handleApiError(e, "maj"); return false; }
    },

    deleteRow: async (id, sheetId, rowIdx) => {
        try {
            if (!navigator.onLine) throw new Error("Offline");
            const sheetIdInt = parseInt(sheetId, 10);
            await googleApiManager.gapi.client.sheets.spreadsheets.batchUpdate({
                spreadsheetId: id,
                resource: { 
                    requests: [{ 
                        deleteDimension: { 
                            range: { sheetId: sheetIdInt, dimension: 'ROWS', startIndex: rowIdx - 1, endIndex: rowIdx } 
                        } 
                    }] 
                }
            });
            return true;
        } catch (e) { handleApiError(e, "suppression"); return false; }
    },

    addSheet: async (id, title) => {
        try {
            if (!navigator.onLine) throw new Error("Offline");
            await googleApiManager.gapi.client.sheets.spreadsheets.batchUpdate({
                spreadsheetId: id, resource: { requests: [{ addSheet: { properties: { title } } }] }
            });
            return true;
        } catch (e) { handleApiError(e, "création"); return false; }
    },

    renameSheet: async (id, sheetId, newTitle) => {
        try {
            if (!navigator.onLine) throw new Error("Offline");
            const sheetIdInt = parseInt(sheetId, 10);
            await googleApiManager.gapi.client.sheets.spreadsheets.batchUpdate({
                spreadsheetId: id,
                resource: { requests: [{ updateSheetProperties: { properties: { sheetId: sheetIdInt, title: newTitle }, fields: 'title' } }] }
            });
            return true;
        } catch (e) { handleApiError(e, "renommage"); return false; }
    }
};

// ======================= APPLICATION LOGIC ======================= //
let state = {
    currentSpreadsheetId: localStorage.getItem('spreadsheetId') || null,
    spreadsheetDetails: null,
    currentSheet: null,
    headers: [],
    data: [],
    view: 'sheets',
    currentPage: 1,
    itemsPerPage: 12,
    formHeaders: [],
    comptaRawRows: [],
    expensesRawRows: [],
    projects: [],
    currentProjectChecklist: []
};

const els = {};

async function initializeApp() {
    await idbManager.init();
    updateOfflineBadge();

    els.app = document.getElementById('app-container');
    els.grid = document.getElementById('inventory-grid');
    els.search = document.getElementById('search-input');
    els.breadcrumbs = document.getElementById('breadcrumbs');
    els.title = document.getElementById('stock-title');
    els.backBtn = document.getElementById('back-btn');
    els.fab = document.querySelector('.fab-container');
    els.loginOverlay = document.getElementById('login-overlay');
    els.sheetPrompt = document.getElementById('sheet-prompt');
    els.sheetInput = document.getElementById('spreadsheet-id-input');

    const bindClick = (id, fn) => { const el = document.getElementById(id); if(el) el.addEventListener('click', fn); };
    const bindSubmit = (id, fn) => { const el = document.getElementById(id); if(el) el.addEventListener('submit', fn); };
    const bindChange = (id, fn) => { const el = document.getElementById(id); if(el) el.addEventListener('change', fn); };

    bindClick('g-login-btn-main', googleApiManager.handleLogin);
    bindClick('g-logout-btn-header', () => googleApiManager.handleLogout(updateAuthState));
    bindClick('g-logout-btn-main', () => googleApiManager.handleLogout(updateAuthState));

    bindSubmit('sheet-id-form', (e) => {
        e.preventDefault();
        loadSpreadsheet(els.sheetInput.value.trim());
    });
    bindClick('change-sheet-btn', handleChangeSheet);
    bindClick('open-picker-btn', createPicker);

    document.querySelectorAll('nav a').forEach(l => l.addEventListener('click', handleNav));
    if(els.backBtn) els.backBtn.addEventListener('click', goBack);

    document.querySelectorAll('.modal .close, .modal .close-modal-btn').forEach(btn => 
        btn.addEventListener('click', e => {
            const m = e.target.closest('.modal');
            if (m) m.style.display = 'none';
        })
    );
    window.addEventListener('click', e => { if (e.target.classList.contains('modal')) closeModal(e.target); });

    // Fermer les menus d'engrenage des dossiers si clic en dehors
    window.addEventListener('click', (e) => {
        if (!e.target.closest('.more-menu')) {
            document.querySelectorAll('.more-content.show').forEach(m => m.classList.remove('show'));
        }
    });

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal').forEach(m => { m.style.display = 'none'; });
            if (els.fab) els.fab.classList.remove('active');
        }
    });

    bindSubmit('rename-form', handleRenameSubmit);
    bindChange('form-sheet-select', handleFormSheetChange);
    bindSubmit('main-add-form', handleMainFormSubmit);
    bindSubmit('create-sheet-form', handleAddSheet);

    bindClick('fab-add-btn', () => els.fab.classList.toggle('active'));
    bindClick('add-product-fab-btn', openAddModal);
        bindClick('add-folder-fab-btn', () => { 
        const m = document.getElementById('create-sheet-modal'); 
        if(m) {
            const sel = document.getElementById('sheet-template');
            if (sel) {
                sel.innerHTML = '<option value="custom">-- Créer un formulaire sur mesure --</option>';
                if (state.spreadsheetDetails && state.spreadsheetDetails.sheets) {
                    state.spreadsheetDetails.sheets.forEach(sheet => {
                        const title = sheet.properties.title;
                        if (title !== COMPTA_SHEET_NAME && title !== PROJECTS_SHEET_NAME && title !== EXPENSES_SHEET_NAME) {
                            const opt = document.createElement('option');
                            opt.value = title;
                            opt.textContent = `Cloner les champs de : ${title}`;
                            sel.appendChild(opt);
                        }
                    });
                }
                sel.onchange = () => {
                    const grp = document.getElementById('custom-headers-group');
                    const inp = document.getElementById('custom-headers');
                    if (sel.value === 'custom') {
                        grp.style.display = 'block';
                        inp.required = true;
                    } else {
                        grp.style.display = 'none';
                        inp.required = false;
                    }
                };
                sel.onchange(); // Force l'affichage initial
            }
            m.style.display = 'block';
            setTimeout(() => document.getElementById('sheet-name')?.focus(), 50);
        }
    });

    bindClick('header-btn-import', () => { const i = document.getElementById('header-csv-input'); if(i) i.click(); });
    bindClick('header-btn-export', handleExportClick);
    bindChange('header-csv-input', (e) => {
        if(e.target.files.length > 0) importCSV(e.target.files[0]);
    });

    if(els.search) els.search.addEventListener('input', () => { state.currentPage = 1; renderProductList(); });
    bindChange('filter-stock-price', () => { state.currentPage = 1; renderProductList(); });
    bindChange('filter-stock-sort', () => { state.currentPage = 1; renderProductList(); });

    bindChange('filter-compta-period', renderFilteredCompta);
    bindChange('filter-compta-type', renderFilteredCompta);
    bindChange('filter-compta-payment', renderFilteredCompta);
    bindChange('filter-compta-status', renderFilteredCompta);
    bindClick('export-fec-btn', exportFEC);

    bindChange('filter-expense-period', renderFilteredExpenses);
    bindChange('filter-expense-cat', renderFilteredExpenses);

    bindClick('view-kanban-btn', () => {
        document.getElementById('view-kanban-btn')?.classList.add('active');
        document.getElementById('view-timeline-btn')?.classList.remove('active');
        document.getElementById('projects-kanban')?.classList.remove('hidden');
        document.getElementById('projects-timeline')?.classList.add('hidden');
    });
    bindClick('view-timeline-btn', () => {
        document.getElementById('view-timeline-btn')?.classList.add('active');
        document.getElementById('view-kanban-btn')?.classList.remove('active');
        document.getElementById('projects-kanban')?.classList.add('hidden');
        document.getElementById('projects-timeline')?.classList.remove('hidden');
        renderTimeline();
    });

    if(els.grid) els.grid.addEventListener('click', handleGridClick);

    setupSaleForms();
    setupExpenseForms();
    setupProjectEvents();
    setupTheme();

    googleApiManager.initClient(updateAuthState);
    googleApiManager.loadGoogleScripts();
}

// --- FORMULAIRES DE VENTE ---
function setupSaleForms() {
    const saleModal = document.getElementById('sale-product-modal');
    const salePriceInput = document.getElementById('sale-price');
    const transTypeSelect = document.getElementById('sale-trans-type');
    const paymentMethodSelect = document.getElementById('sale-payment-method');

    const updateCalculations = () => {
        if (!salePriceInput) return;
        const ttc = parsePrice(salePriceInput.value);
        const transType = transTypeSelect ? transTypeSelect.value : 'B2C';
        
        let ht = 0;
        let tva = 0;

        if (transType === 'DEPOT') {
            const ownerDue = parsePrice(document.getElementById('depot-owner-due')?.value);
            const storeCommissionTTC = Math.max(0, ttc - ownerDue);
            const commissionHT = storeCommissionTTC / 1.20;
            tva = storeCommissionTTC - commissionHT;
            ht = commissionHT;

            const elGain = document.getElementById('depot-store-gain');
            if (elGain) elGain.value = storeCommissionTTC.toFixed(2);
        } else if (transType === 'B2B') {
            ht = ttc;
            tva = 0;
        } else {
            ht = ttc / 1.20;
            tva = ttc - ht;
        }

        const elTTC = document.getElementById('sale-calc-ttc');
        const elHT = document.getElementById('sale-calc-ht');
        const elTVA = document.getElementById('sale-calc-tva');

        if (elTTC) elTTC.textContent = ttc.toFixed(2) + ' €';
        if (elHT) elHT.textContent = ht.toFixed(2) + ' €';
        if (elTVA) elTVA.textContent = tva.toFixed(2) + ' €';

        if (paymentMethodSelect && paymentMethodSelect.value === 'Différé') {
            const paid = parsePrice(document.getElementById('diff-paid')?.value);
            const elRest = document.getElementById('diff-rest');
            if (elRest) elRest.value = Math.max(0, ttc - paid).toFixed(2);
        }
    };

    if (saleModal) {
        saleModal.addEventListener('input', (e) => {
            if (e.target && (e.target.id === 'sale-price' || e.target.id === 'diff-paid' || e.target.id === 'depot-owner-due')) {
                updateCalculations();
            }
        });
    }

    if (paymentMethodSelect) {
        paymentMethodSelect.addEventListener('change', () => {
            const diffBox = document.getElementById('diff-fields');
            const diffClient = document.getElementById('diff-client-name');
            if (diffBox && diffClient) {
                if (paymentMethodSelect.value === 'Différé') {
                    diffBox.classList.remove('hidden');
                    diffClient.disabled = false;
                    diffClient.required = true;
                } else {
                    diffBox.classList.add('hidden');
                    diffClient.disabled = true;
                    diffClient.required = false;
                    diffClient.value = '';
                }
            }
            updateCalculations();
        });
    }

    if (transTypeSelect) {
        transTypeSelect.addEventListener('change', () => {
            const b2bBox = document.getElementById('b2b-fields');
            const depotBox = document.getElementById('depot-fields');
            const b2bCompany = document.getElementById('b2b-company-name');
            const depotOwner = document.getElementById('depot-owner-name');
            const depotDueEl = document.getElementById('depot-owner-due');

            if (b2bBox) b2bBox.classList.add('hidden');
            if (depotBox) depotBox.classList.add('hidden');
            if (b2bCompany) { b2bCompany.disabled = true; b2bCompany.required = false; }
            if (depotOwner) { depotOwner.disabled = true; depotOwner.required = false; }
            if (depotDueEl) { depotDueEl.disabled = true; depotDueEl.required = false; }

            if (transTypeSelect.value === 'B2B') {
                if (b2bBox) b2bBox.classList.remove('hidden');
                if (b2bCompany) { b2bCompany.disabled = false; b2bCompany.required = true; }
            } else if (transTypeSelect.value === 'DEPOT') {
                if (depotBox) depotBox.classList.remove('hidden');
                if (depotOwner) { depotOwner.disabled = false; depotOwner.required = true; }
                if (depotDueEl) { depotDueEl.disabled = false; depotDueEl.required = true; }
            }
            updateCalculations();
        });
    }

    const saleForm = document.getElementById('sale-product-form');
    if (saleForm) {
        saleForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const submitBtn = saleForm.querySelector('button[type="submit"]');
            const originalBtnHtml = submitBtn ? submitBtn.innerHTML : '';
            if (submitBtn) {
                submitBtn.classList.add('btn-success-check');
                submitBtn.innerHTML = '<i class="fas fa-check"></i> Vente validée !';
            }

            const rowIdx = parseInt(document.getElementById('sale-product-row-idx').value, 10);
            const productData = JSON.parse(document.getElementById('sale-product-details').value || '{}');
            const ttc = parsePrice(salePriceInput.value);
            const payment = paymentMethodSelect.value;
            const transType = transTypeSelect.value;
            const linkedProjectId = document.getElementById('sale-project-link')?.value || '';
            
            let ht = 0;
            let tva = 0;
            let detailsSpecifiques = "";
            let clientOrCompany = "Client Particulier";

            if (transType === 'DEPOT') {
                const owner = document.getElementById('depot-owner-name')?.value.trim() || 'Inconnu';
                const due = parsePrice(document.getElementById('depot-owner-due')?.value);
                const commissionTTC = Math.max(0, ttc - due);
                ht = (commissionTTC / 1.20).toFixed(2);
                tva = (commissionTTC - (commissionTTC / 1.20)).toFixed(2);
                detailsSpecifiques += `[Dépôt: Dépositaire ${owner} | Dû: ${due.toFixed(2)}€ | Com Boutique TTC: ${commissionTTC.toFixed(2)}€] [STATUT_DEPOT: EN_ATTENTE] `;
                clientOrCompany = `Dépositaire: ${owner}`;
            } else if (transType === 'B2B') {
                ht = ttc.toFixed(2);
                tva = (0).toFixed(2);
                const company = document.getElementById('b2b-company-name')?.value.trim() || '';
                detailsSpecifiques += `[B2B - Hors TVA: Sté ${company}] `;
                clientOrCompany = company;
            } else {
                ht = (ttc / 1.20).toFixed(2);
                tva = (ttc - (ttc / 1.20)).toFixed(2);
            }

            if (payment === 'Différé') {
                const client = document.getElementById('diff-client-name')?.value.trim() || '';
                const paid = parsePrice(document.getElementById('diff-paid')?.value).toFixed(2);
                const rest = parsePrice(document.getElementById('diff-rest')?.value).toFixed(2);
                detailsSpecifiques += `[Différé: Client ${client} | Payé: ${paid}€ | Reste dû: ${rest}€] `;
                clientOrCompany = client;
            }

            if (linkedProjectId) {
                detailsSpecifiques += `[ProjetID:${linkedProjectId}] `;
            }

            const refKey = state.headers.find(x => x.toLowerCase().includes('ref') || x.toLowerCase().includes('code')) || '';
            const nameKey = state.headers.find(x => x.toLowerCase().includes('nom')) || state.headers[0];
            const ref = productData[refKey] || '-';
            const name = productData[nameKey] || 'Produit sans nom';

            const comptaRow = [
                new Date().toLocaleString('fr-FR'),
                state.currentSheet ? state.currentSheet.title : 'Stock',
                ref,
                name,
                ttc.toFixed(2),
                ht,
                tva,
                payment,
                transType,
                detailsSpecifiques,
                JSON.stringify(productData),
                "VALID"
            ];

            if (!navigator.onLine) {
                await idbManager.savePendingSale({
                    action: "soldProduct",
                    originSheetId: state.currentSheet ? state.currentSheet.id : null,
                    rowIdx: rowIdx,
                    comptaRow: comptaRow
                });
                setTimeout(() => {
                    document.getElementById('sale-product-modal').style.display = 'none';
                    if (submitBtn) {
                        submitBtn.classList.remove('btn-success-check');
                        submitBtn.innerHTML = originalBtnHtml;
                    }
                }, 600);
                showNotification("Vente enregistrée en mode HORS-LIGNE !", "info");
                generateInvoicePDF({ date: comptaRow[0], ref, name, ttc, ht, tva, payment, transType, client: clientOrCompany });
                return;
            }

            await ensureComptaSheetExists();
            const appendOk = await googleApiManager.appendRow(state.currentSpreadsheetId, `${COMPTA_SHEET_NAME}!A:L`, comptaRow);
            if (appendOk) {
                if (state.currentSheet) {
                    await googleApiManager.deleteRow(state.currentSpreadsheetId, state.currentSheet.id, rowIdx);
                }
                setTimeout(() => {
                    document.getElementById('sale-product-modal').style.display = 'none';
                    if (submitBtn) {
                        submitBtn.classList.remove('btn-success-check');
                        submitBtn.innerHTML = originalBtnHtml;
                    }
                    showNotification("Article vendu et déplacé en Comptabilité !", "success");
                    renderProductList();
                }, 600);
                generateInvoicePDF({ date: comptaRow[0], ref, name, ttc, ht, tva, payment, transType, client: clientOrCompany });
            } else {
                if (submitBtn) {
                    submitBtn.classList.remove('btn-success-check');
                    submitBtn.innerHTML = originalBtnHtml;
                }
                showNotification("Erreur lors de l'enregistrement.", "error");
            }
        });
    }

    const directSaleBtn = document.getElementById('open-direct-sale-modal-btn');
    if (directSaleBtn) {
        directSaleBtn.addEventListener('click', () => {
            updateProjectSelectOptions('ds-project-link');
            const m = document.getElementById('direct-sale-modal');
            if(m) {
                m.style.display = 'block';
                const firstInput = m.querySelector('input:not([type="hidden"])');
                if (firstInput) firstInput.focus();
            }
        });
    }

    const directSaleForm = document.getElementById('direct-sale-form');
    if (directSaleForm) {
        directSaleForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const type = document.getElementById('ds-type')?.value || 'Vente Web';
            const desc = document.getElementById('ds-desc')?.value || '';
            const ttc = parsePrice(document.getElementById('ds-price')?.value);
            const payment = document.getElementById('ds-payment')?.value || 'Carte';
            const client = document.getElementById('ds-client')?.value || 'Client Standard';
            const linkedProjectId = document.getElementById('ds-project-link')?.value || '';
            const ht = (ttc / 1.20).toFixed(2);
            const tva = (ttc - (ttc / 1.20)).toFixed(2);

            let spec = `Client: ${client}`;
            if (linkedProjectId) spec += ` [ProjetID:${linkedProjectId}]`;

            const comptaRow = [
                new Date().toLocaleString('fr-FR'),
                "Vente Libre",
                "-",
                desc,
                ttc.toFixed(2),
                ht,
                tva,
                payment,
                type,
                spec,
                "{}",
                "VALID"
            ];

            if (!navigator.onLine) {
                await idbManager.savePendingSale({ action: "directSale", comptaRow: comptaRow });
                document.getElementById('direct-sale-modal').style.display = 'none';
                directSaleForm.reset();
                showNotification("Vente libre enregistrée en mode HORS-LIGNE !", "info");
                generateInvoicePDF({ date: comptaRow[0], ref: '-', name: desc, ttc, ht, tva, payment, transType: type, client });
                return;
            }

            await ensureComptaSheetExists();
            if (await googleApiManager.appendRow(state.currentSpreadsheetId, `${COMPTA_SHEET_NAME}!A:L`, comptaRow)) {
                showNotification("Vente enregistrée en comptabilité !", "success");
                document.getElementById('direct-sale-modal').style.display = 'none';
                directSaleForm.reset();
                generateInvoicePDF({ date: comptaRow[0], ref: '-', name: desc, ttc, ht, tva, payment, transType: type, client });
                loadComptaData();
            }
        });
    }
}

// ========================================================
// SECTION DÉPENSES & CALCUL DE LA MARGE NETTE RÉELLE
// ========================================================

async function ensureExpensesSheetExists() {
    const details = await googleApiManager.getSpreadsheetDetails(state.currentSpreadsheetId);
    if (!details) return;
    const exists = details.sheets.some(s => s.properties.title === EXPENSES_SHEET_NAME);
    if (!exists) {
        await googleApiManager.addSheet(state.currentSpreadsheetId, EXPENSES_SHEET_NAME);
        await googleApiManager.appendRow(state.currentSpreadsheetId, `${EXPENSES_SHEET_NAME}!A1:I1`, EXPENSES_HEADERS);
    }
}

async function loadExpensesData() {
    if (!state.currentSpreadsheetId) return;
    await ensureExpensesSheetExists();
    const rawData = await googleApiManager.getSheetData(state.currentSpreadsheetId, `${EXPENSES_SHEET_NAME}!A:I`);
    if (!rawData || rawData.length < 2) {
        state.expensesRawRows = [];
    } else {
        state.expensesRawRows = rawData.slice(1).map((r, idx) => ({
            id: r[0] || Date.now().toString(),
            date: r[1] || '',
            cat: r[2] || 'Autre',
            desc: r[3] || 'Charge',
            ttc: parseFloat(r[4]) || 0,
            ht: parseFloat(r[5]) || 0,
            tva: parseFloat(r[6]) || 0,
            payment: r[7] || 'Carte',
            projectId: r[8] || '',
            rowIndex: idx + 2
        }));
    }
    renderFilteredExpenses();
}

function setupExpenseForms() {
    const openBtn = document.getElementById('open-expense-modal-btn');
    if (openBtn) {
        openBtn.addEventListener('click', () => {
            updateProjectSelectOptions('exp-project-link');
            const expDateInput = document.getElementById('exp-date');
            if (expDateInput && !expDateInput.value) {
                expDateInput.value = new Date().toISOString().split('T')[0];
            }
            const modal = document.getElementById('expense-modal');
            if (modal) modal.style.display = 'block';
        });
    }

    const form = document.getElementById('expense-form');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitBtn = form.querySelector('button[type="submit"]');
            const origHtml = submitBtn ? submitBtn.innerHTML : '';
            if (submitBtn) {
                submitBtn.classList.add('btn-success-check');
                submitBtn.innerHTML = '<i class="fas fa-check"></i> Charge enregistrée !';
            }

            const date = document.getElementById('exp-date').value || new Date().toISOString().split('T')[0];
            const cat = document.getElementById('exp-cat').value;
            const desc = document.getElementById('exp-desc').value;
            const ttc = parsePrice(document.getElementById('exp-ttc').value);
            const tvaRate = parseFloat(document.getElementById('exp-tva-rate').value) || 0;
            const payment = document.getElementById('exp-payment').value;
            const projectId = document.getElementById('exp-project-link').value || '';

            const ht = (tvaRate > 0) ? (ttc / (1 + (tvaRate / 100))) : ttc;
            const tva = ttc - ht;

            const expenseRow = [
                Date.now().toString(),
                date,
                cat,
                desc,
                ttc.toFixed(2),
                ht.toFixed(2),
                tva.toFixed(2),
                payment,
                projectId
            ];

            await ensureExpensesSheetExists();
            const success = await googleApiManager.appendRow(state.currentSpreadsheetId, `${EXPENSES_SHEET_NAME}!A:I`, expenseRow);

            setTimeout(() => {
                document.getElementById('expense-modal').style.display = 'none';
                form.reset();
                if (submitBtn) {
                    submitBtn.classList.remove('btn-success-check');
                    submitBtn.innerHTML = origHtml;
                }
                if (success) {
                    showNotification("Dépense ajoutée avec succès !", "success");
                    loadExpensesData();
                }
            }, 600);
        });
    }
}

function renderFilteredExpenses() {
    const period = document.getElementById('filter-expense-period')?.value || 'all';
    const catFilter = document.getElementById('filter-expense-cat')?.value || '';
    const tbody = document.getElementById('expenses-table-body');
    if (!tbody) return;

    const now = new Date();
    const filteredExpenses = state.expensesRawRows.filter(r => {
        if (catFilter && r.cat !== catFilter) return false;
        if (period !== 'all' && r.date) {
            const expDate = new Date(r.date);
            if (period === 'month' && (expDate.getMonth() !== now.getMonth() || expDate.getFullYear() !== now.getFullYear())) return false;
            if (period === 'quarter') {
                const qNow = Math.floor(now.getMonth() / 3);
                const qRow = Math.floor(expDate.getMonth() / 3);
                if (qNow !== qRow || expDate.getFullYear() !== now.getFullYear()) return false;
            }
            if (period === 'year' && expDate.getFullYear() !== now.getFullYear()) return false;
        }
        return true;
    });

    const filteredSales = state.comptaRawRows.filter(r => {
        if (r[11] === "ANNULE") return false;
        if (period !== 'all') {
            const parts = (r[0] || '').split(/[/ :]/);
            if (parts.length >= 3) {
                const rowDate = new Date(parts[2], parts[1] - 1, parts[0]);
                if (period === 'month' && (rowDate.getMonth() !== now.getMonth() || rowDate.getFullYear() !== now.getFullYear())) return false;
                if (period === 'quarter') {
                    const qNow = Math.floor(now.getMonth() / 3);
                    const qRow = Math.floor(rowDate.getMonth() / 3);
                    if (qNow !== qRow || rowDate.getFullYear() !== now.getFullYear()) return false;
                }
                if (period === 'year' && rowDate.getFullYear() !== now.getFullYear()) return false;
            }
        }
        return true;
    });

    let totalCA_HT = 0;
    filteredSales.forEach(r => { totalCA_HT += parseFloat(r[5]) || 0; });

    let totalExpensesHT = 0;
    let totalExpensesTTC = 0;
    let html = '';

    filteredExpenses.slice().reverse().forEach(r => {
        totalExpensesHT += r.ht;
        totalExpensesTTC += r.ttc;

        html += `
            <tr>
                <td>${r.date}</td>
                <td><span class="product-category">${r.cat}</span></td>
                <td><strong>${r.desc}</strong></td>
                <td>${r.payment}</td>
                <td class="text-right font-bold" style="color:var(--danger);">${r.ttc.toFixed(2)} €</td>
                <td class="text-right">${r.ht.toFixed(2)} €</td>
                <td class="text-right" style="color:var(--gray);">${r.tva.toFixed(2)} €</td>
                <td>${r.projectId ? `<span class="priority-tag priority-Moyenne"><i class="fas fa-bullhorn"></i> Projet</span>` : '-'}</td>
                <td class="text-center">
                    <button class="btn-table-action btn-table-cancel" onclick="deleteExpenseRow(${r.rowIndex})" title="Supprimer"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `;
    });

    if (filteredExpenses.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;">Aucune dépense sur cette période.</td></tr>';
    } else {
        tbody.innerHTML = html;
    }

    const netProfitHT = totalCA_HT - totalExpensesHT;
    const marginRate = (totalCA_HT > 0) ? ((netProfitHT / totalCA_HT) * 100) : 0;

    renderMarginKPIs(totalCA_HT, totalExpensesHT, netProfitHT, marginRate);
}

function renderMarginKPIs(caHT, expensesHT, netProfit, marginRate) {
    const el = document.getElementById('margin-kpis');
    if (!el) return;
    const isProfitPositive = netProfit >= 0;

    el.innerHTML = `
        <div class="kpi-card"><div class="kpi-icon kpi-blue"><i class="fas fa-file-invoice-dollar"></i></div><div class="kpi-info"><span class="kpi-label">Total CA Net HT</span><span class="kpi-value">${caHT.toLocaleString('fr-FR', {minimumFractionDigits: 2})} €</span></div></div>
        <div class="kpi-card"><div class="kpi-icon kpi-orange"><i class="fas fa-receipt"></i></div><div class="kpi-info"><span class="kpi-label">Charges & Dépenses HT</span><span class="kpi-value">${expensesHT.toLocaleString('fr-FR', {minimumFractionDigits: 2})} €</span></div></div>
        <div class="kpi-card"><div class="kpi-icon ${isProfitPositive ? 'kpi-green' : 'kpi-purple'}"><i class="fas fa-hand-holding-usd"></i></div><div class="kpi-info"><span class="kpi-label">Bénéfice Net Réel</span><span class="kpi-value" style="color:${isProfitPositive ? 'var(--success)' : 'var(--danger)'};">${isProfitPositive ? '+' : ''}${netProfit.toLocaleString('fr-FR', {minimumFractionDigits: 2})} €</span></div></div>
        <div class="kpi-card"><div class="kpi-icon ${isProfitPositive ? 'kpi-green' : 'kpi-purple'}"><i class="fas fa-percent"></i></div><div class="kpi-info"><span class="kpi-label">Taux de Marge Nette</span><span class="kpi-value">${marginRate.toFixed(1)} %</span></div></div>
    `;
}

window.deleteExpenseRow = async function(rowIndex) {
    if (confirm("Supprimer définitivement cette charge ?")) {
        const sheetDetails = await googleApiManager.getSpreadsheetDetails(state.currentSpreadsheetId);
        const sheetObj = sheetDetails.sheets.find(s => s.properties.title === EXPENSES_SHEET_NAME);
        if (sheetObj) {
            await googleApiManager.deleteRow(state.currentSpreadsheetId, sheetObj.properties.sheetId, rowIndex);
            showNotification("Charge supprimée !", "info");
            loadExpensesData();
        }
    }
};

function updateProjectSelectOptions(selectId) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    sel.innerHTML = '<option value="">-- Aucun projet associé --</option>';
    state.projects.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.name} (${p.status})`;
        sel.appendChild(opt);
    });
}

function openSoldModal(rowIdx, item) {
    const priceKey = detectBestPriceColumn(state.headers, [item]);
    const defaultPrice = priceKey && item[priceKey] ? parsePrice(item[priceKey]) : 0;
    
    document.getElementById('sale-product-row-idx').value = rowIdx;
    document.getElementById('sale-product-details').value = JSON.stringify(item);
    
    const salePriceEl = document.getElementById('sale-price');
    if (salePriceEl) {
        salePriceEl.value = defaultPrice > 0 ? defaultPrice.toFixed(2) : '';
        salePriceEl.removeAttribute('readonly');
        salePriceEl.removeAttribute('disabled');
    }
    
    const nameKey = state.headers.find(x => x.toLowerCase().includes('nom')) || state.headers[0];
    const summaryEl = document.getElementById('sale-product-summary');
    if (summaryEl) {
        summaryEl.innerHTML = `<strong>Article :</strong> ${item[nameKey] || 'Sans nom'} (Dossier : ${state.currentSheet ? state.currentSheet.title : ''})`;
    }
    
    updateProjectSelectOptions('sale-project-link');

    const paymentEl = document.getElementById('sale-payment-method');
    const transEl = document.getElementById('sale-trans-type');
    
    if (paymentEl) paymentEl.value = 'Carte';
    if (transEl) transEl.value = 'B2C';

    const diffBox = document.getElementById('diff-fields');
    const b2bBox = document.getElementById('b2b-fields');
    const depotBox = document.getElementById('depot-fields');

    if (diffBox) diffBox.classList.add('hidden');
    if (b2bBox) b2bBox.classList.add('hidden');
    if (depotBox) depotBox.classList.add('hidden');

    const modal = document.getElementById('sale-product-modal');
    if (modal) {
        modal.style.display = 'block';
        setTimeout(() => {
            if (salePriceEl) {
                salePriceEl.focus();
                salePriceEl.select();
            }
        }, 150);
    }
}

// --- FACTURE PDF ---
function generateInvoicePDF(data) {
    if (!window.jspdf) return;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a5' });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("BACKROOM BY FMR", 15, 20);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("Boutique & Créations FMR", 15, 26);
    doc.text(`Date : ${data.date}`, 15, 31);
    doc.text(`Client / Réf : ${data.client || 'Particulier'}`, 15, 36);

    doc.setDrawColor(200, 200, 200);
    doc.line(15, 42, 135, 42);

    doc.setFont("helvetica", "bold");
    doc.text("Description", 15, 48);
    doc.text("Total TTC", 115, 48);

    doc.setFont("helvetica", "normal");
    doc.text(`${data.name} (Réf: ${data.ref})`, 15, 56);
    doc.text(`${parseFloat(data.ttc).toFixed(2)} €`, 115, 56);

    doc.line(15, 65, 135, 65);

    doc.text(`Montant Net HT : ${parseFloat(data.ht).toFixed(2)} €`, 75, 73);
    doc.text(`TVA : ${parseFloat(data.tva).toFixed(2)} €`, 75, 78);
    
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(`TOTAL TTC : ${parseFloat(data.ttc).toFixed(2)} €`, 75, 86);

    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.text(`Règlement : ${data.payment} (${data.transType})`, 15, 100);
    doc.text("Merci pour votre confiance !", 50, 115);

    doc.save(`Recu_FMR_${Date.now()}.pdf`);
}

async function ensureComptaSheetExists() {
    const details = await googleApiManager.getSpreadsheetDetails(state.currentSpreadsheetId);
    if (!details) return;
    const exists = details.sheets.some(s => s.properties.title === COMPTA_SHEET_NAME);
    if (!exists) {
        await googleApiManager.addSheet(state.currentSpreadsheetId, COMPTA_SHEET_NAME);
        await googleApiManager.appendRow(state.currentSpreadsheetId, `${COMPTA_SHEET_NAME}!A1:L1`, COMPTA_HEADERS);
    }
}

async function loadComptaData() {
    await ensureComptaSheetExists();
    const rawData = await googleApiManager.getSheetData(state.currentSpreadsheetId, `${COMPTA_SHEET_NAME}!A:L`);
    if (!rawData || rawData.length < 2) {
        state.comptaRawRows = [];
    } else {
        state.comptaRawRows = rawData.slice(1).map((r, idx) => ({ ...r, rowIndex: idx + 2 }));
    }
    renderFilteredCompta();
    renderDepotsBilan();
    loadExpensesData();
    loadProjectsFromSheet();
}

function renderFilteredCompta() {
    const period = document.getElementById('filter-compta-period')?.value || 'all';
    const typeFilter = document.getElementById('filter-compta-type')?.value || '';
    const paymentFilter = document.getElementById('filter-compta-payment')?.value || '';
    const statusFilter = document.getElementById('filter-compta-status')?.value || '';

    const tbody = document.getElementById('compta-table-body');
    if (!tbody) return;

    if (state.comptaRawRows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;">Aucune vente dans le registre.</td></tr>';
        renderComptaKPIs([], 0, 0, 0, 0);
        return;
    }

    const now = new Date();
    const filtered = state.comptaRawRows.filter(r => {
        const status = r[11] || "VALID";
        if (statusFilter && status !== statusFilter) return false;
        if (typeFilter && String(r[8]) !== typeFilter) return false;
        if (paymentFilter && !String(r[7]).includes(paymentFilter)) return false;

        if (period !== 'all') {
            const dateStr = r[0];
            const parts = dateStr.split(/[/ :]/);
            if (parts.length >= 3) {
                const rowDate = new Date(parts[2], parts[1] - 1, parts[0]);
                if (period === 'month' && (rowDate.getMonth() !== now.getMonth() || rowDate.getFullYear() !== now.getFullYear())) return false;
                if (period === 'quarter') {
                    const qNow = Math.floor(now.getMonth() / 3);
                    const qRow = Math.floor(rowDate.getMonth() / 3);
                    if (qNow !== qRow || rowDate.getFullYear() !== now.getFullYear()) return false;
                }
                if (period === 'year' && rowDate.getFullYear() !== now.getFullYear()) return false;
            }
        }
        return true;
    });

    let html = '';
    let totalTTC = 0, totalHT = 0, totalTVA = 0, totalDueDiff = 0;

    filtered.slice().reverse().forEach(r => {
        const isAnnule = (r[11] === "ANNULE");
        const ttc = parseFloat(r[4]) || 0;
        const ht = parseFloat(r[5]) || 0;
        const tva = parseFloat(r[6]) || 0;

        const isDiff = String(r[7]).includes('Différé') && !isAnnule;
        const isSettled = String(r[9]).includes('SOLDE REGLÉ');

        if (!isAnnule) {
            totalTTC += ttc; totalHT += ht; totalTVA += tva;
            if (isDiff && !isSettled) {
                const m = String(r[9]).match(/Reste dû:\s*([\d\.]+)€/);
                if(m) totalDueDiff += parseFloat(m[1]) || 0;
            }
        }

        html += `
            <tr class="${isAnnule ? 'row-annule' : ''}">
                <td>${r[0] || '-'}</td>
                <td><span class="product-ref-badge" style="position:static;">${r[1] || ''} | ${r[2] || '-'}</span></td>
                <td><strong>${r[3] || '-'}</strong></td>
                <td><span class="product-category">${r[8] || '-'}</span></td>
                <td>${r[7] || '-'}</td>
                <td class="text-right font-bold">${ttc.toFixed(2)} €</td>
                <td class="text-right">${ht.toFixed(2)} €</td>
                <td class="text-right" style="color:var(--gray);">${tva.toFixed(2)} €</td>
                <td style="font-size:0.85rem;">
                    ${r[9] || '-'} 
                    ${isAnnule ? '<strong style="color:var(--danger);">[ANNULÉ / AVOIR]</strong>' : ''}
                </td>
                <td class="text-center">
                    <button class="btn-table-action btn-table-pdf" onclick="reprintPDF(${r.rowIndex})" title="Imprimer Reçu"><i class="fas fa-file-pdf"></i></button>
                    ${isDiff ? (
                        !isSettled 
                        ? `<button class="btn-table-action btn-table-settle" onclick="settleDeferred(${r.rowIndex})" title="Confirmer le règlement total"><i class="fas fa-check"></i> Solde réglé</button>`
                        : `<button class="btn-table-action" style="background-color: var(--gray); color:white;" onclick="unsettleDeferred(${r.rowIndex})" title="Annuler le solde et rétablir l'impayé"><i class="fas fa-undo"></i> Rétablir dû</button>`
                    ) : ''}
                    ${!isAnnule ? `<button class="btn-table-action btn-table-cancel" onclick="cancelSale(${r.rowIndex})" title="Annuler la vente"><i class="fas fa-undo"></i></button>` : ''}
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
    renderComptaKPIs(filtered, totalTTC, totalHT, totalTVA, totalDueDiff);
}

function renderComptaKPIs(rows, ttc = 0, ht = 0, tva = 0, dueDiff = 0) {
    const el = document.getElementById('compta-kpis');
    if (!el) return;
    el.innerHTML = `
        <div class="kpi-card"><div class="kpi-icon kpi-green"><i class="fas fa-coins"></i></div><div class="kpi-info"><span class="kpi-label">CA Filtré TTC</span><span class="kpi-value">${ttc.toLocaleString('fr-FR', {minimumFractionDigits: 2})} €</span></div></div>
        <div class="kpi-card"><div class="kpi-icon kpi-blue"><i class="fas fa-file-invoice-dollar"></i></div><div class="kpi-info"><span class="kpi-label">Total HT (Assiette)</span><span class="kpi-value">${ht.toLocaleString('fr-FR', {minimumFractionDigits: 2})} €</span></div></div>
        <div class="kpi-card"><div class="kpi-icon kpi-purple"><i class="fas fa-percent"></i></div><div class="kpi-info"><span class="kpi-label">TVA Collectée</span><span class="kpi-value">${tva.toLocaleString('fr-FR', {minimumFractionDigits: 2})} €</span></div></div>
        <div class="kpi-card"><div class="kpi-icon kpi-orange"><i class="fas fa-clock"></i></div><div class="kpi-info"><span class="kpi-label">Créances Restantes</span><span class="kpi-value">${dueDiff.toLocaleString('fr-FR', {minimumFractionDigits: 2})} €</span></div></div>
    `;
}

window.settleDeferred = async function(rowIndex) {
    const row = state.comptaRawRows.find(r => r.rowIndex === rowIndex);
    if (!row) return;

    if (confirm("Confirmer la réception de la totalité du paiement ? Le reste dû passera à 0€.")) {
        showNotification("Mise à jour du solde...", "info");
        const matchRest = String(row[9]).match(/Reste dû:\s*([\d\.]+)€/);
        const restAmount = matchRest ? matchRest[1] : '0';
        
        const updatedDetails = String(row[9])
            .replace(/Payé:\s*[\d\.]+€/, `Payé: ${row[4]}€`)
            .replace(/Reste dû:\s*([\d\.]+)\s*€/, `Reste dû: 0.00€ (SOLDE REGLÉ [prevRest:${restAmount}])`);

        await googleApiManager.updateRow(state.currentSpreadsheetId, `${COMPTA_SHEET_NAME}!J${rowIndex}`, [updatedDetails]);
        showNotification("Paiement soldé !", "success");
        loadComptaData();
    }
};

window.unsettleDeferred = async function(rowIndex) {
    const row = state.comptaRawRows.find(r => r.rowIndex === rowIndex);
    if (!row) return;

    if (await showFMRConfirm("Confirmer la réception de la totalité du paiement ? Le reste dû passera à 0€.")) {
        showNotification("Rétablissement du montant dû...", "info");
        const prevMatch = String(row[9]).match(/\[prevRest:([\d\.]+)\]/);
        const originalRest = prevMatch ? parseFloat(prevMatch[1]) : 0;
        const totalTTC = parseFloat(row[4]) || 0;
        const originalPaid = Math.max(0, totalTTC - originalRest).toFixed(2);

        const restoredDetails = String(row[9])
            .replace(/Payé:\s*[\d\.]+€/, `Payé: ${originalPaid}€`)
            .replace(/Reste dû:\s*0\.00€\s*\(SOLDE REGLÉ\s*\[prevRest:[\d\.]+\]\)/, `Reste dû: ${originalRest.toFixed(2)}€`);

        await googleApiManager.updateRow(state.currentSpreadsheetId, `${COMPTA_SHEET_NAME}!J${rowIndex}`, [restoredDetails]);
        showNotification("Montant restant dû rétabli !", "info");
        loadComptaData();
    }
};

window.cancelSale = async function(rowIndex) {
    const row = state.comptaRawRows.find(r => r.rowIndex === rowIndex);
    if (!row) return;

    if (await showFMRConfirm("Annuler cette vente ? Le produit sera restitué dans son dossier de stock d'origine.")) {
        showNotification("Annulation de la vente...", "info");
        const originSheet = row[1];
        const rawJson = row[10];
        if (originSheet && rawJson && rawJson !== "{}") {
            const productData = JSON.parse(rawJson);
            delete productData.gSheetRowIndex;
            const valuesToRestore = Object.values(productData);
            await googleApiManager.appendRow(state.currentSpreadsheetId, `${originSheet}!A:A`, valuesToRestore);
        }
        await googleApiManager.updateRow(state.currentSpreadsheetId, `${COMPTA_SHEET_NAME}!L${rowIndex}`, ["ANNULE"]);
        showNotification("Vente annulée et pièce réintégrée au stock !", "success");
        loadComptaData();
    }
};

window.reprintPDF = function(rowIndex) {
    const r = state.comptaRawRows.find(item => item.rowIndex === rowIndex);
    if (!r) return;
    generateInvoicePDF({
        date: r[0], ref: r[2], name: r[3], ttc: r[4], ht: r[5], tva: r[6], payment: r[7], transType: r[8], client: r[9]
    });
};

function exportFEC() {
    if (state.comptaRawRows.length === 0) {
        showNotification("Aucune donnée comptable à exporter", "error");
        return;
    }
    const fecHeaders = ["DatePiece", "NumeroPiece", "CompteNum", "CompteLibelle", "Debit", "Credit", "Libelle"];
    const fecRows = [];

    state.comptaRawRows.filter(r => r[11] !== "ANNULE").forEach((r, idx) => {
        const dateClean = (r[0] || "").split(' ')[0].replace(/\//g, '');
        const pieceNum = `VT-${idx + 1}`;
        const ttc = parseFloat(r[4]) || 0;
        const ht = parseFloat(r[5]) || 0;
        const tva = parseFloat(r[6]) || 0;
        const desc = (r[3] || "Vente").replace(/"/g, '""');

        fecRows.push([dateClean, pieceNum, "512000", "Banque", ttc.toFixed(2), "0.00", desc]);
        fecRows.push([dateClean, pieceNum, "707000", "Ventes de marchandises", "0.00", ht.toFixed(2), desc]);
        if (tva > 0) {
            fecRows.push([dateClean, pieceNum, "445710", "TVA collectee 20%", "0.00", tva.toFixed(2), desc]);
        }
    });

    const csvContent = [fecHeaders.join(','), ...fecRows.map(row => row.join(','))].join('\n');
    downloadFile(csvContent, `EXPORT_FEC_COMPTA_${new Date().toISOString().slice(0,10)}.csv`, 'text/csv');
    showNotification("Export FEC / Comptable téléchargé !", "success");
}

function renderDepotsBilan() {
    const depotRows = state.comptaRawRows.filter(r => String(r[8]).includes('DEPOT') && r[11] !== "ANNULE");
    const tbody = document.getElementById('depots-table-body');
    const kpiContainer = document.getElementById('depot-kpis');
    if (!tbody || !kpiContainer) return;

    if (depotRows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Aucune vente en dépôt-vente.</td></tr>';
        kpiContainer.innerHTML = '';
        return;
    }

    let grandTotalTTC = 0, grandTotalDuePending = 0, grandTotalDuePaid = 0, grandTotalStore = 0;
    let html = '';

    depotRows.slice().reverse().forEach(r => {
        const date = r[0] || '-';
        const article = `${r[3] || '-'} (${r[2] || '-'})`;
        const ttc = parseFloat(r[4]) || 0;
        const details = r[9] || '';
        
        const ownerMatch = details.match(/Dépositaire\s*([^|\]]+)/);
        const dueMatch = details.match(/Dû:\s*([\d\.]+)€/);
        const gainMatch = details.match(/Com Boutique TTC:\s*([\d\.]+)€/);
        const statusMatch = details.match(/\[STATUT_DEPOT:\s*([^\]]+)\]/);

        const owner = ownerMatch ? ownerMatch[1].trim() : "Inconnu";
        const due = dueMatch ? parseFloat(dueMatch[1]) || 0 : 0;
        const gain = gainMatch ? parseFloat(gainMatch[1]) || 0 : Math.max(0, ttc - due);
        
        // Rétrocompatibilité pour les anciennes ventes sans statut
        const status = statusMatch ? statusMatch[1].trim() : "EN_ATTENTE";

        grandTotalTTC += ttc;
        grandTotalStore += gain;
        
        if (status === 'PAYE' || status === 'PAYÉ') {
            grandTotalDuePaid += due;
        } else {
            grandTotalDuePending += due;
        }

        const isPending = (status === 'EN_ATTENTE');

        html += `
            <tr>
                <td>${date}</td>
                <td><strong>${article}</strong></td>
                <td><i class="fas fa-user-circle" style="color:var(--primary); margin-right:5px;"></i> ${owner}</td>
                <td class="text-right font-bold">${ttc.toFixed(2)} €</td>
                <td class="text-right" style="color:var(--danger); font-weight:700;">${due.toFixed(2)} €</td>
                <td class="text-center">
                    ${isPending 
                        ? `<span class="product-status" style="background:#fff3e0; color:#ef6c00; padding:5px 10px;"><i class="fas fa-clock"></i> En attente</span>` 
                        : `<span class="product-status" style="background:#e8f5e9; color:#2e7d32; padding:5px 10px;"><i class="fas fa-check"></i> Part versée</span>`}
                </td>
                <td class="text-center">
                    ${isPending
                        ? `<button class="btn-table-action btn-table-settle" onclick="settleDepot(${r.rowIndex})" title="Marquer comme payé au dépositaire"><i class="fas fa-hand-holding-usd"></i> Valider Versement</button>`
                        : `<button class="btn-table-action" style="background-color: var(--gray); color:white;" onclick="unsettleDepot(${r.rowIndex})" title="Annuler le versement"><i class="fas fa-undo"></i> Rétablir dû</button>`
                    }
                </td>
            </tr>
        `;
    });

    kpiContainer.innerHTML = `
        <div class="kpi-card"><div class="kpi-icon kpi-purple"><i class="fas fa-handshake"></i></div><div class="kpi-info"><span class="kpi-label">CA Dépôts TTC</span><span class="kpi-value">${grandTotalTTC.toFixed(2)} €</span></div></div>
        <div class="kpi-card"><div class="kpi-icon kpi-orange"><i class="fas fa-hourglass-half"></i></div><div class="kpi-info"><span class="kpi-label">Reste à Verser</span><span class="kpi-value" style="color:var(--danger);">${grandTotalDuePending.toFixed(2)} €</span></div></div>
        <div class="kpi-card"><div class="kpi-icon kpi-green"><i class="fas fa-check-circle"></i></div><div class="kpi-info"><span class="kpi-label">Déjà Versé</span><span class="kpi-value">${grandTotalDuePaid.toFixed(2)} €</span></div></div>
        <div class="kpi-card"><div class="kpi-icon kpi-blue"><i class="fas fa-store"></i></div><div class="kpi-info"><span class="kpi-label">Commissions Boutique</span><span class="kpi-value">${grandTotalStore.toFixed(2)} €</span></div></div>
    `;

    tbody.innerHTML = html;
}

window.settleDepot = async function(rowIndex) {
    const row = state.comptaRawRows.find(r => r.rowIndex === rowIndex);
    if (!row) return;

    if (await showFMRConfirm("Confirmer que le dépositaire a bien reçu sa part pour cet article ?")) {
        showNotification("Mise à jour du statut...", "info");
        let details = String(row[9]);
        if (details.includes('[STATUT_DEPOT: EN_ATTENTE]')) {
            details = details.replace('[STATUT_DEPOT: EN_ATTENTE]', '[STATUT_DEPOT: PAYE]');
        } else if (!details.includes('[STATUT_DEPOT:')) {
            details += ' [STATUT_DEPOT: PAYE]'; // Rétrocompatibilité
        }
        
        await googleApiManager.updateRow(state.currentSpreadsheetId, `${COMPTA_SHEET_NAME}!J${rowIndex}`, [details]);
        showNotification("Versement au dépositaire confirmé !", "success");
        loadComptaData(); // Recharge la vue
    }
};

window.unsettleDepot = async function(rowIndex) {
    const row = state.comptaRawRows.find(r => r.rowIndex === rowIndex);
    if (!row) return;

    if (await showFMRConfirm("Annuler ce versement et remettre l'article en attente de paiement ?")) {
        showNotification("Mise à jour du statut...", "info");
        let details = String(row[9]);
        if (details.includes('[STATUT_DEPOT: PAYE]')) {
            details = details.replace('[STATUT_DEPOT: PAYE]', '[STATUT_DEPOT: EN_ATTENTE]');
        }
        await googleApiManager.updateRow(state.currentSpreadsheetId, `${COMPTA_SHEET_NAME}!J${rowIndex}`, [details]);
        showNotification("Statut remis en attente !", "info");
        loadComptaData();
    }
};


// --- NOTIFICATIONS DEADLINES PROJETS ---
function checkProjectDeadlines() {
    if (!state.projects || state.projects.length === 0) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let alerts = [];

    state.projects.forEach(p => {
        // On ignore les projets déjà publiés/terminés ou sans date de fin
        if (p.status === 'Publié' || !p.end) return;

        const dl = new Date(p.end);
        dl.setHours(0, 0, 0, 0);
        const diffDays = Math.ceil((dl - today) / (1000 * 60 * 60 * 24));

        if (diffDays < 0) {
            alerts.push(`🚨 <strong>${p.name}</strong> : En retard (${p.end})`);
        } else if (diffDays === 0) {
            alerts.push(`⚠️ <strong>${p.name}</strong> : À terminer AUJOURD'HUI`);
        } else if (diffDays > 0 && diffDays <= 3) {
            alerts.push(`⏳ <strong>${p.name}</strong> : J-${diffDays} (${p.end})`);
        }
    });

    if (alerts.length > 0) {
        // On limite l'affichage à 4 projets maximum pour ne pas envahir l'écran
        const displayAlerts = alerts.slice(0, 4);
        let msg = displayAlerts.join('<br><br>');
        
        if (alerts.length > 4) {
            msg += `<br><br><em>+ ${alerts.length - 4} autre(s) projet(s) urgent(s)</em>`;
        }
        
        // On affiche la notification avec un petit délai de 2.5s pour ne pas surcharger visuellement l'arrivée sur l'app
        setTimeout(() => {
            showNotification(`<div style="font-size: 0.95rem; line-height: 1.4;"><strong>Rappel des Deadlines :</strong><br><br>${msg}</div>`, "info");
        }, 2500);
    }
}

// ========================================================
// SECTION PROJETS : KANBAN, CHECKLISTS, ROI & DEADLINES
// ========================================================

async function ensureProjectsSheetExists() {
    const details = await googleApiManager.getSpreadsheetDetails(state.currentSpreadsheetId);
    if (!details) return;
    const exists = details.sheets.some(s => s.properties.title === PROJECTS_SHEET_NAME);
    if (!exists) {
        await googleApiManager.addSheet(state.currentSpreadsheetId, PROJECTS_SHEET_NAME);
        await googleApiManager.appendRow(state.currentSpreadsheetId, `${PROJECTS_SHEET_NAME}!A1:N1`, PROJECTS_HEADERS);
    }
}

async function loadProjectsFromSheet() {
    if (!state.currentSpreadsheetId) return;
    await ensureProjectsSheetExists();
    const rawData = await googleApiManager.getSheetData(state.currentSpreadsheetId, `${PROJECTS_SHEET_NAME}!A:N`);
    if (!rawData || rawData.length < 2) {
        state.projects = [];
    } else {
        state.projects = rawData.slice(1).map((r, idx) => ({
            id: r[0] || Date.now().toString(),
            name: r[1] || 'Sans nom',
            start: r[2] || '',
            end: r[3] || '',
            status: r[4] || "Idée",
            desc: r[5] || '',
            channels: r[6] ? r[6].split(',').map(s => s.trim()).filter(Boolean) : [],
            budgetAds: r[7] || "0",
            budgetProd: r[8] || "0",
            driveLink: r[9] || "",
            plan: r[10] || "",
            checklist: r[11] ? JSON.parse(r[11]) : [],
            priority: r[12] || "Moyenne",
            trelloLink: r[13] || "",
            rowIndex: idx + 2
        }));
    }
    renderKanban();
    if (!document.getElementById('projects-timeline')?.classList.contains('hidden')) {
        renderTimeline();
    }
}

function setupProjectEvents() {
    const addProjBtn = document.getElementById('add-new-project-btn');
    if (addProjBtn) {
        addProjBtn.addEventListener('click', () => {
            document.getElementById('proj-edit-id').value = '';
            document.getElementById('project-form').reset();
            state.currentProjectChecklist = [];
            renderChecklistBuilder();
            const modal = document.getElementById('project-modal');
            if(modal) {
                modal.style.display = 'block';
                setTimeout(() => document.getElementById('proj-name')?.focus(), 50);
            }
        });
    }

    const templateSelect = document.getElementById('proj-template-select');
    if (templateSelect) {
        templateSelect.addEventListener('change', (e) => {
            const key = e.target.value;
            if (!key || !PROJECT_TEMPLATES[key]) return;
            const tpl = PROJECT_TEMPLATES[key];

            document.getElementById('proj-name').value = tpl.name;
            document.getElementById('proj-desc').value = tpl.desc;
            document.getElementById('proj-priority').value = tpl.priority;
            document.getElementById('proj-budget-ads').value = tpl.budgetAds;
            document.getElementById('proj-budget-prod').value = tpl.budgetProd;

            document.querySelectorAll('input[name="proj-channels"]').forEach(cb => {
                cb.checked = tpl.channels.includes(cb.value);
            });

            state.currentProjectChecklist = tpl.tasks.map(t => ({ text: t, done: false }));
            renderChecklistBuilder();
        });
    }

    const addTaskBtn = document.getElementById('add-task-item-btn');
    const taskInput = document.getElementById('new-task-input');
    const handleAddTask = () => {
        const text = taskInput?.value.trim();
        if (!text) return;
        state.currentProjectChecklist.push({ text: text, done: false });
        taskInput.value = '';
        renderChecklistBuilder();
    };
    if (addTaskBtn) addTaskBtn.addEventListener('click', handleAddTask);
    if (taskInput) {
        taskInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); handleAddTask(); }
        });
    }

    const projForm = document.getElementById('project-form');
    if (projForm) {
        projForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const submitBtn = projForm.querySelector('button[type="submit"]');
            const originalBtnHtml = submitBtn ? submitBtn.innerHTML : '';
            if (submitBtn) {
                submitBtn.classList.add('btn-success-check');
                submitBtn.innerHTML = '<i class="fas fa-check"></i> Projet enregistré !';
            }

            const editId = document.getElementById('proj-edit-id')?.value;
            const channels = Array.from(document.querySelectorAll('input[name="proj-channels"]:checked')).map(cb => cb.value);

            const projObj = [
                editId || Date.now().toString(),
                document.getElementById('proj-name')?.value || '',
                document.getElementById('proj-start')?.value || '',
                document.getElementById('proj-end')?.value || '',
                document.getElementById('proj-status')?.value || 'Idée',
                document.getElementById('proj-desc')?.value || '',
                channels.join(','),
                parsePrice(document.getElementById('proj-budget-ads')?.value).toFixed(2),
                parsePrice(document.getElementById('proj-budget-prod')?.value).toFixed(2),
                document.getElementById('proj-drive-link')?.value || '',
                document.getElementById('proj-com-plan')?.value || '',
                JSON.stringify(state.currentProjectChecklist || []),
                document.getElementById('proj-priority')?.value || 'Moyenne',
                document.getElementById('proj-trello-link')?.value || ''
            ];

            await ensureProjectsSheetExists();

            if (editId) {
                const existing = state.projects.find(p => p.id === editId);
                if (existing) {
                    await googleApiManager.updateRow(state.currentSpreadsheetId, `${PROJECTS_SHEET_NAME}!A${existing.rowIndex}:N${existing.rowIndex}`, projObj);
                }
            } else {
                await googleApiManager.appendRow(state.currentSpreadsheetId, `${PROJECTS_SHEET_NAME}!A:N`, projObj);
            }

            setTimeout(() => {
                document.getElementById('project-modal').style.display = 'none';
                if (submitBtn) {
                    submitBtn.classList.remove('btn-success-check');
                    submitBtn.innerHTML = originalBtnHtml;
                }
                showNotification("Projet synchronisé avec Google Sheets !", "success");
                loadProjectsFromSheet();
            }, 600);
        });
    }
}

function renderChecklistBuilder() {
    const container = document.getElementById('checklist-builder-container');
    if (!container) return;
    if (state.currentProjectChecklist.length === 0) {
        container.innerHTML = '<span style="color:var(--gray); font-size:0.85rem; padding:4px;">Aucune tâche ajoutée.</span>';
        return;
    }
    container.innerHTML = state.currentProjectChecklist.map((item, idx) => `
        <div class="checklist-builder-row">
            <span><i class="fas fa-check-square" style="color:var(--primary); margin-right:6px;"></i> ${item.text}</span>
            <button type="button" onclick="removeChecklistBuilderTask(${idx})" style="background:none; border:none; color:var(--danger); cursor:pointer;"><i class="fas fa-trash"></i></button>
        </div>
    `).join('');
}

window.removeChecklistBuilderTask = function(idx) {
    state.currentProjectChecklist.splice(idx, 1);
    renderChecklistBuilder();
};

// --- DRAG AND DROP KANBAN ---
window.handleDragStart = function(e, id) {
    e.dataTransfer.setData('text/plain', id);
    e.currentTarget.classList.add('is-dragging');
};

window.handleDragEnd = function(e) {
    e.currentTarget.classList.remove('is-dragging');
};

window.handleDragOver = function(e) {
    e.preventDefault();
    e.currentTarget.classList.add('drag-over');
};

window.handleDragLeave = function(e) {
    e.currentTarget.classList.remove('drag-over');
};

window.handleDrop = async function(e, targetStatus) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    const id = e.dataTransfer.getData('text/plain');
    if (!id) return;
    await updateProjectKanbanStatus(id, targetStatus);
};

function renderKanban() {
    const cols = {
        "Idée": document.getElementById('kanban-col-idee'),
        "En rédaction": document.getElementById('kanban-col-redaction'),
        "Tourné/Créé": document.getElementById('kanban-col-tourne'),
        "Publié": document.getElementById('kanban-col-publie')
    };

    Object.values(cols).forEach(c => { if(c) c.innerHTML = ''; });
    const counts = { "Idée": 0, "En rédaction": 0, "Tourné/Créé": 0, "Publié": 0 };

    state.projects.forEach(p => {
        const col = cols[p.status] || cols["Idée"];
        counts[p.status] = (counts[p.status] || 0) + 1;

        if (col) {
            const card = document.createElement('div');
            card.className = 'kanban-card';
            card.draggable = true;
            card.ondragstart = (e) => handleDragStart(e, p.id);
            card.ondragend = handleDragEnd;
            card.onclick = (e) => {
                if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select') || e.target.closest('a')) return;
                openProjectDetailsModal(p.id);
            };

            let deadlineHtml = '';
            if (p.end) {
                const today = new Date();
                today.setHours(0,0,0,0);
                const dl = new Date(p.end);
                const diffDays = Math.ceil((dl - today) / (1000 * 60 * 60 * 24));
                
                if (diffDays < 0) {
                    deadlineHtml = `<span class="deadline-tag is-overdue"><i class="fas fa-exclamation-circle"></i> En retard (${p.end})</span>`;
                } else if (diffDays <= 3) {
                    deadlineHtml = `<span class="deadline-tag is-approaching"><i class="fas fa-clock"></i> J-${diffDays} (${p.end})</span>`;
                } else {
                    deadlineHtml = `<span class="deadline-tag"><i class="fas fa-calendar-alt"></i> ${p.end}</span>`;
                }
            }

            const channelBadges = (p.channels || []).map(ch => {
                const clean = ch.trim();
                let icon = 'fas fa-bullhorn';
                let cls = 'evenement';

                if (clean === 'Instagram') { icon = 'fab fa-instagram'; cls = 'instagram'; }
                else if (clean === 'TikTok') { icon = 'fab fa-tiktok'; cls = 'tiktok'; }
                else if (clean === 'Newsletter') { icon = 'fas fa-envelope-open-text'; cls = 'newsletter'; }
                else if (clean === 'Shooting') { icon = 'fas fa-camera'; cls = 'shooting'; }
                else if (clean === 'Événement' || clean === 'Evenement') { icon = 'fas fa-glass-cheers'; cls = 'evenement'; }
                else if (clean === 'Boutique') { icon = 'fas fa-store'; cls = 'boutique'; }

                return `<span class="channel-badge ${cls}"><i class="${icon}"></i> ${clean}</span>`;
            }).join('');

            let projectSalesTotal = 0;
            state.comptaRawRows.forEach(r => {
                if (r[11] !== "ANNULE" && String(r[9]).includes(`[ProjetID:${p.id}]`)) {
                    projectSalesTotal += parseFloat(r[4]) || 0;
                }
            });

            const totalBudget = (parseFloat(p.budgetAds) || 0) + (parseFloat(p.budgetProd) || 0);
            const netROI = projectSalesTotal - totalBudget;
            let roiHtml = '';
            if (totalBudget > 0 || projectSalesTotal > 0) {
                roiHtml = `
                    <div style="font-size:0.8rem; display:flex; justify-content:space-between; align-items:center; background:var(--light); padding:4px 8px; border-radius:6px;">
                        <span>Budget: <strong>${totalBudget.toFixed(0)}€</strong> | Ventes: <strong>${projectSalesTotal.toFixed(0)}€</strong></span>
                        <span class="roi-metric-badge ${netROI < 0 ? 'negative' : ''}">${netROI >= 0 ? '+' : ''}${netROI.toFixed(0)}€ ROI</span>
                    </div>
                `;
            }

            let checklistHtml = '';
            if (p.checklist && p.checklist.length > 0) {
                const completedCount = p.checklist.filter(t => t.done).length;
                checklistHtml = `
                    <div class="kanban-checklist">
                        <div style="font-weight:700; font-size:0.8rem; display:flex; justify-content:space-between;">
                            <span><i class="fas fa-check-double"></i> Checklist</span>
                            <span>${completedCount}/${p.checklist.length}</span>
                        </div>
                        ${p.checklist.map((t, tIdx) => `
                            <label class="checklist-item ${t.done ? 'done' : ''}">
                                <input type="checkbox" ${t.done ? 'checked' : ''} onchange="toggleKanbanTask('${p.id}', ${tIdx})">
                                <span>${t.text}</span>
                            </label>
                        `).join('')}
                    </div>
                `;
            }

            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
                    <div class="kanban-card-title">${p.name}</div>
                    <span class="priority-tag priority-${p.priority || 'Moyenne'}">${p.priority || 'Moyenne'}</span>
                </div>
                ${deadlineHtml}
                <div class="channel-tags-container">${channelBadges}</div>
                <div style="font-size:0.85rem; color:var(--dark);">${p.desc || ''}</div>
                ${checklistHtml}
                ${roiHtml}
                ${p.driveLink ? `<a href="${p.driveLink}" target="_blank" style="font-size:0.8rem; color:var(--info); text-decoration:none; font-weight:600; display:block; margin-top:4px;"><i class="fab fa-google-drive"></i> Rushes & Visuels HD</a>` : ''}
                ${p.trelloLink ? `<div style="margin-top: 4px;"><a href="${p.trelloLink}" target="_blank" class="trello-link"><i class="fab fa-trello"></i> Voir sur Trello</a></div>` : ''}
                
                <div style="display:flex; justify-content:flex-end; gap:6px; margin-top:5px; border-top:1px solid var(--border-color); padding-top:8px;">
                    <button class="btn btn-secondary" onclick="openEditProjectModal('${p.id}')" style="padding:4px 8px; font-size:11px;" title="Modifier"><i class="fas fa-pen"></i></button>
                    <button class="btn btn-secondary" onclick="deleteProjectSheet('${p.id}')" style="padding:4px 8px; font-size:11px;" title="Supprimer"><i class="fas fa-trash"></i></button>
                </div>
            `;
            col.appendChild(card);
        }
    });

    document.querySelectorAll('.kanban-column').forEach(col => {
        const st = col.dataset.status;
        const cntEl = col.querySelector('.col-count');
        if (cntEl) cntEl.textContent = counts[st] || 0;
    });
}

window.openProjectDetailsModal = function(id) {
    const p = state.projects.find(proj => proj.id == id);
    if (!p) return;

    document.getElementById('view-proj-title').innerHTML = `<i class="fas fa-bullhorn"></i> ${p.name}`;
    const body = document.getElementById('view-project-body');

    let projectSalesTotal = 0;
    state.comptaRawRows.forEach(r => {
        if (r[11] !== "ANNULE" && String(r[9]).includes(`[ProjetID:${p.id}]`)) {
            projectSalesTotal += parseFloat(r[4]) || 0;
        }
    });
    const totalBudget = (parseFloat(p.budgetAds) || 0) + (parseFloat(p.budgetProd) || 0);
    const netROI = projectSalesTotal - totalBudget;

    let checklistView = '<span style="color:var(--gray);">Aucune tâche définie.</span>';
    if (p.checklist && p.checklist.length > 0) {
        checklistView = p.checklist.map((t, idx) => `
            <label class="checklist-item ${t.done ? 'done' : ''}" style="margin-bottom:6px;">
                <input type="checkbox" ${t.done ? 'checked' : ''} onchange="toggleKanbanTask('${p.id}', ${idx}); openProjectDetailsModal('${p.id}');">
                <span>${t.text}</span>
            </label>
        `).join('');
    }

    body.innerHTML = `
        <div class="project-detail-section">
            <div class="project-detail-row">
                <div class="project-detail-box">
                    <h5><i class="fas fa-info-circle"></i> Informations</h5>
                    <p><strong>Statut :</strong> ${p.status}</p>
                    <p><strong>Priorité :</strong> ${p.priority}</p>
                    <p><strong>Début :</strong> ${p.start || 'Non défini'}</p>
                    <p><strong>Deadline :</strong> ${p.end || 'Non définie'}</p>
                </div>
                <div class="project-detail-box">
                    <h5><i class="fas fa-wallet"></i> Bilan Financier & ROI</h5>
                    <p><strong>Budget Publicité (Ads) :</strong> ${parseFloat(p.budgetAds || 0).toFixed(2)} €</p>
                    <p><strong>Budget Production :</strong> ${parseFloat(p.budgetProd || 0).toFixed(2)} €</p>
                    <p><strong>CA Ventes Générées :</strong> ${projectSalesTotal.toFixed(2)} €</p>
                    <p><strong>Bilan Net (ROI) :</strong> <span class="${netROI >= 0 ? 'text-success' : 'text-danger'}" style="font-weight:bold;">${netROI >= 0 ? '+' : ''}${netROI.toFixed(2)} €</span></p>
                </div>
            </div>

            <div class="project-detail-box">
                <h5><i class="fas fa-align-left"></i> Description & Objectifs</h5>
                <p>${p.desc || 'Aucune description fournie.'}</p>
            </div>

            <div class="project-detail-row">
                <div class="project-detail-box">
                    <h5><i class="fas fa-check-double"></i> Checklist de Production</h5>
                    <div style="margin-top:8px; display:flex; flex-direction:column; gap:4px;">
                        ${checklistView}
                    </div>
                </div>
                <div class="project-detail-box">
                    <h5><i class="fas fa-link"></i> Canaux & Liens Externes</h5>
                    <div class="channel-tags-container" style="margin-bottom:10px;">
                        ${(p.channels || []).map(ch => `<span class="channel-badge"><i class="fas fa-hashtag"></i> ${ch}</span>`).join('')}
                    </div>
                    ${p.driveLink ? `<p><a href="${p.driveLink}" target="_blank" style="color:var(--info); font-weight:600;"><i class="fab fa-google-drive"></i> Accéder au dossier Google Drive</a></p>` : ''}
                    ${p.trelloLink ? `<p><a href="${p.trelloLink}" target="_blank" class="trello-link"><i class="fab fa-trello"></i> Tableau Trello du projet</a></p>` : ''}
                    ${!p.driveLink && !p.trelloLink ? '<p style="color:var(--gray);">Aucun lien externe.</p>' : ''}
                </div>
            </div>

            ${p.plan ? `
                <div class="project-detail-box">
                    <h5><i class="fas fa-calendar-check"></i> Plan de Contenu / Ligne Éditoriale</h5>
                    <p style="white-space: pre-line;">${p.plan}</p>
                </div>
            ` : ''}
        </div>
    `;

    document.getElementById('view-project-modal').style.display = 'block';
};

function renderTimeline() {
    const container = document.getElementById('timeline-list');
    if (!container) return;
    if (state.projects.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:var(--gray);">Aucun projet planifié.</p>';
        return;
    }

    const sorted = [...state.projects].sort((a, b) => (a.end || '9999').localeCompare(b.end || '9999'));

    container.innerHTML = sorted.map(p => `
        <div class="timeline-card" onclick="openProjectDetailsModal('${p.id}')" style="cursor:pointer;">
            <div>
                <strong style="font-size:1.1rem; color:var(--secondary);">${p.name}</strong>
                <div style="font-size:0.85rem; color:var(--gray); margin-top:3px;">
                    <i class="fas fa-clock"></i> Deadline : <strong>${p.end || 'Non définie'}</strong> (Début : ${p.start || 'N/A'})
                </div>
            </div>
            <div style="display:flex; align-items:center; gap:10px;">
                <span class="priority-tag priority-${p.priority || 'Moyenne'}">${p.priority}</span>
                <span class="product-category">${p.status}</span>
                <button class="btn btn-secondary" onclick="event.stopPropagation(); openEditProjectModal('${p.id}')" style="padding:6px 12px; font-size:12px;"><i class="fas fa-pen"></i></button>
            </div>
        </div>
    `).join('');
}

window.toggleKanbanTask = async function(projectId, taskIndex) {
    const proj = state.projects.find(p => p.id == projectId);
    if (!proj || !proj.checklist) return;
    proj.checklist[taskIndex].done = !proj.checklist[taskIndex].done;
    await googleApiManager.updateRow(state.currentSpreadsheetId, `${PROJECTS_SHEET_NAME}!L${proj.rowIndex}`, [JSON.stringify(proj.checklist)]);
    renderKanban();
};

window.updateProjectKanbanStatus = async function(id, newStatus) {
    const proj = state.projects.find(p => p.id == id);
    if (!proj) return;
    showNotification("Mise à jour de l'étape...", "info");
    proj.status = newStatus;
    await googleApiManager.updateRow(state.currentSpreadsheetId, `${PROJECTS_SHEET_NAME}!E${proj.rowIndex}`, [newStatus]);
    renderKanban();
};

window.openEditProjectModal = function(id) {
    const proj = state.projects.find(p => p.id == id);
    if (!proj) return;

    document.getElementById('proj-edit-id').value = proj.id;
    document.getElementById('proj-name').value = proj.name;
    document.getElementById('proj-start').value = proj.start;
    document.getElementById('proj-end').value = proj.end;
    document.getElementById('proj-priority').value = proj.priority;
    document.getElementById('proj-status').value = proj.status;
    document.getElementById('proj-desc').value = proj.desc;
    document.getElementById('proj-budget-ads').value = proj.budgetAds;
    document.getElementById('proj-budget-prod').value = proj.budgetProd;
    document.getElementById('proj-drive-link').value = proj.driveLink;
    document.getElementById('proj-trello-link').value = proj.trelloLink || '';
    document.getElementById('proj-com-plan').value = proj.plan;

    document.querySelectorAll('input[name="proj-channels"]').forEach(cb => {
        cb.checked = (proj.channels || []).includes(cb.value);
    });

    state.currentProjectChecklist = proj.checklist || [];
    renderChecklistBuilder();

    const modal = document.getElementById('project-modal');
    if (modal) modal.style.display = 'block';
};

window.deleteProjectSheet = async function(id) {
    const proj = state.projects.find(p => p.id == id);
    if (!proj) return;
    if (await showFMRConfirm("Supprimer ce projet de Google Sheets ?")) {
        const sheetDetails = await googleApiManager.getSpreadsheetDetails(state.currentSpreadsheetId);
        const sheetObj = sheetDetails.sheets.find(s => s.properties.title === PROJECTS_SHEET_NAME);
        if (sheetObj) {
            await googleApiManager.deleteRow(state.currentSpreadsheetId, sheetObj.properties.sheetId, proj.rowIndex);
            showNotification("Projet supprimé !", "info");
            loadProjectsFromSheet();
        }
    }
};

// --- CARTES ET RENDU INVENTAIRE ---
function createCardHTML(item) {
    const h = state.headers;
    const nameKey = h.find(x => x.toLowerCase().includes('nom')) || h[0];
    const priceKey = detectBestPriceColumn(h, [item]); 
    const statusKey = h.find(x => x.toLowerCase().includes('état') || x.toLowerCase().includes('condition'));
    const typeKey = h.find(x => x.toLowerCase().includes('type') || x.toLowerCase().includes('catégorie'));
    const imgKey = h.find(x => x.toLowerCase().includes('image') || x.toLowerCase().includes('photo'));
    const refKey = h.find(x => x.toLowerCase().includes('ref') || x.toLowerCase().includes('code') || x.toLowerCase().includes('sku'));
    const name = item[nameKey] || 'Sans nom';
    const priceVal = (priceKey && item[priceKey]) ? parsePrice(item[priceKey]) : 0;
    const price = priceVal > 0 ? `${priceVal.toFixed(2)}€` : '';
    const status = item[statusKey] || '';
    const type = item[typeKey] || '';  
    const ref = (refKey && item[refKey]) ? item[refKey] : '';
    let rawImg = item[imgKey] ? item[imgKey].split(',')[0].trim() : '';
    let imgUrl = convertDriveImage(rawImg);
    const badgeText = ref || '';   

    return `
        <div class="product-image">
            <img src="${imgUrl}" alt="${name}" loading="lazy" referrerpolicy="no-referrer">
            ${badgeText ? `<span class="product-ref-badge">${badgeText}</span>` : ''}
        </div>
        <div class="product-info">
            ${type ? `<div class="product-category">${type}</div>` : ''}
            <h3 class="product-title">${name}</h3>
            <div class="product-footer" style="border:none; padding-top:5px;">
                <span class="product-price">${price}</span>
                ${status ? `<span class="product-status">${status}</span>` : ''}
            </div>
            <div class="card-actions">
                <button class="action-btn sold-btn" data-action="sold" title="Marquer comme Vendu"><i class="fas fa-shopping-bag"></i></button>
                <button class="action-btn edit-btn" data-action="edit" title="Modifier"><i class="fas fa-pen"></i></button>
                <button class="action-btn delete-btn" data-action="delete" title="Supprimer"><i class="fas fa-trash"></i></button>
            </div>
        </div>
        <div class="product-confirm-delete">
             <div class="confirm-text"><i class="fas fa-exclamation-triangle"></i> Supprimer ce produit ?</div>
             <div class="confirm-actions"><button class="btn btn-confirm-yes" data-action="confirm-del">Oui, supprimer</button><button class="btn btn-confirm-no" data-action="cancel-del">Annuler</button></div>
        </div>`;
}

async function handleGridClick(e) {
    const moreBtn = e.target.closest('.more-btn');
    const moreContent = e.target.closest('.more-content');
    
    if (moreBtn || moreContent) {
        e.preventDefault();
        e.stopPropagation(); 
        if (moreBtn) {
            const menu = moreBtn.nextElementSibling;
            document.querySelectorAll('.more-content.show').forEach(m => { if(m !== menu) m.classList.remove('show'); });
            if (menu) menu.classList.toggle('show');
        }
        return;
    }

    const actionBtn = e.target.closest('[data-action]') || e.target.closest('.sold-btn') || e.target.closest('.edit-btn') || e.target.closest('.delete-btn');
    if (actionBtn) {
        e.stopPropagation(); 
        const action = actionBtn.dataset.action || (actionBtn.classList.contains('sold-btn') ? 'sold' : actionBtn.classList.contains('edit-btn') ? 'edit' : actionBtn.classList.contains('delete-btn') ? 'delete' : null);
        const productCard = actionBtn.closest('.product-card');

        if (action === 'open-sheet') {
            const card = actionBtn.closest('.folder-card');
            if (card) {
                state.currentSheet = { id: parseInt(card.dataset.sheetId), title: card.dataset.sheetTitle };
                state.view = 'products'; state.currentPage = 1; if(els.backBtn) els.backBtn.classList.remove('hidden');
                const filterBar = document.getElementById('stock-filters-bar');
                if (filterBar) filterBar.style.display = 'flex';
                renderProductList(); updateBreadcrumbs();
            }
            return;
        }

        if (productCard) {
            const rowIndex = parseInt(productCard.dataset.row, 10);
            const item = state.data.find(i => i.gSheetRowIndex == rowIndex);

            if (action === 'sold') {
                if (item) openSoldModal(rowIndex, item);
                return;
            } else if (action === 'edit') {
                if (item) openEditModal(rowIndex);
                return;
            } else if (action === 'delete') {
                productCard.classList.add('is-deleting');
                return;
            } else if (action === 'cancel-del') {
                productCard.classList.remove('is-deleting');
                return;
            } else if (action === 'confirm-del') {
                productCard.style.opacity = '0.5'; 
                productCard.style.pointerEvents = 'none';
                const success = await googleApiManager.deleteRow(state.currentSpreadsheetId, state.currentSheet.id, rowIndex);
                if(success) { 
                    const savedScroll = window.scrollY; 
                    await renderProductList(); 
                    window.scrollTo(0, savedScroll); 
                } else { 
                    productCard.style.opacity = '1'; 
                    productCard.style.pointerEvents = 'auto'; 
                    productCard.classList.remove('is-deleting'); 
                }
                return;
            }
        }
    }

    const folderCard = e.target.closest('.folder-card');
    if (folderCard && state.view === 'sheets') {
        state.currentSheet = { id: parseInt(folderCard.dataset.sheetId), title: folderCard.dataset.sheetTitle };
        state.view = 'products'; 
        state.currentPage = 1; 
        if(els.backBtn) els.backBtn.classList.remove('hidden');
        const filterBar = document.getElementById('stock-filters-bar');
        if (filterBar) filterBar.style.display = 'flex';
        renderProductList(); 
        updateBreadcrumbs();
        return;
    }

    const productCard = e.target.closest('.product-card');
    if (productCard && !productCard.classList.contains('is-deleting')) {
        const rowIndex = parseInt(productCard.dataset.row, 10);
        openViewModal(rowIndex);
    }
}

// --- NAVIGATION ET CORE ---
function handleNav(e) {
    e.preventDefault();
    document.querySelectorAll('nav a').forEach(a => a.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    
    const targetA = e.target.closest('a');
    targetA.classList.add('active');
    const tab = targetA.dataset.tab;
    const tabEl = document.getElementById(tab);
    if(tabEl) tabEl.classList.add('active');
    
    if(els.fab) els.fab.style.display = (tab === 'stock') ? 'block' : 'none';
    
    if(tab === 'stock') {
        if(state.view === 'sheets') renderSheetList();
        else renderProductList();
    }
    if(tab === 'stats') initStatsDashboard();
    if(tab === 'form') initFormTab();
    if(tab === 'compta') loadComptaData();
    if(tab === 'expenses') loadExpensesData();
    if(tab === 'depots') renderDepotsBilan();
    if(tab === 'projects') loadProjectsFromSheet();
}

function convertDriveImage(url) {
    if (!url) return 'https://placehold.co/400x300/e6e6e6/1d1d1d?text=No+Image';
    const idRegex = /[-\w]{25,}/;
    const match = url.match(idRegex);
    if (match && (url.includes('drive.google.com') || url.includes('docs.google.com'))) {
        return `https://drive.google.com/thumbnail?id=${match[0]}&sz=w1000`;
    }
    return url;
}

function parsePrice(str) {
    if (!str) return 0;
    let clean = String(str).replace(/\s/g, '').replace(/€/g, '').replace(/eur/i, '').replace(',', '.');
    const match = clean.match(/(\d+[.,]?\d*)/);
    if(match) clean = match[0];
    let val = parseFloat(clean); return isNaN(val) ? 0 : val;
}

function detectBestPriceColumn(headers, sampleRows) {
    const isInvalid = (h) => h.match(/lieu|place|date|statut|status/i);
    let key = headers.find(h => !isInvalid(h) && (h.match(/final|estim|public|pv|selling|sold/i) || h.match(/vente/i))); if(key) return key;
    key = headers.find(h => !isInvalid(h) && h.match(/prix|price|valeur|montant|tarif|ttc|ht|cout|coût/i) && !h.match(/sourc|achat|cost|buy/i)); if(key) return key;
    key = headers.find(h => !isInvalid(h) && h.match(/prix|price|valeur|montant|tarif|ttc|ht|cout|coût/i)); if(key) return key;
    return null;
}

function findHeadersAndData(rawData) {
    if (!rawData || rawData.length === 0) return { headers: [], rows: [] };
    const keywords = ['ref', 'prix', 'price', 'type', 'marque', 'stock', 'couleur', 'taille', 'status', 'statut'];
    let bestRowIndex = 0;
    let maxMatches = 0;
    for (let i = 0; i < Math.min(rawData.length, 5); i++) {
        const row = rawData[i];
        let matches = 0;
        row.forEach(cell => {
            if (cell && typeof cell === 'string') {
                if (keywords.some(k => cell.toLowerCase().includes(k))) matches++;
            }
        });
        if (matches > maxMatches) {
            maxMatches = matches;
            bestRowIndex = i;
        }
    }
    const headers = rawData[bestRowIndex];
    const rows = rawData.slice(bestRowIndex + 1);
    const objectRows = rows.map((row, idx) => {
        let obj = { gSheetRowIndex: bestRowIndex + 1 + idx + 1 };
        headers.forEach((h, i) => { if(h) obj[h] = row[i]; });
        return obj;
    });
    return { headers, rows: objectRows };
}

function updateAuthState(loggedIn) {
    if (loggedIn) {
        if (els.loginOverlay) els.loginOverlay.classList.add('hidden');
        if (state.currentSpreadsheetId) {
            if (els.sheetPrompt) els.sheetPrompt.classList.add('hidden');
            if (els.app) els.app.style.display = 'block';
            loadSpreadsheet(state.currentSpreadsheetId);
        } else {
            if (els.sheetPrompt) els.sheetPrompt.classList.remove('hidden');
            if (els.app) els.app.style.display = 'none';
        }
    } else {
        if (els.loginOverlay) els.loginOverlay.classList.remove('hidden');
        if (els.sheetPrompt) els.sheetPrompt.classList.add('hidden');
        if (els.app) els.app.style.display = 'none';
        state.currentSpreadsheetId = null;
    }
}

async function loadSpreadsheet(id) {
    if (!id) return;
    showNotification("Chargement et synchronisation globale...", "info");
    const details = await googleApiManager.getSpreadsheetDetails(id);
    if (details) {
        state.currentSpreadsheetId = id;
        localStorage.setItem('spreadsheetId', id);
        state.spreadsheetDetails = details;
        if (els.sheetPrompt) els.sheetPrompt.classList.add('hidden');
        if (els.app) els.app.style.display = 'block';
        
        state.view = 'sheets';
        renderSheetList();
        updateBreadcrumbs();

        // SYNCHRONISATION GLOBALE EN ARRIÈRE-PLAN : 
        // Charge la comptabilité, les dépenses et les projets dès le démarrage
        // pour que toutes les sections communiquent immédiatement entre elles.
        preloadAllDataInBackground();
    } else {
        if (els.sheetPrompt) els.sheetPrompt.classList.remove('hidden');
    }
}

// Fonction de chargement global discret au démarrage
async function preloadAllDataInBackground() {
    try {
        await ensureComptaSheetExists();
        const comptaRaw = await googleApiManager.getSheetData(state.currentSpreadsheetId, `${COMPTA_SHEET_NAME}!A:L`);
        if (comptaRaw && comptaRaw.length >= 2) {
            state.comptaRawRows = comptaRaw.slice(1).map((r, idx) => ({ ...r, rowIndex: idx + 2 }));
        } else {
            state.comptaRawRows = [];
        }

        await ensureExpensesSheetExists();
        const expensesRaw = await googleApiManager.getSheetData(state.currentSpreadsheetId, `${EXPENSES_SHEET_NAME}!A:I`);
        if (expensesRaw && expensesRaw.length >= 2) {
            state.expensesRawRows = expensesRaw.slice(1).map((r, idx) => ({
                id: r[0] || Date.now().toString(),
                date: r[1] || '',
                cat: r[2] || 'Autre',
                desc: r[3] || 'Charge',
                ttc: parseFloat(r[4]) || 0,
                ht: parseFloat(r[5]) || 0,
                tva: parseFloat(r[6]) || 0,
                payment: r[7] || 'Carte',
                projectId: r[8] || '',
                rowIndex: idx + 2
            }));
        } else {
            state.expensesRawRows = [];
        }

        await ensureProjectsSheetExists();
        const projectsRaw = await googleApiManager.getSheetData(state.currentSpreadsheetId, `${PROJECTS_SHEET_NAME}!A:N`);
        if (projectsRaw && projectsRaw.length >= 2) {
            state.projects = projectsRaw.slice(1).map((r, idx) => ({
                id: r[0] || Date.now().toString(),
                name: r[1] || 'Sans nom',
                start: r[2] || '',
                end: r[3] || '',
                status: r[4] || "Idée",
                desc: r[5] || '',
                channels: r[6] ? r[6].split(',').map(s => s.trim()).filter(Boolean) : [],
                budgetAds: r[7] || "0",
                budgetProd: r[8] || "0",
                driveLink: r[9] || "",
                plan: r[10] || "",
                checklist: r[11] ? JSON.parse(r[11]) : [],
                priority: r[12] || "Moyenne",
                trelloLink: r[13] || "",
                rowIndex: idx + 2
            }));
        } else {
            state.projects = [];
        }

        console.log("Synchronisation globale en arrière-plan réussie.");
        
        // Appel de la vérification des deadlines une fois les données chargées
        checkProjectDeadlines();
        
    } catch (err) {
        console.error("Erreur lors de la synchronisation globale en arrière-plan :", err);
    }
}

function handleChangeSheet() {
    if(confirm("Changer de fichier Google Sheet ?")) {
        state.currentSpreadsheetId = null;
        localStorage.removeItem('spreadsheetId');
        updateAuthState(true);
    }
}

function goBack() {
    state.view = 'sheets';
    state.currentSheet = null;
    renderSheetList();
    updateBreadcrumbs();
    if (els.backBtn) els.backBtn.classList.add('hidden');
    const filterBar = document.getElementById('stock-filters-bar');
    if (filterBar) filterBar.style.display = 'none';
    if (els.search) els.search.value = '';
    state.currentPage = 1;
    const pag = document.getElementById('pagination-controls');
    if (pag) pag.innerHTML = '';
}

function updateBreadcrumbs() {
    if(!state.currentSpreadsheetId) return;
    const root = state.spreadsheetDetails?.properties?.title || 'Spreadsheet';
    if(state.view === 'sheets') {
        if(els.breadcrumbs) els.breadcrumbs.innerHTML = `<span class="current-folder">${root}</span>`;
        if(els.title) els.title.innerHTML = `<i class="fas fa-book"></i> ${root}`;
    } else {
        if(els.breadcrumbs) els.breadcrumbs.innerHTML = `<a href="#" onclick="goBack()">${root}</a> / <span class="current-folder">${state.currentSheet.title}</span>`;
        if(els.title) els.title.innerHTML = `<i class="fas fa-folder-open"></i> ${state.currentSheet.title}`;
    }
    updateHeaderActions(); 
}

function updateHeaderActions() {
    const btnImp = document.getElementById('header-btn-import');
    const btnExp = document.getElementById('header-btn-export');
    if (!btnExp) return;
    const btnExpText = btnExp.querySelector('span');
    if (state.view === 'sheets') {
        if (btnImp) btnImp.style.display = 'none';
        if (btnExpText) btnExpText.textContent = "Tout Exporter";
    } else {
        if (btnImp) btnImp.style.display = 'inline-flex';
        if (btnExpText) btnExpText.textContent = "Exporter Dossier";
    }
}

function handleExportClick() {
    if (state.view === 'sheets') exportGlobalCSV();
    else exportLocalCSV();
}

function renderSheetList() {
    if(!els.grid) return;
    els.grid.innerHTML = '<div class="loading-overlay-grid"><i class="fas fa-circle-notch spinner-icon"></i><span>Chargement des dossiers...</span></div>';
    const pag = document.getElementById('pagination-controls');
    if (pag) pag.innerHTML = ''; 
    updateHeaderActions();
    if (!state.spreadsheetDetails) return;

    els.grid.innerHTML = '';
    state.spreadsheetDetails.sheets.forEach(sheet => {
        const title = sheet.properties.title;
        if(title === COMPTA_SHEET_NAME || title === PROJECTS_SHEET_NAME || title === EXPENSES_SHEET_NAME) return;
        const sheetId = sheet.properties.sheetId;
        const card = document.createElement('div');
        card.className = 'folder-card';
        card.setAttribute('data-sheet-id', sheetId);
        card.setAttribute('data-sheet-title', title);
        card.innerHTML = `
            <div class="folder-icon-display"><i class="fas fa-folder"></i></div>
            <div class="folder-details"><h3>${title}</h3><p id="sheet-count-${sheetId}" style="color:var(--gray); font-size:0.9em;"><i class="fas fa-circle-notch fa-spin"></i></p></div>
            <div class="more-menu folder-actions">
                <button class="more-btn" type="button"><i class="fas fa-cog"></i></button>
                <div class="more-content">
                    <button class="more-item" type="button" onclick="window.openRenameModal(event, '${sheetId}', '${title}')"><i class="fas fa-edit"></i> Renommer</button>
                    <button class="more-item" type="button" onclick="window.deleteFolderSheet(event, '${sheetId}', '${title}')" style="color:var(--danger);"><i class="fas fa-trash"></i> Supprimer</button>
                </div>
            </div>`;
        els.grid.appendChild(card);
    });
    updateSheetRealCounts();
}

window.deleteFolderSheet = async function(e, sheetId, title) {
    e.preventDefault();
    e.stopPropagation();
    
    document.querySelectorAll('.more-content.show').forEach(m => m.classList.remove('show'));
        if (await showFMRConfirm(`Voulez-vous vraiment supprimer définitivement le dossier "${title}" et tout son contenu ?`)) {
        showNotification(`Suppression du dossier ${title}...`, "info");
        try {
            const sheetIdInt = parseInt(sheetId, 10);
            await googleApiManager.gapi.client.sheets.spreadsheets.batchUpdate({
                spreadsheetId: state.currentSpreadsheetId,
                resource: {
                    requests: [{
                        deleteSheet: {
                            sheetId: sheetIdInt
                        }
                    }]
                }
            });
            showNotification(`Dossier "${title}" supprimé avec succès !`, "success");
            loadSpreadsheet(state.currentSpreadsheetId);
        } catch (err) {
            console.error("Erreur suppression de feuille", err);
            showNotification("Erreur lors de la suppression du dossier.", "error");
        }
    }
};

async function updateSheetRealCounts() {
    if (!state.spreadsheetDetails || !state.spreadsheetDetails.sheets) return;
    const sheets = state.spreadsheetDetails.sheets.filter(s => s.properties.title !== COMPTA_SHEET_NAME && s.properties.title !== PROJECTS_SHEET_NAME && s.properties.title !== EXPENSES_SHEET_NAME);
    const ranges = sheets.map(s => `'${s.properties.title.replace(/'/g, "''")}'!A:E`);
    const data = await googleApiManager.getBatchSheetData(state.currentSpreadsheetId, ranges);
    if (data) {
        data.forEach((rangeData, index) => {
            const sheetId = sheets[index].properties.sheetId;
            let count = 0;
            if(rangeData.values) {
                const nonEmptyRows = rangeData.values.filter(row => row.some(cell => cell && cell.toString().trim() !== '')).length;
                count = Math.max(0, nonEmptyRows - 1);
            }
            const countEl = document.getElementById(`sheet-count-${sheetId}`);
            if (countEl) countEl.textContent = `${count} produit${count > 1 ? 's' : ''}`;
        });
    }
}

async function renderProductList() {
    if (!state.currentSheet || !els.grid) return;
    updateHeaderActions();

    els.grid.innerHTML = '<div class="loading-overlay-grid"><i class="fas fa-circle-notch spinner-icon"></i><span>Synchronisation des produits...</span></div>';

    const rawData = await googleApiManager.getSheetData(state.currentSpreadsheetId, `${state.currentSheet.title}!A:Z`);
    if(!rawData || rawData.length === 0) {
        els.grid.innerHTML = '<div class="no-products"><p>Dossier vide.</p></div>';
        const pag = document.getElementById('pagination-controls');
        if (pag) pag.innerHTML = '';
        state.headers = []; state.data = [];
        return;
    }
    const processed = findHeadersAndData(rawData);
    state.headers = processed.headers;
    state.data = processed.rows;

    const term = (els.search?.value || '').toLowerCase();
    const priceFilter = document.getElementById('filter-stock-price')?.value || '';
    const sortFilter = document.getElementById('filter-stock-sort')?.value || 'default';
    const priceKey = detectBestPriceColumn(state.headers, state.data);

    let filtered = state.data.filter(item => {
        const matchesTerm = Object.values(item).some(v => String(v).toLowerCase().includes(term));
        if (!matchesTerm) return false;

        if (priceFilter && priceKey) {
            const p = parsePrice(item[priceKey]);
            if (priceFilter === "0-30" && (p < 0 || p > 30)) return false;
            if (priceFilter === "30-70" && (p <= 30 || p > 70)) return false;
            if (priceFilter === "70-150" && (p <= 70 || p > 150)) return false;
            if (priceFilter === "150+" && p <= 150) return false;
        }
        return true;
    });

    if (sortFilter === "price-asc" && priceKey) {
        filtered.sort((a, b) => parsePrice(a[priceKey]) - parsePrice(b[priceKey]));
    } else if (sortFilter === "price-desc" && priceKey) {
        filtered.sort((a, b) => parsePrice(b[priceKey]) - parsePrice(a[priceKey]));
    } else if (sortFilter === "name-asc") {
        const nameKey = state.headers.find(x => x.toLowerCase().includes('nom')) || state.headers[0];
        filtered.sort((a, b) => String(a[nameKey] || '').localeCompare(String(b[nameKey] || '')));
    }

    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / state.itemsPerPage);
    if (state.currentPage > totalPages) state.currentPage = totalPages || 1;
    if (state.currentPage < 1) state.currentPage = 1;
    const start = (state.currentPage - 1) * state.itemsPerPage;
    const end = start + state.itemsPerPage;
    const paginatedItems = filtered.slice(start, end);
    els.grid.innerHTML = ''; 
    if(totalItems === 0) {
        els.grid.innerHTML = '<div class="no-products"><p>Aucun résultat.</p></div>';
        const pag = document.getElementById('pagination-controls');
        if (pag) pag.innerHTML = '';
        return;
    }
    paginatedItems.forEach(item => {
        const card = document.createElement('div');
        card.className = 'product-card';
        card.dataset.row = item.gSheetRowIndex; 
        card.innerHTML = createCardHTML(item);
        els.grid.appendChild(card);
    });
    renderPaginationControls(totalPages);
}

function renderPaginationControls(totalPages) {
    const container = document.getElementById('pagination-controls');
    if (!container) return;
    container.innerHTML = '';
    if (totalPages <= 1) return;
    const createBtn = (iconOrText, targetPage, isDisabled = false, isActive = false) => {
        const btn = document.createElement('button');
        btn.className = `page-btn ${isActive ? 'active' : ''}`;
        btn.innerHTML = iconOrText;
        if (isDisabled) btn.disabled = true;
        if (!isDisabled && !isActive) {
            btn.onclick = () => {
                state.currentPage = targetPage;
                renderProductList();
                window.scrollTo({ top: 0, behavior: 'smooth' });
            };
        }
        container.appendChild(btn);
    };
    createBtn('<i class="fas fa-angle-left"></i>', state.currentPage - 1, state.currentPage === 1);
    for (let i = 1; i <= totalPages; i++) {
        createBtn(i, i, false, state.currentPage === i);
    }
    createBtn('<i class="fas fa-angle-right"></i>', state.currentPage + 1, state.currentPage === totalPages);
}

// Modals Helpers
function openViewModal(rowIdx) {
    const item = state.data.find(i => i.gSheetRowIndex == rowIdx);
    if (!item) return;
    const body = document.getElementById('view-product-body');
    const imgKey = state.headers.find(x => x.toLowerCase().includes('image'));
    let raw = item[imgKey] ? item[imgKey].split(',')[0].trim() : '';
    let url = convertDriveImage(raw);
    let html = '';
    state.headers.forEach(h => { if(h !== 'gSheetRowIndex' && h !== imgKey) { html += `<div class="detail-row"><div class="detail-label">${h}</div><div class="detail-value">${item[h]||'-'}</div></div>`; } });
    if (body) body.innerHTML = `<div class="detail-view-container"><div class="detail-image"><img src="${url}" referrerpolicy="no-referrer"></div><div class="detail-info">${html}</div></div>`;
    const modal = document.getElementById('view-product-modal');
    if (modal) modal.style.display='block';
}

function openAddModal() {
    if(!state.currentSheet) { showNotification("Ouvrez d'abord un dossier !", "error"); return; }
    const container = document.querySelector('#add-product-modal .modal-body');
    if (container) {
        container.innerHTML = `<form id="add-form"><div class="dynamic-fields-grid">${buildFields(state.headers)}</div><div class="modal-footer"><button type="submit" class="btn btn-finish">Ajouter</button></div></form>`;
        document.getElementById('add-form').onsubmit = async (e) => {
            e.preventDefault();
            const vals = state.headers.map((h, i) => document.getElementById(`field-${i}`).value);
            if(await googleApiManager.appendRow(state.currentSpreadsheetId, `${state.currentSheet.title}!A:A`, vals)) {
                showNotification("Produit ajouté !", "success"); document.getElementById('add-product-modal').style.display='none'; renderProductList();
            }
        };
    }
    const modal = document.getElementById('add-product-modal');
    if (modal) modal.style.display='block';
}

function openEditModal(rowIdx) {
    const item = state.data.find(i => i.gSheetRowIndex == rowIdx);
    const container = document.querySelector('#edit-modal .modal-body');
    if (container) {
        container.innerHTML = `<form id="edit-form"><div class="dynamic-fields-grid">${buildFields(state.headers, item)}</div><div class="modal-footer"><button type="submit" class="btn btn-finish">Sauvegarder</button></div></form>`;
        document.getElementById('edit-form').onsubmit = async (e) => {
            e.preventDefault();
            const vals = state.headers.map((h, i) => document.getElementById(`field-${i}`).value);
            const endCol = String.fromCharCode(64 + state.headers.length);
            if(await googleApiManager.updateRow(state.currentSpreadsheetId, `${state.currentSheet.title}!A${rowIdx}:${endCol}${rowIdx}`, vals)) {
                document.getElementById('edit-modal').style.display='none'; const savedScroll = window.scrollY; await renderProductList(); window.scrollTo(0, savedScroll);
            }
        };
    }
    const modal = document.getElementById('edit-modal');
    if (modal) modal.style.display='block';
}

function buildFields(headers, data) {
    return headers.map((h, i) => {
        const val = data ? (data[h]||'') : ''; const safeVal = String(val).replace(/"/g, '&quot;'); const lower = h.toLowerCase();
        let input = `<input type="text" id="field-${i}" value="${safeVal}">`;
        if(lower.includes('desc')) input = `<textarea id="field-${i}" rows="3">${val}</textarea>`;
        return `<div class="form-group"><label>${h}</label>${input}</div>`;
    }).join('');
}

function initFormTab() {
    const selector = document.getElementById('form-sheet-select');
    if (!selector) return;
    selector.innerHTML = '<option value="">-- Choisir un dossier --</option>';
    if (!state.spreadsheetDetails) return;
    state.spreadsheetDetails.sheets.forEach(sheet => {
        if(sheet.properties.title === COMPTA_SHEET_NAME || sheet.properties.title === PROJECTS_SHEET_NAME || sheet.properties.title === EXPENSES_SHEET_NAME) return;
        const opt = document.createElement('option'); opt.value = sheet.properties.title; opt.textContent = sheet.properties.title;
        if (state.currentSheet && state.currentSheet.title === sheet.properties.title) opt.selected = true;
        selector.appendChild(opt);
    });
    if (selector.value) handleFormSheetChange({ target: selector });
}

async function handleFormSheetChange(e) {
    const sheetTitle = e.target.value;
    const container = document.getElementById('form-dynamic-container');
    const submitBtn = document.getElementById('form-submit-btn');
    if (!sheetTitle) { if(container) container.innerHTML = '<p style="color:var(--gray); grid-column: 1/-1; text-align:center;">Veuillez sélectionner un dossier.</p>'; if(submitBtn) submitBtn.disabled = true; return; }
    if(container) container.innerHTML = '<p style="grid-column:1/-1; text-align:center;"><i class="fas fa-circle-notch fa-spin"></i> Chargement des champs...</p>';
    const rawData = await googleApiManager.getSheetData(state.currentSpreadsheetId, `${sheetTitle}!A1:Z2`);
    if (!rawData || rawData.length === 0) { if(container) container.innerHTML = '<p style="color:var(--danger); grid-column:1/-1;">Erreur dossier vide.</p>'; return; }
    const headers = rawData[0]; state.formHeaders = headers; 
    if(container) {
        container.innerHTML = headers.map((h, i) => {
            const lower = h.toLowerCase(); let input = `<input type="text" id="main-field-${i}">`;
            if(lower.includes('desc')) input = `<textarea id="main-field-${i}" rows="3"></textarea>`;
            return `<div class="form-group"><label>${h}</label>${input}</div>`;
        }).join('');
    }
    if(submitBtn) submitBtn.disabled = false;
}

async function handleMainFormSubmit(e) {
    e.preventDefault();
    const sheetTitle = document.getElementById('form-sheet-select')?.value;
    const submitBtn = document.getElementById('form-submit-btn');
    if (!sheetTitle || state.formHeaders.length === 0) return;
    const values = state.formHeaders.map((h, i) => document.getElementById(`main-field-${i}`).value);
    if(submitBtn) submitBtn.disabled = true;
    const success = await googleApiManager.appendRow(state.currentSpreadsheetId, `${sheetTitle}!A:A`, values);
    if (success) { 
        showNotification("Article enregistré !", "success");  
        state.formHeaders.forEach((h, i) => { const el = document.getElementById(`main-field-${i}`); if(el) el.value = ''; });
    }
    if(submitBtn) submitBtn.disabled = false;
}

async function handleAddSheet(e) {
    e.preventDefault();
    const name = document.getElementById('sheet-name')?.value.trim();
    const template = document.getElementById('sheet-template')?.value;
    const customHeaders = document.getElementById('custom-headers')?.value;
    
    if(!name) return;
    
    const submitBtn = document.querySelector('#create-sheet-form button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    if (await googleApiManager.addSheet(state.currentSpreadsheetId, name)) { 
        let headersToWrite = [];
        
        // 1. Définition des champs à injecter
        if (template === 'custom') {
            headersToWrite = customHeaders.split(',').map(s => s.trim()).filter(Boolean);
        } else if (template) {
            const rawData = await googleApiManager.getSheetData(state.currentSpreadsheetId, `${template}!A1:Z1`);
            if (rawData && rawData.length > 0) {
                headersToWrite = rawData[0]; // Clone la première ligne (les en-têtes)
            }
        }

        // 2. Écriture des en-têtes dans le nouveau dossier
        if (headersToWrite.length > 0) {
            await googleApiManager.appendRow(state.currentSpreadsheetId, `${name}!A:A`, headersToWrite);
        }

        showNotification(`Dossier "${name}" et son formulaire créés !`, "success");
        loadSpreadsheet(state.currentSpreadsheetId);  
        const m = document.getElementById('create-sheet-modal');
        if (m) m.style.display = 'none'; 
        document.getElementById('create-sheet-form').reset();
    } else {
        showNotification("Erreur lors de la création du dossier.", "error");
    }
    
    if (submitBtn) submitBtn.disabled = false;
}

window.openRenameModal = function(e, id, currentName) {
    e.preventDefault(); e.stopPropagation();  
    document.getElementById('rename-sheet-id').value = id;
    document.getElementById('rename-sheet-name').value = currentName;
    const m = document.getElementById('rename-modal');
    if(m) m.style.display = 'block';
};

async function handleRenameSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('rename-sheet-id')?.value;
    const newName = document.getElementById('rename-sheet-name')?.value;
    const m = document.getElementById('rename-modal');
    if(m) m.style.display = 'none';
    if (newName && id) {
        if(await googleApiManager.renameSheet(state.currentSpreadsheetId, id, newName)) loadSpreadsheet(state.currentSpreadsheetId);
    }
}

function exportLocalCSV() {
    if(!state.currentSheet || state.data.length === 0) { showNotification("Dossier vide ou non chargé", "error"); return; }
    const csvContent = generateCSVFromData(state.headers, state.data);
    downloadFile(csvContent, `${state.currentSheet.title}_export.csv`, 'text/csv');
}

async function exportGlobalCSV() {
    showNotification("Préparation de l'export global...", "info");
    const sheets = state.spreadsheetDetails.sheets.filter(s => s.properties.title !== COMPTA_SHEET_NAME && s.properties.title !== PROJECTS_SHEET_NAME && s.properties.title !== EXPENSES_SHEET_NAME);
    const ranges = sheets.map(s => `'${s.properties.title.replace(/'/g, "''")}'!A:Z`);
    const batchData = await googleApiManager.getBatchSheetData(state.currentSpreadsheetId, ranges);
    if (!batchData) { showNotification("Erreur de récupération des données", "error"); return; }
    let mergedData = []; let masterHeaders = [];
    batchData.forEach(res => { if(res.values && res.values.length > 0) { if(res.values[0].length > masterHeaders.length) masterHeaders = res.values[0]; } });
    masterHeaders = ['Source_Dossier', ...masterHeaders]; mergedData.push(masterHeaders);
    batchData.forEach((res, index) => {
        const title = sheets[index].properties.title; const rows = res.values || []; if(rows.length < 2) return;
        const headers = rows[0]; const data = rows.slice(1);
        data.forEach(row => { let newRow = new Array(masterHeaders.length).fill(""); newRow[0] = title; row.forEach((cell, idx) => { newRow[idx + 1] = cell; }); mergedData.push(newRow); });
    });
    const csvContent = mergedData.map(row => { return row.map(cell => { let val = String(cell || ""); if (val.includes(',') || val.includes('"') || val.includes('\n')) { val = `"${val.replace(/"/g, '""')}"`; } return val; }).join(','); }).join('\n');
    downloadFile(csvContent, `GLOBAL_EXPORT_${new Date().toISOString().slice(0,10)}.csv`, 'text/csv');
    showNotification("Export Global terminé !", "success");
}

async function importCSV(file) {
    if(!state.currentSheet) { showNotification("Ouvrez d'abord un dossier !", "error"); return; }
    const reader = new FileReader();
    reader.onload = async (e) => {
        const text = e.target.result; const rows = parseCSVString(text);
        if(rows.length < 2) { showNotification("Fichier CSV vide ou invalide", "error"); return; }
        showNotification(`Import de ${rows.length-1} lignes en cours...`, "info");
        const dataToAppend = rows.slice(1); let count = 0;
        for (const rowVal of dataToAppend) { if(rowVal.length === 0 || (rowVal.length === 1 && rowVal[0] === '')) continue; await googleApiManager.appendRow(state.currentSpreadsheetId, `${state.currentSheet.title}!A:A`, rowVal); count++; }
        showNotification(`Import terminé (${count} produits)`, "success"); document.getElementById('header-csv-input').value = ""; renderProductList();
    };
    reader.readAsText(file);
}

function generateCSVFromData(headers, data) {
    const headerRow = headers;
    const dataRows = data.map(item => { return headers.map(h => { let val = item[h] || ""; if (typeof val === 'string' && (val.includes(',') || val.includes('"') || val.includes('\n'))) { val = `"${val.replace(/"/g, '""')}"`; } return val; }); });
    return [headerRow.join(','), ...dataRows.map(r => r.join(','))].join('\n');
}

function parseCSVString(str) {
    const arr = []; let quote = false; let col, c;
    for (let row = col = c = 0; c < str.length; c++) {
        let cc = str[c], nc = str[c+1]; arr[row] = arr[row] || []; arr[row][col] = arr[row][col] || '';
        if (cc == '"' && quote && nc == '"') { arr[row][col] += cc; ++c; continue; }
        if (cc == '"') { quote = !quote; continue; }
        if (cc == ',' && !quote) { ++col; continue; }
        if (cc == '\r' && nc == '\n' && !quote) { ++row; col = 0; ++c; continue; }
        if (cc == '\n' && !quote) { ++row; col = 0; continue; }
        if (cc == '\r' && !quote) { ++row; col = 0; continue; }
        arr[row][col] += cc;
    }
    return arr;
}

function downloadFile(content, fileName, mimeType) {
    const blob = new Blob([content], { type: mimeType + ';charset=utf-8;' }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.setAttribute("href", url); link.setAttribute("download", fileName); document.body.appendChild(link); link.click(); document.body.removeChild(link);
}

// Stats & Chart.js Dashboard optimisé
async function initStatsDashboard() {
    const selector = document.getElementById('stats-sheet-select');
    if (!selector) return;
    selector.innerHTML = '<option value="">-- Choisir un dossier --</option>';
    if (!state.spreadsheetDetails) return;
    state.spreadsheetDetails.sheets.forEach(sheet => {
        if(sheet.properties.title === COMPTA_SHEET_NAME || sheet.properties.title === PROJECTS_SHEET_NAME || sheet.properties.title === EXPENSES_SHEET_NAME) return;
        const opt = document.createElement('option'); opt.value = sheet.properties.title; opt.textContent = sheet.properties.title;
        selector.appendChild(opt);
    });
    selector.onchange = (e) => loadStatsForSheet(e.target.value);
}

async function loadStatsForSheet(sheetTitle) {
    if (!sheetTitle) return;
    const rawData = await googleApiManager.getSheetData(state.currentSpreadsheetId, `${sheetTitle}!A:Z`);
    if (!rawData || rawData.length === 0) return;
    const processed = findHeadersAndData(rawData);
    const priceKey = detectBestPriceColumn(processed.headers, processed.rows);
    let totalVal = 0; let count = processed.rows.length;
    
    const brandKey = processed.headers.find(h => h.toLowerCase().includes('marque') || h.toLowerCase().includes('brand')) || processed.headers[0];
    const typeKey = processed.headers.find(h => h.toLowerCase().includes('type') || h.toLowerCase().includes('catégorie')) || brandKey;

    const groupCounts = {};
    processed.rows.forEach(item => { 
        if(priceKey && item[priceKey]) totalVal += parsePrice(item[priceKey]); 
        const groupVal = (item[brandKey] || item[typeKey] || 'Autre').trim();
        groupCounts[groupVal] = (groupCounts[groupVal] || 0) + 1;
    });

    const kpi = document.getElementById('kpi-container');
    if (kpi) {
        kpi.innerHTML = `
            <div class="kpi-card"><div class="kpi-icon kpi-blue"><i class="fas fa-tshirt"></i></div><div class="kpi-info"><span class="kpi-label">Stock Total</span><span class="kpi-value">${count}</span></div></div>
            <div class="kpi-card"><div class="kpi-icon kpi-green"><i class="fas fa-coins"></i></div><div class="kpi-info"><span class="kpi-label">Valorisation</span><span class="kpi-value">${totalVal.toFixed(2)} €</span></div></div>
        `;
    }

    renderCleanChart(groupCounts);
}

function renderCleanChart(dataObj) {
    const chartBody = document.getElementById('main-chart');
    if (!chartBody) return;
    chartBody.innerHTML = '<canvas id="statsCanvas" style="width:100%; max-height:280px;"></canvas>';
    const ctx = document.getElementById('statsCanvas').getContext('2d');

    if (mainChartInstance) mainChartInstance.destroy();

    const sortedEntries = Object.entries(dataObj).sort((a, b) => b[1] - a[1]);
    
    let finalLabels = [];
    let finalData = [];
    
    if (sortedEntries.length > 6) {
        const top6 = sortedEntries.slice(0, 6);
        const others = sortedEntries.slice(6);
        const othersSum = others.reduce((acc, curr) => acc + curr[1], 0);

        top6.forEach(entry => {
            finalLabels.push(entry[0]);
            finalData.push(entry[1]);
        });
        finalLabels.push("Autres");
        finalData.push(othersSum);
    } else {
        sortedEntries.forEach(entry => {
            finalLabels.push(entry[0]);
            finalData.push(entry[1]);
        });
    }

    mainChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: finalLabels,
            datasets: [{
                data: finalData,
                backgroundColor: ['#F76B15', '#00A6ED', '#4CAF50', '#9c27b0', '#FF9800', '#795548', '#B0BEC5'],
                borderWidth: 2,
                borderColor: '#FFFFFF'
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { 
                    position: 'right',
                    labels: { boxWidth: 14, font: { size: 12 } }
                }
            }
        }
    });
}

function createPicker() {
    if (!window.google || !window.google.picker) return;
    const token = googleApiManager.gapi.client.getToken();
    if (!token) return;

    const sheetPrompt = document.getElementById('sheet-prompt');
    if (sheetPrompt) sheetPrompt.classList.add('hidden');

    const view = new google.picker.View(google.picker.ViewId.SPREADSHEETS);
    const picker = new google.picker.PickerBuilder()
        .setAppId(googleApiManager.CLIENT_ID.split('-')[0])
        .setOAuthToken(token.access_token)
        .addView(view)
        .setCallback((data) => {
            if (data[google.picker.Response.ACTION] === google.picker.Action.PICKED) {
                const id = data.docs[0].id; 
                document.getElementById('spreadsheet-id-input').value = id; 
                loadSpreadsheet(id);
            } else if (data[google.picker.Response.ACTION] === google.picker.Action.CANCEL) {
                if (sheetPrompt && !state.currentSpreadsheetId) {
                    sheetPrompt.classList.remove('hidden');
                }
            }
        })
        .build();
    picker.setVisible(true);
}

function setupTheme() {
    const themeToggle = document.getElementById('theme-checkbox');
    if(themeToggle) {
        themeToggle.addEventListener('change', () => {
            const t = themeToggle.checked ? 'dark' : 'light';
            document.body.setAttribute('data-theme', t);
            localStorage.setItem('theme', t);
        });
        const saved = localStorage.getItem('theme') || 'light';
        document.body.setAttribute('data-theme', saved);
        themeToggle.checked = (saved === 'dark');
    }
}


function showFMRConfirm(message) {
    return new Promise((resolve) => {
        let existingModal = document.getElementById('fmr-confirm-modal');
        if (existingModal) existingModal.remove();

        const modalHtml = `
            <div class="modal" id="fmr-confirm-modal" style="display: block; z-index: 30000 !important;">
                <div class="modal-content" style="max-width: 420px; text-align: center; padding: 10px;">
                    <div class="modal-header" style="border-bottom: none; justify-content: center;">
                        <h3 style="color: var(--danger); font-size: 1.2rem;"><i class="fas fa-exclamation-triangle"></i> Confirmation</h3>
                    </div>
                    <div class="modal-body" style="padding: 10px 20px 20px 20px; font-size: 1rem; color: var(--dark); font-weight: 600;">
                        ${message}
                    </div>
                    <div class="modal-footer" style="border-top: none; justify-content: center; gap: 15px; padding-bottom: 20px;">
                        <button type="button" class="btn btn-secondary" id="fmr-cancel-btn" style="min-width: 110px;">Annuler</button>
                        <button type="button" class="btn btn-finish" id="fmr-ok-btn" style="background-color: var(--danger); margin-top:0; min-width: 110px;">Confirmer</button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
        const modalEl = document.getElementById('fmr-confirm-modal');
        const okBtn = document.getElementById('fmr-ok-btn');
        const cancelBtn = document.getElementById('fmr-cancel-btn');

        const cleanup = (result) => {
            modalEl.remove();
            resolve(result);
        };

        okBtn.onclick = () => cleanup(true);
        cancelBtn.onclick = () => cleanup(false);
        modalEl.onclick = (e) => { if (e.target === modalEl) cleanup(false); };
    });
}

function showNotification(msg, type) {
    const div = document.createElement('div'); div.className = `notification ${type}`;
    div.innerHTML = `<div class="notification-content"><strong>${type==='error'?'Erreur':'Info'}</strong><br>${msg}</div><button class="close-notif">×</button>`;
    div.querySelector('.close-notif').onclick = () => div.remove();
    const notifContainer = document.getElementById('notification-container');
    if (notifContainer) notifContainer.appendChild(div);
    setTimeout(() => div.remove(), 4000);
}

function handleApiError(e, ctx) {
    if (e.status === 401 || e.status === 403) googleApiManager.handleLogin();
    showNotification(`Erreur (${ctx})`, "error");
}

function closeModal(modal) { if (modal) modal.style.display = 'none'; }

document.addEventListener('DOMContentLoaded', initializeApp);