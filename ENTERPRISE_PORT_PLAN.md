# Willow Enterprise Port Plan

## Baseline

- Track Willow Community `19.0.2.4.8` feature-for-feature.
- Ship as the independent Odoo module `willow_backend_theme_ent`.
- Require `web_enterprise` so Willow assets load after Enterprise assets.

## Port work

1. [x] Copy the Community module without its Git metadata or generated Python caches.
2. [x] Rename module, asset, XML-ID, translation, route, and configuration namespaces.
3. [x] Preserve Willow's existing CSS custom properties and narrowly scoped Odoo selectors.
4. [x] Adapt Enterprise startup so the sequence-0 Willow dashboard opens instead of the fullscreen Enterprise Home Menu.
5. [x] Keep Enterprise systray registrations intact and move their rendered container into Willow's topbar using Willow's existing systray mount.
6. [x] Copy missing Community configuration parameters into the Enterprise namespace during post-install migration without deleting the source values.
7. [x] Validate manifests, Python, XML, JavaScript imports, asset paths, translation headers, and Git repository cleanliness.
8. [x] Install and upgrade the module in an isolated Odoo 19 Enterprise database, compile production assets, and exercise the shell in a real browser.

## Compatibility boundaries

- Do not modify Odoo Community or Enterprise core modules.
- Do not install Community and Enterprise Willow editions together.
- Keep Enterprise-only view structures outside Willow's selector assumptions unless verified against local Odoo 19 Enterprise source.
- Re-run the regression matrix whenever Willow Community changes or the target Enterprise build is upgraded.
- Exercise app-specific views again in a representative production database because the isolated validation database intentionally contains only the module dependency set.

## Completed validation

- Odoo 19 Enterprise install and upgrade: passed.
- Production backend JavaScript and CSS bundle compilation: passed.
- Willow dashboard selected as the Enterprise root action: passed.
- Enterprise systray preservation: passed with 14 rendered items in the dependency-only database.
- Light/dark in-place theme toggle: passed.
- Responsive shell at 1440, 992, 991, 768, 767, 480, and 360 px: passed with no horizontal overflow.
- Browser console and runtime exception check: passed with no problems.
