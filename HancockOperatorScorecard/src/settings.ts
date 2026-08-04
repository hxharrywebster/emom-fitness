"use strict";

import powerbi from "powerbi-visuals-api";
import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";
import { dataViewWildcard } from "powerbi-visuals-utils-dataviewutils";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;
import VisualEnumerationInstanceKinds = powerbi.VisualEnumerationInstanceKinds;

/** Hancock Iron Ore brand tokens — authoritative hex from the locked spec. */
export const BRAND = {
    deepBlue: "#006A9D",
    cyan: "#00AFD0",
    teal: "#00917B",
    mint: "#5AC28D",
    coral: "#F15B55",
    orange: "#F68C50",
    pink: "#E77D9A",
    softPink: "#EBA6B8",
    black: "#000000",
    white: "#FFFFFF",
    midGrey: "#7F7F7F",
    fontStack: "Gilroy, \"Gilroy Semibold\", Aptos, \"Segoe UI\", Arial, sans-serif"
} as const;

/** fx (conditional-formatting) descriptor shared by every colour/text/target slice. */
const FX = {
    instanceKind: VisualEnumerationInstanceKinds.ConstantOrRule,
    selector: dataViewWildcard.createDataViewWildcardSelector(
        dataViewWildcard.DataViewWildcardMatchingOption.InstancesAndTotals)
};

function fxText(name: string, displayName: string, value: string, placeholder = ""): formattingSettings.TextInput {
    return new formattingSettings.TextInput({
        name, displayName, value, placeholder, ...FX
    });
}

function fxColor(name: string, displayName: string, value: string): formattingSettings.ColorPicker {
    return new formattingSettings.ColorPicker({
        name, displayName, value: { value }, ...FX
    });
}

class SectionsCard extends FormattingSettingsCard {
    showHero = new formattingSettings.ToggleSwitch({ name: "showHero", displayName: "Hero header", value: true });
    showInfo = new formattingSettings.ToggleSwitch({ name: "showInfo", displayName: "Info strip", value: true });
    showKpis = new formattingSettings.ToggleSwitch({ name: "showKpis", displayName: "KPI tiles", value: true });
    showTrend = new formattingSettings.ToggleSwitch({ name: "showTrend", displayName: "Trend", value: true });
    showQuadrant = new formattingSettings.ToggleSwitch({ name: "showQuadrant", displayName: "Peer quadrant", value: true });
    showSummary = new formattingSettings.ToggleSwitch({ name: "showSummary", displayName: "Summary box", value: true });

    name = "sections";
    displayName = "Sections";
    slices: FormattingSettingsSlice[] = [this.showHero, this.showInfo, this.showKpis, this.showTrend, this.showQuadrant, this.showSummary];
}

class HeaderCard extends FormattingSettingsCard {
    siteName = fxText("siteName", "Site name", "ROY HILL");
    title = fxText("title", "Title", "EQUIPMENT SCORECARD");
    periodLabel = fxText("periodLabel", "Period label", "");
    imageUrl = fxText("imageUrl", "Image URL", "", "https://… or data:image/…");
    scrimOpacity = new formattingSettings.NumUpDown({
        name: "scrimOpacity", displayName: "Scrim opacity", value: 0.55,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 1 }
        }
    });

    name = "header";
    displayName = "Header";
    slices: FormattingSettingsSlice[] = [this.siteName, this.title, this.periodLabel, this.imageUrl, this.scrimOpacity];
}

class HeadlineCard extends FormattingSettingsCard {
    label = fxText("label", "Label", "HEADLINE METRIC");
    units = fxText("units", "Units", "");
    target = fxText("target", "Target", "", "blank = no target");
    higherIsBetter = new formattingSettings.ToggleSwitch({ name: "higherIsBetter", displayName: "Higher is better", value: true });
    showTargetChip = new formattingSettings.ToggleSwitch({ name: "showTargetChip", displayName: "Show target chip", value: true });
    showRankChip = new formattingSettings.ToggleSwitch({ name: "showRankChip", displayName: "Show rank chip", value: true });

    name = "headline";
    displayName = "Headline";
    slices: FormattingSettingsSlice[] = [this.label, this.units, this.target, this.higherIsBetter, this.showTargetChip, this.showRankChip];
}

class InfoStripCard extends FormattingSettingsCard {
    label1 = fxText("label1", "Cell 1 label", "OPERATOR");
    label2 = fxText("label2", "Cell 2 label", "PRIMARY MACHINE");
    label3 = fxText("label3", "Cell 3 label", "PRIMARY REGION");
    label4 = fxText("label4", "Cell 4 label", "SHIFTS");

    name = "infoStrip";
    displayName = "Info strip";
    slices: FormattingSettingsSlice[] = [this.label1, this.label2, this.label3, this.label4];
}

class KpiTilesCard extends FormattingSettingsCard {
    meetingColor = fxColor("meetingColor", "Meeting-target border", BRAND.teal);
    belowColor = fxColor("belowColor", "Below-target border", BRAND.coral);

    name = "kpiTiles";
    displayName = "KPI tiles";
    slices: FormattingSettingsSlice[] = [this.meetingColor, this.belowColor];
}

export class KpiCard extends FormattingSettingsCard {
    label: formattingSettings.TextInput;
    units: formattingSettings.TextInput;
    target: formattingSettings.TextInput;
    higherIsBetter: formattingSettings.ToggleSwitch;

    constructor(index: number) {
        super();
        this.name = `kpi${index}`;
        this.displayName = `KPI ${index}`;
        this.label = fxText("label", "Label", "", "blank = field name");
        this.units = fxText("units", "Units", "");
        this.target = fxText("target", "Target", "", "blank = no target");
        this.higherIsBetter = new formattingSettings.ToggleSwitch({ name: "higherIsBetter", displayName: "Higher is better", value: true });
        this.slices = [this.label, this.units, this.target, this.higherIsBetter];
    }
}

class TrendCard extends FormattingSettingsCard {
    series1Label = fxText("series1Label", "Series 1 label", "", "blank = field name");
    series2Label = fxText("series2Label", "Series 2 label", "", "blank = field name");
    yMin = fxText("yMin", "Y min", "", "blank = auto");
    yMax = fxText("yMax", "Y max", "", "blank = auto");
    series1Color = fxColor("series1Color", "Series 1 colour", BRAND.deepBlue);
    series2Color = fxColor("series2Color", "Series 2 colour", BRAND.teal);

    name = "trend";
    displayName = "Trend";
    slices: FormattingSettingsSlice[] = [this.series1Label, this.series2Label, this.yMin, this.yMax, this.series1Color, this.series2Color];
}

class QuadrantCard extends FormattingSettingsCard {
    xThreshold = fxText("xThreshold", "X threshold", "", "blank = auto (mean)");
    yThreshold = fxText("yThreshold", "Y threshold", "", "blank = auto (mean)");
    yInverted = new formattingSettings.ToggleSwitch({ name: "yInverted", displayName: "Invert Y (fewer is better up)", value: false });
    labelTL = fxText("labelTL", "Top-left label", "");
    labelTR = fxText("labelTR", "Top-right label", "");
    labelBL = fxText("labelBL", "Bottom-left label", "");
    labelBR = fxText("labelBR", "Bottom-right label", "");
    fillTL = fxColor("fillTL", "Top-left fill", BRAND.midGrey);
    fillTR = fxColor("fillTR", "Top-right fill", BRAND.mint);
    fillBL = fxColor("fillBL", "Bottom-left fill", BRAND.coral);
    fillBR = fxColor("fillBR", "Bottom-right fill", BRAND.midGrey);
    peerDotColor = fxColor("peerDotColor", "Peer dot colour", BRAND.midGrey);
    focusDotColor = fxColor("focusDotColor", "Focus dot colour", BRAND.deepBlue);
    labelFontSize = new formattingSettings.NumUpDown({ name: "labelFontSize", displayName: "Label size", value: 9 });

    name = "quadrant";
    displayName = "Peer quadrant";
    slices: FormattingSettingsSlice[] = [
        this.xThreshold, this.yThreshold, this.yInverted,
        this.labelTL, this.labelTR, this.labelBL, this.labelBR,
        this.fillTL, this.fillTR, this.fillBL, this.fillBR,
        this.peerDotColor, this.focusDotColor, this.labelFontSize
    ];
}

class SummaryCard extends FormattingSettingsCard {
    title = fxText("title", "Title", "SWING SUMMARY");
    boxColor = fxColor("boxColor", "Box colour", BRAND.deepBlue);
    textColor = fxColor("textColor", "Text colour", BRAND.white);

    name = "summary";
    displayName = "Summary box";
    slices: FormattingSettingsSlice[] = [this.title, this.boxColor, this.textColor];
}

class TextCard extends FormattingSettingsCard {
    fontFamily = new formattingSettings.FontPicker({
        name: "fontFamily", displayName: "Font family", value: BRAND.fontStack, ...FX
    });
    headlineSize = new formattingSettings.NumUpDown({ name: "headlineSize", displayName: "Headline size", value: 54 });
    sectionHeaderSize = new formattingSettings.NumUpDown({ name: "sectionHeaderSize", displayName: "Section header size", value: 10 });
    tileValueSize = new formattingSettings.NumUpDown({ name: "tileValueSize", displayName: "Tile value size", value: 24 });
    bodySize = new formattingSettings.NumUpDown({ name: "bodySize", displayName: "Body size", value: 11 });

    name = "text";
    displayName = "Text";
    slices: FormattingSettingsSlice[] = [this.fontFamily, this.headlineSize, this.sectionHeaderSize, this.tileValueSize, this.bodySize];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    sections = new SectionsCard();
    header = new HeaderCard();
    headline = new HeadlineCard();
    infoStrip = new InfoStripCard();
    kpiTiles = new KpiTilesCard();
    kpi1 = new KpiCard(1);
    kpi2 = new KpiCard(2);
    kpi3 = new KpiCard(3);
    kpi4 = new KpiCard(4);
    trend = new TrendCard();
    quadrant = new QuadrantCard();
    summary = new SummaryCard();
    text = new TextCard();

    cards = [
        this.sections, this.header, this.headline, this.infoStrip,
        this.kpiTiles, this.kpi1, this.kpi2, this.kpi3, this.kpi4,
        this.trend, this.quadrant, this.summary, this.text
    ];

    kpiCards(): KpiCard[] {
        return [this.kpi1, this.kpi2, this.kpi3, this.kpi4];
    }
}
