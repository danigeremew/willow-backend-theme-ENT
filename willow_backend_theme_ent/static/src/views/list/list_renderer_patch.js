/** @odoo-module **/

import { ListRenderer } from "@web/views/list/list_renderer";
import { patch } from "@web/core/utils/patch";
import { onMounted, onPatched, onWillUnmount } from "@odoo/owl";

const DESKTOP_LIST_MQ = "(min-width: 992px)";

function isFormEmbeddedList(table) {
    const listRoot = table.closest(".o_list_view");
    if (!listRoot) return Boolean(table.closest(".o_form_view"));
    return listRoot.classList.contains("o_field_x2many") || Boolean(table.closest(".o_form_view"));
}

function clearInlinePartitionStyles(table) {
    const thead = table.querySelector("thead");
    const tbody = table.querySelector("tbody");
    const tfoot = table.querySelector("tfoot");
    for (const section of [thead, tbody, tfoot]) {
        if (!section) continue;
        section.style.width = "";
        section.style.minWidth = "";
        section.style.maxWidth = "";
        section.style.boxSizing = "";
    }
    for (const section of [thead, tfoot]) if (section) section.style.paddingRight = "";
    for (const row of table.querySelectorAll("thead tr, tbody tr, tfoot tr")) {
        row.style.width = "";
        row.style.minWidth = "";
        row.style.maxWidth = "";
        row.style.tableLayout = "";
        for (const cell of row.children) {
            cell.style.width = "";
            cell.style.maxWidth = "";
            cell.style.boxSizing = "";
        }
    }
}

function ensureFormEmbedHandleColumn(table) {
    for (const cell of table.querySelectorAll(".o_handle_cell")) {
        cell.style.width = "2rem";
        cell.style.minWidth = "2rem";
        cell.style.maxWidth = "2rem";
        cell.style.boxSizing = "border-box";
    }
}

function readHeaderWidths(table) {
    const headerCells = [...table.querySelectorAll("thead th")];
    return { headerCells, headerWidths: headerCells.map((th) => {
        const inlineWidth = parseFloat(th.style.width);
        return Math.floor(Number.isFinite(inlineWidth) && inlineWidth > 0 ? inlineWidth : th.getBoundingClientRect().width);
    }) };
}

function applyRowWidth(row, totalWidth) {
    const rowWidth = `${totalWidth}px`;
    row.style.width = rowWidth;
    row.style.minWidth = rowWidth;
    row.style.maxWidth = rowWidth;
    row.style.tableLayout = "fixed";
}

function applySectionWidth(section, totalWidth) {
    if (!section) return;
    const sectionWidth = `${totalWidth}px`;
    section.style.width = sectionWidth;
    section.style.minWidth = sectionWidth;
    section.style.maxWidth = sectionWidth;
    section.style.boxSizing = "border-box";
}

function syncPartitionedListColumnWidths(table) {
    if (!table || !window.matchMedia(DESKTOP_LIST_MQ).matches) return;
    if (isFormEmbeddedList(table)) {
        clearInlinePartitionStyles(table);
        ensureFormEmbedHandleColumn(table);
        return;
    }
    const { headerCells, headerWidths } = readHeaderWidths(table);
    if (!headerCells.length) return;
    const totalWidth = headerWidths.reduce((sum, width) => sum + width, 0);
    const headerRow = table.querySelector("thead tr");
    if (headerRow) applyRowWidth(headerRow, totalWidth);
    for (const row of table.querySelectorAll("tbody tr")) {
        if (row.children.length !== headerCells.length) continue;
        applyRowWidth(row, totalWidth);
        [...row.children].forEach((td, index) => {
            td.style.width = `${headerWidths[index]}px`;
            td.style.maxWidth = `${headerWidths[index]}px`;
            td.style.boxSizing = "border-box";
        });
    }
    const footerRow = table.querySelector("tfoot tr");
    if (footerRow) {
        applyRowWidth(footerRow, totalWidth);
        let colIndex = 0;
        for (const td of footerRow.children) {
            const colspan = td.colSpan || 1;
            let width = 0;
            for (let i = 0; i < colspan; i++) width += headerWidths[colIndex + i] || 0;
            td.style.width = `${width}px`;
            td.style.maxWidth = `${width}px`;
            td.style.boxSizing = "border-box";
            colIndex += colspan;
        }
        if (colIndex < headerWidths.length) {
            let trailingWidth = 0;
            for (let i = colIndex; i < headerWidths.length; i++) trailingWidth += headerWidths[i];
            const lastFooterCell = footerRow.lastElementChild;
            if (lastFooterCell && trailingWidth > 0) {
                const currentWidth = parseFloat(lastFooterCell.style.width) || 0;
                lastFooterCell.style.width = `${currentWidth + trailingWidth}px`;
                lastFooterCell.style.maxWidth = `${currentWidth + trailingWidth}px`;
            }
        }
    }
    const tbody = table.querySelector("tbody");
    const thead = table.querySelector("thead");
    const tfoot = table.querySelector("tfoot");
    const scrollbarGutter = tbody ? Math.max(0, tbody.offsetWidth - tbody.clientWidth) : 0;
    const partitionWidth = totalWidth + scrollbarGutter;
    for (const section of [thead, tbody, tfoot]) applySectionWidth(section, partitionWidth);
    if (thead) thead.style.paddingRight = scrollbarGutter > 0 ? `${scrollbarGutter}px` : "";
    if (tfoot) tfoot.style.paddingRight = scrollbarGutter > 0 ? `${scrollbarGutter}px` : "";
    const renderer = table.closest(".o_list_renderer");
    if (renderer) renderer.style.overflowX = "auto";
}

patch(ListRenderer.prototype, {
    setup() {
        super.setup(...arguments);
        this._wlListFooterResizeObserver = null;
        onMounted(() => { this._wlScheduleListFooterSync(); this._wlBindListFooterResizeObserver(); this._wlBindResizeWidthSync(); });
        onPatched(() => this._wlScheduleListFooterSync());
        onWillUnmount(() => {
            this._wlResizeWidthSyncCleanup?.();
            this._wlResizeWidthSyncCleanup = null;
            this._wlListFooterResizeObserver?.disconnect();
            this._wlListFooterResizeObserver = null;
        });
    },
    _wlScheduleListFooterSync() { requestAnimationFrame(() => requestAnimationFrame(() => syncPartitionedListColumnWidths(this.tableRef?.el))); },
    _wlBindResizeWidthSync() {
        const table = this.tableRef?.el;
        if (!table || isFormEmbeddedList(table)) return;
        let frame = null;
        const sync = () => { frame = null; if (this.tableRef?.el === table) syncPartitionedListColumnWidths(table); };
        const scheduleSync = () => { if (frame === null && table.querySelector(".o_column_resizing")) frame = requestAnimationFrame(sync); };
        const finishSync = () => {
            if (frame !== null || table.querySelector(".o_column_resizing")) {
                if (frame !== null) cancelAnimationFrame(frame);
                sync();
            }
        };
        const stoppingEvents = ["pointerup", "keydown", "pointerdown"];
        window.addEventListener("pointermove", scheduleSync);
        for (const eventType of stoppingEvents) window.addEventListener(eventType, finishSync);
        this._wlResizeWidthSyncCleanup = () => {
            window.removeEventListener("pointermove", scheduleSync);
            for (const eventType of stoppingEvents) window.removeEventListener(eventType, finishSync);
            if (frame !== null) cancelAnimationFrame(frame);
        };
    },
    _wlBindListFooterResizeObserver() {
        const table = this.tableRef?.el;
        const rendererEl = this.rootRef?.el;
        if (!table || !rendererEl || typeof ResizeObserver === "undefined" || isFormEmbeddedList(table)) return;
        this._wlListFooterResizeObserver = new ResizeObserver(() => syncPartitionedListColumnWidths(table));
        this._wlListFooterResizeObserver.observe(rendererEl);
    },
});