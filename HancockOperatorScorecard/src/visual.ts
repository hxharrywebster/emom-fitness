"use strict";

import powerbi from "powerbi-visuals-api";
import * as d3 from "d3";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import { valueFormatter } from "powerbi-visuals-utils-formattingutils";
import "./../style/visual.less";

import IVisual = powerbi.extensibility.visual.IVisual;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import IVisualEventService = powerbi.extensibility.IVisualEventService;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ISelectionId = powerbi.visuals.ISelectionId;
import DataView = powerbi.DataView;
import DataViewCategoryColumn = powerbi.DataViewCategoryColumn;
import DataViewValueColumn = powerbi.DataViewValueColumn;
import VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;
import PrimitiveValue = powerbi.PrimitiveValue;

import { VisualFormattingSettingsModel, KpiCard, BRAND } from "./settings";

const MAX_PEER_LABELS = 15;
const MAX_TREND_POINTS = 400;

interface PersonVM {
    name: string;
    surname: string;
    firstRowIndex: number;
    focus: boolean;
    headline: number | null;
    kpis: (number | null)[];
    quadX: number | null;
    quadY: number | null;
    selectionId: ISelectionId;
    highlighted: boolean;
}

interface TrendPoint {
    month: Date;
    values: (number | null)[];
}

interface ViewModel {
    persons: PersonVM[];
    focus: PersonVM | null;
    focusCount: number;
    rank: number | null;
    rankCount: number;
    personCol: DataViewCategoryColumn;
    headlineCol: DataViewValueColumn | undefined;
    kpiCols: DataViewValueColumn[];
    trendCols: DataViewValueColumn[];
    quadXCol: DataViewValueColumn | undefined;
    quadYCol: DataViewValueColumn | undefined;
    infoCols: DataViewValueColumn[];
    infoValues: (string | null)[];
    summaryText: string | null;
    tooltipCols: DataViewValueColumn[];
    trend: TrendPoint[];
    hasHighlights: boolean;
}

function toNumber(v: PrimitiveValue | null | undefined): number | null {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
}

function toDate(v: PrimitiveValue | null | undefined): Date | null {
    if (v === null || v === undefined) return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    const d = new Date(String(v));
    return isNaN(d.getTime()) ? null : d;
}

function avg(values: (number | null)[]): number | null {
    const nums = values.filter((v): v is number => v !== null);
    if (!nums.length) return null;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function parseNum(text: string | undefined | null): number | null {
    if (text === null || text === undefined) return null;
    const t = String(text).trim();
    if (!t) return null;
    const n = Number(t.replace(/,/g, "").replace(/%$/, ""));
    return isNaN(n) ? null : n;
}

function clearChildren(el: HTMLElement): void {
    while (el.firstChild) el.removeChild(el.firstChild);
}

function surnameOf(name: string): string {
    const parts = name.trim().split(/\s+/);
    return parts[parts.length - 1] || name;
}

export class Visual implements IVisual {
    private host: IVisualHost;
    private events: IVisualEventService;
    private selectionManager: ISelectionManager;
    private formattingSettingsService: FormattingSettingsService;
    private settings: VisualFormattingSettingsModel;

    private root: HTMLElement;
    private heroEl: HTMLElement;
    private infoEl: HTMLElement;
    private kpisEl: HTMLElement;
    private trendEl: HTMLElement;
    private quadEl: HTMLElement;
    private summaryEl: HTMLElement;
    private emptyEl: HTMLElement;

    private trendSvg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private quadSvg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private quadDots: d3.Selection<SVGCircleElement, PersonVM, SVGGElement, unknown> | null = null;

    private vm: ViewModel | null = null;

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.events = options.host.eventService;
        this.selectionManager = this.host.createSelectionManager();
        this.formattingSettingsService = new FormattingSettingsService();
        this.settings = new VisualFormattingSettingsModel();

        const el = options.element;
        el.classList.add("hos-host");

        this.root = document.createElement("div");
        this.root.className = "hos-root";
        el.appendChild(this.root);

        this.heroEl = this.section("hos-hero");
        this.infoEl = this.section("hos-info");
        this.kpisEl = this.section("hos-kpis");
        this.trendEl = this.section("hos-trend");
        this.quadEl = this.section("hos-quad");
        this.summaryEl = this.section("hos-summary");

        this.emptyEl = document.createElement("div");
        this.emptyEl.className = "hos-empty";
        this.root.appendChild(this.emptyEl);

        this.trendSvg = d3.select(this.trendEl).append("svg").classed("hos-trend-svg", true);
        this.quadSvg = d3.select(this.quadEl).append("svg").classed("hos-quad-svg", true);

        // click empty space clears cross-filter selection
        this.root.addEventListener("click", () => {
            this.selectionManager.clear().then(() => this.applySelectionOpacity([]));
        });
        this.root.addEventListener("contextmenu", (event: MouseEvent) => {
            this.selectionManager.showContextMenu({}, { x: event.clientX, y: event.clientY });
            event.preventDefault();
        });
    }

    private section(cls: string): HTMLElement {
        const s = document.createElement("div");
        s.className = `hos-section ${cls}`;
        this.root.appendChild(s);
        return s;
    }

    public update(options: VisualUpdateOptions): void {
        this.events.renderingStarted(options);
        try {
            this.renderUpdate(options);
            this.events.renderingFinished(options);
        } catch (e) {
            // never throw out of update() — show empty state instead
            this.showEmpty("Unable to render scorecard");
            this.events.renderingFailed(options, String(e));
        }
    }

    private renderUpdate(options: VisualUpdateOptions): void {
        const { width, height } = options.viewport;
        this.root.style.width = `${Math.max(0, width)}px`;
        this.root.style.height = `${Math.max(0, height)}px`;

        // tiny viewport while dragging — bail cleanly
        if (width < 60 || height < 60) {
            this.hideAllSections();
            this.emptyEl.style.display = "none";
            return;
        }

        const dv = options.dataViews?.[0];
        const personCol = dv?.categorical?.categories?.find(c => c.source?.roles?.person);
        const headlineCol = dv?.categorical?.values?.filter(v => v.source?.roles?.headline)?.[0];
        const focusCol = dv?.categorical?.values?.filter(v => v.source?.roles?.focusFlag)?.[0];

        if (!dv || !personCol || !personCol.values?.length || !headlineCol || !focusCol) {
            this.hideAllSections();
            this.showEmpty("Add Person, Headline Value and Focus Person Flag to build the scorecard");
            return;
        }

        this.settings = this.formattingSettingsService.populateFormattingSettingsModel(
            VisualFormattingSettingsModel, dv);

        this.vm = this.transform(dv, personCol, headlineCol, focusCol);

        if (this.vm.focusCount !== 1) {
            this.hideAllSections();
            this.showEmpty(this.vm.focusCount === 0
                ? "No focus person: Focus Person Flag must be 1 for exactly one person"
                : "Multiple focus persons: Focus Person Flag must be 1 for exactly one person");
            return;
        }

        this.emptyEl.style.display = "none";
        const vm = this.vm;
        const s = this.settings;
        const fontFamily = this.fxTextVal("text", "fontFamily", s.text.fontFamily.value, vm) || BRAND.fontStack;
        this.root.style.fontFamily = fontFamily;

        const hc = this.host.colorPalette.isHighContrast;
        this.root.classList.toggle("hos-hc", hc);
        if (hc) {
            this.root.style.background = this.host.colorPalette.background.value;
            this.root.style.color = this.host.colorPalette.foreground.value;
        } else {
            this.root.style.background = "";
            this.root.style.color = "";
        }

        this.renderHero(vm);
        this.renderInfo(vm);
        this.renderKpis(vm);
        this.renderTrend(vm, width);
        this.renderQuadrant(vm, width, height);
        this.renderSummary(vm);

        // restore selection after resize / bookmark
        this.applySelectionOpacity(this.selectionManager.getSelectionIds() as ISelectionId[]);
    }

    /* ---------------- data transform ---------------- */

    private transform(
        dv: DataView,
        personCol: DataViewCategoryColumn,
        headlineCol: DataViewValueColumn,
        focusCol: DataViewValueColumn
    ): ViewModel {
        const values = dv.categorical?.values ?? ([] as unknown as powerbi.DataViewValueColumns);
        const colsFor = (role: string) => (values as DataViewValueColumn[]).filter(v => v.source?.roles?.[role]);

        const dateCol = dv.categorical?.categories?.find(c => c.source?.roles?.date);
        const kpiCols = colsFor("kpis").slice(0, 4);
        const trendCols = colsFor("trendValues").slice(0, 2);
        const quadXCol = colsFor("quadX")[0];
        const quadYCol = colsFor("quadY")[0];
        const infoCols = colsFor("info").slice(0, 3);
        const summaryCol = colsFor("summary")[0];
        const tooltipCols = colsFor("tooltips");

        const highlightSource = (values as DataViewValueColumn[]).find(v => v.highlights);
        const hasHighlights = !!highlightSource;

        // group row indices by person (person repeats per date in the two-category grain)
        const rowsByPerson = new Map<string, number[]>();
        const n = personCol.values.length;
        for (let i = 0; i < n; i++) {
            const key = personCol.values[i] === null || personCol.values[i] === undefined
                ? "(blank)" : String(personCol.values[i]);
            const rows = rowsByPerson.get(key);
            if (rows) rows.push(i); else rowsByPerson.set(key, [i]);
        }

        const aggOver = (col: DataViewValueColumn | undefined, rows: number[]): number | null => {
            if (!col) return null;
            return avg(rows.map(r => toNumber(col.values[r])));
        };

        const persons: PersonVM[] = [];
        rowsByPerson.forEach((rows, name) => {
            const focusVal = Math.max(...rows.map(r => toNumber(focusCol.values[r]) ?? 0));
            const highlighted = !hasHighlights || rows.some(r =>
                highlightSource!.highlights![r] !== null && highlightSource!.highlights![r] !== undefined);
            persons.push({
                name,
                surname: surnameOf(name),
                firstRowIndex: rows[0],
                focus: focusVal >= 1,
                headline: aggOver(headlineCol, rows),
                kpis: kpiCols.map(c => aggOver(c, rows)),
                quadX: aggOver(quadXCol, rows),
                quadY: aggOver(quadYCol, rows),
                selectionId: this.host.createSelectionIdBuilder()
                    .withCategory(personCol, rows[0])
                    .createSelectionId() as ISelectionId,
                highlighted
            });
        });

        const focusPersons = persons.filter(p => p.focus);
        const focus = focusPersons.length === 1 ? focusPersons[0] : null;

        // rank of focus headline among all persons received
        const higherIsBetter = this.settings.headline.higherIsBetter.value;
        const ranked = persons
            .filter(p => p.headline !== null)
            .sort((a, b) => higherIsBetter
                ? (b.headline! - a.headline!)
                : (a.headline! - b.headline!));
        const rankCount = ranked.length;
        const rank = focus && focus.headline !== null
            ? ranked.findIndex(p => p === focus) + 1
            : null;

        // trend: focus person's rows grouped by month
        let trend: TrendPoint[] = [];
        if (focus && dateCol && trendCols.length) {
            const focusRows = rowsByPerson.get(focus.name) ?? [];
            const byMonth = new Map<number, number[][]>();
            for (const r of focusRows) {
                const d = toDate(dateCol.values[r]);
                if (!d) continue;
                const key = d.getFullYear() * 12 + d.getMonth();
                let buckets = byMonth.get(key);
                if (!buckets) { buckets = trendCols.map(() => []); byMonth.set(key, buckets); }
                trendCols.forEach((c, si) => {
                    const v = toNumber(c.values[r]);
                    if (v !== null) buckets![si].push(v);
                });
            }
            trend = [...byMonth.entries()]
                .sort((a, b) => a[0] - b[0])
                .map(([key, buckets]) => ({
                    month: new Date(Math.floor(key / 12), key % 12, 1),
                    values: buckets.map(b => b.length ? b.reduce((x, y) => x + y, 0) / b.length : null)
                }));
            if (trend.length > MAX_TREND_POINTS) {
                const step = Math.ceil(trend.length / MAX_TREND_POINTS);
                trend = trend.filter((_, i) => i % step === 0);
            }
        }

        // info / summary come from the focus person's rows (last non-null value)
        const lastNonNull = (col: DataViewValueColumn, rows: number[]): string | null => {
            for (let i = rows.length - 1; i >= 0; i--) {
                const v = col.values[rows[i]];
                if (v !== null && v !== undefined && v !== "") return String(v);
            }
            return null;
        };
        const focusRows = focus ? (rowsByPerson.get(focus.name) ?? []) : [];
        const infoValues = infoCols.map(c => focus ? lastNonNull(c, focusRows) : null);
        const summaryText = focus && summaryCol ? lastNonNull(summaryCol, focusRows) : null;

        return {
            persons, focus, focusCount: focusPersons.length,
            rank, rankCount,
            personCol, headlineCol, kpiCols, trendCols, quadXCol, quadYCol,
            infoCols, infoValues, summaryText, tooltipCols, trend, hasHighlights
        };
    }

    /* ---------------- fx read-back ----------------
     * An fx rule's evaluated result lands per row in categories[].objects[i];
     * a "format by field value" result for a static property lands in
     * metadata.objects (already merged into settings by populateFormattingSettingsModel).
     * Read the row-level override for the focus person first, then fall back. */

    private rowObject(vm: ViewModel, objName: string, propName: string, rowIndex?: number): unknown {
        const row = rowIndex ?? vm.focus?.firstRowIndex ?? 0;
        const objects = vm.personCol.objects?.[row] as powerbi.DataViewObjects | undefined;
        return objects?.[objName]?.[propName];
    }

    private fxColorVal(objName: string, propName: string, fallback: string, vm: ViewModel, rowIndex?: number): string {
        const v = this.rowObject(vm, objName, propName, rowIndex) as powerbi.Fill | string | undefined;
        if (v && typeof v === "object" && v.solid?.color) return v.solid.color;
        if (typeof v === "string" && v) return v;
        return fallback;
    }

    private fxTextVal(objName: string, propName: string, fallback: string, vm: ViewModel, rowIndex?: number): string {
        const v = this.rowObject(vm, objName, propName, rowIndex);
        if (v !== null && v !== undefined && typeof v !== "object" && String(v) !== "") return String(v);
        return fallback;
    }

    /* ---------------- section rendering ---------------- */

    private hideAllSections(): void {
        for (const el of [this.heroEl, this.infoEl, this.kpisEl, this.trendEl, this.quadEl, this.summaryEl]) {
            el.style.display = "none";
        }
    }

    private showEmpty(message: string): void {
        this.hideAllSections();
        this.emptyEl.style.display = "flex";
        clearChildren(this.emptyEl);
        const brandLine = document.createElement("div");
        brandLine.className = "hos-empty-brand";
        brandLine.textContent = "HANCOCK OPERATOR SCORECARD";
        const msg = document.createElement("div");
        msg.className = "hos-empty-msg";
        msg.textContent = message;
        this.emptyEl.appendChild(brandLine);
        this.emptyEl.appendChild(msg);
    }

    private formatterFor(col: DataViewValueColumn | undefined): (v: number | null) => string {
        const fmt = col?.source?.format;
        const f = valueFormatter.create({ format: fmt, cultureSelector: this.host.locale });
        return (v: number | null) => {
            if (v === null) return "–";
            try { return f.format(v); } catch { return String(Math.round(v * 100) / 100); }
        };
    }

    private isPercentFormat(col: DataViewValueColumn | undefined): boolean {
        return !!col?.source?.format && col.source.format.indexOf("%") >= 0;
    }

    private renderHero(vm: ViewModel): void {
        const s = this.settings;
        if (!s.sections.showHero.value) { this.heroEl.style.display = "none"; return; }
        this.heroEl.style.display = "block";
        clearChildren(this.heroEl);

        const hc = this.host.colorPalette.isHighContrast;
        const imageUrl = this.fxTextVal("header", "imageUrl", s.header.imageUrl.value, vm);
        const scrim = Math.min(1, Math.max(0, s.header.scrimOpacity.value ?? 0.55));

        // background: <image> per spec (data: URLs and https both render;
        // https needs report-level privacy acceptance via the WebAccess privilege)
        const svgNs = "http://www.w3.org/2000/svg";
        const bg = document.createElementNS(svgNs, "svg");
        bg.setAttribute("class", "hos-hero-bg");
        bg.setAttribute("preserveAspectRatio", "none");
        if (imageUrl && !hc) {
            const img = document.createElementNS(svgNs, "image");
            img.setAttribute("href", imageUrl);
            img.setAttribute("width", "100%");
            img.setAttribute("height", "100%");
            img.setAttribute("preserveAspectRatio", "xMidYMid slice");
            bg.appendChild(img);
        }
        const scrimRect = document.createElementNS(svgNs, "rect");
        scrimRect.setAttribute("width", "100%");
        scrimRect.setAttribute("height", "100%");
        scrimRect.setAttribute("fill", hc ? this.host.colorPalette.background.value : "#0B2233");
        scrimRect.setAttribute("fill-opacity", imageUrl && !hc ? String(scrim) : "1");
        bg.appendChild(scrimRect);
        this.heroEl.appendChild(bg);

        const content = document.createElement("div");
        content.className = "hos-hero-content";
        if (hc) content.style.color = this.host.colorPalette.foreground.value;

        const top = document.createElement("div");
        top.className = "hos-hero-top";
        const site = document.createElement("div");
        site.className = "hos-site";
        site.textContent = this.fxTextVal("header", "siteName", s.header.siteName.value, vm);
        site.style.fontSize = `${s.text.sectionHeaderSize.value}pt`;
        const titleBlock = document.createElement("div");
        titleBlock.className = "hos-titleblock";
        const title = document.createElement("div");
        title.className = "hos-title";
        title.textContent = this.fxTextVal("header", "title", s.header.title.value, vm);
        title.style.fontSize = `${s.text.sectionHeaderSize.value}pt`;
        const period = document.createElement("div");
        period.className = "hos-period";
        period.textContent = this.fxTextVal("header", "periodLabel", s.header.periodLabel.value, vm);
        period.style.fontSize = `${s.text.sectionHeaderSize.value}pt`;
        titleBlock.appendChild(title);
        if (period.textContent) titleBlock.appendChild(period);
        top.appendChild(site);
        top.appendChild(titleBlock);
        content.appendChild(top);

        const bottom = document.createElement("div");
        bottom.className = "hos-hero-bottom";
        const label = document.createElement("div");
        label.className = "hos-headline-label";
        label.textContent = this.fxTextVal("headline", "label", s.headline.label.value, vm);
        label.style.fontSize = `${s.text.sectionHeaderSize.value}pt`;
        bottom.appendChild(label);

        const fmt = this.formatterFor(vm.headlineCol);
        const valueRow = document.createElement("div");
        valueRow.className = "hos-headline-value";
        const num = document.createElement("span");
        num.className = "hos-headline-num";
        num.textContent = fmt(vm.focus?.headline ?? null);
        num.style.fontSize = `${s.text.headlineSize.value}pt`;
        valueRow.appendChild(num);
        const units = this.fxTextVal("headline", "units", s.headline.units.value, vm);
        if (units) {
            const u = document.createElement("span");
            u.className = "hos-headline-units";
            u.textContent = units;
            u.style.fontSize = `${Math.round(s.text.headlineSize.value * 0.35)}pt`;
            valueRow.appendChild(u);
        }
        bottom.appendChild(valueRow);

        const chips = document.createElement("div");
        chips.className = "hos-chips";
        const target = parseNum(this.fxTextVal("headline", "target", s.headline.target.value, vm));
        if (s.headline.showTargetChip.value && target !== null && vm.focus?.headline !== null && vm.focus?.headline !== undefined) {
            const delta = vm.focus.headline - target;
            const pct = target !== 0 ? (delta / Math.abs(target)) * 100 : null;
            const chip = document.createElement("span");
            chip.className = "hos-chip";
            const pctText = pct !== null ? ` · ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%` : "";
            chip.textContent = `TARGET ${fmt(target)}${pctText}`;
            if (!hc) chip.style.background = BRAND.deepBlue;
            chips.appendChild(chip);
        }
        if (s.headline.showRankChip.value && vm.rank !== null) {
            const chip = document.createElement("span");
            chip.className = "hos-chip";
            chip.textContent = `RANK #${vm.rank} / ${vm.rankCount}`;
            if (!hc) chip.style.background = BRAND.deepBlue;
            chips.appendChild(chip);
        }
        if (chips.childNodes.length) bottom.appendChild(chips);
        content.appendChild(bottom);
        this.heroEl.appendChild(content);
    }

    private renderInfo(vm: ViewModel): void {
        const s = this.settings;
        if (!s.sections.showInfo.value || !vm.focus) { this.infoEl.style.display = "none"; return; }
        this.infoEl.style.display = "flex";
        clearChildren(this.infoEl);

        const labels = [
            this.fxTextVal("infoStrip", "label1", s.infoStrip.label1.value, vm),
            this.fxTextVal("infoStrip", "label2", s.infoStrip.label2.value, vm),
            this.fxTextVal("infoStrip", "label3", s.infoStrip.label3.value, vm),
            this.fxTextVal("infoStrip", "label4", s.infoStrip.label4.value, vm)
        ];
        const cells: { label: string; value: string }[] = [
            { label: labels[0], value: vm.focus.name }
        ];
        vm.infoCols.forEach((c, i) => {
            cells.push({
                label: labels[i + 1] || c.source.displayName?.toUpperCase() || "",
                value: vm.infoValues[i] ?? "–"
            });
        });

        for (const cell of cells.slice(0, 4)) {
            const cellEl = document.createElement("div");
            cellEl.className = "hos-info-cell";
            const l = document.createElement("div");
            l.className = "hos-info-label";
            l.textContent = cell.label;
            l.style.fontSize = `${Math.max(7, s.text.sectionHeaderSize.value - 2)}pt`;
            const v = document.createElement("div");
            v.className = "hos-info-value";
            v.textContent = cell.value;
            v.style.fontSize = `${s.text.bodySize.value + 1}pt`;
            cellEl.appendChild(l);
            cellEl.appendChild(v);
            this.infoEl.appendChild(cellEl);
        }
    }

    private renderKpis(vm: ViewModel): void {
        const s = this.settings;
        if (!s.sections.showKpis.value || !vm.kpiCols.length || !vm.focus) {
            this.kpisEl.style.display = "none"; return;
        }
        this.kpisEl.style.display = "flex";
        clearChildren(this.kpisEl);

        const hc = this.host.colorPalette.isHighContrast;
        const meetingColor = this.fxColorVal("kpiTiles", "meetingColor", s.kpiTiles.meetingColor.value.value, vm);
        const belowColor = this.fxColorVal("kpiTiles", "belowColor", s.kpiTiles.belowColor.value.value, vm);
        const kpiCards: KpiCard[] = this.settings.kpiCards();

        vm.kpiCols.forEach((col, i) => {
            const card = kpiCards[i];
            const value = vm.focus!.kpis[i];
            const fmt = this.formatterFor(col);
            const label = this.fxTextVal(card.name, "label", card.label.value, vm)
                || col.source.displayName?.toUpperCase() || `KPI ${i + 1}`;
            const units = this.fxTextVal(card.name, "units", card.units.value, vm);
            const targetRaw = parseNum(this.fxTextVal(card.name, "target", card.target.value, vm));
            // percent-formatted measures deliver fractions; allow targets typed as whole percents
            const target = targetRaw !== null && this.isPercentFormat(col) && Math.abs(targetRaw) > 1
                ? targetRaw / 100 : targetRaw;
            const higherIsBetter = card.higherIsBetter.value;

            const tile = document.createElement("div");
            tile.className = "hos-tile";
            let borderColor: string = BRAND.midGrey;
            if (value !== null && target !== null) {
                const meets = higherIsBetter ? value >= target : value <= target;
                borderColor = meets ? meetingColor : belowColor;
            }
            tile.style.borderTopColor = hc ? this.host.colorPalette.foreground.value : borderColor;

            const l = document.createElement("div");
            l.className = "hos-tile-label";
            l.textContent = label.toUpperCase();
            l.style.fontSize = `${Math.max(7, s.text.sectionHeaderSize.value - 2)}pt`;
            tile.appendChild(l);

            const v = document.createElement("div");
            v.className = "hos-tile-value";
            v.textContent = value === null ? "–" : fmt(value) + (units ? ` ${units}` : "");
            v.style.fontSize = `${s.text.tileValueSize.value}pt`;
            tile.appendChild(v);

            if (target !== null && value !== null) {
                const delta = value - target;
                const good = higherIsBetter ? delta >= 0 : delta <= 0;
                const pct = target !== 0 ? (delta / Math.abs(target)) * 100 : null;
                const d = document.createElement("div");
                d.className = "hos-tile-delta";
                const arrow = delta >= 0 ? "▲" : "▼";
                const deltaText = pct !== null
                    ? `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`
                    : fmt(delta);
                d.textContent = `${arrow} ${deltaText} vs target ${fmt(target)}`;
                d.style.color = hc
                    ? this.host.colorPalette.foreground.value
                    : (good ? meetingColor : belowColor);
                d.style.fontSize = `${Math.max(7, s.text.bodySize.value - 2)}pt`;
                tile.appendChild(d);
            }

            tile.addEventListener("mousemove", (event: MouseEvent) => {
                const items: VisualTooltipDataItem[] = [
                    { displayName: label, value: value === null ? "–" : fmt(value) }
                ];
                if (target !== null) items.push({ displayName: "Target", value: fmt(target) });
                this.appendTooltipRole(items, vm, vm.focus!.firstRowIndex);
                this.host.tooltipService.show({
                    dataItems: items,
                    identities: [vm.focus!.selectionId],
                    coordinates: [event.clientX, event.clientY],
                    isTouchEvent: false
                });
            });
            tile.addEventListener("mouseout", () =>
                this.host.tooltipService.hide({ isTouchEvent: false, immediately: false }));

            this.kpisEl.appendChild(tile);
        });
    }

    private renderTrend(vm: ViewModel, viewportWidth: number): void {
        const s = this.settings;
        const show = s.sections.showTrend.value && vm.trendCols.length > 0 && vm.trend.length > 0;
        this.trendEl.style.display = show ? "block" : "none";
        this.trendSvg.selectAll("*").remove();
        if (!show) return;

        const hc = this.host.colorPalette.isHighContrast;
        const fg = hc ? this.host.colorPalette.foreground.value : "#333333";
        const grid = hc ? this.host.colorPalette.foreground.value : BRAND.midGrey;

        const elW = this.trendEl.clientWidth || viewportWidth;
        const elH = this.trendEl.clientHeight || 140;
        const margin = { top: 26, right: 12, bottom: 20, left: 40 };
        const w = Math.max(0, elW - margin.left - margin.right);
        const h = Math.max(0, elH - margin.top - margin.bottom);
        if (w <= 0 || h <= 0) return;

        this.trendSvg.attr("width", elW).attr("height", elH);
        const g = this.trendSvg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

        const colors = [
            this.fxColorVal("trend", "series1Color", s.trend.series1Color.value.value, vm),
            this.fxColorVal("trend", "series2Color", s.trend.series2Color.value.value, vm)
        ];
        const seriesLabels = [
            this.fxTextVal("trend", "series1Label", s.trend.series1Label.value, vm) || vm.trendCols[0]?.source.displayName || "Series 1",
            this.fxTextVal("trend", "series2Label", s.trend.series2Label.value, vm) || vm.trendCols[1]?.source.displayName || "Series 2"
        ];

        const x = d3.scaleTime()
            .domain(d3.extent(vm.trend, t => t.month) as [Date, Date])
            .range([0, w]);

        const allVals = vm.trend.flatMap(t => t.values.filter((v): v is number => v !== null));
        let yMin = parseNum(s.trend.yMin.value);
        let yMax = parseNum(s.trend.yMax.value);
        const dataMin = d3.min(allVals) ?? 0;
        const dataMax = d3.max(allVals) ?? 1;
        if (yMin === null) yMin = dataMin - (dataMax - dataMin) * 0.1;
        if (yMax === null) yMax = dataMax + (dataMax - dataMin) * 0.1;
        if (yMin === yMax) { yMin -= 1; yMax += 1; }
        const y = d3.scaleLinear().domain([yMin, yMax]).range([h, 0]);

        const fmt = this.formatterFor(vm.trendCols[0]);
        g.append("g")
            .call(d3.axisLeft(y).ticks(4).tickFormat(v => fmt(v as number)))
            .call(ax => ax.selectAll("text").attr("fill", fg).style("font-size", "8pt"))
            .call(ax => ax.selectAll("line,path").attr("stroke", grid).attr("stroke-opacity", 0.4));
        g.append("g")
            .attr("transform", `translate(0,${h})`)
            .call(d3.axisBottom(x).ticks(Math.min(6, vm.trend.length)).tickFormat(d3.timeFormat("%b %y") as never))
            .call(ax => ax.selectAll("text").attr("fill", fg).style("font-size", "8pt"))
            .call(ax => ax.selectAll("line,path").attr("stroke", grid).attr("stroke-opacity", 0.4));

        vm.trendCols.forEach((_, si) => {
            const pts = vm.trend.filter(t => t.values[si] !== null);
            if (!pts.length) return;
            const line = d3.line<TrendPoint>()
                .x(t => x(t.month))
                .y(t => y(t.values[si]!));
            g.append("path")
                .datum(pts)
                .attr("class", "hos-trend-line")
                .attr("fill", "none")
                .attr("stroke", hc ? fg : colors[si])
                .attr("stroke-width", 2)
                .attr("d", line);
            g.selectAll(`.hos-trend-dot-${si}`)
                .data(pts)
                .join("circle")
                .attr("class", `hos-trend-dot-${si}`)
                .attr("cx", t => x(t.month))
                .attr("cy", t => y(t.values[si]!))
                .attr("r", 2.5)
                .attr("fill", hc ? fg : colors[si]);
        });

        // legend top-left
        const legend = this.trendSvg.append("g").attr("transform", `translate(${margin.left},12)`);
        let lx = 0;
        vm.trendCols.forEach((_, si) => {
            legend.append("rect").attr("x", lx).attr("y", -6).attr("width", 10).attr("height", 3)
                .attr("fill", hc ? fg : colors[si]);
            const t = legend.append("text").attr("x", lx + 14).attr("y", 0)
                .attr("fill", fg).style("font-size", "8pt")
                .text(seriesLabels[si]);
            lx += 14 + (t.node()?.getComputedTextLength?.() ?? seriesLabels[si].length * 6) + 16;
        });
    }

    private renderQuadrant(vm: ViewModel, viewportWidth: number, viewportHeight: number): void {
        const s = this.settings;
        const eligible = vm.persons.filter(p => p.quadX !== null && p.quadY !== null);
        const show = s.sections.showQuadrant.value && !!vm.quadXCol && !!vm.quadYCol && eligible.length > 0;
        this.quadEl.style.display = show ? "block" : "none";
        this.quadSvg.selectAll("*").remove();
        this.quadDots = null;
        if (!show) return;

        const hc = this.host.colorPalette.isHighContrast;
        const palette = this.host.colorPalette;
        const fg = hc ? palette.foreground.value : "#333333";

        const elW = this.quadEl.clientWidth || viewportWidth;
        const elH = this.quadEl.clientHeight || Math.max(160, viewportHeight * 0.25);
        const margin = { top: 14, right: 14, bottom: 30, left: 44 };
        const w = Math.max(0, elW - margin.left - margin.right);
        const h = Math.max(0, elH - margin.top - margin.bottom);
        if (w <= 0 || h <= 0) return;

        this.quadSvg.attr("width", elW).attr("height", elH);
        const g = this.quadSvg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

        const xs = eligible.map(p => p.quadX!);
        const ys = eligible.map(p => p.quadY!);
        const pad = (lo: number, hi: number) => {
            const span = hi - lo || Math.abs(hi) || 1;
            return [lo - span * 0.12, hi + span * 0.12];
        };
        const [x0, x1] = pad(d3.min(xs)!, d3.max(xs)!);
        const [yLo, yHi] = pad(d3.min(ys)!, d3.max(ys)!);
        const yInverted = s.quadrant.yInverted.value;

        const x = d3.scaleLinear().domain([x0, x1]).range([0, w]);
        const y = d3.scaleLinear().domain([yLo, yHi]).range(yInverted ? [0, h] : [h, 0]);

        const xThr = parseNum(this.fxTextVal("quadrant", "xThreshold", s.quadrant.xThreshold.value, vm)) ?? d3.mean(xs)!;
        const yThr = parseNum(this.fxTextVal("quadrant", "yThreshold", s.quadrant.yThreshold.value, vm)) ?? d3.mean(ys)!;
        const xThrPx = Math.max(0, Math.min(w, x(xThr)));
        const yThrPx = Math.max(0, Math.min(h, y(yThr)));

        // quadrant background washes (~8% opacity fills)
        const fills = {
            TL: this.fxColorVal("quadrant", "fillTL", s.quadrant.fillTL.value.value, vm),
            TR: this.fxColorVal("quadrant", "fillTR", s.quadrant.fillTR.value.value, vm),
            BL: this.fxColorVal("quadrant", "fillBL", s.quadrant.fillBL.value.value, vm),
            BR: this.fxColorVal("quadrant", "fillBR", s.quadrant.fillBR.value.value, vm)
        };
        if (!hc) {
            const quadRects: [number, number, number, number, string][] = [
                [0, 0, xThrPx, yThrPx, fills.TL],
                [xThrPx, 0, w - xThrPx, yThrPx, fills.TR],
                [0, yThrPx, xThrPx, h - yThrPx, fills.BL],
                [xThrPx, yThrPx, w - xThrPx, h - yThrPx, fills.BR]
            ];
            for (const [rx, ry, rw, rh, fill] of quadRects) {
                if (rw <= 0 || rh <= 0) continue;
                g.append("rect").attr("x", rx).attr("y", ry).attr("width", rw).attr("height", rh)
                    .attr("fill", fill).attr("fill-opacity", 0.08).attr("pointer-events", "none");
            }
        }

        // corner labels
        const labels = {
            TL: this.fxTextVal("quadrant", "labelTL", s.quadrant.labelTL.value, vm),
            TR: this.fxTextVal("quadrant", "labelTR", s.quadrant.labelTR.value, vm),
            BL: this.fxTextVal("quadrant", "labelBL", s.quadrant.labelBL.value, vm),
            BR: this.fxTextVal("quadrant", "labelBR", s.quadrant.labelBR.value, vm)
        };
        const cornerPos: Record<string, [number, number, string]> = {
            TL: [4, 10, "start"], TR: [w - 4, 10, "end"],
            BL: [4, h - 4, "start"], BR: [w - 4, h - 4, "end"]
        };
        (Object.keys(labels) as (keyof typeof labels)[]).forEach(k => {
            if (!labels[k]) return;
            const [cx, cy, anchor] = cornerPos[k];
            g.append("text").attr("x", cx).attr("y", cy)
                .attr("text-anchor", anchor)
                .attr("fill", fg).attr("fill-opacity", 0.7)
                .style("font-size", `${Math.max(6, s.quadrant.labelFontSize.value - 1)}pt`)
                .style("letter-spacing", "0.08em")
                .text(labels[k].toUpperCase());
        });

        // axes
        const fmtX = this.formatterFor(vm.quadXCol);
        const fmtY = this.formatterFor(vm.quadYCol);
        g.append("g").attr("transform", `translate(0,${h})`)
            .call(d3.axisBottom(x).ticks(5).tickFormat(v => fmtX(v as number)))
            .call(ax => ax.selectAll("text").attr("fill", fg).style("font-size", "7.5pt"))
            .call(ax => ax.selectAll("line,path").attr("stroke", BRAND.midGrey).attr("stroke-opacity", 0.4));
        g.append("g")
            .call(d3.axisLeft(y).ticks(5).tickFormat(v => fmtY(v as number)))
            .call(ax => ax.selectAll("text").attr("fill", fg).style("font-size", "7.5pt"))
            .call(ax => ax.selectAll("line,path").attr("stroke", BRAND.midGrey).attr("stroke-opacity", 0.4));

        // axis titles
        this.quadSvg.append("text")
            .attr("x", margin.left + w / 2).attr("y", elH - 4)
            .attr("text-anchor", "middle").attr("fill", fg).attr("fill-opacity", 0.75)
            .style("font-size", "7.5pt")
            .text(vm.quadXCol!.source.displayName ?? "");
        this.quadSvg.append("text")
            .attr("transform", `translate(10,${margin.top + h / 2}) rotate(-90)`)
            .attr("text-anchor", "middle").attr("fill", fg).attr("fill-opacity", 0.75)
            .style("font-size", "7.5pt")
            .text(vm.quadYCol!.source.displayName ?? "");

        // dashed threshold lines
        for (const line of [
            { x1: xThrPx, y1: 0, x2: xThrPx, y2: h },
            { x1: 0, y1: yThrPx, x2: w, y2: yThrPx }
        ]) {
            g.append("line")
                .attr("x1", line.x1).attr("y1", line.y1).attr("x2", line.x2).attr("y2", line.y2)
                .attr("stroke", fg).attr("stroke-opacity", 0.5)
                .attr("stroke-dasharray", "4,3").attr("stroke-width", 1);
        }

        const peerColorDefault = s.quadrant.peerDotColor.value.value;
        const focusColorDefault = s.quadrant.focusDotColor.value.value;
        const peerCount = eligible.filter(p => !p.focus).length;
        const showPeerLabels = peerCount <= MAX_PEER_LABELS;

        const dotColor = (p: PersonVM): string => {
            if (hc) return p.focus ? palette.foregroundSelected.value : palette.foreground.value;
            return p.focus
                ? this.fxColorVal("quadrant", "focusDotColor", focusColorDefault, vm, p.firstRowIndex)
                : this.fxColorVal("quadrant", "peerDotColor", peerColorDefault, vm, p.firstRowIndex);
        };

        const dots = g.selectAll<SVGCircleElement, PersonVM>("circle.hos-dot")
            .data(eligible, (p: PersonVM) => p.name)
            .join("circle")
            .attr("class", "hos-dot")
            .attr("cx", p => x(p.quadX!))
            .attr("cy", p => y(p.quadY!))
            .attr("r", p => p.focus ? 8 : 4.5)
            .attr("fill", dotColor)
            .attr("stroke", hc ? palette.background.value : BRAND.white)
            .attr("stroke-width", p => p.focus ? 2 : 1)
            .attr("fill-opacity", p => p.highlighted ? 1 : 0.3)
            .style("cursor", "pointer");

        dots.on("click", (event: MouseEvent, p: PersonVM) => {
            const multi = event.ctrlKey || event.metaKey;
            this.selectionManager.select(p.selectionId, multi).then((ids: powerbi.extensibility.ISelectionId[]) => {
                this.applySelectionOpacity(ids as ISelectionId[]);
            });
            event.stopPropagation();
        });
        dots.on("contextmenu", (event: MouseEvent, p: PersonVM) => {
            this.selectionManager.showContextMenu(p.selectionId, { x: event.clientX, y: event.clientY });
            event.preventDefault();
            event.stopPropagation();
        });
        dots.on("mousemove", (event: MouseEvent, p: PersonVM) => {
            const items: VisualTooltipDataItem[] = [
                { displayName: "Person", value: p.name },
                { displayName: vm.quadXCol!.source.displayName ?? "X", value: fmtX(p.quadX) },
                { displayName: vm.quadYCol!.source.displayName ?? "Y", value: fmtY(p.quadY) }
            ];
            this.appendTooltipRole(items, vm, p.firstRowIndex);
            this.host.tooltipService.show({
                dataItems: items,
                identities: [p.selectionId],
                coordinates: [event.clientX, event.clientY],
                isTouchEvent: false
            });
        });
        dots.on("mouseout", () =>
            this.host.tooltipService.hide({ isTouchEvent: false, immediately: false }));

        // labels: focus always ("NAME · YOU"), peers by surname while ≤ 15 peers
        const labelled = eligible.filter(p => p.focus || showPeerLabels);
        g.selectAll<SVGTextElement, PersonVM>("text.hos-dot-label")
            .data(labelled, (p: PersonVM) => p.name)
            .join("text")
            .attr("class", "hos-dot-label")
            .attr("x", p => x(p.quadX!))
            .attr("y", p => y(p.quadY!) - (p.focus ? 12 : 8))
            .attr("text-anchor", "middle")
            .attr("fill", p => hc ? fg : (p.focus ? dotColor(p) : BRAND.midGrey))
            .style("font-size", `${s.quadrant.labelFontSize.value}pt`)
            .style("font-weight", p => p.focus ? "700" : "400")
            .attr("pointer-events", "none")
            .text(p => p.focus ? `${p.name.toUpperCase()} · YOU` : p.surname);

        this.quadDots = dots;
    }

    private renderSummary(vm: ViewModel): void {
        const s = this.settings;
        const show = s.sections.showSummary.value && !!vm.summaryText;
        this.summaryEl.style.display = show ? "block" : "none";
        if (!show) return;
        clearChildren(this.summaryEl);

        const hc = this.host.colorPalette.isHighContrast;
        const box = document.createElement("div");
        box.className = "hos-summary-box";
        if (hc) {
            box.style.background = this.host.colorPalette.background.value;
            box.style.border = `1px solid ${this.host.colorPalette.foreground.value}`;
            box.style.color = this.host.colorPalette.foreground.value;
        } else {
            box.style.background = this.fxColorVal("summary", "boxColor", s.summary.boxColor.value.value, vm);
            box.style.color = this.fxColorVal("summary", "textColor", s.summary.textColor.value.value, vm);
        }

        const title = document.createElement("div");
        title.className = "hos-summary-title";
        title.textContent = this.fxTextVal("summary", "title", s.summary.title.value, vm);
        title.style.fontSize = `${s.text.sectionHeaderSize.value}pt`;
        box.appendChild(title);

        const body = document.createElement("div");
        body.className = "hos-summary-body";
        body.textContent = vm.summaryText ?? "";   // plain text only — no markup parsing
        body.style.fontSize = `${s.text.bodySize.value}pt`;
        box.appendChild(body);

        this.summaryEl.appendChild(box);
    }

    private appendTooltipRole(items: VisualTooltipDataItem[], vm: ViewModel, rowIndex: number): void {
        for (const col of vm.tooltipCols) {
            const v = col.values[rowIndex];
            if (v === null || v === undefined) continue;
            const fmt = this.formatterFor(col);
            const num = toNumber(v);
            items.push({
                displayName: col.source.displayName ?? "",
                value: num !== null ? fmt(num) : String(v)
            });
        }
    }

    private applySelectionOpacity(selectedIds: ISelectionId[]): void {
        if (!this.quadDots) return;
        const anySelected = selectedIds?.length > 0;
        this.quadDots.attr("fill-opacity", (p: PersonVM) => {
            if (!p.highlighted) return 0.3;
            if (!anySelected) return 1;
            return selectedIds.some(id => id.equals(p.selectionId)) ? 1 : 0.3;
        });
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.settings);
    }
}
