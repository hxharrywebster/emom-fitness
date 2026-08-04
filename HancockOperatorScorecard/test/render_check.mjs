/**
 * render_check.mjs — headless verification for the Hancock Operator Scorecard.
 *
 * Mounts the compiled bundle (.tmp/drop/visual.js) in jsdom with a mock Power BI
 * host, feeds it dataviews shaped exactly like the visual's capabilities
 * (person × date categorical grain with headline/focusFlag/kpis/trendValues/
 * quadX/quadY/info/summary roles), and asserts the spec's test checklist.
 *
 * Usage: node test/render_check.mjs
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundlePath = join(projectDir, ".tmp", "drop", "visual.js");
if (!existsSync(bundlePath)) {
    console.error(`No compiled bundle at ${bundlePath}. Run \`pbiviz package\` first.`);
    process.exit(1);
}

/* ---------------- demo data ---------------- */

const PERSONS = [
    "T. Baker", "A. Nguyen", "S. Whitfield", "K. Dunstan",
    "M. Okafor", "J. Pearce", "L. Marshall", "R. Gilbert"
];
const FOCUS_INDEX = 0; // T. Baker
const DAYS = 60;

// deterministic pseudo-random
let seed = 42;
function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }

function makeRows() {
    const rows = [];
    const start = new Date(2026, 0, 5);
    for (let p = 0; p < PERSONS.length; p++) {
        const skill = 0.6 + 0.4 * (p / PERSONS.length); // spread so ranks are distinct
        for (let d = 0; d < DAYS; d++) {
            const date = new Date(start.getTime() + d * 86400000);
            rows.push({
                person: PERSONS[p],
                date,
                headline: Math.round((6 + 5 * skill + rnd() * 1.5) * 10) / 10, // hours
                focusFlag: p === FOCUS_INDEX ? 1 : 0,
                kpi1: 0.55 + 0.35 * skill + rnd() * 0.05,  // UoA %
                kpi2: 0.5 + 0.4 * skill + rnd() * 0.05,    // Productive time %
                kpi3: 0.3 + 0.5 * skill + rnd() * 0.08,
                kpi4: 0.6 + 0.3 * skill + rnd() * 0.06,
                trend1: 0.55 + 0.35 * skill + rnd() * 0.06,
                trend2: 0.5 + 0.4 * skill + rnd() * 0.06,
                quadX: 40 + 50 * skill + rnd() * 6,
                quadY: 30 - 18 * skill + rnd() * 4,        // fewer is better
                info1: `EX36${60 + p}`,
                info2: p % 2 ? "Panel 4 North" : "South Stockyard",
                info3: 14,
                summary: p === FOCUS_INDEX
                    ? "Strong swing. Utilisation of availability up 4.2% on last swing; proximity stoppages down. Keep pit-floor grading cadence through node 7."
                    : null,
                tooltip1: Math.round(100 + rnd() * 80)
            });
        }
    }
    return rows;
}

function col(rows, key, roles, opts = {}) {
    return {
        source: {
            displayName: opts.displayName ?? key,
            queryName: `q.${key}`,
            roles,
            isMeasure: !roles.person && !roles.date,
            format: opts.format
        },
        values: rows.map(r => r[key]),
        ...(opts.highlights ? { highlights: opts.highlights(rows) } : {}),
        ...(opts.objects ? { objects: opts.objects(rows) } : {})
    };
}

function makeDataView(rows, {
    withHighlights = false,
    metadataObjects = undefined,
    personObjects = undefined,   // (rows) => objects array for the person category column
    roles = ["date", "kpis", "trendValues", "quad", "info", "summary", "tooltips"]
} = {}) {
    const has = r => roles.includes(r);
    const personCol = {
        source: { displayName: "Person", queryName: "q.person", roles: { person: true } },
        values: rows.map(r => r.person),
        identity: rows.map((_, i) => ({ key: `row-${i}` })),
        objects: personObjects ? personObjects(rows) : undefined
    };
    const categories = [personCol];
    if (has("date")) {
        categories.push({
            source: { displayName: "Date", queryName: "q.date", roles: { date: true } },
            values: rows.map(r => r.date)
        });
    }
    const values = [
        col(rows, "headline", { headline: true }, {
            displayName: "Hours On Machine", format: "0.0",
            highlights: withHighlights
                ? rs => rs.map(r => (r.person === PERSONS[0] || r.person === PERSONS[3]) ? r.headline : null)
                : undefined
        }),
        col(rows, "focusFlag", { focusFlag: true }, { displayName: "Is Selected Person" })
    ];
    if (has("kpis")) {
        values.push(
            col(rows, "kpi1", { kpis: true }, { displayName: "UoA %", format: "0.0 %" }),
            col(rows, "kpi2", { kpis: true }, { displayName: "Productive Time %", format: "0.0 %" }),
            col(rows, "kpi3", { kpis: true }, { displayName: "Ancillary %", format: "0.0 %" }),
            col(rows, "kpi4", { kpis: true }, { displayName: "Availability Used %", format: "0.0 %" })
        );
    }
    if (has("trendValues")) {
        values.push(
            col(rows, "trend1", { trendValues: true }, { displayName: "UoA %", format: "0.0 %" }),
            col(rows, "trend2", { trendValues: true }, { displayName: "Productive Time %", format: "0.0 %" })
        );
    }
    if (has("quad")) {
        values.push(
            col(rows, "quadX", { quadX: true }, { displayName: "Effective Utilisation", format: "0.0" }),
            col(rows, "quadY", { quadY: true }, { displayName: "Proximity Stoppages", format: "0.0" })
        );
    }
    if (has("info")) {
        values.push(
            col(rows, "info1", { info: true }, { displayName: "Primary Machine" }),
            col(rows, "info2", { info: true }, { displayName: "Primary Region" }),
            col(rows, "info3", { info: true }, { displayName: "Shifts" })
        );
    }
    if (has("summary")) values.push(col(rows, "summary", { summary: true }, { displayName: "Swing Summary" }));
    if (has("tooltips")) values.push(col(rows, "tooltip1", { tooltips: true }, { displayName: "Loads", format: "0" }));

    values.grouped = () => [{ values }];
    return {
        metadata: { columns: [], objects: metadataObjects },
        categorical: { categories, values }
    };
}

/* ---------------- mock host ---------------- */

const calls = { select: [], clear: 0, tooltipShow: 0, contextMenu: 0 };
let selected = [];
const selectionManager = {
    select: (id, multi) => { calls.select.push({ id, multi }); selected = multi ? [...selected, id] : [id]; return Promise.resolve(selected); },
    clear: () => { calls.clear++; selected = []; return Promise.resolve(); },
    getSelectionIds: () => selected,
    showContextMenu: () => { calls.contextMenu++; return Promise.resolve(); },
    registerOnSelectCallback: () => {},
    hasSelection: () => selected.length > 0
};

let highContrast = false;
const mockHost = {
    createSelectionManager: () => selectionManager,
    createSelectionIdBuilder: () => {
        let key = "";
        const b = {
            withCategory: (c, i) => { key += `c${i}`; return b; },
            withSeries: () => { key += "s"; return b; },
            withMeasure: m => { key += `m${m}`; return b; },
            createSelectionId: () => ({ key, equals: o => o?.key === key, getKey: () => key })
        };
        return b;
    },
    colorPalette: {
        get isHighContrast() { return highContrast; },
        foreground: { value: "#FFFFFF" },
        background: { value: "#000000" },
        foregroundSelected: { value: "#FFFF00" },
        hyperlink: { value: "#00AFD0" },
        getColor: () => ({ value: "#006A9D" }),
        reset: () => {}
    },
    tooltipService: {
        enabled: () => true,
        show: () => { calls.tooltipShow++; },
        move: () => {},
        hide: () => {}
    },
    eventService: { renderingStarted: () => {}, renderingFinished: () => {}, renderingFailed: () => {} },
    locale: "en-AU",
    hostCapabilities: { allowInteractions: true },
    displayWarningIcon: () => {},
    persistProperties: () => {},
    applyJsonFilter: () => {}
};

/* ---------------- mount ---------------- */

const dom = new JSDOM(`<!DOCTYPE html><body><div id="root"></div></body>`, { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
try { globalThis.navigator = dom.window.navigator; } catch { /* Node ≥21 exposes a read-only global */ }
globalThis.SVGElement = dom.window.SVGElement;

const results = [];
const record = (name, pass, evidence) => {
    results.push({ name, pass });
    console.log(`${pass ? "PASS" : "FAIL"}  ${name}${evidence ? `  — ${evidence}` : ""}`);
};
const tick = () => new Promise(r => setTimeout(r, 0));

let plugin;
try {
    dom.window.powerbi = { visuals: { plugins: {} } };
    dom.window.eval(readFileSync(bundlePath, "utf8"));
    plugin = Object.values(dom.window.powerbi.visuals.plugins)[0];
    if (!plugin?.create) throw new Error("no visual plugin registered in window.powerbi.visuals.plugins");
    record("bundle loads and registers a visual plugin", true, plugin.name);
} catch (e) {
    record("bundle loads and registers a visual plugin", false, e.message);
    process.exit(1);
}

const rows = makeRows();
const viewport = { width: 820, height: 1100 };
const element = document.getElementById("root");
const visual = plugin.create({ element, host: mockHost });
const q = sel => element.querySelector(sel);
const qa = sel => [...element.querySelectorAll(sel)];
const visible = sel => { const el = q(sel); return el && el.style.display !== "none"; };

/* 1 — full render: all six sections */
try {
    visual.update({ dataViews: [makeDataView(rows)], viewport, type: 2 });
    const sections = {
        hero: visible(".hos-hero"),
        info: visible(".hos-info"),
        kpis: visible(".hos-kpis"),
        trend: visible(".hos-trend"),
        quad: visible(".hos-quad"),
        summary: visible(".hos-summary")
    };
    const allVisible = Object.values(sections).every(Boolean);
    record("all six sections render with full demo data", allVisible, JSON.stringify(sections));

    const headlineNum = q(".hos-headline-num")?.textContent;
    record("headline shows a value", !!headlineNum && headlineNum !== "–", `"${headlineNum}"`);
    record("4 KPI tiles render", qa(".hos-tile").length === 4, `${qa(".hos-tile").length} tiles`);
    record("trend draws 2 series", qa(".hos-trend-line").length === 2, `${qa(".hos-trend-line").length} lines`);
    record("quadrant draws a dot per person", qa("circle.hos-dot").length === PERSONS.length,
        `${qa("circle.hos-dot").length} dots for ${PERSONS.length} persons`);
    record("summary box shows swing summary text",
        (q(".hos-summary-body")?.textContent ?? "").startsWith("Strong swing"), "");
    record("info strip shows operator + info measures",
        qa(".hos-info-cell").length === 4 && q(".hos-info-value")?.textContent === PERSONS[FOCUS_INDEX],
        `${qa(".hos-info-cell").length} cells, first="${q(".hos-info-value")?.textContent}"`);
    const focusLabel = qa("text.hos-dot-label").find(t => t.textContent.includes("YOU"));
    record("focus dot labelled NAME · YOU", !!focusLabel, `"${focusLabel?.textContent}"`);
} catch (e) { record("all six sections render with full demo data", false, e.stack.split("\n")[0]); }

/* 2 — rank, both directions */
try {
    // expected rank from per-person averages
    const byPerson = new Map();
    for (const r of rows) {
        const b = byPerson.get(r.person) ?? [];
        b.push(r.headline); byPerson.set(r.person, b);
    }
    const avgs = [...byPerson.entries()].map(([p, v]) => [p, v.reduce((a, b) => a + b) / v.length]);
    const desc = [...avgs].sort((a, b) => b[1] - a[1]);
    const asc = [...avgs].sort((a, b) => a[1] - b[1]);
    const expHigh = desc.findIndex(([p]) => p === PERSONS[FOCUS_INDEX]) + 1;
    const expLow = asc.findIndex(([p]) => p === PERSONS[FOCUS_INDEX]) + 1;

    visual.update({ dataViews: [makeDataView(rows)], viewport, type: 2 });
    const chipHigh = qa(".hos-chip").map(c => c.textContent).find(t => t.startsWith("RANK"));
    visual.update({
        dataViews: [makeDataView(rows, { metadataObjects: { headline: { higherIsBetter: false } } })],
        viewport, type: 2
    });
    const chipLow = qa(".hos-chip").map(c => c.textContent).find(t => t.startsWith("RANK"));
    record("rank correct (higher-is-better)", chipHigh === `RANK #${expHigh} / ${PERSONS.length}`,
        `chip="${chipHigh}" expected #${expHigh}/${PERSONS.length}`);
    record("rank correct (lower-is-better)", chipLow === `RANK #${expLow} / ${PERSONS.length}`,
        `chip="${chipLow}" expected #${expLow}/${PERSONS.length}`);
} catch (e) { record("rank correct (higher-is-better)", false, e.stack.split("\n")[0]); }

/* 3 — cross-filter */
try {
    calls.select.length = 0; calls.clear = 0; selected = [];
    visual.update({ dataViews: [makeDataView(rows)], viewport, type: 2 });
    const dots = qa("circle.hos-dot");
    dots[1].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await tick();
    const dimmedAfterClick = qa("circle.hos-dot").filter(d => Number(d.getAttribute("fill-opacity")) < 1).length;
    record("cross-filter: dot click calls selectionManager.select and dims others",
        calls.select.length === 1 && dimmedAfterClick === PERSONS.length - 1,
        `select() x${calls.select.length}, ${dimmedAfterClick}/${PERSONS.length} dimmed`);

    dots[2].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, ctrlKey: true }));
    await tick();
    const dimmedMulti = qa("circle.hos-dot").filter(d => Number(d.getAttribute("fill-opacity")) < 1).length;
    record("cross-filter: Ctrl+click multi-selects",
        calls.select.length === 2 && calls.select[1].multi === true && dimmedMulti === PERSONS.length - 2,
        `multi=${calls.select[1]?.multi}, ${dimmedMulti} dimmed`);

    element.querySelector(".hos-root").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await tick();
    const dimmedAfterClear = qa("circle.hos-dot").filter(d => Number(d.getAttribute("fill-opacity")) < 1).length;
    record("cross-filter: empty-space click clears selection",
        calls.clear >= 1 && dimmedAfterClear === 0, `clear() x${calls.clear}, ${dimmedAfterClear} still dimmed`);

    calls.contextMenu = 0;
    dots[0].dispatchEvent(new dom.window.MouseEvent("contextmenu", { bubbles: true }));
    record("context menu shown on right-click", calls.contextMenu === 1, `showContextMenu x${calls.contextMenu}`);
} catch (e) { record("cross-filter: dot click calls selectionManager.select and dims others", false, e.stack.split("\n")[0]); }

/* 4 — highlight (inbound) */
try {
    selected = [];
    visual.update({ dataViews: [makeDataView(rows, { withHighlights: true })], viewport, type: 2 });
    const opacities = qa("circle.hos-dot").map(d => Number(d.getAttribute("fill-opacity")));
    const dimmed = opacities.filter(o => o < 1).length;
    record("highlight: non-highlighted dots dim to 0.3",
        dimmed === PERSONS.length - 2 && opacities.filter(o => o === 1).length === 2,
        `${dimmed}/${PERSONS.length} dimmed (2 highlighted)`);
} catch (e) { record("highlight: non-highlighted dots dim to 0.3", false, e.stack.split("\n")[0]); }

/* 5 — degenerate dataviews never throw */
try {
    visual.update({ dataViews: [], viewport, type: 2 });
    const landing = q(".hos-empty");
    record("empty dataview → landing state, no exception",
        landing.style.display !== "none" && landing.textContent.includes("Add Person"),
        `"${q(".hos-empty-msg")?.textContent}"`);
} catch (e) { record("empty dataview → landing state, no exception", false, e.stack.split("\n")[0]); }

try {
    visual.update({ dataViews: [makeDataView(rows, { roles: [] })], viewport, type: 2 });
    const shown = ["hero", "info", "kpis", "trend", "quad", "summary"].filter(k => visible(`.hos-${k === "kpis" ? "kpis" : k}`));
    record("missing optional roles → sections auto-hide, no exception",
        visible(".hos-hero") && !visible(".hos-trend") && !visible(".hos-quad") && !visible(".hos-summary") && !visible(".hos-kpis"),
        `visible: ${shown.join(", ")}`);
} catch (e) { record("missing optional roles → sections auto-hide, no exception", false, e.stack.split("\n")[0]); }

try {
    const single = rows.filter(r => r.person === PERSONS[0]);
    visual.update({ dataViews: [makeDataView(single)], viewport, type: 2 });
    const chip = qa(".hos-chip").map(c => c.textContent).find(t => t.startsWith("RANK"));
    record("single person → rank #1 / 1 and single dot",
        chip === "RANK #1 / 1" && qa("circle.hos-dot").length === 1,
        `chip="${chip}", ${qa("circle.hos-dot").length} dot`);
} catch (e) { record("single person → rank #1 / 1 and single dot", false, e.stack.split("\n")[0]); }

try {
    const nullRows = rows.map(r => ({
        ...r, headline: null, kpi1: null, kpi2: null, kpi3: null, kpi4: null,
        trend1: null, trend2: null, quadX: null, quadY: null, info1: null, info2: null, info3: null, summary: null
    }));
    visual.update({ dataViews: [makeDataView(nullRows)], viewport, type: 2 });
    record("all-null measures → tiles show – and no exception",
        q(".hos-headline-num")?.textContent === "–", `headline="${q(".hos-headline-num")?.textContent}"`);
} catch (e) { record("all-null measures → tiles show – and no exception", false, e.stack.split("\n")[0]); }

try {
    const twoFocus = rows.map(r => ({ ...r, focusFlag: (r.person === PERSONS[0] || r.person === PERSONS[1]) ? 1 : 0 }));
    visual.update({ dataViews: [makeDataView(twoFocus)], viewport, type: 2 });
    const multiMsg = q(".hos-empty-msg")?.textContent ?? "";
    const zeroFocus = rows.map(r => ({ ...r, focusFlag: 0 }));
    visual.update({ dataViews: [makeDataView(zeroFocus)], viewport, type: 2 });
    const zeroMsg = q(".hos-empty-msg")?.textContent ?? "";
    record("zero / multiple focus persons → instructive empty state",
        multiMsg.includes("Multiple focus") && zeroMsg.includes("No focus"),
        `multi="${multiMsg}", zero="${zeroMsg}"`);
} catch (e) { record("zero / multiple focus persons → instructive empty state", false, e.stack.split("\n")[0]); }

/* 6 — resize storm */
try {
    for (const [w, h] of [[40, 30], [80, 60], [200, 900], [1400, 300], [30, 1200], [820, 1100]]) {
        visual.update({ dataViews: [makeDataView(rows)], viewport: { width: w, height: h }, type: 4 });
    }
    record("resize storm (tiny→large) does not throw", true, "6 viewports");
} catch (e) { record("resize storm (tiny→large) does not throw", false, e.stack.split("\n")[0]); }

/* 7 — fx: capabilities rule blocks + runtime override read */
try {
    const caps = JSON.parse(readFileSync(join(projectDir, "capabilities.json"), "utf8"));
    const missing = [];
    for (const [objName, obj] of Object.entries(caps.objects ?? {})) {
        for (const [propName, prop] of Object.entries(obj.properties ?? {})) {
            const isColor = !!prop.type?.fill;
            const isText = !!prop.type?.text || !!prop.type?.formatting?.fontFamily;
            if ((isColor || isText) && !prop.rule) missing.push(`${objName}.${propName}`);
        }
    }
    record("every colour/text property has a capabilities rule block (fx)",
        missing.length === 0, missing.length ? `missing: ${missing.join(", ")}` : "all fx-enabled");
} catch (e) { record("every colour/text property has a capabilities rule block (fx)", false, e.message); }

try {
    // simulate an fx rule result landing in categories[0].objects[i]
    const focusRowIdx = rows.findIndex(r => r.person === PERSONS[FOCUS_INDEX]);
    const dvFx = makeDataView(rows, {
        personObjects: rs => {
            const objects = new Array(rs.length);
            for (let i = 0; i < rs.length; i++) {
                objects[i] = {
                    quadrant: { focusDotColor: { solid: { color: "#123456" } } },
                    summary: { boxColor: { solid: { color: "#654321" } } },
                    headline: { label: "FX HEADLINE" }
                };
            }
            return objects;
        }
    });
    visual.update({ dataViews: [dvFx], viewport, type: 2 });
    const focusDot = qa("circle.hos-dot").find(d => Number(d.getAttribute("r")) > 5);
    const boxBg = q(".hos-summary-box")?.style.background;
    const label = q(".hos-headline-label")?.textContent;
    record("fx override read from categories objects (colour + text)",
        focusDot?.getAttribute("fill") === "#123456"
            && (boxBg === "rgb(101, 67, 33)" || boxBg === "#654321")
            && label === "FX HEADLINE",
        `dot=${focusDot?.getAttribute("fill")}, box=${boxBg}, label="${label}" (row ${focusRowIdx})`);
} catch (e) { record("fx override read from categories objects (colour + text)", false, e.stack.split("\n")[0]); }

/* 8 — formatting pane */
try {
    const model = visual.getFormattingModel?.();
    record("getFormattingModel() enumerates cards", !!model?.cards?.length, `${model?.cards?.length ?? 0} cards`);
} catch (e) { record("getFormattingModel() enumerates cards", false, e.message); }

try {
    const dvHidden = makeDataView(rows, {
        metadataObjects: {
            sections: { showTrend: false, showQuadrant: false, showSummary: false }
        }
    });
    visual.update({ dataViews: [dvHidden], viewport, type: 2 });
    record("section toggles hide sections",
        visible(".hos-hero") && !visible(".hos-trend") && !visible(".hos-quad") && !visible(".hos-summary"),
        `trend=${visible(".hos-trend")}, quad=${visible(".hos-quad")}, summary=${visible(".hos-summary")}`);
} catch (e) { record("section toggles hide sections", false, e.stack.split("\n")[0]); }

/* 9 — high contrast */
try {
    highContrast = true;
    visual.update({ dataViews: [makeDataView(rows)], viewport, type: 2 });
    const dot = q("circle.hos-dot");
    const rootBg = element.querySelector(".hos-root").style.background;
    record("high-contrast mode renders with palette colours",
        (dot?.getAttribute("fill") === "#FFFFFF" || dot?.getAttribute("fill") === "#FFFF00")
            && (rootBg === "rgb(0, 0, 0)" || rootBg === "#000000"),
        `dot=${dot?.getAttribute("fill")}, bg=${rootBg}`);
    highContrast = false;
    visual.update({ dataViews: [makeDataView(rows)], viewport, type: 2 });
} catch (e) { highContrast = false; record("high-contrast mode renders with palette colours", false, e.stack.split("\n")[0]); }

/* 10 — peer label cap */
try {
    const manyPersons = [];
    const start = new Date(2026, 0, 5);
    for (let p = 0; p < 20; p++) {
        for (let d = 0; d < 5; d++) {
            manyPersons.push({
                person: `Op ${String.fromCharCode(65 + p)}. Surname${p}`,
                date: new Date(start.getTime() + d * 86400000),
                headline: 5 + p * 0.3, focusFlag: p === 0 ? 1 : 0,
                kpi1: 0.5, kpi2: 0.5, kpi3: 0.5, kpi4: 0.5,
                trend1: 0.5, trend2: 0.5,
                quadX: 40 + p * 2, quadY: 20 + (p % 7), info1: "EX3660", info2: "Panel 4", info3: 14,
                summary: p === 0 ? "s" : null, tooltip1: 1
            });
        }
    }
    visual.update({ dataViews: [makeDataView(manyPersons)], viewport, type: 2 });
    const labels = qa("text.hos-dot-label");
    record(">15 peers → peer labels off, focus label kept",
        labels.length === 1 && labels[0].textContent.includes("YOU"),
        `${labels.length} labels for 20 persons`);
} catch (e) { record(">15 peers → peer labels off, focus label kept", false, e.stack.split("\n")[0]); }

/* 11 — write demo CSV for Desktop testing */
try {
    const header = "person,date,headline_hours,is_selected_person,uoa_pct,productive_pct,ancillary_pct,availability_used_pct,trend_uoa_pct,trend_productive_pct,effective_utilisation,proximity_stoppages,primary_machine,primary_region,shifts,swing_summary,loads";
    const lines = rows.map(r => [
        r.person, r.date.toISOString().slice(0, 10), r.headline, r.focusFlag,
        r.kpi1.toFixed(4), r.kpi2.toFixed(4), r.kpi3.toFixed(4), r.kpi4.toFixed(4),
        r.trend1.toFixed(4), r.trend2.toFixed(4),
        r.quadX.toFixed(2), r.quadY.toFixed(2),
        r.info1, `"${r.info2}"`, r.info3,
        r.summary ? `"${r.summary}"` : "", r.tooltip1
    ].join(","));
    writeFileSync(join(projectDir, "test", "demo_data.csv"), [header, ...lines].join("\n"));
    record("demo CSV written for Desktop testing", true, "test/demo_data.csv");
} catch (e) { record("demo CSV written for Desktop testing", false, e.message); }

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length ? 1 : 0);
