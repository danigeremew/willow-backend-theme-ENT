#!/usr/bin/env python3
"""Generate willow_backend_theme_ent POT/PO files from source strings.

Seeds msgstr from Kraken + Pine where msgid matches, then applies MANUAL
overrides for Willow-unique copy. Emits mandatory Odoo markers:
  #. odoo-javascript / odoo-python
  #: code:addons/willow_backend_theme_ent/...:0
"""

from __future__ import annotations

import re
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
REPO = BASE.parent.parent.parent  # odoo_themes/
KRAKEN_I18N = REPO / "custom_addons/kraken_backend_theme/kraken_backend_theme/i18n"
PINE_I18N = REPO / "custom_addons/pine-backend-theme/pine_backend_theme/i18n"
OUT = Path(__file__).resolve().parent
MODULE = "willow_backend_theme_ent"

entries: dict[str, list[tuple[str, str]]] = {}

JS_FILES = [
    "static/src/webclient/shell/global_shell.js",
    "static/src/dashboard/operations_dashboard_action.js",
    "static/src/theme_settings/components/theme_settings.js",
    "static/src/theme_settings/presets/presets.js",
]

XML_FILES = [
    "static/src/dashboard/operations_dashboard_action.xml",
    "static/src/theme_settings/templates/theme_settings.xml",
]

PY_FILES = [
    "models/willow_dashboard_widgets.py",
    "models/theme_settings.py",
    "models/res_users_dashboard.py",
]

LANG_FILES = ("ar", "de", "es", "fr", "hi_IN", "pt_BR", "zh_CN")

SKIP_XML_TEXT = re.compile(
    r"^(fa |wl_|tt_|o_|is-|btn|col-|row |d-|m-|p-|flex|grid|#|"
    r"[\d\s.%·•\-_/]+)$"
)


def add(msgid: str, ref_type: str, ref_path: str) -> None:
    msgid = (msgid or "").strip()
    if not msgid or len(msgid) < 2:
        return
    if msgid.startswith("#") and len(msgid) in (4, 7):
        return  # hex colors
    if msgid.startswith(("wl_", "tt_", "o_", "fa ")):
        return
    if re.fullmatch(r"[\d\s.%·•\-_/]+", msgid):
        return
    entries.setdefault(msgid, [])
    ref = (ref_type, ref_path)
    if ref not in entries[msgid]:
        entries[msgid].append(ref)


def escape_po(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def scan_sources() -> None:
    for rel in PY_FILES:
        path = BASE / rel
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        for match in re.finditer(r'_\(\s*["\']([^"\']+)["\']', text):
            add(match.group(1), "python", rel)

    for rel in JS_FILES:
        path = BASE / rel
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        for match in re.finditer(r'_t\(\s*["\']([^"\']+)["\']', text):
            add(match.group(1), "js", rel)
        # Preset / color-field English source strings (translated at call time).
        if rel.endswith("presets.js"):
            for match in re.finditer(r'(?:label|description):\s*"([^"]+)"', text):
                add(match.group(1), "js", rel)
            for match in re.finditer(r'\["[^"]+",\s*"([^"]+)",\s*"([^"]+)"\]', text):
                add(match.group(1), "js", rel)
                add(match.group(2), "js", rel)
        if rel.endswith("operations_dashboard_action.js"):
            for label in re.findall(
                r'^\s+(?:sale|crm|purchase|stock|account|project|hr|mrp|website|discuss|mail):\s*"([^"]+)"',
                text,
                re.M,
            ):
                add(label, "js", rel)

    for rel in XML_FILES:
        path = BASE / rel
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        for match in re.finditer(r">([^<>{}\n]+)<", text):
            raw = match.group(1).strip()
            if not raw or SKIP_XML_TEXT.match(raw):
                continue
            if raw.startswith("&") or "{{" in raw:
                continue
            add(raw, "xml", rel)
        for attr in ("aria-label", "placeholder", "title"):
            for match in re.finditer(rf'{attr}="([^"]+)"', text):
                add(match.group(1), "xml", rel)

    add("Dashboard", "model", "views/willow_dashboard_action.xml")


def format_entry(msgid: str, refs: list[tuple[str, str]], msgstr: str = "") -> str:
    lines = [f"#. module: {MODULE}"]
    for ref_type, ref_path in refs:
        if ref_type == "model":
            lines.append(f"#: model:ir.ui.menu,name:{MODULE}.menu_willow_dashboard")
            lines.append(f"#: model:ir.actions.client,name:{MODULE}.action_willow_dashboard")
        elif ref_type == "python":
            lines.append("#. odoo-python")
            lines.append(f"#: code:addons/{MODULE}/{ref_path}:0")
        else:
            lines.append("#. odoo-javascript")
            lines.append(f"#: code:addons/{MODULE}/{ref_path}:0")
    if "%(" in msgid:
        lines.append("#, python-format")
    lines.append(f'msgid "{escape_po(msgid)}"')
    lines.append(f'msgstr "{escape_po(msgstr)}"')
    lines.append("")
    return "\n".join(lines)


HEADER = f'''# Translation of Odoo Server.
# This file contains the translation of the following modules:
# \t* {MODULE}
#
msgid ""
msgstr ""
"Project-Id-Version: Odoo Server 17.0\\n"
"Report-Msgid-Bugs-To: \\n"
"POT-Creation-Date: 2026-07-27 12:00+0000\\n"
"PO-Revision-Date: 2026-07-27 12:00+0000\\n"
"Last-Translator: \\n"
"Language-Team: \\n"
"MIME-Version: 1.0\\n"
"Content-Type: text/plain; charset=UTF-8\\n"
"Content-Transfer-Encoding: \\n"
"Plural-Forms: \\n"

'''

# Willow-unique / high-visibility strings. Keys = English msgid.
# Seeded langs: fr, es, de, pt_BR, ar, hi_IN, zh_CN.
MANUAL: dict[str, dict[str, str]] = {
    "fr": {
        "Dashboard": "Tableau de bord",
        "Hi,": "Bonjour,",
        "Your open work at a glance": "Votre travail ouvert en un coup d'œil",
        "Spreadsheet Dashboard": "Tableau de bord tableur",
        "Retry": "Réessayer",
        "Due today": "Pour aujourd'hui",
        "Overdue": "En retard",
        "This week": "Cette semaine",
        "Waiting on you": "En attente de vous",
        "Open activities": "Activités ouvertes",
        "Scheduled for today": "Planifié pour aujourd'hui",
        "Past due date": "Date d'échéance dépassée",
        "Due in the next 7 days": "Échéance dans les 7 prochains jours",
        "Approvals and items needing your decision": "Approbations et éléments nécessitant votre décision",
        "Assigned to you right now": "Assignées à vous maintenant",
        "Nothing else due this week": "Rien d'autre à échéance cette semaine",
        "You're caught up": "Vous êtes à jour",
        "Needs your review": "Nécessite votre revue",
        "Inbox clear": "Boîte de réception vide",
        "Unread": "Non lus",
        "Meetings today": "Réunions aujourd'hui",
        "Last 6 weeks": "6 dernières semaines",
        "Last 12 weeks": "12 dernières semaines",
        "Your activity over time": "Votre activité dans le temps",
        "Due and overdue activity trend": "Tendance des activités dues et en retard",
        "Quotations to send": "Devis à envoyer",
        "Orders to process": "Commandes à traiter",
        "Leads assigned to me": "Pistes qui me sont assignées",
        "RFQs in draft": "Demandes de prix en brouillon",
        "Transfers ready": "Transferts prêts",
        "Unpaid customer invoices": "Factures clients impayées",
        "Tasks due this week": "Tâches à échéance cette semaine",
        "Sales": "Ventes",
        "CRM": "CRM",
        "Purchase": "Achats",
        "Inventory": "Inventaire",
        "Accounting": "Comptabilité",
        "Project": "Projet",
        "HR": "RH",
        "Contacts": "Contacts",
        "Finance": "Finance",
        "Operations": "Opérations",
        "Manufacturing": "Fabrication",
        "Website": "Site web",
        "Workspace": "Espace de travail",
        "Activity": "Activité",
        "Meeting": "Réunion",
        "My activities": "Mes activités",
        "My calendar": "Mon calendrier",
        "Discuss inbox": "Boîte de discussion",
        "Settings": "Paramètres",
        "Total Receivables": "Total des créances",
        "Total Payables": "Total des dettes",
        "Total Sales (This Month)": "Ventes totales (ce mois)",
        "Cash in Hand": "Liquidités",
        "Open Purchase Orders": "Bons de commande ouverts",
        "Top Items in Inventory": "Principaux articles en stock",
        "Recent Transactions": "Transactions récentes",
        "Needs attention": "Nécessite une attention",
        "Open work queues by app": "Files de travail ouvertes par application",
        "Open items by app": "Éléments ouverts par application",
        "What you still need to handle": "Ce qu'il vous reste à traiter",
        "My activities": "Mes activités",
        "Next on your list": "Prochain sur votre liste",
        "Today": "Aujourd'hui",
        "Assigned": "Assigné",
        "View all activities": "Voir toutes les activités",
        "Recent items": "Éléments récents",
        "Your apps": "Vos applications",
        "See all apps": "Voir toutes les applications",
        "Upcoming": "À venir",
        "No activities assigned to you": "Aucune activité ne vous est assignée",
        "Could not load your dashboard data. Try refreshing the page.": "Impossible de charger les données du tableau de bord. Essayez d'actualiser la page.",
        "Enterprise Resource Planning": "Progiciel de gestion intégré",
        "Willow Theme Settings": "Paramètres du thème Willow",
        "Theme Settings": "Paramètres du thème",
        "Appearance": "Apparence",
        "Colors": "Couleurs",
        "Branding": "Image de marque",
        "Advanced": "Avancé",
        "Show dashboard menu": "Afficher le menu Tableau de bord",
        "Color mode": "Mode couleur",
        "Light": "Clair",
        "Dark": "Sombre",
        "System": "Système",
        "Updated": "Mis à jour",
        "Jobs:": "Tâches :",
        "Mail queue:": "File mail :",
        "Users": "Utilisateurs",
        "Developer mode": "Mode développeur",
        "Administrator": "Administrateur",
        "Access Rights": "Droits d'accès",
        "Internal User": "Utilisateur interne",
        "Portal User": "Utilisateur portail",
        "Production": "Production",
        "Staging": "Préproduction",
        "Development": "Développement",
        "Sales Invoice": "Facture client",
        "Credit Note": "Avoir",
        "Vendor Bill": "Facture fournisseur",
        "Vendor Refund": "Remboursement fournisseur",
        "Journal Entry": "Écriture comptable",
        "Sales Order": "Commande client",
        "Purchase Order": "Bon de commande",
        "Posted": "Comptabilisé",
        "Unpaid": "Impayé",
        "Partial": "Partiel",
        "In Payment": "En paiement",
        "Paid": "Payé",
        "Reversed": "Extourné",
        "Cancelled": "Annulé",
        "Quotation": "Devis",
        "Sent": "Envoyé",
        "Confirmed": "Confirmé",
        "Done": "Terminé",
        "RFQ": "Demande de prix",
        "RFQ Sent": "Demande de prix envoyée",
        "To Approve": "À approuver",
        "Willow": "Willow",
        "Indigo": "Indigo",
        "Forest": "Forêt",
        "Sunset": "Coucher de soleil",
        "Ocean": "Océan",
        "Slate": "Ardoise",
        "Deep blue and cool neutrals": "Bleu profond et neutres froids",
        "Focused and technical": "Focalisé et technique",
        "Calm operational green": "Vert opérationnel apaisant",
        "Warm orange and plum": "Orange chaud et prune",
        "Teal and ocean blue": "Sarcelle et bleu océan",
        "Neutral enterprise palette": "Palette entreprise neutre",
        "Primary": "Primaire",
        "Dashboard primary": "Primaire du tableau de bord",
        "Hero base": "Base du hero",
        "Hero mid-tone": "Teinte moyenne du hero",
        "Content canvas": "Toile de contenu",
        "Card surface": "Surface des cartes",
        "Card border": "Bordure des cartes",
        "Header text": "Texte d'en-tête",
        "Header muted text": "Texte d'en-tête atténué",
        "Body text": "Texte du corps",
        "Muted text": "Texte atténué",
        "Success": "Succès",
        "Information": "Information",
        "Warning": "Avertissement",
        "Danger": "Danger",
        "You are up to date. Nothing overdue right now.": "Vous êtes à jour. Rien en retard pour le moment.",
        "Discard theme changes?": "Annuler les modifications du thème ?",
        "Reset Willow theme?": "Réinitialiser le thème Willow ?",
        "All Apps": "Toutes les applications",
        "Search applications...": "Rechercher des applications...",
        "Search anything here": "Recherchez ici",
        "Switch to light mode": "Passer en mode clair",
        "Switch to dark mode": "Passer en mode sombre",
        "Add to favorites": "Ajouter aux favoris",
        "Remove from favorites": "Retirer des favoris",
        "Open work queues by app": "Files de travail ouvertes par application",
    },
        "%(app)s has the most open items (%(count)s).": "%(app)s a le plus d'éléments ouverts (%(count)s).",
        "%(due)s of %(week)s this week": "%(due)s sur %(week)s cette semaine",
        "%(overdue)s overdue · %(today)s today": "%(overdue)s en retard · %(today)s aujourd'hui",
        "%(pct)s%% of your open work": "%(pct)s%% de votre travail ouvert",
        "%(today)s today · %(upcoming)s upcoming": "%(today)s aujourd'hui · %(upcoming)s à venir",
        "Attention items": "Éléments prioritaires",
        "Avg. Order Value": "Valeur moyenne des commandes",
        "Brand assets": "Éléments de marque",
        "Business overview": "Vue d'ensemble métier",
        "Close": "Fermer",
        "Conversion Rate": "Taux de conversion",
        "Deadlines": "Échéances",
        "Discard": "Annuler",
        "Due": "Dû",
        "Due and overdue by day": "Dû et en retard par jour",
        "Empty": "Vide",
        "Export settings": "Exporter les paramètres",
        "Import settings": "Importer les paramètres",
        "Interface palette": "Palette d'interface",
        "Live": "En direct",
        "Loading theme settings…": "Chargement des paramètres du thème…",
        "No activities": "Aucune activité",
        "No apps": "Aucune application",
        "No apps available": "Aucune application disponible",
        "No recent items": "Aucun élément récent",
        "No recent items yet": "Pas encore d'éléments récents",
        "No recent transactions": "Aucune transaction récente",
        "No stock on hand": "Aucun stock disponible",
        "No upcoming events": "Aucun événement à venir",
        "Open calendar": "Ouvrir le calendrier",
        "Orders": "Commandes",
        "Overdue Activities": "Activités en retard",
        "Preset themes": "Thèmes prédéfinis",
        "Records you updated lately": "Enregistrements récemment mis à jour",
        "Reset theme": "Réinitialiser le thème",
        "Semantic colors": "Couleurs sémantiques",
        "Theme configuration": "Configuration du thème",
        "You have %(count)s activities due today.": "Vous avez %(count)s activités pour aujourd'hui.",
        "You have %(count)s activity due today.": "Vous avez %(count)s activité pour aujourd'hui.",
        "You have %(count)s overdue activities.": "Vous avez %(count)s activités en retard.",
        "You have %(count)s overdue activity.": "Vous avez %(count)s activité en retard.",
    "es": {
        "Dashboard": "Tablero",
        "Hi,": "Hola,",
        "Your open work at a glance": "Tu trabajo abierto de un vistazo",
        "Due today": "Para hoy",
        "Overdue": "Vencido",
        "This week": "Esta semana",
        "Waiting on you": "Esperando por ti",
        "Open activities": "Actividades abiertas",
        "Sales": "Ventas",
        "Purchase": "Compras",
        "Inventory": "Inventario",
        "Accounting": "Contabilidad",
        "Settings": "Ajustes",
        "Total Receivables": "Total por cobrar",
        "Total Payables": "Total por pagar",
        "Total Sales (This Month)": "Ventas totales (este mes)",
        "Needs attention": "Requiere atención",
        "View all activities": "Ver todas las actividades",
        "Enterprise Resource Planning": "Planificación de recursos empresariales",
        "Willow Theme Settings": "Ajustes del tema Willow",
        "Appearance": "Apariencia",
        "Colors": "Colores",
        "Branding": "Marca",
        "Advanced": "Avanzado",
        "Show dashboard menu": "Mostrar menú Tablero",
        "Administrator": "Administrador",
        "Access Rights": "Permisos de acceso",
        "Internal User": "Usuario interno",
        "Portal User": "Usuario portal",
    },
    "de": {
        "Dashboard": "Dashboard",
        "Hi,": "Hallo,",
        "Your open work at a glance": "Ihre offenen Aufgaben auf einen Blick",
        "Due today": "Heute fällig",
        "Overdue": "Überfällig",
        "This week": "Diese Woche",
        "Waiting on you": "Wartet auf Sie",
        "Open activities": "Offene Aktivitäten",
        "Sales": "Verkauf",
        "Purchase": "Einkauf",
        "Inventory": "Lager",
        "Accounting": "Buchhaltung",
        "Settings": "Einstellungen",
        "Total Receivables": "Forderungen gesamt",
        "Total Payables": "Verbindlichkeiten gesamt",
        "Total Sales (This Month)": "Verkauf gesamt (dieser Monat)",
        "Needs attention": "Benötigt Aufmerksamkeit",
        "View all activities": "Alle Aktivitäten anzeigen",
        "Enterprise Resource Planning": "Enterprise Resource Planning",
        "Willow Theme Settings": "Willow-Theme-Einstellungen",
        "Appearance": "Erscheinungsbild",
        "Colors": "Farben",
        "Branding": "Branding",
        "Advanced": "Erweitert",
        "Show dashboard menu": "Dashboard-Menü anzeigen",
        "Administrator": "Administrator",
        "Access Rights": "Zugriffsrechte",
        "Internal User": "Interner Benutzer",
        "Portal User": "Portalbenutzer",
    },
    "pt_BR": {
        "Dashboard": "Painel",
        "Hi,": "Olá,",
        "Your open work at a glance": "Seu trabalho em aberto de relance",
        "Due today": "Para hoje",
        "Overdue": "Atrasado",
        "This week": "Esta semana",
        "Waiting on you": "Aguardando você",
        "Open activities": "Atividades abertas",
        "Sales": "Vendas",
        "Purchase": "Compras",
        "Inventory": "Inventário",
        "Accounting": "Contabilidade",
        "Settings": "Configurações",
        "Total Receivables": "Total a receber",
        "Total Payables": "Total a pagar",
        "Total Sales (This Month)": "Vendas totais (este mês)",
        "Needs attention": "Precisa de atenção",
        "View all activities": "Ver todas as atividades",
        "Enterprise Resource Planning": "Planejamento de recursos empresariais",
        "Willow Theme Settings": "Configurações do tema Willow",
        "Appearance": "Aparência",
        "Colors": "Cores",
        "Branding": "Marca",
        "Advanced": "Avançado",
        "Show dashboard menu": "Mostrar menu Painel",
        "Administrator": "Administrador",
        "Access Rights": "Direitos de acesso",
        "Internal User": "Usuário interno",
        "Portal User": "Usuário do portal",
    },
    "ar": {
        "Dashboard": "لوحة المعلومات",
        "Hi,": "مرحبًا،",
        "Your open work at a glance": "عملك المفتوح في لمحة",
        "Due today": "مستحق اليوم",
        "Overdue": "متأخر",
        "This week": "هذا الأسبوع",
        "Waiting on you": "في انتظارك",
        "Open activities": "الأنشطة المفتوحة",
        "Sales": "المبيعات",
        "Purchase": "المشتريات",
        "Inventory": "المخزون",
        "Accounting": "المحاسبة",
        "Settings": "الإعدادات",
        "Total Receivables": "إجمالي المستحقات",
        "Total Payables": "إجمالي المستحقات للدفع",
        "Needs attention": "يحتاج إلى انتباه",
        "View all activities": "عرض كل الأنشطة",
        "Willow Theme Settings": "إعدادات سمة Willow",
        "Appearance": "المظهر",
        "Colors": "الألوان",
        "Branding": "الهوية",
        "Advanced": "متقدم",
        "Show dashboard menu": "إظهار قائمة لوحة المعلومات",
        "Administrator": "المسؤول",
        "Access Rights": "صلاحيات الوصول",
        "Internal User": "مستخدم داخلي",
        "Portal User": "مستخدم البوابة",
    },
    "hi_IN": {
        "Dashboard": "डैशबोर्ड",
        "Hi,": "नमस्ते,",
        "Your open work at a glance": "आपका खुला काम एक नज़र में",
        "Due today": "आज देय",
        "Overdue": "अतिदेय",
        "This week": "इस सप्ताह",
        "Waiting on you": "आपकी प्रतीक्षा में",
        "Open activities": "खुली गतिविधियाँ",
        "Sales": "बिक्री",
        "Purchase": "खरीद",
        "Inventory": "इन्वेंटरी",
        "Accounting": "लेखांकन",
        "Settings": "सेटिंग्स",
        "Needs attention": "ध्यान देने की आवश्यकता",
        "View all activities": "सभी गतिविधियाँ देखें",
        "Willow Theme Settings": "Willow थीम सेटिंग्स",
        "Appearance": "दिखावट",
        "Colors": "रंग",
        "Branding": "ब्रांडिंग",
        "Advanced": "उन्नत",
        "Show dashboard menu": "डैशबोर्ड मेनू दिखाएँ",
        "Administrator": "प्रशासक",
        "Access Rights": "एक्सेस अधिकार",
        "Internal User": "आंतरिक उपयोगकर्ता",
        "Portal User": "पोर्टल उपयोगकर्ता",
    },
    "zh_CN": {
        "Dashboard": "仪表板",
        "Hi,": "你好，",
        "Your open work at a glance": "一眼查看您的待办工作",
        "Due today": "今日到期",
        "Overdue": "已逾期",
        "This week": "本周",
        "Waiting on you": "等待您处理",
        "Open activities": "未完成活动",
        "Sales": "销售",
        "Purchase": "采购",
        "Inventory": "库存",
        "Accounting": "会计",
        "Settings": "设置",
        "Total Receivables": "应收总额",
        "Total Payables": "应付总额",
        "Total Sales (This Month)": "本月销售总额",
        "Needs attention": "需要关注",
        "View all activities": "查看全部活动",
        "Enterprise Resource Planning": "企业资源规划",
        "Willow Theme Settings": "Willow 主题设置",
        "Appearance": "外观",
        "Colors": "颜色",
        "Branding": "品牌",
        "Advanced": "高级",
        "Show dashboard menu": "显示仪表板菜单",
        "Administrator": "管理员",
        "Access Rights": "访问权限",
        "Internal User": "内部用户",
        "Portal User": "门户用户",
    },
}


def parse_po(path: Path) -> dict[str, str]:
    translations: dict[str, str] = {}
    if not path.exists():
        return translations
    content = path.read_text(encoding="utf-8")
    current_msgid = None
    current_msgstr = None
    in_msgid = False
    in_msgstr = False
    for line in content.splitlines():
        if line.startswith('msgid "'):
            if current_msgid is not None and current_msgstr:
                translations[current_msgid] = current_msgstr
            current_msgid = line[7:-1]
            current_msgstr = ""
            in_msgid = True
            in_msgstr = False
        elif line.startswith('msgstr "'):
            current_msgstr = line[8:-1]
            in_msgid = False
            in_msgstr = True
        elif line.startswith('"') and in_msgid:
            current_msgid += line[1:-1]
        elif line.startswith('"') and in_msgstr:
            current_msgstr += line[1:-1]
        elif not line.startswith('"'):
            in_msgid = False
            in_msgstr = False
    if current_msgid and current_msgstr:
        translations[current_msgid] = current_msgstr
    return translations


def lookup_translation(lang: str, msgid: str, seed: dict[str, str]) -> str:
    manual = MANUAL.get(lang, {})
    if msgid in manual:
        return manual[msgid]
    return seed.get(msgid, "")


def main() -> None:
    scan_sources()
    sorted_keys = sorted(entries.keys(), key=str.lower)
    pot_body = "".join(format_entry(key, entries[key]) for key in sorted_keys)
    (OUT / f"{MODULE}.pot").write_text(HEADER + pot_body, encoding="utf-8")
    print(f"Wrote POT with {len(sorted_keys)} entries")

    for lang in LANG_FILES:
        seed = {}
        seed.update(parse_po(PINE_I18N / f"{lang}.po"))
        seed.update(parse_po(KRAKEN_I18N / f"{lang}.po"))  # Kraken wins on overlap
        po_body = "".join(
            format_entry(key, entries[key], lookup_translation(lang, key, seed))
            for key in sorted_keys
        )
        lang_header = HEADER.replace(
            "Plural-Forms: \\n\"",
            f"Language: {lang}\\n\"\n\"Plural-Forms: \\n\"",
        )
        (OUT / f"{lang}.po").write_text(lang_header + po_body, encoding="utf-8")
        filled = sum(1 for key in sorted_keys if lookup_translation(lang, key, seed))
        print(f"Wrote {lang}.po ({filled}/{len(sorted_keys)} translated)")


if __name__ == "__main__":
    main()
