/**
 * Fiscal calendar model: turns the periodCalendar dataset into a year -> period -> week -> day tree.
 * Section numbers refer to FiscalCalendarSelector-writeup.md.
 *
 * All instants are epoch millis. Compare millis, never formatted strings (writeup quirk 8).
 */
import { Dataset } from '@inductiveautomation/perspective-client';

/** One dataset row (one fiscal week). See writeup 2.1. */
export interface CalendarRow {
    fyYear: number;
    period: number;
    fyWeek: number;
    wStart: number;
    wEnd: number;     // exclusive
    pStart: number;
    pEnd: number;     // exclusive
}

export const REQUIRED_COLUMNS = ['FYWeek', 'wStart', 'wEnd', 'FyYear', 'Period', 'pStart', 'pEnd'];

export interface ParseResult {
    rows: Array<CalendarRow>;
    error?: string;
}

export function toMillis(value: any): number | undefined {
    if (value === null || value === undefined) {
        return undefined;
    }
    if (typeof value === 'number') {
        return value;
    }
    if (value instanceof Date) {
        return value.getTime();
    }
    const parsed = new Date(value).getTime();
    return isNaN(parsed) ? undefined : parsed;
}

/**
 * Reads the dataset into typed rows and validates the required columns (writeup quirk 10: show an error instead of
 * rendering silently empty).
 */
export function parseCalendar(dataset: Dataset | null): ParseResult {
    if (!dataset || !dataset.columns) {
        return { rows: [], error: 'No periodCalendar dataset bound.' };
    }

    const byName: Record<string, Array<any>> = {};
    dataset.columns.forEach(c => byName[c.name] = c.data);

    const missing = REQUIRED_COLUMNS.filter(name => !byName[name]);
    if (missing.length > 0) {
        return { rows: [], error: `periodCalendar is missing column(s): ${missing.join(', ')}` };
    }

    const rows: Array<CalendarRow> = [];
    for (let i = 0; i < dataset.rowCount; i++) {
        const row = {
            fyYear: Number(byName.FyYear[i]),
            period: Number(byName.Period[i]),
            fyWeek: Number(byName.FYWeek[i]),
            wStart: toMillis(byName.wStart[i]),
            wEnd: toMillis(byName.wEnd[i]),
            pStart: toMillis(byName.pStart[i]),
            pEnd: toMillis(byName.pEnd[i])
        };
        if (row.wStart === undefined || row.wEnd === undefined || row.pStart === undefined || row.pEnd === undefined) {
            return { rows: [], error: `periodCalendar row ${i} has an empty or invalid date.` };
        }
        rows.push(row as CalendarRow);
    }
    return { rows };
}

// ---------------------------------------------------------------------------------------------------------------
// Tree model (writeup 2.2 and 7). Every node has the same base shape so a year can become selectable later
// (yearToggled) without changing the selection code.
// ---------------------------------------------------------------------------------------------------------------

export type NodeType = 'year' | 'period' | 'week' | 'day';

export interface FiscalNode {
    type: NodeType;
    key: string;        // full path key, e.g. "Y2024/P2/W5/D29"; used in props.selectedKeys
    label: string;      // "Y2024", "P2", "W5", "D29"
    number: number;     // the integer after the prefix
    fyYear: number;     // always the fiscal year, never getYear(end) (writeup quirk 1)
    start: number;
    end: number;        // exclusive
    children: Array<FiscalNode>;
}

/**
 * Builds the year -> period -> week -> day tree (writeup 2.2):
 *  - rows are grouped by FyYear and Period in a single pass (quirk 7: the original rebuilt each year once per row)
 *  - periods take their range from pStart/pEnd, weeks from wStart/wEnd
 *  - 7 generated days per week; day numbers run across the whole fiscal year (D1..D364/D371), reset per year
 *  - every level is sorted by its number, so input row order doesn't matter
 */
export function buildTree(rows: Array<CalendarRow>): Array<FiscalNode> {
    const years = new Map<number, Map<number, Array<CalendarRow>>>();
    rows.forEach(row => {
        let periods = years.get(row.fyYear);
        if (!periods) {
            periods = new Map<number, Array<CalendarRow>>();
            years.set(row.fyYear, periods);
        }
        let weekRows = periods.get(row.period);
        if (!weekRows) {
            weekRows = [];
            periods.set(row.period, weekRows);
        }
        weekRows.push(row);
    });

    const yearNodes: Array<FiscalNode> = [];
    years.forEach((periods, fyYear) => {
        const yearKey = `Y${fyYear}`;
        let dayCount = 0;

        const periodNodes = sortedKeys(periods).map(period => {
            const periodKey = `${yearKey}/P${period}`;
            const weekRows = periods.get(period)!.sort((a, b) => a.fyWeek - b.fyWeek);

            const weekNodes = weekRows.map(row => {
                const weekKey = `${periodKey}/W${row.fyWeek}`;
                const days = buildDays(row, weekKey, dayCount);
                dayCount += days.length;
                return makeNode('week', weekKey, 'W', row.fyWeek, fyYear, row.wStart, row.wEnd, days);
            });

            // pStart/pEnd repeat on every week row of the period, so any row will do.
            return makeNode('period', periodKey, 'P', period, fyYear, weekRows[0].pStart, weekRows[0].pEnd, weekNodes);
        });

        const yearStart = periodNodes[0].start;
        const yearEnd = periodNodes[periodNodes.length - 1].end;
        yearNodes.push(makeNode('year', yearKey, 'Y', fyYear, fyYear, yearStart, yearEnd, periodNodes));
    });

    return yearNodes.sort((a, b) => a.number - b.number);
}

/**
 * Generates the 7 days of a week, numbered after `daysBefore` days already counted in the fiscal year.
 *
 * Day boundaries use calendar-day math in the browser's local time (quirk 8), keeping wStart's time of day. Adding
 * j * 86400000 instead would put every boundary after a DST change an hour off. Keeping the time of day (rather
 * than forcing midnight) keeps boundaries aligned with the data if the browser isn't in the gateway's time zone.
 */
function buildDays(week: CalendarRow, weekKey: string, daysBefore: number): Array<FiscalNode> {
    const s = new Date(week.wStart);
    const dayStart = (j: number) =>
        new Date(s.getFullYear(), s.getMonth(), s.getDate() + j, s.getHours(), s.getMinutes()).getTime();

    const days: Array<FiscalNode> = [];
    for (let j = 0; j < 7; j++) {
        const day = daysBefore + j + 1;
        days.push(makeNode('day', `${weekKey}/D${day}`, 'D', day, week.fyYear, dayStart(j), dayStart(j + 1), []));
    }
    return days;
}

function sortedKeys<V>(map: Map<number, V>): Array<number> {
    return Array.from(map.keys()).sort((a, b) => a - b);
}

function makeNode(type: NodeType, key: string, prefix: string, number: number, fyYear: number,
                  start: number, end: number, children: Array<FiscalNode>): FiscalNode {
    return { type, key, label: `${prefix}${number}`, number, fyYear, start, end, children };
}

// ---------------------------------------------------------------------------------------------------------------
// Validation helpers. Run against sampleCalendarRows(), or against real rows from parseCalendar().
// ---------------------------------------------------------------------------------------------------------------

/**
 * Synthetic calendar shaped like the writeup's example: FY2024 (52 weeks from 2023-12-31), FY2025 (53 weeks, week 53
 * in P13), FY2026 (52 weeks). 157 rows, local midnights, returned newest first so row order is exercised too.
 */
export function sampleCalendarRows(): Array<CalendarRow> {
    const rows: Array<CalendarRow> = [];
    let yearStart = new Date(2023, 11, 31);
    const years: Array<[number, number]> = [[2024, 52], [2025, 53], [2026, 52]];

    years.forEach(([fyYear, weekCount]) => {
        const weekStarts: Array<number> = [];
        for (let w = 0; w <= weekCount; w++) {
            weekStarts.push(new Date(yearStart.getFullYear(), yearStart.getMonth(), yearStart.getDate() + 7 * w).getTime());
        }
        for (let w = 1; w <= weekCount; w++) {
            const period = Math.min(Math.ceil(w / 4), 13);
            const periodEndWeek = period === 13 ? weekCount : period * 4;
            rows.push({
                fyYear,
                period,
                fyWeek: w,
                wStart: weekStarts[w - 1],
                wEnd: weekStarts[w],
                pStart: weekStarts[(period - 1) * 4],
                pEnd: weekStarts[periodEndWeek]
            });
        }
        yearStart = new Date(weekStarts[weekCount]);
    });

    return rows.reverse();
}

/**
 * Checks a built tree and returns a list of problems (empty if it's valid):
 *  - day numbers run 1..N across each fiscal year
 *  - every day starts at local midnight and ends where the next day starts
 *  - each week's first and last day line up with the week's own start and end
 *  - each period's weeks tile the period, and each year's periods tile the year
 */
export function validateTree(tree: Array<FiscalNode>): Array<string> {
    const problems: Array<string> = [];

    const checkTiling = (parent: FiscalNode) => {
        const kids = parent.children;
        if (kids.length === 0) {
            problems.push(`${parent.key} has no children`);
            return;
        }
        if (kids[0].start !== parent.start || kids[kids.length - 1].end !== parent.end) {
            problems.push(`${parent.key} children don't start/end on its boundaries`);
        }
        for (let i = 1; i < kids.length; i++) {
            if (kids[i - 1].end !== kids[i].start) {
                problems.push(`gap or overlap between ${kids[i - 1].key} and ${kids[i].key}`);
            }
        }
    };

    tree.forEach(year => {
        checkTiling(year);
        let dayCount = 0;
        year.children.forEach(period => {
            checkTiling(period);
            period.children.forEach(week => {
                checkTiling(week);
                week.children.forEach(day => {
                    dayCount++;
                    if (day.number !== dayCount) {
                        problems.push(`${day.key} expected D${dayCount}`);
                    }
                    const start = new Date(day.start);
                    if (start.getHours() !== 0 || start.getMinutes() !== 0) {
                        problems.push(`${day.key} doesn't start at local midnight (${start.toString()})`);
                    }
                });
            });
        });
    });

    return problems;
}
