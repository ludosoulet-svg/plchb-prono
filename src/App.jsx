import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Trophy, Plus, Lock, Shield, Check, X, ChevronRight, Users, Eye, EyeOff, Pencil, LogOut, Bell, BellOff, Download, Crown } from "lucide-react";
import { supabase } from "./supabaseClient";

const CLUB_LOGO = "/club-logo.png";
const HAND_EXPERT_LOGO = "/hand-expert-logo.png";
const NEW_CLUB_LOGO = "/plchb-logo-final.png";
const SIGNATURE_TAG = "/ludo-signature-tag.png";

const FONTS = `
@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600&display=swap');

@media print {
  body * { visibility: hidden; }
  .print-leaderboard, .print-leaderboard * { visibility: visible; }
  .print-leaderboard {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    background: #FFFFFF !important;
    color: #0A2647 !important;
    padding: 24px;
  }
  .print-leaderboard * {
    background: transparent !important;
    color: #0A2647 !important;
    border-color: #ccc !important;
  }
  .no-print { display: none !important; }
}

input[type="number"]::-webkit-outer-spin-button,
input[type="number"]::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
input[type="number"] {
  -moz-appearance: textfield;
}
`;

const COLORS = {
  ink: "#0A2647",
  ink2: "#123B69",
  paper: "#FAF9F4",
  paperDim: "#9FB8D6",
  amber: "#FFD400",
  teal: "#3D8BDB",
  red: "#E2574C",
  green: "#33A554",
  line: "#1E4E80",
};

const ADMIN_PASS = "coach2026";
const NS = "phc"; // pronostics hand club — v2 (clés localStorage pour les préférences personnelles)

// Conversion entre les lignes Supabase (snake_case) et le format utilisé par l'appli
function matchFromRow(row) {
  return {
    id: row.id,
    home: row.home,
    away: row.away,
    category: row.category,
    date: row.match_date,
    status: row.status,
    scoreH: row.score_h,
    scoreA: row.score_a,
  };
}

function predictionsFromRows(rows) {
  const map = {};
  rows.forEach((row) => {
    map[`${row.match_id}__${row.username}`] = { h: row.pred_h, a: row.pred_a };
  });
  return map;
}

const CATEGORIES = ["SM1", "SM2", "SF1", "U18F", "U18M", "U15F", "U15M", "U13F", "U13M"];

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function computePoints(predH, predA, actH, actA) {
  if (predH === actH && predA === actA) return 10; // score exact
  const predDiff = predH - predA;
  const actDiff = actH - actA;
  if (predDiff === actDiff) return 5; // bon vainqueur + bonne différence de buts
  if (Math.sign(predDiff) === Math.sign(actDiff)) return 2; // bon vainqueur seulement
  return 0; // pronostic faux
}

function fmtDate(iso) {
  try {
    const d = new Date(iso);
    const s = d.toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    const t = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    return `${s.charAt(0).toUpperCase() + s.slice(1)} · ${t}`;
  } catch {
    return iso;
  }
}

// Groups matches by the Monday of their week, so "classement de la semaine"
// can isolate one week's (lundi-dimanche) matches from the full season.
function weekendKeyOf(iso) {
  const d = new Date(iso);
  const day = d.getDay(); // 0 = dimanche ... 6 = samedi
  let offset;
  if (day === 0) offset = -6;
  else offset = 1 - day; // ramène au lundi de la semaine
  const mon = new Date(d);
  mon.setDate(d.getDate() + offset);
  return mon.toISOString().slice(0, 10);
}

function weekendLabelOf(key) {
  const mon = new Date(key);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const monStr = mon.toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
  const sunStr = sun.toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
  return `Semaine du ${monStr} au ${sunStr}`;
}

// Convertit une date ISO en valeur compatible avec un input type="datetime-local"
function toLocalInputValue(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function App() {
  const [username, setUsername] = useState(null);
  const [nameInput, setNameInput] = useState("");
  const [loginStep, setLoginStep] = useState("name"); // "name" | "create-pin" | "verify-pin"
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");
  const [checkingUser, setCheckingUser] = useState(false);
  const [matches, setMatches] = useState([]);
  const [predictions, setPredictions] = useState({}); // key `${matchId}__${user}` -> {h,a}
  const [tab, setTab] = useState("matches");
  const [loading, setLoading] = useState(true);
  const [adminOn, setAdminOn] = useState(false);
  const [adminInput, setAdminInput] = useState("");
  const [adminError, setAdminError] = useState(false);
  const [showAdminInput, setShowAdminInput] = useState(false);
  const [lbScope, setLbScope] = useState("weekend"); // 'weekend' | 'season'
  const [showLeaderboardModal, setShowLeaderboardModal] = useState(false);
  const [selectedWeekend, setSelectedWeekend] = useState(null);
  const [matchFilter, setMatchFilter] = useState("all"); // 'all' | 'mine'
  const [now, setNow] = useState(() => new Date());
  const [showAdminTab, setShowAdminTab] = useState(() => localStorage.getItem(`${NS}:showAdminTab`) === "true");
  const logoTapsRef = useRef([]);

  const handleLogoTap = () => {
    const t = Date.now();
    logoTapsRef.current = [...logoTapsRef.current, t].filter((ts) => t - ts <= 3000);
    if (logoTapsRef.current.length >= 5) {
      logoTapsRef.current = [];
      setShowAdminTab(true);
      localStorage.setItem(`${NS}:showAdminTab`, "true");
      setTab("admin");
    }
  };

  useEffect(() => {
    if (tab === "admin" && !showAdminTab) setTab("matches");
  }, [tab, showAdminTab]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);

  // new match form
  const [newHome, setNewHome] = useState("");
  const [newAway, setNewAway] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newCategory, setNewCategory] = useState(CATEGORIES[0]);
  const [registeredUsers, setRegisteredUsers] = useState([]);
  const [userPins, setUserPins] = useState({}); // { [username]: pin | null }
  const [confirmingResetFor, setConfirmingResetFor] = useState(null);
  const [notifPermission, setNotifPermission] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported"
  );
  const [seenMatchIds, setSeenMatchIds] = useState([]);
  const [bonusPoints, setBonusPoints] = useState({}); // { [username]: points } — points attribués manuellement par l'admin
  const [bonusNameInput, setBonusNameInput] = useState("");
  const [bonusPointsInput, setBonusPointsInput] = useState("");
  const knownMatchIdsRef = useRef(null);

  const requestNotifPermission = async () => {
    if (typeof Notification === "undefined") return;
    const perm = await Notification.requestPermission();
    setNotifPermission(perm);
  };

  const loadAll = useCallback(async () => {
    setLoading(true);

    const storedUsername = localStorage.getItem(`${NS}:username`);
    if (storedUsername) setUsername(storedUsername);

    try {
      const { data, error } = await supabase.from("matches").select("*").order("match_date");
      if (error) throw error;
      const initialMatches = (data || []).map(matchFromRow);
      setMatches(initialMatches);
      knownMatchIdsRef.current = new Set(initialMatches.map((match) => match.id));
    } catch {
      setMatches([]);
    }

    try {
      const { data, error } = await supabase.from("predictions").select("*");
      if (error) throw error;
      setPredictions(predictionsFromRows(data || []));
    } catch {
      setPredictions({});
    }

    try {
      const { data, error } = await supabase.from("registered_users").select("username, pin");
      if (error) throw error;
      setRegisteredUsers((data || []).map((r) => r.username).sort());
      const pins = {};
      (data || []).forEach((r) => {
        pins[r.username] = r.pin || null;
      });
      setUserPins(pins);
    } catch {
      setRegisteredUsers([]);
      setUserPins({});
    }

    try {
      const s = localStorage.getItem(`${NS}:seenMatchIds`);
      setSeenMatchIds(s ? JSON.parse(s) : []);
    } catch {
      setSeenMatchIds([]);
    }

    try {
      const { data, error } = await supabase.from("bonus_points").select("*");
      if (error) throw error;
      const map = {};
      (data || []).forEach((row) => {
        map[row.username] = row.points;
      });
      setBonusPoints(map);
    } catch {
      setBonusPoints({});
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Les matchs/pronostics sont partagés entre tous les licenciés, mais chaque appareil
  // ne les récupère qu'une fois au chargement. On réactualise donc en tâche de fond
  // pour que les matchs ajoutés par l'admin (ou les résultats saisis) apparaissent
  // sans qu'il soit nécessaire de recharger la page.
  const refreshShared = useCallback(async () => {
    try {
      const { data, error } = await supabase.from("matches").select("*").order("match_date");
      if (error) throw error;
      const nextMatches = (data || []).map(matchFromRow);
      setMatches(nextMatches);

      const nextIds = new Set(nextMatches.map((match) => match.id));
      if (knownMatchIdsRef.current === null) {
        // Premier chargement : on mémorise les matchs existants sans notifier.
        knownMatchIdsRef.current = nextIds;
      } else {
        const newlyAdded = nextMatches.filter((match) => !knownMatchIdsRef.current.has(match.id));
        knownMatchIdsRef.current = nextIds;
        if (newlyAdded.length > 0 && typeof Notification !== "undefined" && Notification.permission === "granted") {
          newlyAdded.forEach((match) => {
            new Notification("Nouveau match à pronostiquer", {
              body: `${match.home} vs ${match.away} — ${fmtDate(match.date)}`,
            });
          });
        }
      }
    } catch {
      /* ignore */
    }
    try {
      const { data, error } = await supabase.from("predictions").select("*");
      if (error) throw error;
      setPredictions(predictionsFromRows(data || []));
    } catch {
      /* ignore */
    }
    try {
      const { data, error } = await supabase.from("registered_users").select("username, pin");
      if (error) throw error;
      setRegisteredUsers((data || []).map((r) => r.username).sort());
      const pins = {};
      (data || []).forEach((r) => {
        pins[r.username] = r.pin || null;
      });
      setUserPins(pins);
    } catch {
      /* ignore */
    }
    try {
      const { data, error } = await supabase.from("bonus_points").select("*");
      if (error) throw error;
      const map = {};
      (data || []).forEach((row) => {
        map[row.username] = row.points;
      });
      setBonusPoints(map);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const t = setInterval(refreshShared, 20000);
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshShared();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshShared]);

  const registerUser = async (name) => {
    try {
      await supabase.from("registered_users").upsert({ username: name }, { onConflict: "username" });
      setRegisteredUsers((prev) => (prev.includes(name) ? prev : [...prev, name].sort()));
    } catch {
      /* ignore */
    }
  };

  // Attribue (ajoute) des points bonus manuels à un licencié dans le classement général.
  // Si le licencié n'existe pas encore, il est créé et inscrit.
  const addBonusPoints = async (name, points) => {
    const cleanName = name.trim().toLowerCase();
    if (!cleanName || !Number.isFinite(points)) return;
    const newTotal = (bonusPoints[cleanName] || 0) + points;
    setBonusPoints((prev) => ({ ...prev, [cleanName]: newTotal }));
    try {
      await supabase.from("bonus_points").upsert({ username: cleanName, points: newTotal }, { onConflict: "username" });
    } catch {
      /* ignore */
    }
    await registerUser(cleanName);
  };

  const resetBonusPoints = async (name) => {
    setBonusPoints((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
    try {
      await supabase.from("bonus_points").delete().eq("username", name);
    } catch {
      /* ignore */
    }
  };

  // Retire un licencié du registre ET efface ses pronostics (il ne comptera plus dans le classement).
  const removeLicencie = async (name) => {
    setRegisteredUsers((prev) => prev.filter((n) => n !== name));
    setUserPins((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
    try {
      await supabase.from("registered_users").delete().eq("username", name);
    } catch {
      /* ignore */
    }
    setPredictions((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) => key.split("__")[1] !== name)));
    try {
      await supabase.from("predictions").delete().eq("username", name);
    } catch {
      /* ignore */
    }
    if (bonusPoints[name] !== undefined) {
      await resetBonusPoints(name);
    }
  };

  // Réinitialise le code secret d'un licencié : à sa prochaine connexion, l'appli
  // lui proposera d'en créer un nouveau (même flux qu'une première connexion).
  const resetPin = async (name) => {
    setUserPins((prev) => ({ ...prev, [name]: null }));
    setConfirmingResetFor(null);
    try {
      await supabase.from("registered_users").update({ pin: null }).eq("username", name);
    } catch {
      /* ignore */
    }
  };

  // Étape 1 : on vérifie si ce licencié a déjà un compte (et un code) avant de savoir
  // s'il faut lui proposer de créer un code secret ou de saisir celui qu'il a déjà.
  const handleNameContinue = async () => {
    const name = nameInput.trim().toLowerCase();
    if (!name) return;
    setCheckingUser(true);
    setPinError("");
    try {
      const { data, error } = await supabase.from("registered_users").select("pin").eq("username", name).maybeSingle();
      if (error) throw error;
      setLoginStep(data && data.pin ? "verify-pin" : "create-pin");
    } catch {
      setPinError("Impossible de vérifier ton compte, réessaie.");
    } finally {
      setCheckingUser(false);
    }
  };

  const backToName = () => {
    setLoginStep("name");
    setPinInput("");
    setPinError("");
  };

  const confirmCreatePin = async () => {
    if (!/^\d{4}$/.test(pinInput)) {
      setPinError("Le code doit contenir exactement 4 chiffres.");
      return;
    }
    const name = nameInput.trim().toLowerCase();
    try {
      await supabase.from("registered_users").upsert({ username: name, pin: pinInput }, { onConflict: "username" });
    } catch {
      /* ignore */
    }
    setRegisteredUsers((prev) => (prev.includes(name) ? prev : [...prev, name].sort()));
    setUserPins((prev) => ({ ...prev, [name]: pinInput }));
    localStorage.setItem(`${NS}:username`, name);
    setUsername(name);
  };

  const confirmVerifyPin = async () => {
    const name = nameInput.trim().toLowerCase();
    setPinError("");
    setCheckingUser(true);
    try {
      const { data, error } = await supabase.from("registered_users").select("pin").eq("username", name).maybeSingle();
      if (error) throw error;
      if (data && data.pin === pinInput) {
        localStorage.setItem(`${NS}:username`, name);
        setUsername(name);
      } else {
        setPinError("Code incorrect.");
      }
    } catch {
      setPinError("Impossible de vérifier ton code, réessaie.");
    } finally {
      setCheckingUser(false);
    }
  };

  const logout = async () => {
    localStorage.removeItem(`${NS}:username`);
    setUsername(null);
    setNameInput("");
    setLoginStep("name");
    setPinInput("");
    setPinError("");
    localStorage.removeItem(`${NS}:showAdminTab`);
    setShowAdminTab(false);
    if (tab === "admin") setTab("matches");
  };

  const [addMatchError, setAddMatchError] = useState(false);

  const addMatch = async () => {
    if (!newHome.trim() || !newAway.trim() || !newDate) {
      setAddMatchError(true);
      return;
    }
    setAddMatchError(false);
    try {
      const { data, error } = await supabase
        .from("matches")
        .insert({
          home: newHome.trim(),
          away: newAway.trim(),
          category: newCategory,
          match_date: new Date(newDate).toISOString(),
          status: "upcoming",
        })
        .select()
        .single();
      if (error) throw error;
      const match = matchFromRow(data);
      setMatches((prev) => [...prev, match].sort((a, b) => new Date(a.date) - new Date(b.date)));
      knownMatchIdsRef.current?.add(match.id);
    } catch {
      /* ignore */
    }
    setNewHome("");
    setNewAway("");
    setNewDate("");
  };

  const removeMatch = async (id) => {
    setMatches((prev) => prev.filter((m) => m.id !== id));
    try {
      await supabase.from("matches").delete().eq("id", id);
    } catch {
      /* ignore */
    }
  };

  const editMatch = async (id, updates) => {
    setMatches((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...updates } : m)).sort((a, b) => new Date(a.date) - new Date(b.date))
    );
    try {
      const row = {};
      if (updates.home !== undefined) row.home = updates.home;
      if (updates.away !== undefined) row.away = updates.away;
      if (updates.date !== undefined) row.match_date = updates.date;
      if (updates.category !== undefined) row.category = updates.category;
      await supabase.from("matches").update(row).eq("id", id);
    } catch {
      /* ignore */
    }
  };

  const setResult = async (id, scoreH, scoreA) => {
    setMatches((prev) =>
      prev.map((m) => (m.id === id ? { ...m, status: "finished", scoreH: Number(scoreH), scoreA: Number(scoreA) } : m))
    );
    try {
      await supabase.from("matches").update({ status: "finished", score_h: Number(scoreH), score_a: Number(scoreA) }).eq("id", id);
    } catch {
      /* ignore */
    }
  };

  const reopenMatch = async (id) => {
    setMatches((prev) => prev.map((m) => (m.id === id ? { ...m, status: "upcoming", scoreH: null, scoreA: null } : m)));
    try {
      await supabase.from("matches").update({ status: "upcoming", score_h: null, score_a: null }).eq("id", id);
    } catch {
      /* ignore */
    }
  };

  const myPrediction = (matchId) => predictions[`${matchId}__${username}`];

  const isLocked = (match) => now >= new Date(match.date);

  const submitPrediction = async (matchId, h, a) => {
    if (h === "" || a === "" || !username) return;
    const match = matches.find((m) => m.id === matchId);
    if (!match || isLocked(match)) return; // coup d'envoi passé : plus de pronostic possible
    setPredictions((prev) => ({ ...prev, [`${matchId}__${username}`]: { h: Number(h), a: Number(a) } }));
    try {
      await supabase
        .from("predictions")
        .upsert(
          { match_id: matchId, username, pred_h: Number(h), pred_a: Number(a), updated_at: new Date().toISOString() },
          { onConflict: "match_id,username" }
        );
    } catch {
      /* ignore */
    }
  };

  const buildLeaderboard = useCallback(
    (matchList) => {
      const totals = {}; // user -> {points, exact, played}
      matchList
        .filter((m) => m.status === "finished")
        .forEach((m) => {
          Object.entries(predictions).forEach(([key, pred]) => {
            const [matchId, user] = key.split("__");
            if (matchId !== m.id) return;
            const pts = computePoints(pred.h, pred.a, m.scoreH, m.scoreA);
            if (!totals[user]) totals[user] = { points: 0, exact: 0, played: 0 };
            totals[user].points += pts;
            totals[user].played += 1;
            if (pts === 10) totals[user].exact += 1;
          });
        });
      return Object.entries(totals)
        .map(([user, v]) => ({ user, ...v }))
        .sort((a, b) => b.points - a.points || b.exact - a.exact);
    },
    [predictions]
  );

  // Toutes les dates de week-end présentes dans le calendrier, de la plus récente à la plus ancienne.
  const weekendKeys = useMemo(() => {
    const keys = new Set(matches.map((m) => weekendKeyOf(m.date)));
    return Array.from(keys).sort((a, b) => new Date(b) - new Date(a));
  }, [matches]);

  useEffect(() => {
    if (weekendKeys.length === 0) {
      setSelectedWeekend(null);
      return;
    }
    if (!selectedWeekend || !weekendKeys.includes(selectedWeekend)) {
      // Par défaut : le week-end le plus récent qui a au moins un match terminé,
      // sinon le week-end le plus proche.
      const withResults = weekendKeys.find((k) =>
        matches.some((m) => weekendKeyOf(m.date) === k && m.status === "finished")
      );
      setSelectedWeekend(withResults || weekendKeys[0]);
    }
  }, [weekendKeys, matches, selectedWeekend]);

  const seasonLeaderboard = useMemo(() => {
    const base = buildLeaderboard(matches);
    const byUser = Object.fromEntries(base.map((row) => [row.user, { ...row }]));
    Object.entries(bonusPoints).forEach(([user, bonus]) => {
      if (!bonus) return;
      if (!byUser[user]) {
        byUser[user] = { user, points: 0, exact: 0, played: 0 };
      }
      byUser[user].points += bonus;
      byUser[user].bonus = bonus;
    });
    return Object.values(byUser).sort((a, b) => b.points - a.points || b.exact - a.exact);
  }, [matches, buildLeaderboard, bonusPoints]);

  // Combine le registre des inscriptions avec les noms trouvés dans les pronostics
  // (utile pour les licenciés qui s'étaient déjà connectés avant la mise en place du registre).
  const allLicencies = useMemo(() => {
    const names = new Set(registeredUsers);
    Object.keys(predictions).forEach((key) => {
      const user = key.split("__")[1];
      if (user) names.add(user);
    });
    return Array.from(names).sort();
  }, [registeredUsers, predictions]);

  const weekendLeaderboard = useMemo(() => {
    if (!selectedWeekend) return [];
    return buildLeaderboard(matches.filter((m) => weekendKeyOf(m.date) === selectedWeekend));
  }, [matches, selectedWeekend, buildLeaderboard]);

  const leaderboard = lbScope === "season" ? seasonLeaderboard : weekendLeaderboard;

  const upcoming = matches.filter((m) => m.status === "upcoming");
  const finished = matches.filter((m) => m.status === "finished").reverse();

  useEffect(() => {
    if (tab !== "matches" || matches.length === 0) return;
    const allIds = matches.map((m) => m.id);
    const merged = Array.from(new Set([...seenMatchIds, ...allIds]));
    if (merged.length !== seenMatchIds.length) {
      setSeenMatchIds(merged);
      localStorage.setItem(`${NS}:seenMatchIds`, JSON.stringify(merged));
    }
  }, [tab, matches, seenMatchIds]);

  if (loading) {
    return (
      <div style={{ background: COLORS.ink, minHeight: "100vh" }} className="flex items-center justify-center">
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: 4, background: COLORS.amber, zIndex: 50 }} />
        <style>{FONTS}</style>
        <div style={{ color: COLORS.paperDim, fontFamily: "Inter, sans-serif" }}>Chargement…</div>
      </div>
    );
  }

  if (!username) {
    return (
      <div
        style={{ background: COLORS.ink, minHeight: "calc(100vh - 110px)", marginTop: 57, fontFamily: "Inter, sans-serif" }}
        className="flex items-center justify-center px-6"
      >
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: 4, background: COLORS.amber, zIndex: 50 }} />
        <HandExpertBanner />
        <div style={{ position: "fixed", top: 53, left: 0, right: 0, height: 4, background: COLORS.amber, zIndex: 50 }} />
        <style>{FONTS}</style>
        <div style={{ background: COLORS.ink2, border: `1px solid ${COLORS.line}` }} className="w-full max-w-sm rounded p-6">
          <img src={NEW_CLUB_LOGO} alt="PLCHB Pronostic" className="w-full max-w-[280px] mx-auto mb-4 object-contain" />

          {loginStep === "name" && (
            <>
              <p style={{ color: COLORS.paperDim }} className="text-sm mb-3 text-center">
                Entrez votre prénom et votre nom pour accéder aux pronostics
              </p>
              <input
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value.toLowerCase())}
                onKeyDown={(e) => e.key === "Enter" && handleNameContinue()}
                placeholder="prénom nom"
                style={{ background: COLORS.ink, color: COLORS.paper, border: `1px solid ${COLORS.line}`, textTransform: "lowercase" }}
                className="w-full rounded px-3 py-2 mb-3 outline-none focus:ring-2 text-center"
              />
            </>
          )}

          {loginStep !== "name" && (
            <>
              <div style={{ color: COLORS.paperDim }} className="text-sm mb-2 flex items-center justify-between">
                <span>
                  Connexion : <span style={{ color: COLORS.paper }} className="font-medium">{nameInput.trim().toLowerCase()}</span>
                </span>
                <button onClick={backToName} style={{ color: COLORS.teal }} className="text-xs underline">
                  Changer
                </button>
              </div>
              <p style={{ color: COLORS.paperDim }} className="text-xs mb-2">
                {loginStep === "create-pin"
                  ? "Crée un code secret à 4 chiffres. Ce code te sera redemandé pour te reconnecter et protège ton nom."
                  : "Entre ton code secret à 4 chiffres pour te reconnecter."}
              </p>
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={pinInput}
                onChange={(e) => {
                  setPinInput(e.target.value.replace(/\D/g, "").slice(0, 4));
                  setPinError("");
                }}
                onKeyDown={(e) => e.key === "Enter" && (loginStep === "create-pin" ? confirmCreatePin() : confirmVerifyPin())}
                placeholder="••••"
                style={{ background: COLORS.ink, color: COLORS.paper, border: `1px solid ${COLORS.line}` }}
                className="w-full rounded px-3 py-2 mb-2 outline-none focus:ring-2 text-center text-lg tracking-[0.5em]"
              />
            </>
          )}

          {pinError && (
            <div style={{ color: COLORS.red }} className="text-xs mb-2">
              {pinError}
            </div>
          )}

          <button
            onClick={loginStep === "name" ? handleNameContinue : loginStep === "create-pin" ? confirmCreatePin : confirmVerifyPin}
            disabled={checkingUser}
            style={{ background: COLORS.amber, color: COLORS.ink, opacity: checkingUser ? 0.6 : 1 }}
            className="w-full rounded py-2 font-semibold"
          >
            {checkingUser ? "…" : "Continuer"}
          </button>
        </div>

        <a
          href="https://www.helloasso.com/associations/plaisir-les-clayes-handball/boutiques/boutique-plaisir-les-clayes-hb"
          target="_blank"
          rel="noopener noreferrer"
          style={{ background: COLORS.amber, borderTop: `1px solid ${COLORS.line}`, position: "relative" }}
          className="fixed bottom-0 left-0 right-0 flex items-center justify-center py-3"
        >
          <img
            src={SIGNATURE_TAG}
            alt=""
            style={{ position: "absolute", bottom: "100%", right: 12, marginBottom: 8, height: 42, zIndex: 45, pointerEvents: "none" }}
            className="object-contain"
          />
          <span style={{ fontFamily: "Oswald, sans-serif", color: COLORS.ink, letterSpacing: "0.04em" }} className="text-xl font-semibold uppercase">
            Ici, votre boutique du club
          </span>
        </a>
      </div>
    );
  }

  return (
    <div style={{ background: COLORS.ink, minHeight: "100vh", fontFamily: "Inter, sans-serif", paddingTop: 57 }}>
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: 4, background: COLORS.amber, zIndex: 50 }} />
      <HandExpertBanner />
      <div style={{ position: "fixed", top: 53, left: 0, right: 0, height: 4, background: COLORS.amber, zIndex: 50 }} />
      <style>{FONTS}</style>

      {/* header */}
      <div style={{ borderBottom: `1px solid ${COLORS.line}` }} className="px-4 pt-5 pb-3">
        <div className="flex items-center justify-between mb-1">
          <img src={CLUB_LOGO} alt="Logo PLCHB" className="h-12 w-12 object-contain" onClick={handleLogoTap} />
          <div className="flex flex-col items-center gap-1">
            <div style={{ color: COLORS.amber }} className="text-lg font-bold">
              {username}
            </div>
            <button
              onClick={logout}
              style={{ color: COLORS.amber, border: `1px solid ${COLORS.amber}` }}
              className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full"
            >
              <LogOut size={14} />
              Déconnexion
            </button>
          </div>
          <img src={CLUB_LOGO} alt="Logo PLCHB" className="h-12 w-12 object-contain" />
        </div>
      </div>

      {/* tabs */}
      <div className="flex px-4 pt-3 gap-1">
        {[
          ["matches", "Matchs"],
          ["leaderboard", "Classement"],
          ...(showAdminTab ? [["admin", "Admin"]] : []),
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              color: tab === key ? COLORS.ink : COLORS.paperDim,
              background: tab === key ? COLORS.amber : "transparent",
              border: tab === key ? "none" : `1px solid ${COLORS.line}`,
            }}
            className="relative flex-1 rounded py-2 text-sm font-medium"
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "matches" && notifPermission !== "granted" && typeof Notification !== "undefined" && (
        <div className="px-4 pt-2">
          <button
            onClick={requestNotifPermission}
            style={{ color: COLORS.paperDim, border: `1px solid ${COLORS.line}` }}
            className="w-full flex items-center justify-center gap-1.5 text-xs py-1.5 rounded"
          >
            <Bell size={13} />
            Activer les notifications pour les nouveaux matchs
          </button>
        </div>
      )}

      <div className="p-4 space-y-4 pb-40">
        {tab === "matches" && (
          <>
            <div className="flex gap-1 mb-1">
              {[
                ["all", "Tous les matchs"],
                ["mine", "Mes pronostics"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setMatchFilter(key)}
                  style={{
                    color: matchFilter === key ? COLORS.ink : COLORS.paperDim,
                    background: matchFilter === key ? COLORS.teal : "transparent",
                    border: matchFilter === key ? "none" : `1px solid ${COLORS.line}`,
                  }}
                  className="flex-1 rounded py-1.5 text-xs font-medium"
                >
                  {label}
                </button>
              ))}
            </div>

            {(() => {
              const visibleUpcoming = matchFilter === "mine" ? upcoming.filter((m) => myPrediction(m.id)) : upcoming;
              const visibleFinished = matchFilter === "mine" ? finished.filter((m) => myPrediction(m.id)) : finished;

              return (
                <>
                  {visibleUpcoming.length === 0 && visibleFinished.length === 0 && (
                    <EmptyState
                      text={
                        matchFilter === "mine"
                          ? "Tu n'as encore pronostiqué aucun match."
                          : "Aucun match programmé pour l'instant. Un admin peut en ajouter dans l'onglet Admin."
                      }
                    />
                  )}

                  {visibleUpcoming.length > 0 && (
                    <Section title="À venir">
                      {visibleUpcoming.map((m) => (
                        <MatchCard
                          key={m.id}
                          match={m}
                          locked={isLocked(m)}
                          myPred={myPrediction(m.id)}
                          bettorsCount={Object.keys(predictions).filter((key) => key.startsWith(`${m.id}__`)).length}
                          onSubmit={(h, a) => submitPrediction(m.id, h, a)}
                        />
                      ))}
                    </Section>
                  )}

                  {visibleFinished.length > 0 && (
                    <Section title="Terminés">
                      {visibleFinished.map((m) => (
                        <FinishedCard key={m.id} match={m} predictions={predictions} username={username} />
                      ))}
                    </Section>
                  )}
                </>
              );
            })()}
          </>
        )}

        {tab === "leaderboard" && (
          <Section title="Classement" titleColor={COLORS.amber}>
            <div className="flex gap-1 mb-1">
              {[
                ["weekend", "Cette semaine"],
                ["season", "Saison"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => {
                    setLbScope(key);
                    setShowLeaderboardModal(true);
                  }}
                  style={{
                    color: lbScope === key ? COLORS.ink : COLORS.paperDim,
                    background: lbScope === key ? COLORS.teal : "transparent",
                    border: lbScope === key ? "none" : `1px solid ${COLORS.line}`,
                  }}
                  className="flex-1 rounded py-1.5 text-xs font-medium"
                >
                  {label}
                </button>
              ))}
            </div>

            {lbScope === "weekend" && weekendKeys.length > 0 && (
              <select
                value={selectedWeekend || ""}
                onChange={(e) => setSelectedWeekend(e.target.value)}
                style={{ background: COLORS.ink2, color: COLORS.paper, border: `1px solid ${COLORS.line}` }}
                className="w-full rounded px-3 py-2 text-sm outline-none mb-1"
              >
                {weekendKeys.map((k) => (
                  <option key={k} value={k}>
                    {weekendLabelOf(k)}
                  </option>
                ))}
              </select>
            )}
          </Section>
        )}

        {tab === "admin" && !adminOn && (
          <div style={{ background: COLORS.ink2, border: `1px solid ${COLORS.line}` }} className="rounded p-5">
            <div className="flex items-center gap-2 mb-3">
              <Shield size={16} color={COLORS.amber} />
              <div style={{ color: COLORS.paper }} className="font-medium text-sm">
                Accès administrateur
              </div>
            </div>
            <div className="relative mb-2">
              <input
                type={showAdminInput ? "text" : "password"}
                value={adminInput}
                onChange={(e) => {
                  setAdminInput(e.target.value);
                  setAdminError(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (adminInput === ADMIN_PASS) setAdminOn(true);
                    else setAdminError(true);
                  }
                }}
                placeholder="Code admin"
                style={{ background: COLORS.ink, color: COLORS.paper, border: `1px solid ${COLORS.line}` }}
                className="w-full rounded px-3 py-2 pr-10 outline-none"
              />
              <button
                type="button"
                onClick={() => setShowAdminInput((v) => !v)}
                style={{ color: COLORS.paperDim }}
                className="absolute right-2 top-1/2 -translate-y-1/2"
                aria-label={showAdminInput ? "Masquer le code" : "Afficher le code"}
              >
                {showAdminInput ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {adminError && (
              <div style={{ color: COLORS.red }} className="text-xs mb-2">
                Code incorrect.
              </div>
            )}
            <button
              onClick={() => {
                if (adminInput === ADMIN_PASS) setAdminOn(true);
                else setAdminError(true);
              }}
              style={{ background: COLORS.amber, color: COLORS.ink }}
              className="w-full rounded py-2 font-semibold text-sm"
            >
              Déverrouiller
            </button>
            <p style={{ color: COLORS.paperDim }} className="text-xs mt-3">
              Réservé à la personne qui gère les matchs et saisit les résultats.
            </p>
          </div>
        )}

        {tab === "admin" && adminOn && (
          <>
            <Section title="Licenciés inscrits" titleColor={COLORS.amber}>
              <div style={{ background: COLORS.ink2, border: `1px solid ${COLORS.line}` }} className="rounded p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Users size={14} color={COLORS.amber} />
                  <span style={{ color: COLORS.paper }} className="text-sm font-medium">
                    {allLicencies.length} licencié{allLicencies.length > 1 ? "s" : ""}
                  </span>
                </div>
                {allLicencies.length === 0 ? (
                  <p style={{ color: COLORS.paperDim }} className="text-xs">
                    Personne ne s'est encore connecté à l'appli.
                  </p>
                ) : (
                  <div style={{ border: `1px solid ${COLORS.line}` }} className="rounded overflow-hidden">
                    {allLicencies.map((name, i) => (
                      <LicencieRow
                        key={name}
                        name={name}
                        pin={userPins[name]}
                        isLast={i === allLicencies.length - 1}
                        confirming={confirmingResetFor === name}
                        onStartReset={() => setConfirmingResetFor(name)}
                        onCancelReset={() => setConfirmingResetFor(null)}
                        onConfirmReset={() => resetPin(name)}
                        onRemove={() => removeLicencie(name)}
                      />
                    ))}
                  </div>
                )}
                <p style={{ color: COLORS.paperDim }} className="text-xs mt-2">
                  Supprimer un licencié efface aussi ses pronostics déjà enregistrés.
                </p>
              </div>
            </Section>

            <Section title="Attribuer des points (classement général)" titleColor={COLORS.amber}>
              <div style={{ background: COLORS.ink2, border: `1px solid ${COLORS.line}` }} className="rounded p-4 space-y-2">
                <div className="flex gap-2">
                  <input
                    value={bonusNameInput}
                    onChange={(e) => setBonusNameInput(e.target.value)}
                    placeholder="prénom nom du licencié"
                    style={{ background: COLORS.ink, color: COLORS.paper, border: `1px solid ${COLORS.line}` }}
                    className="flex-1 rounded px-3 py-2 text-sm outline-none"
                  />
                  <input
                    value={bonusPointsInput}
                    onChange={(e) => setBonusPointsInput(e.target.value)}
                    type="number"
                    placeholder="points"
                    style={{ background: COLORS.ink, color: COLORS.paper, border: `1px solid ${COLORS.line}` }}
                    className="w-24 rounded px-3 py-2 text-sm outline-none"
                  />
                </div>
                <button
                  onClick={async () => {
                    const pts = Number(bonusPointsInput);
                    if (!bonusNameInput.trim() || !Number.isFinite(pts) || pts === 0) return;
                    await addBonusPoints(bonusNameInput, pts);
                    setBonusNameInput("");
                    setBonusPointsInput("");
                  }}
                  style={{ background: COLORS.amber, color: COLORS.ink }}
                  className="w-full rounded py-2 text-sm font-semibold flex items-center justify-center gap-1"
                >
                  <Plus size={14} /> Attribuer les points
                </button>
                <p style={{ color: COLORS.paperDim }} className="text-xs">
                  Si le licencié n'existe pas encore, il est créé automatiquement. Les points s'ajoutent uniquement au classement général (pas au classement de la semaine). Un nombre négatif retire des points.
                </p>
              </div>

              {Object.keys(bonusPoints).length > 0 && (
                <div style={{ background: COLORS.ink2, border: `1px solid ${COLORS.line}` }} className="rounded overflow-hidden mt-2">
                  {Object.entries(bonusPoints).map(([name, pts], i, arr) => (
                    <div
                      key={name}
                      style={{ borderBottom: i === arr.length - 1 ? "none" : `1px solid ${COLORS.line}` }}
                      className="flex items-center justify-between px-3 py-2"
                    >
                      <div style={{ color: COLORS.paper }} className="text-sm">
                        {name}
                      </div>
                      <div className="flex items-center gap-3">
                        <span style={{ color: COLORS.amber, fontFamily: "Oswald, sans-serif" }} className="text-sm font-semibold">
                          {pts >= 0 ? `+${pts}` : pts}
                        </span>
                        <button onClick={() => resetBonusPoints(name)} style={{ color: COLORS.red }} aria-label={`Retirer les points bonus de ${name}`}>
                          <X size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section title="Ajouter un match" titleColor={COLORS.amber}>
              <div style={{ background: COLORS.ink2, border: `1px solid ${COLORS.line}` }} className="rounded p-4 space-y-2">
                <div className="flex gap-2">
                  <input
                    value={newHome}
                    onChange={(e) => setNewHome(e.target.value)}
                    placeholder="Équipe recevante"
                    style={{ background: COLORS.ink, color: COLORS.paper, border: `1px solid ${COLORS.line}` }}
                    className="flex-1 rounded px-3 py-2 text-sm outline-none"
                  />
                  <input
                    value={newAway}
                    onChange={(e) => setNewAway(e.target.value)}
                    placeholder="Équipe visiteuse"
                    style={{ background: COLORS.ink, color: COLORS.paper, border: `1px solid ${COLORS.line}` }}
                    className="flex-1 rounded px-3 py-2 text-sm outline-none"
                  />
                </div>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  style={{ background: COLORS.ink, color: COLORS.paper, border: `1px solid ${COLORS.line}` }}
                  className="w-full rounded px-3 py-2 text-sm outline-none"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <input
                  type="datetime-local"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  style={{ background: COLORS.ink, color: COLORS.paper, border: `1px solid ${COLORS.line}` }}
                  className="w-full rounded px-3 py-2 text-sm outline-none"
                />
                {addMatchError && (
                  <div style={{ color: COLORS.red }} className="text-xs">
                    Renseigne les deux équipes et la date/heure avant d'ajouter le match.
                  </div>
                )}
                <button
                  onClick={addMatch}
                  style={{ background: COLORS.teal, color: COLORS.paper }}
                  className="w-full rounded py-2 text-sm font-semibold flex items-center justify-center gap-1"
                >
                  <Plus size={14} /> Ajouter le match
                </button>
              </div>
            </Section>

            <Section title="Matchs à venir" titleColor={COLORS.amber}>
              {upcoming.length === 0 && <EmptyState text="Aucun match à venir." />}
              {upcoming.map((m) => (
                <AdminMatchRow key={m.id} match={m} onResult={setResult} onRemove={removeMatch} onEdit={editMatch} />
              ))}
            </Section>

            <Section title="Matchs terminés" titleColor={COLORS.amber}>
              {finished.length === 0 && <EmptyState text="Aucun résultat saisi." />}
              {finished.map((m) => (
                <div
                  key={m.id}
                  style={{ background: COLORS.ink2, border: `1px solid ${COLORS.line}` }}
                  className="rounded p-3 flex items-center justify-between mb-2"
                >
                  <div style={{ color: COLORS.paper }} className="text-sm">
                    {m.home} <span style={{ color: COLORS.amber }} className="font-semibold tabular-nums">{m.scoreH} - {m.scoreA}</span> {m.away}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => reopenMatch(m.id)} style={{ color: COLORS.paperDim }} className="text-xs underline">
                      Rouvrir
                    </button>
                    <button onClick={() => removeMatch(m.id)} style={{ color: COLORS.red }} className="text-xs underline">
                      Supprimer
                    </button>
                  </div>
                </div>
              ))}
            </Section>
          </>
        )}
      </div>

      {showLeaderboardModal && (
        <div
          onClick={() => setShowLeaderboardModal(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 60 }}
          className="flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: COLORS.paper, border: "1px solid #E2E2E2" }}
            className="w-[95vw] max-w-3xl rounded p-6 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-3">
              <div style={{ fontFamily: "Oswald, sans-serif", color: COLORS.ink }} className="text-2xl font-semibold">
                {lbScope === "season" ? "Classement général" : "Classement de la semaine"}
              </div>
              <button
                onClick={() => setShowLeaderboardModal(false)}
                style={{ color: COLORS.ink }}
                aria-label="Fermer le classement"
              >
                <X size={18} />
              </button>
            </div>

            {lbScope === "season" && (
              <button
                onClick={() => window.print()}
                style={{ color: "#6B7280", border: "1px solid #E2E2E2" }}
                className="no-print w-full flex items-center justify-center gap-1.5 text-xs py-1.5 rounded mb-1"
              >
                <Download size={13} />
                Télécharger le classement général en PDF
              </button>
            )}

            <div className={lbScope === "season" ? "print-leaderboard" : ""}>
              {lbScope === "season" && (
                <div style={{ fontFamily: "Oswald, sans-serif", color: COLORS.ink }} className="text-base font-semibold mb-2">
                  Classement général — PLCHB Pronostic
                </div>
              )}
              {leaderboard.length === 0 ? (
                <EmptyState
                  text={
                    lbScope === "weekend"
                      ? "Aucun résultat saisi pour cette semaine pour l'instant."
                      : "Le classement apparaîtra dès qu'un match sera terminé et pronostiqué."
                  }
                />
              ) : (
                <div style={{ background: "#FFFFFF", border: "1px solid #E2E2E2" }} className="rounded overflow-hidden">
                  {leaderboard.map((row, i) => (
                    <div
                      key={row.user}
                      style={{
                        borderBottom: i === leaderboard.length - 1 ? "none" : "1px solid #E2E2E2",
                        background: COLORS.paper,
                      }}
                      className="flex items-center px-4 py-3 gap-3"
                    >
                      <div
                        style={{
                          width: 32,
                          height: 40,
                          position: "relative",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {i === 0 && lbScope === "season" && (
                          <Crown
                            size={16}
                            color="#B8860B"
                            style={{ position: "absolute", top: -8, left: "50%", transform: "translateX(-50%)" }}
                          />
                        )}
                        <span
                          style={{ fontFamily: "Oswald, sans-serif", color: COLORS.ink }}
                          className="text-lg font-semibold"
                        >
                          {i + 1}
                        </span>
                      </div>
                      <div className="flex-1">
                        <div style={{ color: COLORS.ink }} className="font-medium text-sm">
                          {row.user}
                        </div>
                        <div style={{ color: "#6B7280" }} className="text-xs">
                          {row.played} pronostic{row.played > 1 ? "s" : ""} · {row.exact} exact{row.exact > 1 ? "s" : ""}
                          {row.bonus ? ` · ${row.bonus >= 0 ? `+${row.bonus}` : row.bonus} bonus` : ""}
                        </div>
                      </div>
                      <div style={{ width: 90, whiteSpace: "nowrap" }} className="shrink-0">
                        <span
                          style={{ fontFamily: "Oswald, sans-serif", color: COLORS.ink, width: 50 }}
                          className="text-lg font-semibold tabular-nums text-right inline-block"
                        >
                          {row.points}
                        </span>
                        {lbScope === "season" && i > 0 && leaderboard[0].points - row.points > 0 && (
                          <span style={{ color: "#6B7280", fontSize: "0.7em" }} className="ml-1">
                            (-{leaderboard[0].points - row.points})
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <p style={{ color: "#6B7280" }} className="text-xs mt-3">
                Barème : score exact = 10 pts · bon vainqueur et bonne différence de buts = 5 pts · bon vainqueur = 2 pts · pronostic faux = 0 pt.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* bande boutique du club */}
      <a
        href="https://www.helloasso.com/associations/plaisir-les-clayes-handball/boutiques/boutique-plaisir-les-clayes-hb"
        target="_blank"
        rel="noopener noreferrer"
        style={{ background: COLORS.amber, borderTop: `1px solid ${COLORS.line}` }}
        className="fixed bottom-0 left-0 right-0 flex items-center justify-center py-3"
      >
        <span style={{ fontFamily: "Oswald, sans-serif", color: COLORS.ink, letterSpacing: "0.04em" }} className="text-xl font-semibold uppercase">
          Ici, votre boutique du club
        </span>
      </a>
    </div>
  );
}

function Section({ title, titleColor = COLORS.paperDim, children }) {
  return (
    <div>
      <div
        style={{ fontFamily: "Oswald, sans-serif", color: titleColor, letterSpacing: "0.08em" }}
        className="text-[11px] uppercase mb-2"
      >
        {title}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function HandExpertBanner() {
  return (
    <div
      style={{ position: "fixed", top: 4, left: 0, right: 0, background: COLORS.paper, borderBottom: `1px solid ${COLORS.line}`, zIndex: 49 }}
      className="flex items-center justify-center py-1.5"
    >
      <a href="https://www.hand-expert.fr" target="_blank" rel="noopener noreferrer">
        <img src={HAND_EXPERT_LOGO} alt="Hand Expert" className="h-9 object-contain" />
      </a>
    </div>
  );
}

function EmptyState({ text }) {
  return (
    <div style={{ background: COLORS.ink2, border: `1px dashed ${COLORS.line}`, color: COLORS.paperDim }} className="rounded p-4 text-sm">
      {text}
    </div>
  );
}

function LicencieRow({ name, pin, isLast, confirming, onStartReset, onCancelReset, onConfirmReset, onRemove }) {
  return (
    <div
      style={{ background: COLORS.ink, borderBottom: isLast ? "none" : `1px solid ${COLORS.line}` }}
      className="flex items-center justify-between gap-2 px-3 py-2"
    >
      <div className="min-w-0">
        <div style={{ color: COLORS.paper }} className="text-sm truncate">
          {name}
        </div>
        <div style={{ color: COLORS.paperDim, fontFamily: "Oswald, sans-serif" }} className="text-xs tracking-wide">
          {pin ? `Code : ${pin}` : "Pas encore de code"}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {confirming ? (
          <>
            <span style={{ color: COLORS.paperDim }} className="text-xs">
              Confirmer ?
            </span>
            <button onClick={onConfirmReset} style={{ color: COLORS.green }} className="text-xs font-semibold underline">
              Oui
            </button>
            <button onClick={onCancelReset} style={{ color: COLORS.paperDim }} className="text-xs underline">
              Annuler
            </button>
          </>
        ) : (
          <>
            {pin && (
              <button onClick={onStartReset} style={{ color: COLORS.teal }} className="text-xs underline">
                Réinitialiser le code
              </button>
            )}
            <button onClick={onRemove} style={{ color: COLORS.red }} aria-label={`Supprimer ${name}`} className="flex items-center">
              <X size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function MatchCard({ match, locked, myPred, bettorsCount, onSubmit }) {
  const [h, setH] = useState(myPred?.h ?? "");
  const [a, setA] = useState(myPred?.a ?? "");

  useEffect(() => {
    if (myPred) {
      setH(myPred.h);
      setA(myPred.a);
    }
  }, [myPred]);

  const isSaved = myPred && h !== "" && a !== "" && Number(h) === myPred.h && Number(a) === myPred.a;

  return (
    <div style={{ background: COLORS.ink2, border: `1px solid ${COLORS.line}` }} className="rounded p-4">
      <div className="flex items-center justify-between mb-2">
        <div style={{ color: COLORS.paper }} className="text-xs">
          {fmtDate(match.date)}
        </div>
        <CategoryBadge category={match.category} />
      </div>
      <div className="flex items-center gap-2">
        <div style={{ color: COLORS.paper }} className="flex-1 text-sm font-medium">
          {match.home}
        </div>
        <ScoreInput value={h} onChange={setH} disabled={locked} />
        <span style={{ color: COLORS.paperDim }}>-</span>
        <ScoreInput value={a} onChange={setA} disabled={locked} />
        <div style={{ color: COLORS.paper }} className="flex-1 text-sm font-medium text-right">
          {match.away}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between">
        {locked ? (
          <div style={{ color: COLORS.paperDim }} className="text-xs flex items-center gap-1">
            <Lock size={12} /> Pronostics clos
          </div>
        ) : (
          <div style={{ color: COLORS.paperDim }} className="text-xs">
            {myPred ? "Pronostic enregistré" : "Pas encore de pronostic"}
          </div>
        )}
        {!locked && (
          <button
            onClick={() => onSubmit(h, a)}
            disabled={h === "" || a === ""}
            style={{
              background: h === "" || a === "" ? COLORS.line : isSaved ? COLORS.green : COLORS.amber,
              color: h === "" || a === "" ? COLORS.paperDim : isSaved ? COLORS.paper : COLORS.ink,
            }}
            className="rounded px-3 py-1.5 text-xs font-semibold flex items-center gap-1"
          >
            <Check size={13} /> {isSaved ? "Validé" : "Valider"}
          </button>
        )}
      </div>
      <div style={{ color: COLORS.paperDim }} className="mt-2 text-xs flex items-center gap-1">
        <Users size={12} />
        {bettorsCount > 0
          ? `${bettorsCount} licencié${bettorsCount > 1 ? "s ont" : " a"} déjà parié`
          : "Personne n'a encore parié"}
      </div>
    </div>
  );
}

function CategoryBadge({ category }) {
  if (!category) return null;
  return (
    <span
      style={{
        color: COLORS.amber,
        border: `1px solid ${COLORS.amber}`,
        fontFamily: "Oswald, sans-serif",
        letterSpacing: "0.04em",
      }}
      className="text-[10px] uppercase px-2 py-0.5 rounded-full"
    >
      {category}
    </span>
  );
}

function ScoreInput({ value, onChange, disabled }) {
  return (
    <input
      type="number"
      min="0"
      inputMode="numeric"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value === "" ? "" : Math.max(0, Number(e.target.value)))}
      style={{
        background: COLORS.ink,
        color: COLORS.paper,
        border: `1px solid ${COLORS.amber}`,
        fontFamily: "Oswald, sans-serif",
        opacity: disabled ? 0.5 : 1,
        textAlign: "center",
      }}
      className="w-12 text-center rounded py-1.5 text-lg font-semibold tabular-nums outline-none"
    />
  );
}

function FinishedCard({ match, predictions, username }) {
  const myKey = `${match.id}__${username}`;
  const mine = predictions[myKey];
  const myPts = mine ? computePoints(mine.h, mine.a, match.scoreH, match.scoreA) : null;

  const others = Object.entries(predictions)
    .filter(([key]) => key.startsWith(`${match.id}__`))
    .map(([key, pred]) => {
      const user = key.split("__")[1];
      return { user, pred, pts: computePoints(pred.h, pred.a, match.scoreH, match.scoreA) };
    })
    .sort((a, b) => b.pts - a.pts);

  return (
    <div style={{ background: COLORS.ink2, border: `1px solid ${COLORS.line}` }} className="rounded p-4">
      <div className="flex items-center justify-between mb-2">
        <div style={{ color: COLORS.paper }} className="text-xs">
          {fmtDate(match.date)}
        </div>
        <CategoryBadge category={match.category} />
      </div>
      <div className="flex items-center justify-center gap-3 mb-3">
        <div style={{ color: COLORS.paper }} className="text-sm font-medium">
          {match.home}
        </div>
        <div style={{ fontFamily: "Oswald, sans-serif", color: COLORS.amber }} className="text-2xl font-semibold tabular-nums">
          {match.scoreH} - {match.scoreA}
        </div>
        <div style={{ color: COLORS.paper }} className="text-sm font-medium">
          {match.away}
        </div>
      </div>

      {mine && (
        <div style={{ background: "rgba(255,176,32,0.08)", border: `1px solid ${COLORS.line}` }} className="rounded p-2 mb-2 flex items-center justify-between">
          <span style={{ color: COLORS.paper }} className="text-xs">
            Ton pronostic : {mine.h} - {mine.a}
          </span>
          <span style={{ color: COLORS.amber, fontFamily: "Oswald, sans-serif" }} className="text-sm font-semibold">
            +{myPts} pts
          </span>
        </div>
      )}

      {others.length > 0 && (
        <details>
          <summary style={{ color: COLORS.paperDim }} className="text-xs cursor-pointer flex items-center gap-1">
            <Users size={12} /> Voir tous les pronostics ({others.length})
          </summary>
          <div className="mt-2 space-y-1">
            {others.map(({ user, pred, pts }) => (
              <div key={user} className="flex items-center justify-between text-xs">
                <span style={{ color: COLORS.paperDim }}>
                  <span style={{ color: COLORS.amber }} className="font-bold">
                    {user}
                  </span>{" "}
                  · {pred.h}-{pred.a}
                </span>
                <span style={{ color: pts === 10 ? COLORS.amber : pts >= 2 ? COLORS.teal : COLORS.paperDim }}>
                  +{pts}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function AdminMatchRow({ match, onResult, onRemove, onEdit }) {
  const [h, setH] = useState("");
  const [a, setA] = useState("");
  const [editing, setEditing] = useState(false);
  const [editHome, setEditHome] = useState(match.home);
  const [editAway, setEditAway] = useState(match.away);
  const [editDate, setEditDate] = useState(toLocalInputValue(match.date));

  const startEdit = () => {
    setEditHome(match.home);
    setEditAway(match.away);
    setEditDate(toLocalInputValue(match.date));
    setEditing(true);
  };

  const saveEdit = () => {
    if (!editHome.trim() || !editAway.trim() || !editDate) return;
    onEdit(match.id, {
      home: editHome.trim(),
      away: editAway.trim(),
      date: new Date(editDate).toISOString(),
    });
    setEditing(false);
  };

  if (editing) {
    return (
      <div style={{ background: COLORS.ink2, border: `1px solid ${COLORS.amber}` }} className="rounded p-3 mb-2 space-y-2">
        <div className="flex gap-2">
          <input
            value={editHome}
            onChange={(e) => setEditHome(e.target.value)}
            style={{ background: COLORS.ink, color: COLORS.paper, border: `1px solid ${COLORS.line}` }}
            className="flex-1 rounded px-3 py-2 text-sm outline-none"
          />
          <input
            value={editAway}
            onChange={(e) => setEditAway(e.target.value)}
            style={{ background: COLORS.ink, color: COLORS.paper, border: `1px solid ${COLORS.line}` }}
            className="flex-1 rounded px-3 py-2 text-sm outline-none"
          />
        </div>
        <input
          type="datetime-local"
          value={editDate}
          onChange={(e) => setEditDate(e.target.value)}
          style={{ background: COLORS.ink, color: COLORS.paper, border: `1px solid ${COLORS.line}` }}
          className="w-full rounded px-3 py-2 text-sm outline-none"
        />
        <div className="flex gap-2">
          <button
            onClick={() => setEditing(false)}
            style={{ background: COLORS.ink, color: COLORS.paperDim, border: `1px solid ${COLORS.line}` }}
            className="flex-1 rounded py-1.5 text-xs font-semibold"
          >
            Annuler
          </button>
          <button
            onClick={saveEdit}
            style={{ background: COLORS.amber, color: COLORS.ink }}
            className="flex-1 rounded py-1.5 text-xs font-semibold flex items-center justify-center gap-1"
          >
            <Check size={13} /> Enregistrer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: COLORS.ink2, border: `1px solid ${COLORS.line}` }} className="rounded p-3 mb-2">
      <div className="flex items-center justify-between mb-2">
        <div style={{ color: COLORS.paper }} className="text-sm">
          {match.home} <span style={{ color: COLORS.paperDim }}>vs</span> {match.away}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={startEdit} style={{ color: COLORS.teal }} aria-label="Modifier le match">
            <Pencil size={14} />
          </button>
          <button onClick={() => onRemove(match.id)} style={{ color: COLORS.red }} aria-label="Supprimer le match">
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between mb-2">
        <div style={{ color: COLORS.paper }} className="text-xs">
          {fmtDate(match.date)}
        </div>
        <CategoryBadge category={match.category} />
      </div>
      <div className="flex items-center gap-2">
        <ScoreInput value={h} onChange={setH} />
        <span style={{ color: COLORS.paperDim }}>-</span>
        <ScoreInput value={a} onChange={setA} />
        <button
          onClick={() => h !== "" && a !== "" && onResult(match.id, h, a)}
          disabled={h === "" || a === ""}
          style={{
            background: h === "" || a === "" ? COLORS.line : COLORS.teal,
            color: COLORS.paper,
          }}
          className="ml-auto rounded px-3 py-1.5 text-xs font-semibold flex items-center gap-1"
        >
          <ChevronRight size={13} /> Clôturer
        </button>
      </div>
    </div>
  );
}
