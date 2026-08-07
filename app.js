(() => {
  "use strict";

  const CONFIG = window.SP_CONFIG || {};
  const app = document.getElementById("app");
  const modalRoot = document.getElementById("modal-root");
  const toastRoot = document.getElementById("toast-root");

  const RANKS = [
    "Commandeur suprême",
    "Maître de guerre",
    "Chef mercenaire",
    "Commandant",
    "Capitaine",
    "Chef d'escouade",
    "Spécialiste",
    "Élite",
    "Vétéran",
    "Soldat",
    "Mercenaire débutant",
    "Recrue"
  ];

  const RANK_LEVELS = {
    "Commandeur suprême": 120,
    "Maître de guerre": 110,
    "Chef mercenaire": 100,
    "Commandant": 90,
    "Capitaine": 80,
    "Chef d'escouade": 70,
    "Spécialiste": 60,
    "Élite": 50,
    "Vétéran": 40,
    "Soldat": 30,
    "Mercenaire débutant": 20,
    "Recrue": 10
  };

  const state = {
    client: null,
    session: null,
    user: null,
    profile: null,
    page: "dashboard",
    selectedVaultId: null,
    sidebarOpen: false,
    vaults: [],
    items: [],
    inventory: [],
    movements: [],
    profiles: [],
    adminAccess: false,
    siteSettings: { approval_required: true, site_enabled: true, maintenance_message: null },
    adminPrivate: [],
    loginEvents: [],
    adminAudit: [],
    adminFilter: "",
    historyFilters: { search: "", type: "", vault: "", member: "" }
  };

  const ICONS = {
    dashboard: "⌂",
    vaults: "▣",
    personal: "♙",
    history: "☷",
    members: "♟",
    settings: "⚙",
    admin: "✦",
    shared: "◈",
    lock: "◆"
  };

  function esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function level(rank = state.profile?.rank) {
    return RANK_LEVELS[rank] || 0;
  }

  function isTechnicalAdmin() {
    return state.adminAccess === true;
  }

  function isTopThree() {
    return isTechnicalAdmin() || level() >= 100;
  }

  function isCommanderSupreme() {
    return isTechnicalAdmin() || level() === 120;
  }

  function accessStatus(profile = state.profile) {
    return profile?.access_status || "approved";
  }

  function isApproved(profile = state.profile) {
    return accessStatus(profile) === "approved" && profile?.is_active !== false;
  }

  function accessBadge(profile) {
    const status = accessStatus(profile);
    if (status === "approved") return '<span class="badge badge-green">Autorisé</span>';
    if (status === "blocked") return '<span class="badge badge-red">Bloqué</span>';
    return '<span class="badge badge-yellow">En attente</span>';
  }

  function canMove(vault) {
    if (!vault) return false;
    if (isTechnicalAdmin()) return true;
    return vault.kind === "personal" ? level() >= 100 : level() >= 20;
  }

  function canManage() {
    return isTechnicalAdmin() || level() >= 100;
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("fr-FR").format(Number(value || 0));
  }

  function formatDate(value, withTime = true) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "short",
      ...(withTime ? { timeStyle: "short" } : {})
    }).format(date);
  }

  function relativeDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    const delta = Date.now() - date.getTime();
    const minutes = Math.max(0, Math.floor(delta / 60000));
    if (minutes < 1) return "à l'instant";
    if (minutes < 60) return `il y a ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `il y a ${hours} h`;
    const days = Math.floor(hours / 24);
    if (days < 8) return `il y a ${days} j`;
    return formatDate(value, false);
  }

  function displayName(profile) {
    return profile?.display_name || profile?.username || "Membre";
  }

  function initials(name) {
    return String(name || "SP")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "SP";
  }

  function avatar(profile, className = "avatar") {
    const name = displayName(profile);
    if (profile?.avatar_url) {
      return `<img class="${className}" src="${esc(profile.avatar_url)}" alt="Avatar de ${esc(name)}" referrerpolicy="no-referrer" />`;
    }
    return `<div class="${className} avatar-fallback">${esc(initials(name))}</div>`;
  }

  function itemImage(item, className = "item-thumb") {
    if (item?.image_url) {
      return `<img class="${className}" src="${esc(item.image_url)}" alt="Image de ${esc(item.name)}" loading="lazy" referrerpolicy="no-referrer" />`;
    }
    return `<div class="${className} item-thumb-placeholder">◈</div>`;
  }

  function byId(rows, id) {
    return rows.find((row) => row.id === id);
  }

  function isConfigured() {
    return Boolean(
      CONFIG.supabaseUrl &&
      /^https:\/\//.test(CONFIG.supabaseUrl) &&
      CONFIG.supabaseAnonKey &&
      !CONFIG.supabaseAnonKey.includes("COLLE_TA_CLE")
    );
  }

  function toast(title, message = "", type = "info", duration = 4400) {
    const element = document.createElement("div");
    element.className = `toast ${type}`;
    element.innerHTML = `
      <div>
        <strong>${esc(title)}</strong>
        ${message ? `<p>${esc(message)}</p>` : ""}
      </div>
      <button class="icon-btn" type="button" aria-label="Fermer">×</button>
    `;
    element.querySelector("button").addEventListener("click", () => element.remove());
    toastRoot.appendChild(element);
    window.setTimeout(() => element.remove(), duration);
  }

  function showLoading(label = "Synchronisation…") {
    if (document.getElementById("global-loading")) return;
    const overlay = document.createElement("div");
    overlay.id = "global-loading";
    overlay.className = "loading-overlay";
    overlay.innerHTML = `<div class="loading-box"><div class="boot-ring"></div><span>${esc(label)}</span></div>`;
    document.body.appendChild(overlay);
  }

  function hideLoading() {
    document.getElementById("global-loading")?.remove();
  }

  function closeModal() {
    modalRoot.innerHTML = "";
  }

  function openModal(title, body, large = false) {
    modalRoot.innerHTML = `
      <div class="modal-backdrop" data-close="1">
        <section class="modal ${large ? "modal-lg" : ""}" role="dialog" aria-modal="true">
          <header class="modal-head">
            <h2>${esc(title)}</h2>
            <button class="icon-btn" data-close="1" type="button" aria-label="Fermer">×</button>
          </header>
          <div class="modal-body">${body}</div>
        </section>
      </div>
    `;
    modalRoot.querySelector(".modal-backdrop").addEventListener("click", (event) => {
      if (event.target.dataset.close === "1") closeModal();
    });
    window.setTimeout(() => modalRoot.querySelector("input, select, textarea")?.focus(), 40);
  }

  function renderSetup() {
    app.innerHTML = `
      <main class="setup-shell">
        <section class="setup-card">
          <img class="auth-logo" src="assets/logo.png" alt="Logo Silver Phoenix" />
          <div class="eyebrow">Configuration</div>
          <h1>Ajoute ta clé Supabase</h1>
          <p>Le site est prêt, mais la clé publique n'a pas encore été collée dans <strong>config.js</strong>.</p>
          <ol class="setup-steps">
            <li>Supabase → <strong>Project Settings</strong> → <strong>API Keys</strong>.</li>
            <li>Copie la clé <strong>Publishable</strong> ou <strong>anon</strong>.</li>
            <li>Ouvre <strong>config.js</strong> et remplace le texte prévu.</li>
          </ol>
          <code class="code-box">supabaseAnonKey: "COLLE_TA_CLE_PUBLIQUE_SUPABASE_ICI"</code>
          <p class="auth-note">Ne mets jamais une clé service_role ou secret.</p>
        </section>
      </main>
    `;
  }

  function renderAuth() {
    app.innerHTML = `
      <main class="auth-shell">
        <section class="auth-card">
          <img class="auth-logo" src="assets/logo.png" alt="Logo Silver Phoenix" />
          <h1>Silver Phoenix</h1>
          <p>Centre de commandement et gestion sécurisée des coffres.</p>
          <button id="discord-login" class="btn btn-primary btn-block" type="button">◉ Se connecter avec Discord</button>
          <p class="auth-note">Les comptes commencent en <strong>Recrue</strong>. Les grades sont ensuite attribués par la direction.</p>
        </section>
      </main>
    `;

    document.getElementById("discord-login").addEventListener("click", loginWithDiscord);
  }

  async function loginWithDiscord() {
    try {
      const redirectTo = `${window.location.origin}${window.location.pathname}`;
      const { error } = await state.client.auth.signInWithOAuth({
        provider: "discord",
        options: { redirectTo }
      });
      if (error) throw error;
    } catch (error) {
      toast("Connexion impossible", error.message || String(error), "error");
    }
  }

  async function logout() {
    await state.client.auth.signOut();
    state.session = null;
    state.user = null;
    state.profile = null;
    state.adminAccess = false;
    state.adminPrivate = [];
    state.loginEvents = [];
    state.adminAudit = [];
    renderAuth();
  }

  async function recordLoginEventOnce(userId) {
    if (!userId) return;
    const key = `sp_login_recorded_${userId}`;
    if (sessionStorage.getItem(key) === "1") return;
    try {
      const { error } = await state.client.rpc("record_login_event", {
        p_user_agent: navigator.userAgent || null,
        p_page_url: window.location.href || null
      });
      if (!error) sessionStorage.setItem(key, "1");
      else console.warn("Journal de connexion indisponible :", error);
    } catch (error) {
      console.warn("Journal de connexion indisponible :", error);
    }
  }

  async function loadAdminData() {
    if (!isTechnicalAdmin()) {
      state.adminPrivate = [];
      state.loginEvents = [];
      state.adminAudit = [];
      return;
    }

    const [privateResult, loginResult, auditResult] = await Promise.all([
      state.client.from("admin_user_private").select("*").order("updated_at", { ascending: false }),
      state.client.from("login_events").select("*").order("logged_at", { ascending: false }).limit(1000),
      state.client.from("admin_audit").select("*").order("created_at", { ascending: false }).limit(1000)
    ]);

    for (const result of [privateResult, loginResult, auditResult]) {
      if (result.error) throw result.error;
    }

    state.adminPrivate = privateResult.data || [];
    state.loginEvents = loginResult.data || [];
    state.adminAudit = auditResult.data || [];
  }

  async function loadData(userOverride = null) {
    showLoading("Chargement des coffres…");
    try {
      // L'utilisateur est capturé au début du chargement pour éviter qu'un
      // événement d'authentification simultané remplace state.user par null.
      let currentUser = userOverride && userOverride.id ? userOverride : state.user;

      if (!currentUser?.id) {
        const { data: userData, error: userError } = await state.client.auth.getUser();
        if (userError) throw userError;
        currentUser = userData?.user || null;
      }

      if (!currentUser?.id) {
        state.session = null;
        state.user = null;
        state.profile = null;
        renderAuth();
        return;
      }

      state.user = currentUser;
      const userId = currentUser.id;
      await recordLoginEventOnce(userId);

      const profileResult = await state.client
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();

      if (profileResult.error) throw profileResult.error;
      state.profile = profileResult.data;

      if (!state.profile) {
        throw new Error("Ton profil n'a pas été créé. Déconnecte-toi puis reconnecte-toi.");
      }

      const adminResult = await state.client.rpc("is_site_admin");
      if (adminResult.error) {
        console.warn("Statut admin indisponible :", adminResult.error);
        state.adminAccess = false;
      } else {
        state.adminAccess = adminResult.data === true;
      }

      const settingsResult = await state.client
        .from("site_settings")
        .select("*")
        .eq("id", 1)
        .maybeSingle();
      if (!settingsResult.error && settingsResult.data) state.siteSettings = settingsResult.data;

      if (!isTechnicalAdmin() && (!isApproved(state.profile) || state.siteSettings.site_enabled === false)) {
        renderAccessGate();
        return;
      }

      const topThree = isTopThree();

      const queries = [
        state.client.from("vaults").select("*").eq("is_archived", false).order("created_at"),
        state.client.from("items").select("*").eq("is_archived", false).order("name"),
        state.client.from("inventory").select("*").order("updated_at", { ascending: false }),
        state.client.from("profiles").select("*").order("created_at")
      ];

      const [vaultsResult, itemsResult, inventoryResult, profilesResult] = await Promise.all(queries);
      for (const result of [vaultsResult, itemsResult, inventoryResult, profilesResult]) {
        if (result.error) throw result.error;
      }

      state.vaults = vaultsResult.data || [];
      state.items = itemsResult.data || [];
      state.inventory = inventoryResult.data || [];
      state.profiles = profilesResult.data || [];

      if (topThree) {
        const movementsResult = await state.client
          .from("movements")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(1000);
        if (movementsResult.error) throw movementsResult.error;
        state.movements = movementsResult.data || [];
      } else {
        state.movements = [];
        if (["history", "personal"].includes(state.page)) state.page = "dashboard";
      }

      await loadAdminData();

      if (state.selectedVaultId && !byId(state.vaults, state.selectedVaultId)) {
        state.selectedVaultId = null;
      }

      renderApp();
    } catch (error) {
      console.error(error);
      toast("Erreur de chargement", error.message || String(error), "error", 7000);
      renderError(error);
    } finally {
      hideLoading();
    }
  }

  function renderAccessGate() {
    const status = accessStatus(state.profile);
    const maintenance = state.siteSettings.site_enabled === false;
    const blocked = status === "blocked" || state.profile?.is_active === false;
    const title = maintenance ? "Centre temporairement fermé" : blocked ? "Accès bloqué" : "Accès en attente";
    const text = maintenance
      ? (state.siteSettings.maintenance_message || "Le centre de commandement est temporairement indisponible.")
      : blocked
        ? "Ton compte a été bloqué par l'administrateur. Contacte la direction si tu penses qu'il s'agit d'une erreur."
        : "Ta connexion Discord a bien été enregistrée. Un administrateur doit maintenant autoriser ton compte avant l'accès aux coffres.";

    app.innerHTML = `
      <main class="auth-shell">
        <section class="auth-card access-gate-card">
          <img class="auth-logo" src="assets/logo.png" alt="Logo Silver Phoenix" />
          <div class="eyebrow">CONTRÔLE D'ACCÈS</div>
          <h1>${esc(title)}</h1>
          <p>${esc(text)}</p>
          <div class="access-identity">${avatar(state.profile)}<div><strong>${esc(displayName(state.profile))}</strong><span>${esc(state.profile?.username || "")}</span></div></div>
          ${!maintenance && !blocked ? '<span class="badge badge-yellow">VALIDATION ADMIN REQUISE</span>' : ''}
          <button id="gate-logout" class="btn btn-secondary btn-block" type="button" style="margin-top:14px">Déconnexion</button>
          <button id="gate-admin" class="btn btn-primary btn-block" type="button" style="margin-top:8px">Accès administrateur technique</button>
        </section>
      </main>
    `;
    document.getElementById("gate-logout")?.addEventListener("click", logout);
    document.getElementById("gate-admin")?.addEventListener("click", openAdminClaimModal);
  }

  function renderError(error) {
    app.innerHTML = `
      <main class="setup-shell">
        <section class="setup-card">
          <img class="auth-logo" src="assets/logo.png" alt="Logo Silver Phoenix" />
          <div class="eyebrow">Erreur</div>
          <h1>Le centre de commandement ne peut pas charger</h1>
          <p>${esc(error.message || String(error))}</p>
          <button id="retry" class="btn btn-primary btn-block" type="button">Réessayer</button>
          <button id="logout-error" class="btn btn-secondary btn-block" type="button" style="margin-top:8px">Déconnexion</button>
        </section>
      </main>
    `;
    document.getElementById("retry").addEventListener("click", () => loadData());
    document.getElementById("logout-error").addEventListener("click", logout);
  }

  function pageMeta() {
    if (state.selectedVaultId) {
      const vault = byId(state.vaults, state.selectedVaultId);
      return { title: vault?.name || "Coffre", subtitle: vault?.description || "Inventaire détaillé" };
    }
    const map = {
      dashboard: ["Tableau de bord", "Vue générale du centre de commandement"],
      vaults: ["Coffres communs", "Stocks accessibles à l'organisation"],
      personal: ["Coffres personnels", "Section réservée aux trois plus hauts grades"],
      history: ["Historique", "Journal sécurisé des opérations"],
      members: ["Membres", "Grades et accès Silver Phoenix"],
      admin: ["Administration", "Contrôle complet du site et des accès"],
      settings: ["Paramètres", "Informations et sécurité du site"]
    };
    return { title: map[state.page]?.[0] || "Silver Phoenix", subtitle: map[state.page]?.[1] || "" };
  }

  function navButton(page, icon, label, topOnly = false) {
    if (topOnly && !isTopThree()) return "";
    return `
      <button class="nav-btn ${state.page === page && !state.selectedVaultId ? "active" : ""}" data-page="${page}" type="button">
        <span>${icon}</span><span>${esc(label)}</span>${topOnly ? '<span class="rank-lock">TOP 3</span>' : ""}
      </button>
    `;
  }

  function renderApp() {
    const meta = pageMeta();
    app.innerHTML = `
      <div class="app-shell">
        <aside class="sidebar ${state.sidebarOpen ? "open" : ""}" id="sidebar">
          <div class="brand">
            <img src="assets/logo.png" alt="Logo Silver Phoenix" />
            <div><strong>SILVER PHOENIX</strong><span>COMMAND CENTER</span></div>
          </div>
          <nav class="nav">
            ${navButton("dashboard", ICONS.dashboard, "Tableau de bord")}
            ${navButton("vaults", ICONS.vaults, "Coffres communs")}
            ${navButton("personal", ICONS.personal, "Coffres personnels", true)}
            <div class="nav-divider"></div>
            ${navButton("history", ICONS.history, "Historique", true)}
            ${navButton("members", ICONS.members, "Membres")}
            ${isTechnicalAdmin() ? navButton("admin", ICONS.admin, "Administration") : ""}
            ${navButton("settings", ICONS.settings, "Paramètres")}
          </nav>
          <div class="sidebar-user">
            <div class="user-line">
              ${avatar(state.profile)}
              <div><strong>${esc(displayName(state.profile))}</strong><span>${esc(state.profile.rank)}${isTechnicalAdmin() ? " · ADMIN TECHNIQUE" : ""}</span></div>
            </div>
            <button id="logout" class="btn btn-secondary btn-block btn-sm" type="button">Déconnexion</button>
          </div>
        </aside>
        ${state.sidebarOpen ? '<div class="sidebar-scrim" id="sidebar-scrim"></div>' : ""}
        <main class="main-area">
          <header class="topbar">
            <div class="topbar-left">
              <button id="mobile-menu" class="icon-btn mobile-menu" type="button">☰</button>
              <div><h1>${esc(meta.title)}</h1><p>${esc(meta.subtitle)}</p></div>
            </div>
            <div class="topbar-actions">
              ${isTechnicalAdmin() ? '<span class="rank-chip">ADMIN TECHNIQUE</span>' : ""}
              <span class="rank-chip">${esc(state.profile.rank)}</span>
              <button id="refresh" class="btn btn-secondary btn-sm" type="button">↻ <span>Actualiser</span></button>
            </div>
          </header>
          <section class="content" id="page-content">${renderCurrentPage()}</section>
        </main>
      </div>
    `;

    bindShellEvents();
    bindPageEvents();
  }

  function bindShellEvents() {
    document.querySelectorAll("[data-page]").forEach((button) => {
      button.addEventListener("click", () => {
        state.page = button.dataset.page;
        state.selectedVaultId = null;
        state.sidebarOpen = false;
        renderApp();
      });
    });
    document.getElementById("logout")?.addEventListener("click", logout);
    document.getElementById("refresh")?.addEventListener("click", loadData);
    document.getElementById("mobile-menu")?.addEventListener("click", () => {
      state.sidebarOpen = !state.sidebarOpen;
      renderApp();
    });
    document.getElementById("sidebar-scrim")?.addEventListener("click", () => {
      state.sidebarOpen = false;
      renderApp();
    });
  }

  function renderCurrentPage() {
    if (state.selectedVaultId) return renderVaultDetail();
    switch (state.page) {
      case "vaults": return renderVaults("shared");
      case "personal": return isTopThree() ? renderVaults("personal") : renderForbidden();
      case "history": return isTopThree() ? renderHistory() : renderForbidden();
      case "members": return renderMembers();
      case "admin": return isTechnicalAdmin() ? renderAdmin() : renderForbidden();
      case "settings": return renderSettings();
      default: return renderDashboard();
    }
  }

  function renderForbidden() {
    return `
      <div class="card">
        <div class="empty-state">
          <div class="empty-icon">⌁</div>
          <strong>Accès réservé</strong>
          Cette section est visible uniquement par les trois plus hauts grades et par l’administrateur technique.
        </div>
      </div>
    `;
  }

  function inventoryForVault(vaultId) {
    return state.inventory.filter((row) => row.vault_id === vaultId);
  }

  function vaultStats(vault) {
    const rows = inventoryForVault(vault.id);
    return {
      references: rows.length,
      quantity: rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0)
    };
  }

  function renderDashboard() {
    const sharedVaults = state.vaults.filter((vault) => vault.kind === "shared");
    const personalVaults = state.vaults.filter((vault) => vault.kind === "personal");
    const totalQuantity = state.inventory.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    const activeMembers = state.profiles.filter((profile) => profile.is_active).length;

    return `
      <div class="page-head">
        <div><h2>Bienvenue, ${esc(displayName(state.profile))}</h2><p>État opérationnel des ressources Silver Phoenix.</p></div>
      </div>

      <div class="grid stats-grid">
        ${statCard("▣", sharedVaults.length, "Coffres communs")}
        ${statCard("◈", totalQuantity, "Unités en stock")}
        ${statCard("♟", activeMembers, "Membres actifs")}
        ${statCard("◆", isTopThree() ? personalVaults.length : "—", "Coffres personnels")}
      </div>

      <div class="grid two-col">
        <section class="card">
          <div class="card-head"><div><h3>Coffres communs</h3><p>Accès rapide aux stocks</p></div><button class="btn btn-secondary btn-sm" data-page-jump="vaults" type="button">Voir tout</button></div>
          <div class="card-body">
            <div class="grid vault-grid">
              ${sharedVaults.slice(0, 3).map(renderVaultCard).join("") || emptyInline("Aucun coffre commun")}
            </div>
          </div>
        </section>
        <section class="card">
          <div class="card-head"><div><h3>Activité récente</h3><p>Journal des dépôts et retraits</p></div></div>
          ${isTopThree()
            ? renderActivityList(state.movements.slice(0, 7))
            : `<div class="card-body"><div class="notice"><strong>Journal protégé.</strong><br>L'historique est visible uniquement par les trois plus hauts grades.</div></div>`}
        </section>
      </div>
    `;
  }

  function statCard(icon, value, label) {
    return `
      <article class="card stat-card">
        <div class="stat-icon">${icon}</div>
        <div><strong>${typeof value === "number" ? formatNumber(value) : esc(value)}</strong><span>${esc(label)}</span></div>
      </article>
    `;
  }

  function emptyInline(label) {
    return `<div class="notice">${esc(label)}</div>`;
  }

  function renderVaults(kind) {
    const vaults = state.vaults.filter((vault) => vault.kind === kind);
    const isPersonal = kind === "personal";
    const ownPersonal = vaults.find((vault) => vault.owner_id === state.user.id);

    return `
      <div class="page-head">
        <div>
          <h2>${isPersonal ? "Coffres personnels" : "Coffres communs"}</h2>
          <p>${isPersonal ? "Réservés aux trois plus hauts grades. Tous les hauts gradés peuvent consulter cette section." : "Stocks partagés de l'organisation."}</p>
        </div>
        <div class="page-actions">
          ${isPersonal && !ownPersonal ? '<button id="create-personal-vault" class="btn btn-primary" type="button">+ Créer mon coffre personnel</button>' : ""}
          ${!isPersonal && canManage() ? '<button id="create-shared-vault" class="btn btn-primary" type="button">+ Nouveau coffre commun</button>' : ""}
        </div>
      </div>

      ${isPersonal ? '<div class="notice" style="margin-bottom:16px"><strong>Confidentiel :</strong> cette page et son contenu sont invisibles pour les grades inférieurs à Chef mercenaire.</div>' : ""}

      <div class="grid vault-grid">
        ${vaults.map(renderVaultCard).join("") || `
          <div class="card" style="grid-column:1/-1">
            <div class="empty-state"><div class="empty-icon">◆</div><strong>Aucun coffre</strong>${isPersonal ? "Crée ton coffre personnel." : "Crée le premier coffre commun."}</div>
          </div>`}
      </div>
    `;
  }

  function renderVaultCard(vault) {
    const stats = vaultStats(vault);
    const owner = vault.owner_id ? byId(state.profiles, vault.owner_id) : null;
    return `
      <article class="card vault-card">
        <div class="vault-main">
          <div class="vault-icon">${vault.kind === "personal" ? "◆" : "◈"}</div>
          <div>
            <h3>${esc(vault.name)}</h3>
            <p>${esc(vault.description || "Aucune description")}</p>
            ${owner ? `<p class="vault-owner">Propriétaire : ${esc(displayName(owner))}</p>` : ""}
          </div>
        </div>
        <div class="vault-metrics">
          <div class="vault-metric"><strong>${formatNumber(stats.references)}</strong><span>références</span></div>
          <div class="vault-metric"><strong>${formatNumber(stats.quantity)}</strong><span>unités</span></div>
        </div>
        <div class="vault-actions">
          <button class="btn btn-secondary btn-sm" data-open-vault="${vault.id}" type="button">Ouvrir</button>
          ${canManage() ? `<button class="btn btn-secondary btn-sm" data-edit-vault="${vault.id}" type="button">Modifier</button>` : ""}
        </div>
      </article>
    `;
  }

  function renderVaultDetail() {
    const vault = byId(state.vaults, state.selectedVaultId);
    if (!vault) return renderForbidden();
    const inventory = inventoryForVault(vault.id);
    const rows = inventory
      .map((stock) => ({ stock, item: byId(state.items, stock.item_id) }))
      .filter((row) => row.item)
      .sort((a, b) => a.item.name.localeCompare(b.item.name, "fr"));
    const movements = isTopThree() ? state.movements.filter((movement) => movement.vault_id === vault.id).slice(0, 8) : [];

    return `
      <div class="page-head">
        <div>
          <button id="back-to-vaults" class="btn btn-secondary btn-sm" type="button">← Tous les coffres</button>
          <h2 style="margin-top:14px">${vault.kind === "personal" ? "◆" : "◈"} ${esc(vault.name)}</h2>
          <p>${esc(vault.description || "Inventaire détaillé")}</p>
        </div>
        <div class="page-actions">
          ${canManage() ? `<button id="add-item" class="btn btn-primary" type="button">+ Ajouter un objet</button>` : ""}
        </div>
      </div>

      <section class="card">
        <div class="card-head">
          <div><h3>Inventaire</h3><p>${rows.length} référence(s) dans ce coffre</p></div>
          <span class="badge badge-purple">${formatNumber(rows.reduce((sum, row) => sum + Number(row.stock.quantity || 0), 0))} unités</span>
        </div>
        ${rows.length ? `
          <div class="table-wrap">
            <table>
              <thead><tr><th>Objet</th><th>Catégorie</th><th>Quantité</th><th>Mise à jour</th><th>Actions</th></tr></thead>
              <tbody>
                ${rows.map(({ stock, item }) => renderInventoryRow(vault, stock, item)).join("")}
              </tbody>
            </table>
          </div>` : `
          <div class="empty-state"><div class="empty-icon">◈</div><strong>Coffre vide</strong>${canManage() ? "Ajoute le premier objet." : "Aucun objet n'a encore été ajouté."}</div>`}
      </section>

      <section class="card" style="margin-top:16px">
        <div class="card-head"><div><h3>Activité du coffre</h3><p>Derniers mouvements</p></div></div>
        ${isTopThree()
          ? renderActivityList(movements)
          : `<div class="card-body"><div class="notice"><strong>Historique masqué.</strong><br>Seuls les trois plus hauts grades peuvent consulter l'activité.</div></div>`}
      </section>
    `;
  }

  function renderInventoryRow(vault, stock, item) {
    return `
      <tr>
        <td>
          <div class="item-cell">
            ${itemImage(item)}
            <div><strong>${esc(item.name)}</strong><span>${esc(item.description || item.unit)}</span></div>
          </div>
        </td>
        <td><span class="badge">${esc(item.category)}</span></td>
        <td><span class="qty">${formatNumber(stock.quantity)}</span> <span class="muted small">${esc(item.unit)}</span></td>
        <td>${relativeDate(stock.updated_at)}</td>
        <td>
          <div class="actions">
            ${canMove(vault) ? `<button class="btn btn-success btn-sm" data-move="deposit" data-vault="${vault.id}" data-item="${item.id}" type="button">+ Déposer</button>` : ""}
            ${canMove(vault) ? `<button class="btn btn-danger btn-sm" data-move="withdrawal" data-vault="${vault.id}" data-item="${item.id}" type="button">− Retirer</button>` : ""}
            ${isTopThree() ? `<button class="btn btn-warning btn-sm" data-move="adjustment" data-vault="${vault.id}" data-item="${item.id}" type="button">≈ Ajuster</button>` : ""}
            ${isTopThree() ? `<button class="btn btn-secondary btn-sm" data-edit-item="${item.id}" type="button">Image / fiche</button>` : ""}
            ${isCommanderSupreme() ? `<button class="btn btn-danger btn-sm" data-delete-item="${item.id}" type="button">Supprimer</button>` : ""}
          </div>
        </td>
      </tr>
    `;
  }

  function renderActivityList(movements) {
    if (!movements.length) {
      return `<div class="empty-state"><div class="empty-icon">☷</div><strong>Aucune activité</strong>Aucun mouvement enregistré.</div>`;
    }
    return `<div class="activity-list">${movements.map((movement) => {
      const item = byId(state.items, movement.item_id);
      const vault = byId(state.vaults, movement.vault_id);
      const profile = byId(state.profiles, movement.user_id);
      const symbol = movement.type === "deposit" ? "+" : movement.type === "withdrawal" ? "−" : "≈";
      const label = movement.type === "deposit" ? "Dépôt" : movement.type === "withdrawal" ? "Retrait" : "Ajustement";
      return `
        <div class="activity-row">
          <div class="activity-icon ${movement.type}">${symbol}</div>
          <div>
            <strong>${esc(displayName(profile))} · ${label} ${formatNumber(movement.quantity)} ${esc(item?.name || "Objet supprimé")}</strong>
            <p>${esc(vault?.name || "Coffre supprimé")}${movement.reason ? ` — ${esc(movement.reason)}` : ""}</p>
          </div>
          <div class="activity-date">${relativeDate(movement.created_at)}<br>${formatDate(movement.created_at)}</div>
        </div>
      `;
    }).join("")}</div>`;
  }

  function filteredMovements() {
    const filters = state.historyFilters;
    return state.movements.filter((movement) => {
      const item = byId(state.items, movement.item_id);
      const vault = byId(state.vaults, movement.vault_id);
      const profile = byId(state.profiles, movement.user_id);
      const haystack = `${item?.name || ""} ${vault?.name || ""} ${displayName(profile)} ${movement.reason || ""}`.toLowerCase();
      return (!filters.search || haystack.includes(filters.search.toLowerCase()))
        && (!filters.type || movement.type === filters.type)
        && (!filters.vault || movement.vault_id === filters.vault)
        && (!filters.member || movement.user_id === filters.member);
    });
  }

  function renderHistory() {
    const movements = filteredMovements();
    return `
      <div class="page-head">
        <div><h2>Historique sécurisé</h2><p>Visible uniquement par les trois plus hauts grades.</p></div>
        <div class="page-actions"><button id="export-history" class="btn btn-secondary" type="button">Exporter CSV</button></div>
      </div>
      <div class="notice" style="margin-bottom:16px"><strong>Accès confidentiel :</strong> Commandeur suprême, Maître de guerre et Chef mercenaire uniquement.</div>
      <div class="filters">
        <input id="history-search" value="${esc(state.historyFilters.search)}" placeholder="Rechercher objet, membre, motif…" />
        <select id="history-type">
          <option value="">Tous les mouvements</option>
          <option value="deposit" ${state.historyFilters.type === "deposit" ? "selected" : ""}>Dépôts</option>
          <option value="withdrawal" ${state.historyFilters.type === "withdrawal" ? "selected" : ""}>Retraits</option>
          <option value="adjustment" ${state.historyFilters.type === "adjustment" ? "selected" : ""}>Ajustements</option>
        </select>
        <select id="history-vault">
          <option value="">Tous les coffres</option>
          ${state.vaults.map((vault) => `<option value="${vault.id}" ${state.historyFilters.vault === vault.id ? "selected" : ""}>${esc(vault.name)}</option>`).join("")}
        </select>
        <select id="history-member">
          <option value="">Tous les membres</option>
          ${state.profiles.map((profile) => `<option value="${profile.id}" ${state.historyFilters.member === profile.id ? "selected" : ""}>${esc(displayName(profile))}</option>`).join("")}
        </select>
      </div>
      <section class="card">
        ${movements.length ? `
          <div class="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Membre</th><th>Action</th><th>Objet</th><th>Coffre</th><th>Avant → Après</th><th>Motif</th></tr></thead>
              <tbody>${movements.map(renderHistoryRow).join("")}</tbody>
            </table>
          </div>` : `<div class="empty-state"><div class="empty-icon">☷</div><strong>Aucun résultat</strong>Aucun mouvement ne correspond aux filtres.</div>`}
      </section>
    `;
  }

  function renderHistoryRow(movement) {
    const item = byId(state.items, movement.item_id);
    const vault = byId(state.vaults, movement.vault_id);
    const profile = byId(state.profiles, movement.user_id);
    const label = movement.type === "deposit" ? "Dépôt" : movement.type === "withdrawal" ? "Retrait" : "Ajustement";
    const badgeClass = movement.type === "deposit" ? "badge-green" : movement.type === "withdrawal" ? "badge-red" : "badge-purple";
    return `
      <tr>
        <td>${formatDate(movement.created_at)}</td>
        <td>${esc(displayName(profile))}</td>
        <td><span class="badge ${badgeClass}">${label}</span></td>
        <td>${esc(item?.name || "Objet supprimé")} × ${formatNumber(movement.quantity)}</td>
        <td>${esc(vault?.name || "Coffre supprimé")}</td>
        <td>${formatNumber(movement.quantity_before)} → ${formatNumber(movement.quantity_after)}</td>
        <td>${esc(movement.reason || "—")}</td>
      </tr>
    `;
  }

  function renderMembers() {
    return `
      <div class="page-head">
        <div><h2>Membres Silver Phoenix</h2><p>Les trois plus hauts grades peuvent modifier les accès.</p></div>
      </div>
      ${!isTopThree() ? '<div class="notice" style="margin-bottom:16px">Tu peux consulter la liste, mais seuls les trois plus hauts grades peuvent modifier un membre.</div>' : ""}
      <section class="card">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Membre</th><th>Grade</th><th>Statut</th><th>Dernière activité</th><th>Action</th></tr></thead>
            <tbody>${state.profiles.map(renderMemberRow).join("")}</tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderMemberRow(profile) {
    const editable = canManage() && (isTechnicalAdmin() || (profile.id !== state.user.id && level(profile.rank) <= level()));
    return `
      <tr>
        <td><div class="item-cell">${avatar(profile, "item-thumb")}<div><strong>${esc(displayName(profile))}</strong><span>${esc(profile.username || "")}</span></div></div></td>
        <td><span class="badge badge-purple">${esc(profile.rank)}</span></td>
        <td><span class="badge ${profile.is_active ? "badge-green" : "badge-red"}">${profile.is_active ? "Actif" : "Suspendu"}</span></td>
        <td>${relativeDate(profile.last_seen_at || profile.updated_at)}</td>
        <td>${editable ? `<button class="btn btn-secondary btn-sm" data-edit-member="${profile.id}" type="button">Modifier</button>` : "—"}</td>
      </tr>
    `;
  }

  function renderSettings() {
    return `
      <div class="page-head"><div><h2>Paramètres</h2><p>Règles d'accès et informations du compte.</p></div></div>
      <div class="grid two-col">
        <section class="card">
          <div class="card-head"><div><h3>Ton compte</h3><p>Informations venant de Discord</p></div></div>
          <div class="card-body">
            <div class="user-line">${avatar(state.profile)}<div><strong>${esc(displayName(state.profile))}</strong><span>${esc(state.profile.rank)}</span></div></div>
            <div class="notice" style="margin-top:14px">
              <strong>Permissions actuelles</strong><br>
              ${level() >= 20 ? "Dépôts et retraits autorisés dans les coffres communs." : "Consultation uniquement dans les coffres communs."}<br>
              ${isTechnicalAdmin() ? "Accès administrateur total : mêmes droits fonctionnels que le Commandeur suprême, sans modifier ton grade RP." : (isTopThree() ? "Historique, coffres personnels et administration accessibles." : "Historique et coffres personnels masqués.")}
            </div>
          </div>
        </section>
        <section class="card">
          <div class="card-head"><div><h3>Règles de sécurité</h3><p>Refonte complète</p></div></div>
          <div class="card-body">
            <div class="notice">
              <strong>Trois plus hauts grades</strong><br>
              Commandeur suprême, Maître de guerre et Chef mercenaire voient l'historique et les coffres personnels.
            </div>
            <div class="notice notice-warning" style="margin-top:10px">
              <strong>Suppression définitive</strong><br>
              Seul le Commandeur suprême peut supprimer complètement un objet.
            </div>
          </div>
        </section>
        <section class="card" style="grid-column:1/-1">
          <div class="card-head">
            <div><h3>Administration technique</h3><p>Accès, membres, connexions, contenu et sécurité</p></div>
            <span class="badge badge-red">Mot de passe requis</span>
          </div>
          <div class="card-body">
            <div class="notice notice-danger">
              <strong>Administration indépendante du grade RP</strong><br>
              Le premier compte qui saisit le bon mot de passe devient le propriétaire technique du panel. Ensuite, seul ce compte peut utiliser le mot de passe pour nommer le Commandeur suprême.
            </div>
            <div class="notice ${isTechnicalAdmin() ? "notice-success" : "notice-warning"}" style="margin-top:10px">
              <strong>Droits administrateur :</strong><br>
              ${isTechnicalAdmin() ? "ACTIFS — tu as tous les droits du Commandeur suprême sur le site, mais ton grade RP reste " + esc(state.profile.rank) + "." : "INACTIFS — active-les avec le mot de passe administrateur."}
            </div>
            <div class="form-actions" style="justify-content:flex-start;margin-top:10px">
              ${isTechnicalAdmin() ? '<span class="badge badge-green">ADMIN TECHNIQUE ACTIF</span>' : '<button id="claim-admin-access" class="btn btn-secondary" type="button">Activer mes droits administrateur</button>'}
            </div>
            <div class="notice" style="margin-top:10px">
              <strong>Commandeur suprême actuel :</strong><br>
              ${esc(displayName(state.profiles.find((profile) => profile.rank === "Commandeur suprême")) || "Aucun membre nommé")}
            </div>
            <div class="form-actions" style="justify-content:flex-start">
              <button id="open-admin-panel" class="btn btn-primary" type="button">Ouvrir l'administration complète</button>
            </div>
          </div>
        </section>
      </div>
    `;
  }

  function adminPrivateFor(userId) {
    return state.adminPrivate.find((row) => row.user_id === userId) || null;
  }

  function latestLoginFor(userId) {
    return state.loginEvents.find((row) => row.user_id === userId) || null;
  }

  function adminAuditLabel(row) {
    const labels = {
      commander_transfer: "Transfert du Commandeur suprême",
      access_status: "Modification d'accès",
      rank_change: "Modification de grade",
      note_update: "Note administrateur",
      site_settings: "Paramètres du site",
      admin_password_changed: "Mot de passe admin modifié",
      admin_owner_transfer: "Transfert de l'administration",
      connection_logs_cleanup: "Nettoyage des connexions"
    };
    return labels[row.action] || row.action || "Action admin";
  }

  function adminFilteredProfiles() {
    const q = state.adminFilter.trim().toLowerCase();
    if (!q) return state.profiles;
    return state.profiles.filter((profile) => {
      const priv = adminPrivateFor(profile.id);
      return [displayName(profile), profile.username, profile.discord_id, profile.rank, profile.access_status, priv?.email]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });
  }

  function renderAdmin() {
    const profiles = adminFilteredProfiles();
    const pending = state.profiles.filter((p) => accessStatus(p) === "pending");
    const blocked = state.profiles.filter((p) => accessStatus(p) === "blocked" || p.is_active === false);
    const approved = state.profiles.filter((p) => accessStatus(p) === "approved" && p.is_active !== false);
    const currentCommander = state.profiles.find((p) => p.rank === "Commandeur suprême");
    const personalCount = state.vaults.filter((v) => v.kind === "personal").length;

    return `
      <div class="page-head admin-page-head">
        <div><h2>Panel administrateur</h2><p>Gestion technique complète, indépendante de ton grade RP.</p></div>
        <div class="page-actions">
          <span class="badge badge-green">ADMIN TECHNIQUE</span>
          <button id="admin-refresh" class="btn btn-secondary" type="button">↻ Actualiser</button>
        </div>
      </div>

      <div class="stats-grid admin-stats">
        <article class="stat-card"><span>Demandes en attente</span><strong>${formatNumber(pending.length)}</strong><small>À valider manuellement</small></article>
        <article class="stat-card"><span>Membres autorisés</span><strong>${formatNumber(approved.length)}</strong><small>Accès actif</small></article>
        <article class="stat-card"><span>Comptes bloqués</span><strong>${formatNumber(blocked.length)}</strong><small>Accès aux données coupé</small></article>
        <article class="stat-card"><span>Connexions enregistrées</span><strong>${formatNumber(state.loginEvents.length)}</strong><small>Journal récent chargé</small></article>
      </div>

      <section class="card admin-section">
        <div class="card-head"><div><h3>Demandes d'accès</h3><p>Un inconnu n'accède à aucun coffre tant que tu ne l'autorises pas.</p></div><span class="badge badge-yellow">${pending.length} EN ATTENTE</span></div>
        <div class="card-body admin-card-body">
          ${pending.length ? `<div class="admin-request-grid">${pending.map(renderAdminRequestCard).join("")}</div>` : `<div class="empty-state"><div class="empty-icon">✓</div><strong>Aucune demande</strong>Tous les comptes ont été traités.</div>`}
        </div>
      </section>

      <section class="card admin-section">
        <div class="card-head admin-toolbar">
          <div><h3>Utilisateurs & grades</h3><p>Whitelist, blocage, grades, Discord ID et notes internes.</p></div>
          <input id="admin-user-search" class="admin-search" value="${esc(state.adminFilter)}" placeholder="Rechercher pseudo, ID Discord, e-mail…" />
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Utilisateur</th><th>Discord / e-mail</th><th>Grade</th><th>Accès</th><th>Connexions</th><th>Actions</th></tr></thead>
            <tbody>${profiles.map(renderAdminUserRow).join("")}</tbody>
          </table>
        </div>
      </section>

      <div class="grid two-col admin-two-col">
        <section class="card admin-section">
          <div class="card-head"><div><h3>Commandement</h3><p>Gestion de la hiérarchie principale</p></div></div>
          <div class="card-body">
            <div class="notice"><strong>Commandeur suprême actuel</strong><br>${esc(displayName(currentCommander) || "Aucun")}</div>
            <div class="form-actions admin-left-actions"><button id="admin-set-commander" class="btn btn-danger" type="button">Changer le Commandeur suprême</button></div>
          </div>
        </section>
        <section class="card admin-section">
          <div class="card-head"><div><h3>Contenu</h3><p>Coffres, objets et historique</p></div></div>
          <div class="card-body">
            <div class="admin-mini-stats"><span><strong>${state.vaults.filter(v => v.kind === "shared").length}</strong> coffres communs</span><span><strong>${personalCount}</strong> coffres perso</span><span><strong>${state.items.length}</strong> objets</span></div>
            <div class="form-actions admin-left-actions"><button class="btn btn-secondary" data-admin-jump="vaults" type="button">Gérer les coffres</button><button class="btn btn-secondary" data-admin-jump="history" type="button">Voir l'historique</button><button id="admin-export-history" class="btn btn-secondary" type="button">Exporter CSV</button></div>
          </div>
        </section>
      </div>

      <section class="card admin-section">
        <div class="card-head"><div><h3>Gestion rapide des coffres</h3><p>Modifier, archiver/supprimer les coffres depuis le panel.</p></div><button id="admin-create-vault" class="btn btn-primary btn-sm" type="button">+ Nouveau coffre</button></div>
        <div class="table-wrap">
          <table><thead><tr><th>Coffre</th><th>Type</th><th>Propriétaire</th><th>Stocks liés</th><th>Actions</th></tr></thead>
          <tbody>${state.vaults.map(renderAdminVaultRow).join("")}</tbody></table>
        </div>
      </section>

      <section class="card admin-section">
        <div class="card-head"><div><h3>Bibliothèque d'objets</h3><p>Modifier ou supprimer définitivement les références globales.</p></div><span class="badge badge-purple">${state.items.length} OBJET(S)</span></div>
        <div class="table-wrap admin-items-table">
          <table><thead><tr><th>Objet</th><th>Catégorie</th><th>Unité</th><th>Présent dans</th><th>Actions</th></tr></thead>
          <tbody>${state.items.map(renderAdminItemRow).join("") || '<tr><td colspan="5">Aucun objet.</td></tr>'}</tbody></table>
        </div>
      </section>

      <section class="card admin-section">
        <div class="card-head"><div><h3>Journal des connexions</h3><p>Informations fournies par Discord/Supabase et le navigateur. Aucun mot de passe ni message privé.</p></div><button id="admin-clean-logins" class="btn btn-secondary btn-sm" type="button">Nettoyer +90 jours</button></div>
        <div class="table-wrap admin-log-table">
          <table><thead><tr><th>Date</th><th>Compte</th><th>Discord ID</th><th>E-mail</th><th>Navigateur / appareil</th></tr></thead>
          <tbody>${state.loginEvents.slice(0, 150).map(renderLoginEventRow).join("") || '<tr><td colspan="5">Aucune connexion enregistrée.</td></tr>'}</tbody></table>
        </div>
      </section>

      <div class="grid two-col admin-two-col">
        <section class="card admin-section">
          <div class="card-head"><div><h3>Sécurité du site</h3><p>Whitelist et maintenance</p></div></div>
          <div class="card-body">
            <form id="admin-site-settings-form">
              <label class="admin-switch-row"><input name="approval_required" type="checkbox" ${state.siteSettings.approval_required !== false ? "checked" : ""}><span><strong>Validation obligatoire</strong><small>Les nouveaux comptes restent en attente.</small></span></label>
              <label class="admin-switch-row"><input name="site_enabled" type="checkbox" ${state.siteSettings.site_enabled !== false ? "checked" : ""}><span><strong>Site ouvert aux membres</strong><small>Décoche pour couper l'accès à tous sauf l'admin.</small></span></label>
              <div class="field" style="margin-top:12px"><label>Message de maintenance</label><textarea name="maintenance_message" maxlength="300" placeholder="Maintenance en cours…">${esc(state.siteSettings.maintenance_message || "")}</textarea></div>
              <div class="form-actions"><button class="btn btn-primary" type="submit">Enregistrer</button></div>
            </form>
          </div>
        </section>
        <section class="card admin-section">
          <div class="card-head"><div><h3>Administration technique</h3><p>Mot de passe et propriétaire du panel</p></div></div>
          <div class="card-body">
            <div class="notice notice-danger"><strong>Ton grade RP reste ${esc(state.profile.rank)}</strong><br>Ces droits sont techniques et séparés de la hiérarchie RP.</div>
            <div class="form-actions admin-left-actions"><button id="admin-change-password" class="btn btn-secondary" type="button">Changer le mot de passe admin</button><button id="admin-transfer-owner" class="btn btn-danger" type="button">Transférer le panel admin</button></div>
          </div>
        </section>
      </div>

      <section class="card admin-section">
        <div class="card-head"><div><h3>Audit administrateur</h3><p>Traçabilité des modifications sensibles.</p></div></div>
        <div class="table-wrap"><table><thead><tr><th>Date</th><th>Action</th><th>Cible</th><th>Détails</th></tr></thead><tbody>${state.adminAudit.slice(0, 150).map(renderAdminAuditRow).join("") || '<tr><td colspan="4">Aucune action enregistrée.</td></tr>'}</tbody></table></div>
      </section>
    `;
  }

  function renderAdminRequestCard(profile) {
    const priv = adminPrivateFor(profile.id);
    const last = latestLoginFor(profile.id);
    return `
      <article class="admin-request-card">
        <div class="admin-request-user">${avatar(profile)}<div><strong>${esc(displayName(profile))}</strong><span>${esc(profile.username || "")}</span></div></div>
        <dl class="admin-detail-list">
          <div><dt>Discord ID</dt><dd>${esc(profile.discord_id || "Non fourni")}</dd></div>
          <div><dt>E-mail</dt><dd>${esc(priv?.email || "Non fourni")}</dd></div>
          <div><dt>Première connexion</dt><dd>${formatDate(profile.first_login_at || profile.created_at)}</dd></div>
          <div><dt>Navigateur</dt><dd class="truncate-text">${esc(last?.user_agent || "Non enregistré")}</dd></div>
        </dl>
        <div class="admin-request-actions"><button class="btn btn-primary btn-sm" data-admin-approve="${profile.id}" type="button">✓ Autoriser</button><button class="btn btn-danger btn-sm" data-admin-block="${profile.id}" type="button">Bloquer</button><button class="btn btn-secondary btn-sm" data-admin-manage="${profile.id}" type="button">Détails</button></div>
      </article>`;
  }

  function renderAdminUserRow(profile) {
    const priv = adminPrivateFor(profile.id);
    return `
      <tr>
        <td><div class="item-cell">${avatar(profile, "item-thumb")}<div><strong>${esc(displayName(profile))}</strong><span>${esc(profile.username || "")}</span></div></div></td>
        <td><strong class="mono-small">${esc(profile.discord_id || "—")}</strong><br><span class="muted-small">${esc(priv?.email || "E-mail non fourni")}</span></td>
        <td><span class="badge badge-purple">${esc(profile.rank)}</span></td>
        <td>${accessBadge(profile)}</td>
        <td><strong>${formatNumber(profile.login_count || 0)}</strong><br><span class="muted-small">${relativeDate(profile.last_login_at || profile.last_seen_at)}</span></td>
        <td><div class="row-actions"><button class="btn btn-secondary btn-sm" data-admin-manage="${profile.id}" type="button">Gérer</button>${accessStatus(profile) !== "approved" ? `<button class="btn btn-primary btn-sm" data-admin-approve="${profile.id}" type="button">Autoriser</button>` : ""}${profile.id !== state.user.id && accessStatus(profile) !== "blocked" ? `<button class="btn btn-danger btn-sm" data-admin-block="${profile.id}" type="button">Bloquer</button>` : ""}</div></td>
      </tr>`;
  }

  function renderAdminVaultRow(vault) {
    const owner = byId(state.profiles, vault.owner_id);
    const stockCount = state.inventory.filter((row) => row.vault_id === vault.id).length;
    return `<tr><td><strong>${esc(vault.name)}</strong><br><span class="muted-small">${esc(vault.description || "")}</span></td><td><span class="badge ${vault.kind === "personal" ? "badge-purple" : "badge-green"}">${vault.kind === "personal" ? "Personnel" : "Commun"}</span></td><td>${vault.kind === "personal" ? esc(displayName(owner)) : "Organisation"}</td><td>${stockCount} référence(s)</td><td><div class="row-actions"><button class="btn btn-secondary btn-sm" data-edit-vault="${vault.id}" type="button">Modifier</button><button class="btn btn-danger btn-sm" data-admin-delete-vault="${vault.id}" type="button">Supprimer</button></div></td></tr>`;
  }

  function renderAdminItemRow(item) {
    const linked = state.inventory.filter((row) => row.item_id === item.id);
    const vaultNames = linked.slice(0, 3).map((row) => byId(state.vaults, row.vault_id)?.name).filter(Boolean);
    const more = Math.max(0, linked.length - vaultNames.length);
    return `<tr><td><div class="item-cell">${itemImage(item, "item-thumb")}<div><strong>${esc(item.name)}</strong><span>${esc(item.description || "")}</span></div></div></td><td>${esc(item.category)}</td><td>${esc(item.unit)}</td><td><span class="muted-small">${esc(vaultNames.join(", ") || "Aucun coffre")}${more ? ` +${more}` : ""}</span></td><td><div class="row-actions"><button class="btn btn-secondary btn-sm" data-edit-item="${item.id}" type="button">Modifier</button><button class="btn btn-danger btn-sm" data-delete-item="${item.id}" type="button">Supprimer</button></div></td></tr>`;
  }

  function renderLoginEventRow(event) {
    const profile = byId(state.profiles, event.user_id);
    const priv = adminPrivateFor(event.user_id);
    return `<tr><td>${formatDate(event.logged_at)}</td><td>${esc(displayName(profile))}</td><td class="mono-small">${esc(profile?.discord_id || "—")}</td><td>${esc(priv?.email || "—")}</td><td class="ua-cell" title="${esc(event.user_agent || "")}">${esc(event.user_agent || "—")}</td></tr>`;
  }

  function renderAdminAuditRow(row) {
    const target = byId(state.profiles, row.target_user_id || row.new_commander_id || row.previous_commander_id);
    let details = "—";
    if (row.details && typeof row.details === "object") {
      details = Object.entries(row.details).map(([k, v]) => `${k}: ${v}`).join(" · ") || "—";
    }
    return `<tr><td>${formatDate(row.created_at)}</td><td>${esc(adminAuditLabel(row))}</td><td>${esc(displayName(target) || "—")}</td><td class="muted-small">${esc(details)}</td></tr>`;
  }

  function openAdminManageMemberModal(profileId) {
    const profile = byId(state.profiles, profileId);
    if (!profile) return;
    const priv = adminPrivateFor(profile.id);
    const last = latestLoginFor(profile.id);
    const rankOptions = RANKS.filter((rank) => rank !== "Commandeur suprême");
    openModal("Gérer le compte", `
      <div class="admin-profile-head">${avatar(profile, "admin-profile-avatar")}<div><h3>${esc(displayName(profile))}</h3><p>${esc(profile.username || "")}</p>${accessBadge(profile)}</div></div>
      <div class="admin-info-grid">
        <div><span>Discord ID</span><strong>${esc(profile.discord_id || "—")}</strong></div>
        <div><span>E-mail</span><strong>${esc(priv?.email || "Non fourni")}</strong></div>
        <div><span>Première connexion</span><strong>${formatDate(profile.first_login_at || profile.created_at)}</strong></div>
        <div><span>Dernière connexion</span><strong>${formatDate(profile.last_login_at || profile.last_seen_at)}</strong></div>
        <div><span>Nombre de connexions</span><strong>${formatNumber(profile.login_count || 0)}</strong></div>
        <div><span>Navigateur</span><strong class="truncate-text">${esc(last?.user_agent || "Non enregistré")}</strong></div>
      </div>
      <form id="admin-manage-user-form" style="margin-top:16px">
        <div class="form-grid">
          <div class="field"><label>Grade RP</label><select name="rank">${rankOptions.map((rank) => `<option value="${esc(rank)}" ${profile.rank === rank ? "selected" : ""}>${esc(rank)}</option>`).join("")}</select></div>
          <div class="field"><label>Accès au site</label><select name="status"><option value="approved" ${accessStatus(profile) === "approved" ? "selected" : ""}>Autorisé</option><option value="pending" ${accessStatus(profile) === "pending" ? "selected" : ""}>En attente</option><option value="blocked" ${accessStatus(profile) === "blocked" ? "selected" : ""}>Bloqué</option></select></div>
          <div class="field full"><label>Note administrateur (privée)</label><textarea name="note" maxlength="500" placeholder="Ex. Membre validé par…">${esc(profile.admin_note || "")}</textarea></div>
        </div>
        <div class="notice" style="margin-top:12px">Pour attribuer <strong>Commandeur suprême</strong>, utilise le bouton dédié dans la section Commandement.</div>
        <div class="form-actions"><button class="btn btn-secondary" data-close="1" type="button">Annuler</button><button class="btn btn-primary" type="submit">Enregistrer</button></div>
      </form>
    `, true);

    document.getElementById("admin-manage-user-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      await runAction("Mise à jour du compte…", async () => {
        const rank = String(data.get("rank"));
        const status = String(data.get("status"));
        const note = String(data.get("note") || "");
        if (profile.rank !== "Commandeur suprême" && rank !== profile.rank) {
          const rankResult = await state.client.rpc("admin_set_member_rank", { p_user_id: profile.id, p_rank: rank });
          if (rankResult.error) throw rankResult.error;
        }
        const statusResult = await state.client.rpc("admin_set_user_status", { p_user_id: profile.id, p_status: status, p_note: note });
        if (statusResult.error) throw statusResult.error;
        const noteResult = await state.client.rpc("admin_update_member_note", { p_user_id: profile.id, p_note: note });
        if (noteResult.error) throw noteResult.error;
      }, "Compte mis à jour");
    });
  }

  async function adminQuickStatus(userId, status) {
    await runAction(status === "approved" ? "Autorisation du compte…" : "Blocage du compte…", async () => {
      const { error } = await state.client.rpc("admin_set_user_status", { p_user_id: userId, p_status: status, p_note: null });
      if (error) throw error;
    }, status === "approved" ? "Compte autorisé" : "Compte bloqué");
  }

  function openDeleteVaultModal(vaultId) {
    const vault = byId(state.vaults, vaultId);
    if (!vault) return;
    openModal("Supprimer le coffre", `
      <div class="notice notice-danger"><strong>Suppression définitive.</strong><br>Le coffre, ses stocks liés et ses mouvements associés seront supprimés.</div>
      <form id="admin-delete-vault-form" style="margin-top:14px"><div class="field"><label>Écris exactement : ${esc(vault.name)}</label><input name="confirm" autocomplete="off" required></div><div class="form-actions"><button class="btn btn-secondary" data-close="1" type="button">Annuler</button><button class="btn btn-danger" type="submit">Supprimer définitivement</button></div></form>
    `);
    document.getElementById("admin-delete-vault-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      if (String(data.get("confirm")) !== vault.name) return toast("Confirmation incorrecte", "Le nom saisi ne correspond pas.", "warning");
      await runAction("Suppression du coffre…", async () => {
        const { error } = await state.client.from("vaults").delete().eq("id", vault.id);
        if (error) throw error;
      }, "Coffre supprimé");
    });
  }

  function openAdminPasswordModal() {
    openModal("Changer le mot de passe administrateur", `
      <form id="admin-password-form"><div class="form-grid"><div class="field full"><label>Mot de passe actuel</label><input name="old_password" type="password" minlength="10" required></div><div class="field full"><label>Nouveau mot de passe</label><input name="new_password" type="password" minlength="10" required></div><div class="field full"><label>Confirme le nouveau mot de passe</label><input name="confirm_password" type="password" minlength="10" required></div></div><div class="form-actions"><button class="btn btn-secondary" data-close="1" type="button">Annuler</button><button class="btn btn-primary" type="submit">Modifier</button></div></form>
    `);
    document.getElementById("admin-password-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      if (data.get("new_password") !== data.get("confirm_password")) return toast("Mot de passe", "Les deux nouveaux mots de passe ne correspondent pas.", "warning");
      await runAction("Modification du mot de passe…", async () => {
        const { error } = await state.client.rpc("admin_change_password", { p_old_password: data.get("old_password"), p_new_password: data.get("new_password") });
        if (error) throw error;
      }, "Mot de passe administrateur modifié");
    });
  }

  function openAdminTransferModal() {
    const candidates = state.profiles.filter((p) => p.id !== state.user.id);
    openModal("Transférer le panel administrateur", `
      <div class="notice notice-danger"><strong>Attention.</strong><br>Après le transfert et le rechargement, ton compte perdra les droits administrateur technique.</div>
      <form id="admin-transfer-form" style="margin-top:14px"><div class="form-grid"><div class="field full"><label>Nouveau propriétaire technique</label><select name="user_id" required><option value="">Choisir un membre</option>${candidates.map((p) => `<option value="${p.id}">${esc(displayName(p))} — ${esc(p.rank)}</option>`).join("")}</select></div><div class="field full"><label>Mot de passe admin</label><input name="password" type="password" minlength="10" required></div></div><div class="form-actions"><button class="btn btn-secondary" data-close="1" type="button">Annuler</button><button class="btn btn-danger" type="submit">Transférer</button></div></form>
    `, true);
    document.getElementById("admin-transfer-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      await runAction("Transfert de l'administration…", async () => {
        const { error } = await state.client.rpc("admin_transfer_owner", { p_password: data.get("password"), p_new_owner: data.get("user_id") });
        if (error) throw error;
      }, "Administration transférée");
    });
  }

  function openAdminCommanderModal() {
    openAdminPanelModal();
  }

  function openAdminClaimModal() {
    openModal("Activer les droits administrateur", `
      <div class="notice notice-warning">
        <strong>Administration technique indépendante du RP.</strong><br>
        Une fois activée, ton compte conserve son vrai grade RP mais peut gérer tout le site comme un Commandeur suprême.
      </div>
      <form id="admin-claim-form" style="margin-top:14px">
        <div class="field">
          <label>Mot de passe administrateur</label>
          <input name="password" type="password" minlength="10" autocomplete="current-password" required />
        </div>
        <div class="form-actions">
          <button class="btn btn-secondary" data-close="1" type="button">Annuler</button>
          <button class="btn btn-primary" type="submit">Activer mes droits</button>
        </div>
      </form>
    `);

    document.getElementById("admin-claim-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const password = String(data.get("password") || "");
      await runAction("Activation des droits administrateur…", async () => {
        const { data: result, error } = await state.client.rpc("admin_claim_access", {
          p_password: password
        });
        if (error) throw error;
        if (!result?.success) throw new Error(result?.message || "Activation impossible.");
      }, "Droits administrateur activés");
    });
  }

  function openAdminPanelModal() {
    const activeProfiles = state.profiles
      .filter((profile) => profile.is_active)
      .sort((a, b) => displayName(a).localeCompare(displayName(b), "fr"));
    const currentCommander = state.profiles.find((profile) => profile.rank === "Commandeur suprême");

    openModal("Panel administrateur", `
      <div class="notice notice-danger">
        <strong>Action sensible :</strong> le membre choisi deviendra Commandeur suprême. L'ancien Commandeur suprême, s'il existe, deviendra Maître de guerre.
      </div>
      <div class="notice" style="margin-top:10px">
        <strong>Commandeur actuel :</strong> ${esc(displayName(currentCommander) || "Aucun")}
      </div>
      <form id="admin-commander-form" style="margin-top:14px">
        <div class="form-grid">
          <div class="field full">
            <label>Nouveau Commandeur suprême</label>
            <select name="user_id" required>
              <option value="">Choisir un membre</option>
              ${activeProfiles.map((profile) => `<option value="${profile.id}" ${profile.id === currentCommander?.id ? "selected" : ""}>${esc(displayName(profile))} — ${esc(profile.rank)}</option>`).join("")}
            </select>
          </div>
          <div class="field full">
            <label>Mot de passe administrateur</label>
            <input name="password" type="password" minlength="10" autocomplete="current-password" required />
          </div>
          <label class="field full" style="display:flex;grid-template-columns:auto 1fr;align-items:flex-start;gap:9px">
            <input name="confirm" type="checkbox" required style="width:auto;margin-top:3px" />
            <span>Je confirme vouloir transférer le grade Commandeur suprême à ce membre.</span>
          </label>
        </div>
        <div class="form-actions">
          <button class="btn btn-secondary" data-close="1" type="button">Annuler</button>
          <button class="btn btn-danger" type="submit">Nommer le Commandeur suprême</button>
        </div>
      </form>
    `, true);

    document.getElementById("admin-commander-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const userId = String(data.get("user_id") || "");
      const password = String(data.get("password") || "");
      if (!userId) {
        toast("Membre requis", "Choisis le nouveau Commandeur suprême.", "warning");
        return;
      }

      await runAction("Transfert du commandement…", async () => {
        const { data: result, error } = await state.client.rpc("admin_set_commander", {
          p_password: password,
          p_new_commander: userId
        });
        if (error) throw error;
        if (!result?.success) throw new Error(result?.message || "Le transfert a échoué.");
      }, "Commandeur suprême mis à jour");
    });
  }

  function bindPageEvents() {
    document.querySelectorAll("[data-page-jump]").forEach((button) => {
      button.addEventListener("click", () => {
        state.page = button.dataset.pageJump;
        state.selectedVaultId = null;
        renderApp();
      });
    });

    document.querySelectorAll("[data-open-vault]").forEach((button) => {
      button.addEventListener("click", () => {
        state.selectedVaultId = button.dataset.openVault;
        renderApp();
      });
    });

    document.querySelectorAll("[data-edit-vault]").forEach((button) => {
      button.addEventListener("click", () => openEditVaultModal(button.dataset.editVault));
    });

    document.getElementById("back-to-vaults")?.addEventListener("click", () => {
      const vault = byId(state.vaults, state.selectedVaultId);
      state.page = vault?.kind === "personal" ? "personal" : "vaults";
      state.selectedVaultId = null;
      renderApp();
    });

    document.getElementById("create-shared-vault")?.addEventListener("click", openCreateVaultModal);
    document.getElementById("create-personal-vault")?.addEventListener("click", createPersonalVault);
    document.getElementById("open-admin-panel")?.addEventListener("click", () => {
      if (!isTechnicalAdmin()) return openAdminClaimModal();
      state.page = "admin";
      state.selectedVaultId = null;
      renderApp();
    });
    document.getElementById("claim-admin-access")?.addEventListener("click", openAdminClaimModal);
    document.getElementById("add-item")?.addEventListener("click", openAddItemModal);

    document.querySelectorAll("[data-move]").forEach((button) => {
      button.addEventListener("click", () => openMoveModal(button.dataset.vault, button.dataset.item, button.dataset.move));
    });

    document.querySelectorAll("[data-edit-item]").forEach((button) => {
      button.addEventListener("click", () => openEditItemModal(button.dataset.editItem));
    });

    document.querySelectorAll("[data-delete-item]").forEach((button) => {
      button.addEventListener("click", () => openDeleteItemModal(button.dataset.deleteItem));
    });

    document.querySelectorAll("[data-edit-member]").forEach((button) => {
      button.addEventListener("click", () => openEditMemberModal(button.dataset.editMember));
    });

    document.getElementById("admin-refresh")?.addEventListener("click", loadData);
    document.getElementById("admin-create-vault")?.addEventListener("click", openCreateVaultModal);
    document.getElementById("admin-set-commander")?.addEventListener("click", openAdminCommanderModal);
    document.getElementById("admin-export-history")?.addEventListener("click", exportHistoryCsv);
    document.getElementById("admin-change-password")?.addEventListener("click", openAdminPasswordModal);
    document.getElementById("admin-transfer-owner")?.addEventListener("click", openAdminTransferModal);

    document.querySelectorAll("[data-admin-jump]").forEach((button) => {
      button.addEventListener("click", () => {
        state.page = button.dataset.adminJump;
        state.selectedVaultId = null;
        renderApp();
      });
    });

    document.querySelectorAll("[data-admin-approve]").forEach((button) => button.addEventListener("click", () => adminQuickStatus(button.dataset.adminApprove, "approved")));
    document.querySelectorAll("[data-admin-block]").forEach((button) => button.addEventListener("click", () => adminQuickStatus(button.dataset.adminBlock, "blocked")));
    document.querySelectorAll("[data-admin-manage]").forEach((button) => button.addEventListener("click", () => openAdminManageMemberModal(button.dataset.adminManage)));
    document.querySelectorAll("[data-admin-delete-vault]").forEach((button) => button.addEventListener("click", () => openDeleteVaultModal(button.dataset.adminDeleteVault)));

    document.getElementById("admin-user-search")?.addEventListener("input", (event) => {
      state.adminFilter = event.target.value;
      const content = document.getElementById("page-content");
      content.innerHTML = renderAdmin();
      bindPageEvents();
      const search = document.getElementById("admin-user-search");
      search?.focus();
      search?.setSelectionRange(search.value.length, search.value.length);
    });

    document.getElementById("admin-site-settings-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      await runAction("Enregistrement des paramètres…", async () => {
        const { error } = await state.client.rpc("admin_update_site_settings", {
          p_approval_required: data.get("approval_required") === "on",
          p_site_enabled: data.get("site_enabled") === "on",
          p_maintenance_message: data.get("maintenance_message") || null
        });
        if (error) throw error;
      }, "Paramètres enregistrés");
    });

    document.getElementById("admin-clean-logins")?.addEventListener("click", async () => {
      if (!confirm("Supprimer les journaux de connexion datant de plus de 90 jours ?")) return;
      await runAction("Nettoyage du journal…", async () => {
        const { error } = await state.client.rpc("admin_clear_connection_logs", { p_older_than_days: 90 });
        if (error) throw error;
      }, "Anciennes connexions supprimées");
    });

    const historyInputs = ["history-search", "history-type", "history-vault", "history-member"];
    historyInputs.forEach((id) => {
      document.getElementById(id)?.addEventListener(id === "history-search" ? "input" : "change", (event) => {
        const key = id.replace("history-", "");
        state.historyFilters[key] = event.target.value;
        const content = document.getElementById("page-content");
        content.innerHTML = renderHistory();
        bindPageEvents();
        const search = document.getElementById("history-search");
        if (id === "history-search") {
          search.focus();
          search.setSelectionRange(search.value.length, search.value.length);
        }
      });
    });

    document.getElementById("export-history")?.addEventListener("click", exportHistoryCsv);
  }

  function openCreateVaultModal() {
    openModal("Créer un coffre commun", `
      <form id="vault-form">
        <div class="form-grid">
          <div class="field full"><label>Nom</label><input name="name" maxlength="70" required placeholder="Ex. Réserve spéciale" /></div>
          <div class="field full"><label>Description</label><textarea name="description" maxlength="250" placeholder="Utilité du coffre"></textarea></div>
        </div>
        <div class="form-actions"><button class="btn btn-secondary" data-close="1" type="button">Annuler</button><button class="btn btn-primary" type="submit">Créer</button></div>
      </form>
    `);
    document.getElementById("vault-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      await runAction("Création du coffre…", async () => {
        const { error } = await state.client.from("vaults").insert({
          name: data.get("name").trim(),
          description: data.get("description").trim() || null,
          kind: "shared",
          owner_id: null,
          created_by: state.user.id
        });
        if (error) throw error;
      }, "Coffre créé");
    });
  }

  function openEditVaultModal(vaultId) {
    const vault = byId(state.vaults, vaultId);
    if (!vault) return;
    openModal("Modifier le coffre", `
      <form id="vault-edit-form">
        <div class="form-grid">
          <div class="field full"><label>Nom</label><input name="name" maxlength="70" required value="${esc(vault.name)}" /></div>
          <div class="field full"><label>Description</label><textarea name="description" maxlength="250">${esc(vault.description || "")}</textarea></div>
        </div>
        <div class="form-actions"><button class="btn btn-secondary" data-close="1" type="button">Annuler</button><button class="btn btn-primary" type="submit">Enregistrer</button></div>
      </form>
    `);
    document.getElementById("vault-edit-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      await runAction("Mise à jour…", async () => {
        const { error } = await state.client.from("vaults").update({
          name: data.get("name").trim(),
          description: data.get("description").trim() || null
        }).eq("id", vault.id);
        if (error) throw error;
      }, "Coffre mis à jour");
    });
  }

  async function createPersonalVault() {
    await runAction("Création du coffre personnel…", async () => {
      const { error } = await state.client.rpc("create_personal_vault");
      if (error) throw error;
    }, "Coffre personnel créé");
  }

  function openAddItemModal() {
    const vault = byId(state.vaults, state.selectedVaultId);
    if (!vault) return;
    openModal("Ajouter un objet", `
      <form id="item-form">
        <div class="form-grid">
          <div class="field"><label>Nom de l'objet</label><input name="name" maxlength="90" required placeholder="Ex. Munition 9MM" /></div>
          <div class="field"><label>Catégorie</label><input name="category" maxlength="60" required placeholder="Ex. Munition" /></div>
          <div class="field"><label>Unité</label><input name="unit" maxlength="30" value="unité" required /></div>
          <div class="field"><label>Quantité initiale</label><input name="quantity" type="number" min="0" step="1" value="0" required /></div>
          <div class="field full"><label>Description</label><textarea name="description" maxlength="300"></textarea></div>
          <div class="field full"><label>Image (facultatif, 5 Mo max.)</label><input name="image" type="file" accept="image/png,image/jpeg,image/webp,image/gif" /></div>
        </div>
        <div class="notice" style="margin-top:13px">Si un objet avec le même nom et la même catégorie existe déjà, il sera simplement ajouté à ce coffre.</div>
        <div class="form-actions"><button class="btn btn-secondary" data-close="1" type="button">Annuler</button><button class="btn btn-primary" type="submit">Ajouter</button></div>
      </form>
    `, true);

    document.getElementById("item-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const name = data.get("name").trim();
      const category = data.get("category").trim();
      const quantity = Number(data.get("quantity"));
      const file = data.get("image");

      await runAction("Ajout de l'objet…", async () => {
        let item = state.items.find((row) => row.name.toLowerCase() === name.toLowerCase() && row.category.toLowerCase() === category.toLowerCase());
        let upload = null;
        if (file instanceof File && file.size) upload = await uploadItemImage(file, name);

        if (!item) {
          const { data: created, error } = await state.client.from("items").insert({
            name,
            category,
            unit: data.get("unit").trim(),
            description: data.get("description").trim() || null,
            image_url: upload?.url || null,
            image_path: upload?.path || null,
            created_by: state.user.id
          }).select("*").single();
          if (error) throw error;
          item = created;
        } else if (upload) {
          const { error } = await state.client.from("items").update({ image_url: upload.url, image_path: upload.path }).eq("id", item.id);
          if (error) throw error;
        }

        const { error: linkError } = await state.client.rpc("link_item_to_vault", { p_vault_id: vault.id, p_item_id: item.id });
        if (linkError) throw linkError;

        if (quantity > 0) {
          const { error: moveError } = await state.client.rpc("move_stock", {
            p_vault_id: vault.id,
            p_item_id: item.id,
            p_type: "deposit",
            p_quantity: quantity,
            p_reason: "Quantité initiale"
          });
          if (moveError) throw moveError;
        }
      }, "Objet ajouté");
    });
  }

  function openMoveModal(vaultId, itemId, type) {
    const vault = byId(state.vaults, vaultId);
    const item = byId(state.items, itemId);
    const stock = state.inventory.find((row) => row.vault_id === vaultId && row.item_id === itemId);
    if (!vault || !item || !stock) return;
    const label = type === "deposit" ? "Déposer" : type === "withdrawal" ? "Retirer" : "Ajuster le stock";
    const isAdjustment = type === "adjustment";
    openModal(label, `
      <form id="move-form">
        <div class="item-cell" style="margin-bottom:15px">${itemImage(item)}<div><strong>${esc(item.name)}</strong><span>Stock actuel : ${formatNumber(stock.quantity)} ${esc(item.unit)}</span></div></div>
        <div class="form-grid">
          <div class="field full"><label>${isAdjustment ? "Nouvelle quantité totale" : "Quantité"}</label><input name="quantity" type="number" min="${isAdjustment ? 0 : 1}" step="1" required /></div>
          <div class="field full"><label>Motif ${type === "withdrawal" ? "(obligatoire)" : "(facultatif)"}</label><textarea name="reason" ${type === "withdrawal" ? "required" : ""} placeholder="Mission, rangement, correction…"></textarea></div>
        </div>
        <div class="form-actions"><button class="btn btn-secondary" data-close="1" type="button">Annuler</button><button class="btn ${type === "withdrawal" ? "btn-danger" : "btn-primary"}" type="submit">Confirmer</button></div>
      </form>
    `);

    document.getElementById("move-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      await runAction("Mise à jour du stock…", async () => {
        const { error } = await state.client.rpc("move_stock", {
          p_vault_id: vaultId,
          p_item_id: itemId,
          p_type: type,
          p_quantity: Number(data.get("quantity")),
          p_reason: data.get("reason").trim() || null
        });
        if (error) throw error;
      }, "Stock mis à jour");
    });
  }

  function openEditItemModal(itemId) {
    const item = byId(state.items, itemId);
    if (!item) return;
    openModal("Modifier la fiche de l'objet", `
      <form id="edit-item-form">
        <div class="form-grid">
          <div class="field"><label>Nom</label><input name="name" maxlength="90" value="${esc(item.name)}" required /></div>
          <div class="field"><label>Catégorie</label><input name="category" maxlength="60" value="${esc(item.category)}" required /></div>
          <div class="field"><label>Unité</label><input name="unit" maxlength="30" value="${esc(item.unit)}" required /></div>
          <div class="field"><label>Image actuelle</label>${itemImage(item, "preview-image")}</div>
          <div class="field full"><label>Description</label><textarea name="description" maxlength="300">${esc(item.description || "")}</textarea></div>
          <div class="field full"><label>Nouvelle image (facultatif)</label><input name="image" type="file" accept="image/png,image/jpeg,image/webp,image/gif" /></div>
        </div>
        <div class="form-actions"><button class="btn btn-secondary" data-close="1" type="button">Annuler</button><button class="btn btn-primary" type="submit">Enregistrer</button></div>
      </form>
    `, true);

    document.getElementById("edit-item-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const file = data.get("image");
      await runAction("Mise à jour de l'objet…", async () => {
        let upload = null;
        if (file instanceof File && file.size) upload = await uploadItemImage(file, data.get("name"));

        const patch = {
          name: data.get("name").trim(),
          category: data.get("category").trim(),
          unit: data.get("unit").trim(),
          description: data.get("description").trim() || null
        };
        if (upload) {
          patch.image_url = upload.url;
          patch.image_path = upload.path;
        }

        const { error } = await state.client.from("items").update(patch).eq("id", item.id);
        if (error) throw error;

        if (upload && item.image_path) {
          await state.client.storage.from("object-images").remove([item.image_path]);
        }
      }, "Objet mis à jour");
    });
  }

  function openDeleteItemModal(itemId) {
    const item = byId(state.items, itemId);
    if (!item) return;
    openModal("Suppression définitive", `
      <div class="notice notice-danger">
        <strong>Attention :</strong> l'objet sera supprimé de tous les coffres, avec son stock et tout son historique.
      </div>
      <form id="delete-item-form" style="margin-top:14px">
        <div class="field"><label>Écris exactement : ${esc(item.name)}</label><input name="confirm" autocomplete="off" required /></div>
        <div class="form-actions"><button class="btn btn-secondary" data-close="1" type="button">Annuler</button><button class="btn btn-danger" type="submit">Supprimer définitivement</button></div>
      </form>
    `);

    document.getElementById("delete-item-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      if (data.get("confirm") !== item.name) {
        toast("Confirmation incorrecte", "Le nom saisi ne correspond pas.", "warning");
        return;
      }
      await runAction("Suppression définitive…", async () => {
        if (item.image_path) {
          const { error: storageError } = await state.client.storage.from("object-images").remove([item.image_path]);
          if (storageError) console.warn(storageError);
        }
        const { error } = await state.client.rpc("delete_item_completely", { p_item_id: item.id });
        if (error) throw error;
      }, "Objet supprimé définitivement");
    });
  }

  function openEditMemberModal(profileId) {
    const profile = byId(state.profiles, profileId);
    if (!profile) return;
    const allowedRanks = RANKS.filter((rank) => rank !== "Commandeur suprême" && (isTechnicalAdmin() || level(rank) <= level()));
    openModal("Modifier le membre", `
      <form id="member-form">
        <div class="item-cell" style="margin-bottom:15px">${avatar(profile, "item-thumb")}<div><strong>${esc(displayName(profile))}</strong><span>${esc(profile.username || "")}</span></div></div>
        <div class="form-grid">
          <div class="field full"><label>Grade</label><select name="rank">${allowedRanks.map((rank) => `<option value="${esc(rank)}" ${profile.rank === rank ? "selected" : ""}>${esc(rank)}</option>`).join("")}</select></div>
          <div class="field full"><label>Accès au site</label><select name="active"><option value="true" ${profile.is_active ? "selected" : ""}>Actif</option><option value="false" ${!profile.is_active ? "selected" : ""}>Suspendu</option></select></div>
        </div>
        <div class="notice" style="margin-top:13px">${isTechnicalAdmin() ? "En tant qu’admin technique, tu peux attribuer tous les grades sauf Commandeur suprême (utilise le panel administrateur pour ce grade)." : "Tu ne peux pas attribuer un grade supérieur au tien ni modifier ton propre grade depuis le site."}</div>
        <div class="form-actions"><button class="btn btn-secondary" data-close="1" type="button">Annuler</button><button class="btn btn-primary" type="submit">Enregistrer</button></div>
      </form>
    `);

    document.getElementById("member-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      await runAction("Mise à jour du membre…", async () => {
        const { error } = await state.client.rpc("set_member_access", {
          p_user_id: profile.id,
          p_rank: data.get("rank"),
          p_is_active: data.get("active") === "true"
        });
        if (error) throw error;
      }, "Membre mis à jour");
    });
  }

  async function uploadItemImage(file, itemName) {
    const allowed = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    if (!allowed.includes(file.type)) throw new Error("Format non accepté : utilise PNG, JPG, WEBP ou GIF.");
    if (file.size > 5 * 1024 * 1024) throw new Error("L'image dépasse 5 Mo.");
    const extension = (file.name.split(".").pop() || "jpg").replace(/[^a-z0-9]/gi, "").toLowerCase();
    const safeName = String(itemName || "objet").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
    const path = `${state.user.id}/${Date.now()}-${safeName || "objet"}.${extension || "jpg"}`;
    const { error } = await state.client.storage.from("object-images").upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type
    });
    if (error) throw error;
    const { data } = state.client.storage.from("object-images").getPublicUrl(path);
    return { path, url: data.publicUrl };
  }

  async function runAction(label, action, successMessage) {
    showLoading(label);
    try {
      await action();
      closeModal();
      toast(successMessage, "", "success");
      await loadData();
    } catch (error) {
      console.error(error);
      toast("Action impossible", error.message || String(error), "error", 6500);
    } finally {
      hideLoading();
    }
  }

  function exportHistoryCsv() {
    const rows = filteredMovements();
    const header = ["Date", "Membre", "Action", "Objet", "Quantité", "Coffre", "Avant", "Après", "Motif"];
    const data = rows.map((movement) => {
      const item = byId(state.items, movement.item_id);
      const vault = byId(state.vaults, movement.vault_id);
      const profile = byId(state.profiles, movement.user_id);
      return [
        formatDate(movement.created_at),
        displayName(profile),
        movement.type,
        item?.name || "Objet supprimé",
        movement.quantity,
        vault?.name || "Coffre supprimé",
        movement.quantity_before,
        movement.quantity_after,
        movement.reason || ""
      ];
    });
    const csv = [header, ...data].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(";")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `silver-phoenix-historique-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function init() {
    if (!isConfigured()) {
      renderSetup();
      return;
    }

    if (!window.supabase?.createClient) {
      renderError(new Error("La bibliothèque Supabase n'a pas pu être chargée."));
      return;
    }

    state.client = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });

    const { data, error } = await state.client.auth.getSession();
    if (error) {
      renderError(error);
      return;
    }

    state.session = data.session;
    state.user = data.session?.user || null;

    state.client.auth.onAuthStateChange((event, session) => {
      state.session = session;
      state.user = session?.user || null;

      // Le callback Supabase reste synchrone. Le chargement est décalé afin
      // d'éviter les courses entre INITIAL_SESSION, SIGNED_IN et getSession().
      if (session?.user) {
        const authenticatedUser = session.user;
        window.setTimeout(() => loadData(authenticatedUser), 0);
      } else if (event === "SIGNED_OUT") {
        state.profile = null;
        state.adminAccess = false;
        state.adminPrivate = [];
        state.loginEvents = [];
        state.adminAudit = [];
        renderAuth();
      }
    });

    if (state.user) await loadData(state.user);
    else renderAuth();
  }

  init();
})();
