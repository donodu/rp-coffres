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
    historyFilters: { search: "", type: "", vault: "", member: "" }
  };

  const ICONS = {
    dashboard: "⌂",
    vaults: "▣",
    personal: "♙",
    history: "☷",
    members: "♟",
    settings: "⚙",
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

  function isTopThree() {
    return level() >= 100;
  }

  function isCommanderSupreme() {
    return level() === 120;
  }

  function canMove(vault) {
    if (!vault) return false;
    return vault.kind === "personal" ? isTopThree() : level() >= 20;
  }

  function canManage() {
    return isTopThree();
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
    renderAuth();
  }

  async function loadData() {
    showLoading("Chargement des coffres…");
    try {
      const profileResult = await state.client
        .from("profiles")
        .select("*")
        .eq("id", state.user.id)
        .maybeSingle();

      if (profileResult.error) throw profileResult.error;
      state.profile = profileResult.data;

      if (!state.profile) {
        throw new Error("Ton profil n'a pas été créé. Déconnecte-toi puis reconnecte-toi.");
      }

      const topThree = level(state.profile.rank) >= 100;

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
    document.getElementById("retry").addEventListener("click", loadData);
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
            ${navButton("settings", ICONS.settings, "Paramètres")}
          </nav>
          <div class="sidebar-user">
            <div class="user-line">
              ${avatar(state.profile)}
              <div><strong>${esc(displayName(state.profile))}</strong><span>${esc(state.profile.rank)}</span></div>
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
          Cette section est visible uniquement par le Commandeur suprême, le Maître de guerre et les Chefs mercenaires.
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
    const editable = isTopThree() && profile.id !== state.user.id && level(profile.rank) <= level();
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
              ${isTopThree() ? "Historique, coffres personnels et administration accessibles." : "Historique et coffres personnels masqués."}
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
      </div>
    `;
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
    const allowedRanks = RANKS.filter((rank) => level(rank) <= level());
    openModal("Modifier le membre", `
      <form id="member-form">
        <div class="item-cell" style="margin-bottom:15px">${avatar(profile, "item-thumb")}<div><strong>${esc(displayName(profile))}</strong><span>${esc(profile.username || "")}</span></div></div>
        <div class="form-grid">
          <div class="field full"><label>Grade</label><select name="rank">${allowedRanks.map((rank) => `<option value="${esc(rank)}" ${profile.rank === rank ? "selected" : ""}>${esc(rank)}</option>`).join("")}</select></div>
          <div class="field full"><label>Accès au site</label><select name="active"><option value="true" ${profile.is_active ? "selected" : ""}>Actif</option><option value="false" ${!profile.is_active ? "selected" : ""}>Suspendu</option></select></div>
        </div>
        <div class="notice" style="margin-top:13px">Tu ne peux pas attribuer un grade supérieur au tien ni modifier ton propre grade depuis le site.</div>
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

    state.client.auth.onAuthStateChange(async (_event, session) => {
      state.session = session;
      state.user = session?.user || null;
      if (state.user) await loadData();
      else renderAuth();
    });

    if (state.user) await loadData();
    else renderAuth();
  }

  init();
})();
